// ─────────────────────────────────────────────────────────────────────────────
// Reco Cloud Functions
//
// This file is the server-side gate that the client cannot bypass. Every key
// spend and every read of premium property data has to pass through here.
//
// Design rules (do not violate):
// 1. Client code must NEVER decrement `keysLeft` or write to
//    `/propertiesPremium`. Firestore rules block both. If a flow needs to
//    spend a key or serve premium data, add a callable Function here.
// 2. Every callable that spends keys does so inside a Firestore transaction
//    so a determined caller cannot race the check-then-decrement.
// 3. Region is southamerica-east1 to match Firestore, so writes are local.
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const RecoCatalogo = require('./shared/catalogo');
const RecoImport = require('./shared/import-core');
const WaCore = require('./whatsapp-core');

initializeApp();
const db = getFirestore();

const openaiKey = defineSecret('OPENAI_API_KEY');
const culqiSecretKey = defineSecret('CULQI_SECRET_KEY');
// Bot de WhatsApp (Cloud API de Meta). Ver whatsappWebhook más abajo.
const waToken = defineSecret('WHATSAPP_TOKEN');
const waAppSecret = defineSecret('WHATSAPP_APP_SECRET');
const waVerifyToken = defineSecret('WHATSAPP_VERIFY_TOKEN');
const waPhoneNumberId = defineString('WHATSAPP_PHONE_NUMBER_ID', { default: '' });

// Seed admin allowlist. Mirrors firestore.rules → isAdmin() fallback.
// Used by setAdminClaim to accept the current caller as admin even if
// their token does not yet carry the `admin` custom claim — needed so
// the very first invocation (when nobody has the claim yet) doesn't
// hit chicken-and-egg. Keep in sync with the rules block AND the
// client-side _ADMIN_EMAILS constant.
const SEED_ADMIN_EMAILS = ['webmaster@recosac.com', 'sebastiand@recosac.com'];

const REGION = 'southamerica-east1';
const CONTINUE_URL = 'https://recosac.com/';
const UNLOCK_COST = 1;
// Publicar es gratuito mientras la pasarela de pagos no esté conectada.
// Para volver a cobrar, poner el costo aquí y el mismo número en
// _PUB_COST dentro de index.html. Con 0 no se valida saldo ni se
// escribe movimiento de llaves.
const PUBLISH_COST = 0;
const HISTORY_CAP = 200;
const WELCOME_KEYS = 1;
// Max contactRequests a single fromUserId can create in the rolling
// last hour. Above this, submitContactRequest throws resource-exhausted.
// A legit user contacting 15 property owners in 60 minutes is already
// aggressive; anything much beyond that is scraper behaviour.
const CONTACT_RATE_LIMIT_PER_HOUR = 15;
const CONTACT_KINDS = ['arrendador', 'vendedor', 'asesor_reco', 'demanda_insatisfecha'];
const UNMET_DEMAND_PROPERTY_TYPES = ['Departamento', 'Casa', 'Terreno', 'Oficina', 'Otro'];
// Max getHistoricoDetail calls per authenticated user per rolling hour.
// A user browsing 500 histórico cards in one hour is already very
// intense; beyond that suggests a script trying to pull the full
// dataset. Hitting the cap throws resource-exhausted (client shows
// "demasiadas consultas, espera un momento").
const HIST_DETAIL_RATE_LIMIT_PER_HOUR = 500;
const RESET_RATE_LIMIT_PER_EMAIL_PER_HOUR = 3;

// AppCheck is ENFORCED on both callables (enforceAppCheck: true on
// the onCall config below). Requests without a valid reCAPTCHA v3
// token minted from an allowed origin are rejected with
// `unauthenticated` before this function body runs, so bot / curl
// traffic cannot burn the invocation quota.
//
// The helper below still fires from inside handler code so we get
// structured logs on the requests that make it past enforcement.
// If we ever need to roll back to soft mode, flip both callables to
// `consumeAppCheckToken: true, enforceAppCheck: false` and redeploy.
function _logAppCheck(request, fn) {
  const t = request.app; // v2 exposes { appId, token } after validation
  if (t && t.appId) {
    logger.info(`[${fn}] appCheck ok`, {
      appId: t.appId,
      uid: request.auth && request.auth.uid,
    });
  } else {
    const headers = (request.rawRequest && request.rawRequest.headers) || {};
    logger.warn(`[${fn}] appCheck MISSING`, {
      uid: request.auth && request.auth.uid,
      ua: headers['user-agent'],
      origin: headers['origin'],
    });
  }
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

// Any callable that changes state or reads premium data must go through
// this. Two properties matter:
//   1. The caller has to be authenticated.
//   2. Their email has to be verified — otherwise anyone can register
//      with a throwaway address and start burning keys / creating
//      publications tied to an inbox they don't actually own. Google
//      sign-in already returns email_verified: true, so those callers
//      pass this check on the first login.
// The failed-precondition code is reused by the client to trigger the
// "verificá tu email" banner instead of a generic error toast.
function requireVerifiedAuth(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const token = request.auth.token || {};
  if (token.email_verified !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verificá tu email antes de continuar. Revisá tu bandeja de entrada (y spam) por el link que te enviamos.',
      { reason: 'email_not_verified' }
    );
  }
}

// Tipo, operación, moneda y estado: valores canónicos y sinónimos en
// shared/catalogo.js (el mismo archivo que usa index.html).
// 'bulk' = Excel/CSV (nombre histórico); el resto son los canales del
// roadmap de carga inteligente (docs/ROADMAP-CARGA-INTELIGENTE.md).
const PUB_SOURCES = ['single', 'bulk', 'text', 'whatsapp', 'documento', 'url', 'pdf', 'feed'];

// ── Importación (Fase 0) ──
// Borradores en /importDrafts: se borran solos (política TTL sobre
// expiresAt) si nadie los publica en IMPORT_DRAFT_TTL_DAYS.
const IMPORT_DRAFT_TTL_DAYS = 30;
const IMPORT_TEXT_MAX_CHARS = 20000;
const IMPORT_MAX_LISTINGS_PER_CALL = 50;
const IMPORT_AI_LIMIT_PER_HOUR = 30;
const IMPORT_AI_KINDS = ['text', 'document'];
const IMPORT_TEXT_CHANNELS = ['text', 'whatsapp'];
const DRAFT_ID_RE = /^[A-Za-z0-9]{1,40}$/;
// Fotos del bot de WhatsApp guardadas en Storage: imports/{uid}/{lote}/{n}.ext
const IMPORT_PHOTO_PATH_RE = /^imports\/[A-Za-z0-9]{1,128}\/[A-Za-z0-9]{1,40}\/\d{1,3}\.(jpg|png|webp)$/;

// ─────────────────────────────────────────────────────────────────────────────
// unlockProperty — spend 1 key, receive premium fields for one property.
//
// Client contract:
//   const fn = firebase.functions().httpsCallable('unlockProperty');
//   const { data } = await fn({ propertyId: '885-RP4625-25' });
//   // data = { premium: {...}, keysLeft, alreadyUnlocked }
//
// Errors (HttpsError):
//   unauthenticated       — no auth context
//   invalid-argument      — propertyId missing / not a string
//   not-found             — property does not exist in /propertiesPremium
//   failed-precondition   — user has 0 keys
//
// Idempotency: if the user has already unlocked this propertyId, the call
// returns the premium data without charging again. This lets the client
// re-fetch premium data on refresh without risking a double charge.
// ─────────────────────────────────────────────────────────────────────────────
exports.unlockProperty = onCall(
  {
    region: REGION,
    maxInstances: 10,
    // AppCheck enforced: requests without a valid reCAPTCHA v3 token
    // are rejected before this function runs. Soft-mode logs from
    // PR #66 / #68 confirmed real browser traffic carries valid
    // tokens (verifications.app === 'VALID'), so it's safe to flip.
    // Rolling back is one PR: flip both flags to
    // `consumeAppCheckToken: true, enforceAppCheck: false`.
    consumeAppCheckToken: true,
    enforceAppCheck: true,
  },
  async (request) => {
    _logAppCheck(request, 'unlockProperty');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const propertyId = request.data && request.data.propertyId;
    if (!propertyId || typeof propertyId !== 'string' || propertyId.length > 128) {
      throw new HttpsError('invalid-argument', 'propertyId requerido (string, <=128 chars).');
    }

    const userRef = db.collection('users').doc(uid);
    const premiumRef = db.collection('propertiesPremium').doc(propertyId);

    try {
      return await _unlockTx(userRef, premiumRef, propertyId);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      // Unexpected failure (transaction contention, Firestore outage…).
      // Log with context so it is traceable in Cloud Logging, and return
      // a retryable code instead of a bare INTERNAL. The transaction
      // either committed fully or not at all, and the call is idempotent,
      // so the client can safely retry.
      logger.error('[unlockProperty] unexpected error', {
        uid, propertyId, err: e && e.message, code: e && e.code,
      });
      throw new HttpsError('unavailable', 'No pudimos desbloquear el inmueble en este momento. Reintentá.');
    }
  }
);

function _unlockTx(userRef, premiumRef, propertyId) {
  return db.runTransaction(async (tx) => {
    const [userSnap, premiumSnap] = await Promise.all([tx.get(userRef), tx.get(premiumRef)]);

    if (!premiumSnap.exists) {
      // Until the migration PR lands, /propertiesPremium is empty and every
      // call returns not-found. The client can already wire onto this
      // callable and get the correct shape of error, so the switch-over PR
      // becomes a data + frontend flip only.
      throw new HttpsError('not-found', 'Propiedad no encontrada.');
    }

    const userData = userSnap.exists ? userSnap.data() : {};
    const currentKeys = Number(userData.keysLeft) || 0;
    const unlockedIds = Array.isArray(userData.unlockedIds) ? userData.unlockedIds : [];
    const alreadyUnlocked = unlockedIds.includes(propertyId);

    if (alreadyUnlocked) {
      return { premium: premiumSnap.data(), keysLeft: currentKeys, alreadyUnlocked: true };
    }

    if (currentKeys < UNLOCK_COST) {
      throw new HttpsError(
        'failed-precondition',
        `Sin llaves suficientes. Necesitas ${UNLOCK_COST} llave para desbloquear este inmueble.`,
        { reason: 'no_keys' }
      );
    }

    const premium = premiumSnap.data();
    const propLabel = [premium.address, premium.district].filter(Boolean).join(', ') || propertyId;
    const historyEntry = {
      type: 'use',
      qty: UNLOCK_COST,
      propId: propertyId,
      propLabel,
      date: new Date().toISOString(),
    };
    const nextHistory = [historyEntry, ...(Array.isArray(userData.keyHistory) ? userData.keyHistory : [])].slice(0, HISTORY_CAP);
    const nextUnlocked = [...unlockedIds, propertyId];

    tx.set(userRef, {
      keysLeft: currentKeys - UNLOCK_COST,
      unlockedIds: nextUnlocked,
      keyHistory: nextHistory,
    }, { merge: true });

    return {
      premium,
      keysLeft: currentKeys - UNLOCK_COST,
      alreadyUnlocked: false,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// publishProperty — spend 3 keys, create one /publications doc with
// status: 'pending' so it enters the moderation queue.
//
// Client contract:
//   const fn = firebase.functions().httpsCallable('publishProperty');
//   const { data } = await fn({
//     address, district, lat, lng,
//     type, op, currency, price, area,
//     areaTerr, beds, baths, parking, floor, floors, age,
//     estado, ascensor, amoblado, petFriendly,
//     features, title, desc,
//     source, // 'single' | 'bulk'
//   });
//   // data = { publicationId, keysLeft }
//   area = área techada. Lo guardado como `area` es el área principal (la
//   de terreno en un Terreno); además se guardan areaTech y areaTerr.
//
// Errors (HttpsError):
//   unauthenticated       — no auth context
//   invalid-argument      — missing / malformed field, o no pasa
//                           RecoCatalogo.verificarPublicacion (details.errores)
//   failed-precondition   — caller has fewer than 3 keys
//
// Photos are NOT part of this callable. The client uploads them to
// Storage under publications/{publicationId}/* AFTER receiving the doc
// id, then does a client-side owner update to set photoUrls on the same
// doc — Firestore rules still allow that update path for the owner
// while the publication is pending.
//
// The check-and-decrement runs inside a Firestore transaction so a
// caller with 3 keys firing off ten publishProperty calls in parallel
// gets exactly ONE success and nine failed-precondition errors — not
// ten publications for the price of three.
// ─────────────────────────────────────────────────────────────────────────────
exports.publishProperty = onCall(
  {
    region: REGION,
    maxInstances: 20,
    // AppCheck enforced (same as unlockProperty). See _logAppCheck
    // and the file-header comment for the rollback path.
    consumeAppCheckToken: true,
    enforceAppCheck: true,
  },
  async (request) => {
    _logAppCheck(request, 'publishProperty');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const raw = request.data;
    if (!raw || typeof raw !== 'object') {
      throw new HttpsError('invalid-argument', 'Cuerpo de la publicación requerido.');
    }

    // Validate + coerce
    const strOrThrow = (v, name, max = 500) => {
      if (v == null) throw new HttpsError('invalid-argument', `Falta ${name}.`);
      const s = String(v).trim();
      if (!s) throw new HttpsError('invalid-argument', `Falta ${name}.`);
      if (s.length > max) throw new HttpsError('invalid-argument', `${name} muy largo (máx ${max}).`);
      return s;
    };
    const address  = strOrThrow(raw.address, 'address');
    const district = strOrThrow(raw.district, 'district');
    const title    = strOrThrow(raw.title, 'title', 200);
    const desc     = strOrThrow(raw.desc, 'desc', 5000);

    const type = RecoCatalogo.matchType(raw.type);
    const op = RecoCatalogo.matchOp(raw.op);
    const currency = RecoCatalogo.matchCurrency(raw.currency);
    if (!type) throw new HttpsError('invalid-argument', 'type inválido.');
    if (!op) throw new HttpsError('invalid-argument', 'op inválido.');
    if (!currency) throw new HttpsError('invalid-argument', 'currency inválido.');

    // Verificación previa a publicar (shared/catalogo.js): la misma que
    // corren la carga masiva y el formulario antes de llamar aquí. Exige el
    // área según el tipo (techada; de terreno para Terreno) y deja en 0 lo
    // que no aplica. raw.area = área techada; pubData.area = área principal.
    const verif = RecoCatalogo.verificarPublicacion(raw);
    if (verif.errores.length) {
      throw new HttpsError('invalid-argument', verif.errores.join('; ') + '.', { errores: verif.errores });
    }
    const price = Number(raw.price);

    // "En planos", "Preventa", "E/C"… → canónico. En proyecto y En
    // construcción siempre se guardan con antigüedad 0.
    const { estado, antiguedad: age } = RecoCatalogo.resolveEstadoAntiguedad(raw.estado, raw.age);
    const source = PUB_SOURCES.includes(raw.source) ? raw.source : 'single';
    const features = Array.isArray(raw.features)
      ? raw.features.filter(f => typeof f === 'string' && f.length < 100).slice(0, 30)
      : [];

    const lat = (typeof raw.lat === 'number' && isFinite(raw.lat)) ? raw.lat : null;
    const lng = (typeof raw.lng === 'number' && isFinite(raw.lng)) ? raw.lng : null;

    const numOrZero = (v) => { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0; };

    const userRef = db.collection('users').doc(uid);
    const pubRef = db.collection('publications').doc(); // pre-generate id
    // Si viene de un borrador de importación, se borra en la misma
    // transacción: o queda publicado y sin borrador, o nada cambia.
    const draftRef = (typeof raw.importDraftId === 'string' && DRAFT_ID_RE.test(raw.importDraftId))
      ? db.collection('importDrafts').doc(raw.importDraftId) : null;

    const out = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : {};
      const draftSnap = draftRef ? await tx.get(draftRef) : null;
      const draft = (draftSnap && draftSnap.exists && draftSnap.data().uid === uid) ? draftSnap.data() : null;
      const currentKeys = Number(userData.keysLeft) || 0;
      if (PUBLISH_COST > 0 && currentKeys < PUBLISH_COST) {
        throw new HttpsError(
          'failed-precondition',
          `Sin llaves suficientes. Necesitas ${PUBLISH_COST} llaves para publicar (tenés ${currentKeys}).`
        );
      }

      const pubData = {
        userId: uid,
        userEmail: (request.auth.token && request.auth.token.email) || null,
        userName: (userData && userData.displayName) || null,
        status: 'pending',
        source,
        createdAt: FieldValue.serverTimestamp(),
        listedAt: new Date().toISOString(),
        address, district,
        lat, lng,
        type,
        op,
        currency,
        price,
        beds: numOrZero(raw.beds),
        baths: numOrZero(raw.baths),
        parking: numOrZero(raw.parking),
        floor: numOrZero(raw.floor),
        unitFloors: Math.max(1, numOrZero(raw.unitFloors) || 1),
        floors: numOrZero(raw.floors),
        age,
        estado,
        ascensor: Boolean(raw.ascensor),
        amoblado: Boolean(raw.amoblado),
        petFriendly: Boolean(raw.petFriendly),
        features,
        title, desc,
        photoUrls: [],
        // area (principal), areaTech, areaTerr y los campos que no aplican
        // al tipo ya en 0 (p. ej. dormitorios en un Terreno).
        ...verif.datos,
      };
      pubData.fingerprint = RecoImport.fingerprint(pubData);
      if (draft) {
        // Métricas de calidad de la importación (roadmap 0.5).
        pubData.importChannel = draft.source || null;
        pubData.importAiFields = Array.isArray(draft.aiFields) ? draft.aiFields.length : 0;
        pubData.importEdits = Math.min(50, Math.max(0, Math.floor(Number(raw.importEdits) || 0)));
      }

      tx.set(pubRef, pubData);
      if (draft) tx.delete(draftRef);

      // Con costo 0 no se debita nada ni se ensucia el historial de
      // llaves con movimientos vacíos.
      if (PUBLISH_COST > 0) {
        const historyEntry = {
          type: 'use',
          qty: PUBLISH_COST,
          propId: null,
          propLabel: 'Publicación: ' + title,
          date: new Date().toISOString(),
        };
        const nextHistory = [historyEntry, ...(Array.isArray(userData.keyHistory) ? userData.keyHistory : [])].slice(0, HISTORY_CAP);

        tx.set(userRef, {
          keysLeft: currentKeys - PUBLISH_COST,
          keyHistory: nextHistory,
        }, { merge: true });
      }

      return {
        publicationId: pubRef.id,
        keysLeft: currentKeys - PUBLISH_COST,
      };
    });

    // Fotos de borradores del bot de WhatsApp (imports/{uid}/…): se copian
    // a publications/{pubId}/{uid}/ y van primero en photoUrls. El cliente
    // sube las demás fotos después, a continuación de estas.
    const importPhotos = (Array.isArray(raw.importPhotos) ? raw.importPhotos : [])
      .filter((p) => typeof p === 'string' && IMPORT_PHOTO_PATH_RE.test(p) && p.startsWith(`imports/${uid}/`)).slice(0, 12);
    if (importPhotos.length) {
      const { getStorage } = require('firebase-admin/storage');
      const bucket = getStorage().bucket();
      const photoUrls = [];
      for (let i = 0; i < importPhotos.length; i++) {
        try {
          const dest = `publications/${pubRef.id}/${uid}/${i}.jpg`;
          const token = require('crypto').randomUUID();
          await bucket.file(importPhotos[i]).copy(bucket.file(dest), { metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
          photoUrls.push(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`);
        } catch (e) {
          logger.warn('[publishProperty] foto importada no copiada', { path: importPhotos[i], err: e && e.message });
        }
      }
      if (photoUrls.length) await pubRef.update({ photoUrls });
      out.photoUrls = photoUrls;
    }
    return out;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// submitContactRequest — create a contactRequest doc, subject to a
// per-user rate limit that Firestore rules cannot express.
//
// Client contract:
//   const fn = firebase.functions().httpsCallable('submitContactRequest');
//   const { data } = await fn({
//     propertyId, kind,
//     publicationOwnerId?, publicationOwnerEmail?, publicationOwnerName?,
//     propertyAddress?, propertyDistrict?, propertyOp?,
//     propertyPrice?, propertyCurrency?,
//     fromName, fromEmail, fromPhone?, message
//   });
//   // data = { contactRequestId }
//
// Errors:
//   unauthenticated       — no auth context
//   failed-precondition   — email not verified
//   invalid-argument      — missing / malformed field
//   already-exists        — this (fromUserId, propertyId, kind) already contacted
//   resource-exhausted    — hit CONTACT_RATE_LIMIT_PER_HOUR
//
// The doc ID is deterministic: `${uid}_${propertyId}_${kind}`. The
// rules used to enforce that shape from the client; now the callable
// enforces it server-side and Firestore rules deny direct client
// creates. Rate limit: count contactRequests by this uid with
// createdAt > now-1h and reject when the count is at the cap.
// ─────────────────────────────────────────────────────────────────────────────
exports.submitContactRequest = onCall(
  {
    region: REGION,
    maxInstances: 20,
    consumeAppCheckToken: true,
    enforceAppCheck: true,
  },
  async (request) => {
    _logAppCheck(request, 'submitContactRequest');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const raw = request.data;
    if (!raw || typeof raw !== 'object') {
      throw new HttpsError('invalid-argument', 'Cuerpo del contacto requerido.');
    }

    // Validate + coerce
    const str = (v, name, max) => {
      if (v == null) throw new HttpsError('invalid-argument', `Falta ${name}.`);
      const s = String(v).trim();
      if (!s) throw new HttpsError('invalid-argument', `Falta ${name}.`);
      if (s.length > max) throw new HttpsError('invalid-argument', `${name} muy largo (máx ${max}).`);
      return s;
    };
    const optStr = (v, max) => {
      if (v == null) return null;
      const s = String(v).trim();
      if (!s) return null;
      return s.slice(0, max);
    };

    const kind = raw.kind;
    if (!CONTACT_KINDS.includes(kind)) {
      throw new HttpsError('invalid-argument', 'kind inválido.');
    }
    const isUnmetDemand = kind === 'demanda_insatisfecha';
    // propertyId is optional for demanda_insatisfecha (submitted from the map
    // without a specific listing); required for all other contact kinds.
    const propertyId = isUnmetDemand
      ? optStr(raw.propertyId, 128)
      : str(raw.propertyId, 'propertyId', 128);
    const fromName  = str(raw.fromName, 'fromName', 200);
    const fromEmail = str(raw.fromEmail, 'fromEmail', 200);
    if (!/.+@.+\..+/.test(fromEmail)) {
      throw new HttpsError('invalid-argument', 'fromEmail inválido.');
    }
    const message = isUnmetDemand ? optStr(raw.message, 2000) || '' : str(raw.message, 'message', 2000);
    if (!isUnmetDemand && message.length < 10) {
      throw new HttpsError('invalid-argument', 'El mensaje debe tener al menos 10 caracteres.');
    }

    let unmetFields = {};
    if (isUnmetDemand) {
      const referenceZone = str(raw.referenceZone, 'referenceZone', 500);
      const propertyTypeWanted = raw.propertyTypeWanted;
      if (!UNMET_DEMAND_PROPERTY_TYPES.includes(propertyTypeWanted)) {
        throw new HttpsError('invalid-argument', 'propertyTypeWanted inválido.');
      }
      const budgetReference = optStr(raw.budgetReference, 200);
      const viewType = optStr(raw.viewType, 40);
      const source = optStr(raw.source, 40);
      unmetFields = { referenceZone, propertyTypeWanted, budgetReference, viewType, source };
    }

    // demanda_insatisfecha allows unlimited submissions (no per-user cap);
    // all other kinds use a deterministic ID so duplicate contacts to the
    // same owner are blocked by Firestore's create-if-not-exists semantics.
    const reqId = isUnmetDemand
      ? null
      : `${uid}_${propertyId}_${kind}`;
    const reqRef = isUnmetDemand
      ? db.collection('contactRequests').doc()
      : db.collection('contactRequests').doc(reqId);

    if (!isUnmetDemand) {
      const existing = await reqRef.get();
      if (existing.exists) {
        throw new HttpsError(
          'already-exists',
          'Ya contactaste al propietario de este inmueble.'
        );
      }
    }

    const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
    const oneHourAgo = new Date(oneHourAgoMs);
    const recent = await db.collection('contactRequests')
      .where('fromUserId', '==', uid)
      .where('createdAt', '>=', oneHourAgo)
      .count()
      .get();
    if (recent.data().count >= CONTACT_RATE_LIMIT_PER_HOUR) {
      logger.warn(`[submitContactRequest] rate-limit hit`, {
        uid,
        recentCount: recent.data().count,
        limit: CONTACT_RATE_LIMIT_PER_HOUR,
      });
      throw new HttpsError(
        'resource-exhausted',
        `Alcanzaste el límite de ${CONTACT_RATE_LIMIT_PER_HOUR} contactos por hora. Reintentá en un rato.`
      );
    }

    const pubOwnerId = optStr(raw.publicationOwnerId, 128);

    await reqRef.create({
      propertyId,
      propertyAddress:     optStr(raw.propertyAddress, 500),
      propertyDistrict:    optStr(raw.propertyDistrict, 100),
      propertyOp:          optStr(raw.propertyOp, 40),
      propertyPrice:       (typeof raw.propertyPrice === 'number' && isFinite(raw.propertyPrice)) ? raw.propertyPrice : null,
      propertyCurrency:    optStr(raw.propertyCurrency, 10),
      publicationOwnerId:    isUnmetDemand ? null : pubOwnerId,
      publicationOwnerEmail: isUnmetDemand ? null : optStr(raw.publicationOwnerEmail, 200),
      kind,
      source:              optStr(raw.source, 40),
      fromUserId:          uid,
      fromName,
      fromEmail,
      fromPhone:           optStr(raw.fromPhone, 40),
      message,
      ...unmetFields,
      status:              'new',
      createdAt:           FieldValue.serverTimestamp(),
    });

    // Notify all corredores when a client submits an advisor search request.
    if (isUnmetDemand) {
      try {
        const corredoresSnap = await db.collection('users')
          .where('isCorredor', '==', true)
          .get();
        if (!corredoresSnap.empty) {
          const notifBatch = db.batch();
          corredoresSnap.docs.forEach(corredorDoc => {
            const notifRef = db.collection('notifications').doc();
            notifBatch.set(notifRef, {
              userId:              corredorDoc.id,
              kind:                'advisor_request',
              read:                false,
              createdAt:           FieldValue.serverTimestamp(),
              contactRequestId:    reqId,
              fromName,
              fromEmail,
              fromPhone:           optStr(raw.fromPhone, 40) || null,
              referenceZone:       unmetFields.referenceZone || null,
              propertyTypeWanted:  unmetFields.propertyTypeWanted || null,
              budgetReference:     unmetFields.budgetReference || null,
              viewType:            unmetFields.viewType || null,
              message:             message || null,
            });
          });
          await notifBatch.commit();
        }
      } catch (e) {
        logger.warn('[submitContactRequest] corredor notifications failed', {
          reqId, err: e && e.message,
        });
      }
    }

    // Queue an email to the publication owner via /mail → Resend.
    // Only user-published properties have an owner; the ~2,663 static
    // properties have no publication owner so no email goes out for those.
    if (pubOwnerId) {
      try {
        const ownerUser = await getAuth().getUser(pubOwnerId);
        if (ownerUser.email) {
          const propLine = [optStr(raw.propertyAddress, 500), optStr(raw.propertyDistrict, 100)]
            .filter(Boolean).join(', ') || '—';
          const kindLabel = kind === 'arrendador' ? 'alquilar' : 'comprar';
          const ownerName = (ownerUser.displayName || '').split(' ')[0];
          const ownerGreeting = ownerName ? `Hola ${_esc(ownerName)},` : 'Hola,';
          await db.collection('mail').add({
            to: ownerUser.email,
            replyTo: fromEmail,
            message: {
              subject: `Nuevo interesado en tu inmueble (${propLine})`,
              html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="color:#0891b2">Nuevo interesado en tu inmueble</h2>
  <p>${ownerGreeting}</p>
  <p>Alguien está interesado en <strong>${kindLabel}</strong> tu propiedad de <strong>${_esc(propLine)}</strong>.</p>
  <div style="background:#f1f5f9;border-radius:10px;padding:14px 16px;margin:16px 0">
    <p style="margin:0 0 6px"><strong>Nombre:</strong> ${_esc(fromName)}</p>
    <p style="margin:0 0 6px"><strong>Email:</strong> <a href="mailto:${_esc(fromEmail)}">${_esc(fromEmail)}</a></p>
    ${raw.fromPhone ? `<p style="margin:0 0 6px"><strong>Teléfono:</strong> ${_esc(optStr(raw.fromPhone, 40))}</p>` : ''}
    <p style="margin:12px 0 0"><strong>Mensaje:</strong></p>
    <p style="margin:4px 0 0;white-space:pre-wrap">${_esc(message)}</p>
  </div>
  <p>Responde directamente al email del interesado para coordinar.</p>
  <p style="color:#64748b;font-size:.85rem;margin-top:32px">— Equipo Reco</p>
</div>`,
              text: `${ownerName ? 'Hola ' + ownerName + ',' : 'Hola,'}\n\nAlguien está interesado en ${kindLabel} tu propiedad de ${propLine}.\n\nNombre: ${fromName}\nEmail: ${fromEmail}\n${raw.fromPhone ? 'Teléfono: ' + optStr(raw.fromPhone, 40) + '\n' : ''}\nMensaje:\n${message}\n\n— Equipo Reco`,
            },
          });
        }
      } catch (e) {
        logger.warn('[submitContactRequest] contact-owner email failed', {
          reqId, ownerEmail: (e && e.code === 'auth/user-not-found') ? null : pubOwnerId,
          err: e && e.message,
        });
        try {
          await db.collection('adminAuditLog').add({
            adminUid: 'system',
            adminEmail: null,
            action: 'mail.contactOwnerFailed',
            targetType: 'contactRequest',
            targetId: reqId,
            extras: { pubOwnerId, err: (e && e.message || '').slice(0, 300) },
            createdAt: FieldValue.serverTimestamp(),
          });
        } catch (_) { /* best effort */ }
      }
    }

    return { contactRequestId: reqId };
  }
);

// getHistoricoDetail — return the price and area fields for one histórico.
//
// These used to live in the public data/properties.json shipped with the
// SPA. Anyone with `curl` could scrape the full 1,750-row histórico
// dataset in one request: address, exact sale price, propietario,
// estacionamiento breakdown proxy, month index. That defeats the value
// prop of Reco (having those numbers curated), so this callable moves
// the sensitive fields behind auth + AppCheck + a per-user rate limit.
//
// Client contract:
//   const fn = firebase.functions().httpsCallable('getHistoricoDetail');
//   const { data } = await fn({ propertyId: '748-1749-20' });
//   // data = { detail: { price, priceTotal, priceProp, areaTech, areaOcup, txKey, cur } }
//
// Errors:
//   unauthenticated       — no auth context / AppCheck failed
//   failed-precondition   — email not verified
//   invalid-argument      — missing / malformed propertyId
//   not-found             — id has no detail doc (non-histórico or unmigrated)
//   resource-exhausted    — hit HIST_DETAIL_RATE_LIMIT_PER_HOUR
//
// Idempotent: reading the same detail 500 times returns the same
// numbers. Rate-limit records live in /histDetailAccess and are
// pruned by a scheduled function (or grow indefinitely with minimal
// cost; consider TTL policy after v1).
// ─────────────────────────────────────────────────────────────────────────────
exports.getHistoricoDetail = onCall(
  {
    region: REGION,
    maxInstances: 20,
    consumeAppCheckToken: true,
    enforceAppCheck: true,
  },
  async (request) => {
    _logAppCheck(request, 'getHistoricoDetail');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const propertyId = request.data && request.data.propertyId;
    if (!propertyId || typeof propertyId !== 'string' || propertyId.length > 128) {
      throw new HttpsError('invalid-argument', 'propertyId requerido.');
    }

    // Rate limit: aggregation count of this uid's accesses in the last
    // rolling hour. count() is a single billed operation regardless of
    // the number of matched docs, so this stays cheap even if a user
    // hits the cap. Trades a tiny race window for simplicity — a burst
    // of parallel requests may overshoot the cap by a handful, which
    // is acceptable for a browsing rate limit (not a payment gate).
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const recentSnap = await db.collection('histDetailAccess')
      .where('uid', '==', uid)
      .where('at', '>', oneHourAgo)
      .count().get();
    const recent = recentSnap.data().count;
    if (recent >= HIST_DETAIL_RATE_LIMIT_PER_HOUR) {
      throw new HttpsError(
        'resource-exhausted',
        `Demasiadas consultas de detalle en la última hora (máx ${HIST_DETAIL_RATE_LIMIT_PER_HOUR}). Intenta de nuevo más tarde.`
      );
    }

    const detailRef = db.collection('propertiesHistoricoDetail').doc(propertyId);
    const snap = await detailRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Detalle no encontrado.');
    }

    // Log the access AFTER the read succeeds. Not inside a transaction
    // with the count(): the aggregation query cannot participate in a
    // Firestore transaction. The trade-off is documented above.
    await db.collection('histDetailAccess').add({
      uid,
      propertyId,
      at: FieldValue.serverTimestamp(),
    });

    return { detail: snap.data() };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// onMailWrite — trigger on /mail docs.
//
// The "Trigger Email from Firestore" Firebase extension writes a
// `delivery` subfield to each /mail doc as it processes it:
//   { state: 'PENDING' | 'SUCCESS' | 'ERROR' | 'RETRY', ... }
//
// Before this trigger, an ERROR was completely silent — nothing in the
// app or in Cloud Logging surfaced the failure, so a Resend outage or a
// bad SMTP config could bury moderation notifications and contact-owner
// emails for days without anyone noticing. This trigger:
//
//   1. Watches every /mail create + update.
//   2. When delivery.state flips to ERROR (or on any RETRY beyond ~3
//      attempts), writes a WARN log with the doc id, `to`, subject and
//      the exact error string from the extension.
//   3. That WARN log is easy to alert on: set up a Cloud Logging
//      Alerting Policy (Cloud Console → Monitoring → Alerting) that
//      fires when this Function emits a WARN. Ping goes to
//      admin's email / Slack without any code changes here.
//
// We do NOT try to auto-retry — the extension already retries with
// backoff on transient errors. This function is purely observability.
// ─────────────────────────────────────────────────────────────────────────────
exports.onMailWrite = onDocumentWritten(
  { region: REGION, document: 'mail/{mailId}' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.data();
    if (!after || !after.delivery) return;
    const before = event.data && event.data.before && event.data.before.data();
    const beforeState = before && before.delivery && before.delivery.state;
    const state = after.delivery.state;

    // Only fire when we transition INTO an error-like state. Avoids
    // repeat WARNs on subsequent updates that keep state === 'ERROR'.
    const isNewError = state === 'ERROR' && beforeState !== 'ERROR';
    const isRetryPastThreshold =
      state === 'RETRY' &&
      typeof after.delivery.attempts === 'number' &&
      after.delivery.attempts >= 3 &&
      (!before || !before.delivery || before.delivery.attempts !== after.delivery.attempts);

    if (!isNewError && !isRetryPastThreshold) return;

    const to = Array.isArray(after.to) ? after.to.join(', ') : after.to;
    const subject = (after.message && after.message.subject) || '(no subject)';
    const errorInfo = after.delivery.info || after.delivery.error || null;

    const mailId = event.params && event.params.mailId;
    const errorStr = errorInfo ? JSON.stringify(errorInfo).slice(0, 500) : null;

    logger.warn(`[onMailWrite] mail ${state}`, {
      mailId, to, subject: String(subject).slice(0, 200), state,
      attempts: after.delivery.attempts, error: errorStr,
      fromUserId: after.fromUserId || null,
    });

    // Also write to /adminAuditLog so admins see mail failures in-app
    // (alongside publication moderation, contactRequest handling, etc.)
    // without having to open Cloud Logging. The admin SDK bypasses the
    // rule that normally requires adminUid == request.auth.uid; we use
    // 'system' as the adminUid marker so it's obvious from the log
    // which entries came from a Cloud Function versus a real admin.
    try {
      await db.collection('adminAuditLog').add({
        adminUid: 'system',
        adminEmail: null,
        action: state === 'ERROR' ? 'mail.error' : 'mail.retryLimit',
        targetType: 'mail',
        targetId: mailId,
        extras: {
          to: String(to || '').slice(0, 200),
          subject: String(subject).slice(0, 200),
          state,
          attempts: after.delivery.attempts || null,
          error: errorStr,
          fromUserId: after.fromUserId || null,
        },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('[onMailWrite] adminAuditLog write failed', { mailId, err: e && e.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// cleanupHistDetailAccess — scheduled cleanup for /histDetailAccess.
//
// getHistoricoDetail writes one doc per call to /histDetailAccess so
// the rate-limit aggregation count() knows how many calls a uid made
// in the last hour. Those docs have no purpose past that 1-hour
// window — after they age out of the rate window, they're just paying
// storage cost forever.
//
// This scheduled function runs every 6 hours, queries for docs with
// `at < now - 2h`, and batch-deletes them. Buffer past the 1-hour
// rate-limit window so we never race with an in-flight aggregation.
//
// Scale check: at 500 requests/user/hour * 100 active users = 50k
// docs/hour, cleanup deletes ~300k per run. Firestore batch cap is
// 500, so we chunk into multiple batches. Runs southamerica-east1
// same as the rest.
// ─────────────────────────────────────────────────────────────────────────────
exports.cleanupHistDetailAccess = onSchedule(
  { region: REGION, schedule: 'every 6 hours', timeZone: 'America/Lima', memory: '256MiB' },
  async () => {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    let totalDeleted = 0;
    let round = 0;
    const perRoundLimit = 500;

    // Chunk deletes into batches of 500 (Firestore batch cap).
    // Loop until a query returns fewer than the limit — that's when
    // there's nothing older left.
    while (true) {
      round++;
      const snap = await db.collection('histDetailAccess')
        .where('at', '<', cutoff)
        .limit(perRoundLimit)
        .get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += snap.size;

      // Safety brake: never run more than 200 rounds (100k deletes)
      // in a single invocation. If we're consistently hitting this
      // cap the schedule is too infrequent or a bot is hammering
      // getHistoricoDetail — page a human.
      if (round >= 200) {
        logger.warn(`[cleanupHistDetailAccess] hit round cap`, { totalDeleted, round });
        break;
      }
      if (snap.size < perRoundLimit) break;
    }

    logger.info(`[cleanupHistDetailAccess] deleted ${totalDeleted} old access records in ${round} rounds`);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// grantWelcomeKey — give every new user WELCOME_KEYS free keys.
//
// Fires when a /users/{uid} document is first created (by
// _sanitizedSeed() on the client, which seeds keysLeft: 0). The admin
// SDK bypasses Firestore rules, so it can set keysLeft to a non-zero
// value that the client create rule intentionally blocks.
//
// Abuse surface: a user cannot re-trigger this by deleting and
// re-creating their doc — the Firestore rule `allow delete: if false`
// on /users prevents client-side deletion. Re-creating an existing doc
// (set without merge) also fails because _pullUserDataFromFirestore
// only calls set() when snap.exists === false.
// ─────────────────────────────────────────────────────────────────────────────
exports.grantWelcomeKey = onDocumentCreated(
  { region: REGION, document: 'users/{uid}' },
  async (event) => {
    const uid = event.params.uid;
    const userRef = db.collection('users').doc(uid);

    const historyEntry = {
      type: 'bonus',
      qty: WELCOME_KEYS,
      propId: null,
      propLabel: 'Llave de bienvenida',
      date: new Date().toISOString(),
    };

    await userRef.update({
      keysLeft: WELCOME_KEYS,
      keyHistory: [historyEntry],
    });

    logger.info('[grantWelcomeKey] granted welcome key', { uid, keys: WELCOME_KEYS });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// setAdminClaim — grant or revoke the `admin` custom claim on a user
// by email. Only existing admins can call it (either via existing
// admin claim OR the seed email allowlist during the migration
// window), so bootstrapping is possible without a service-account
// script: the first seed admin logs in, calls setAdminClaim on
// themselves, and Firebase gives them the claim.
//
// Client contract:
//   const fn = firebase.functions().httpsCallable('setAdminClaim');
//   const { data } = await fn({ email: 'sebastian@recosac.com', admin: true });
//   // data = { targetUid, admin }
//
// After the callable succeeds, the CALLER's claim is unchanged (only
// the target gets the update). The target has to reload their ID
// token to see the new claim — the client-side refreshAdminClaim()
// helper does that on the next sign-in, or the caller can promote
// themselves and use `getIdToken(true)` to refresh in-place.
//
// Errors:
//   unauthenticated       — no auth context / AppCheck failed
//   failed-precondition   — email not verified
//   permission-denied     — caller is not an admin
//   invalid-argument      — missing or malformed email / admin flag
//   not-found             — no user account with that email
// ─────────────────────────────────────────────────────────────────────────────
function _requireAdminCaller(request) {
  requireVerifiedAuth(request);
  const token = request.auth.token || {};
  const email = String(token.email || '').toLowerCase();
  const isAdmin = token.admin === true || SEED_ADMIN_EMAILS.includes(email);
  if (!isAdmin) {
    throw new HttpsError('permission-denied', 'Solo un admin puede realizar esta acción.');
  }
  return { uid: request.auth.uid, email };
}

exports.setAdminClaim = onCall(
  {
    region: REGION,
    maxInstances: 5,
    consumeAppCheckToken: true,
    enforceAppCheck: true,
  },
  async (request) => {
    _logAppCheck(request, 'setAdminClaim');
    const caller = _requireAdminCaller(request);

    const targetEmailRaw = request.data && request.data.email;
    if (!targetEmailRaw || typeof targetEmailRaw !== 'string' || !/.+@.+\..+/.test(targetEmailRaw)) {
      throw new HttpsError('invalid-argument', 'email requerido.');
    }
    const targetEmail = targetEmailRaw.trim().toLowerCase();

    const admin = request.data && request.data.admin;
    if (typeof admin !== 'boolean') {
      throw new HttpsError('invalid-argument', 'admin (boolean) requerido.');
    }

    let targetUser;
    try {
      targetUser = await getAuth().getUserByEmail(targetEmail);
    } catch (e) {
      throw new HttpsError('not-found', 'No hay una cuenta con ese email.');
    }

    // Merge with existing custom claims to avoid clobbering future
    // unrelated flags.
    const existing = targetUser.customClaims || {};
    const next = { ...existing };
    if (admin) next.admin = true; else delete next.admin;
    await getAuth().setCustomUserClaims(targetUser.uid, next);

    // Audit trail. The rule on /adminAuditLog requires adminUid ==
    // auth.uid; the caller's uid satisfies that. If the caller is a
    // seed admin without the claim, adminEmail still records who
    // actually did it.
    try {
      await db.collection('adminAuditLog').add({
        adminUid: caller.uid,
        adminEmail: caller.email || null,
        action: admin ? 'admin.claim.grant' : 'admin.claim.revoke',
        targetType: 'user',
        targetId: targetUser.uid,
        extras: { targetEmail },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('[setAdminClaim] audit write failed', { err: e && e.message });
    }

    return { targetUid: targetUser.uid, admin };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Culqi plan catalogue — single source of truth for both functions below.
// ─────────────────────────────────────────────────────────────────────────────
const CULQI_PLANS = {
  Individual: { amount: 1000,  qty: 1  },
  Bronce:     { amount: 4500,  qty: 5  },
  Plata:      { amount: 8000,  qty: 10 },
  Oro:        { amount: 35000, qty: 50 },
};

// Shared helper: grant keys and record the purchase inside a transaction.
// chargeId must be unique per payment (charge.id for cards, order.id for Yape).
async function _grantKeysForPurchase(uid, planName, plan, chargeId, dniRuc) {
  const userRef = db.collection('users').doc(uid);

  // Quick pre-check outside the transaction to reject obvious replays.
  const preSnap = await userRef.get();
  const preData = preSnap.exists ? preSnap.data() : {};
  const preHistory = Array.isArray(preData.keyHistory) ? preData.keyHistory : [];
  if (preHistory.some(h => h.chargeId === chargeId)) {
    throw new HttpsError('already-exists', 'Este pago ya fue procesado.');
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : {};
    const current = Number(data.keysLeft) || 0;
    const newTotal = current + plan.qty;
    const histEntry = {
      type: 'purchase',
      label: `Pack ${planName} — ${plan.qty} llave${plan.qty !== 1 ? 's' : ''}`,
      delta: plan.qty,
      balance: newTotal,
      chargeId,
      date: new Date().toISOString(),
      ...(dniRuc ? { dniRuc } : {}),
    };
    const nextHistory = [histEntry, ...(Array.isArray(data.keyHistory) ? data.keyHistory : [])].slice(0, HISTORY_CAP);
    tx.set(userRef, { keysLeft: newTotal, keyHistory: nextHistory }, { merge: true });
    return newTotal;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// createCulqiOrder — creates a Culqi order before opening the checkout.
// Required for Yape (and any other order-based payment method).
//
// Client contract:
//   const fn = _getFunctions().httpsCallable('createCulqiOrder');
//   const { data } = await fn({ planName, amount });
//   // data = { orderId: 'ord_live_...' }
// ─────────────────────────────────────────────────────────────────────────────
exports.createCulqiOrder = onCall(
  { region: REGION, maxInstances: 10, consumeAppCheckToken: true, enforceAppCheck: true, secrets: [culqiSecretKey] },
  async (request) => {
    _logAppCheck(request, 'createCulqiOrder');
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const uid     = request.auth.uid;
    const email   = request.auth.token.email || '';
    const rawName = request.auth.token.name  || '';
    const nameParts = rawName.trim().split(' ');
    const firstName = nameParts[0] || 'Cliente';
    const lastName  = nameParts.slice(1).join(' ') || 'Reco';

    const { planName, amount } = request.data;
    const plan = CULQI_PLANS[planName];
    if (!plan) throw new HttpsError('invalid-argument', 'Plan inválido.');
    if (plan.amount !== amount) throw new HttpsError('invalid-argument', 'Monto no coincide con el plan.');

    const orderNumber    = `RECO-${uid.slice(0, 8).toUpperCase()}-${Date.now()}`;
    const expirationDate = Math.floor(Date.now() / 1000) + 15 * 60; // 15 min

    let order;
    try {
      const res = await fetch('https://api.culqi.com/v2/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${culqiSecretKey.value()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: plan.amount,
          currency_code: 'PEN',
          description: `Pack ${planName} — ${plan.qty} llave${plan.qty !== 1 ? 's' : ''}`,
          order_number: orderNumber,
          client_details: { first_name: firstName, last_name: lastName, email, phone_number: '999999999' },
          expiration_date: expirationDate,
          confirm: false,
        }),
      });
      order = await res.json();
      if (!res.ok) {
        logger.warn('[createCulqiOrder] Culqi error', { uid, planName, order });
        throw new HttpsError('aborted', order.user_message || 'Error al crear la orden de pago.');
      }
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error('[createCulqiOrder] fetch error', { uid, err: e.message });
      throw new HttpsError('internal', 'Error al conectar con Culqi.');
    }

    logger.info('[createCulqiOrder] created', { uid, planName, orderId: order.id });
    return { orderId: order.id };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chargeWithCulqi — finalizes payment and grants keys.
// Handles both card tokens and Yape order confirmations.
//
// Client contract:
//   const fn = _getFunctions().httpsCallable('chargeWithCulqi');
//   // Card:  await fn({ tokenId: 'tkn_live_...', planName, amount });
//   // Yape:  await fn({ orderId: 'ord_live_...', planName, amount });
//   // data = { success: true, keysLeft: N, chargeId: '...' }
// ─────────────────────────────────────────────────────────────────────────────
exports.chargeWithCulqi = onCall(
  { region: REGION, maxInstances: 10, consumeAppCheckToken: true, enforceAppCheck: true, secrets: [culqiSecretKey] },
  async (request) => {
    _logAppCheck(request, 'chargeWithCulqi');
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const uid   = request.auth.uid;
    const email = request.auth.token.email || '';

    const tokenId  = request.data && request.data.tokenId;
    const orderId  = request.data && request.data.orderId;
    const planName = request.data && request.data.planName;
    const amount   = request.data && request.data.amount;
    const dniRuc   = (request.data && request.data.dniRuc) || null;

    if (!tokenId && !orderId) throw new HttpsError('invalid-argument', 'tokenId u orderId requerido.');
    const plan = CULQI_PLANS[planName];
    if (!plan) throw new HttpsError('invalid-argument', 'Plan inválido.');
    if (plan.amount !== amount) throw new HttpsError('invalid-argument', 'Monto no coincide con el plan.');

    let chargeId;

    if (tokenId) {
      // ── Card payment ──
      let charge;
      try {
        const res = await fetch('https://api.culqi.com/v2/charges', {
          method: 'POST',
          headers: { Authorization: `Bearer ${culqiSecretKey.value()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: plan.amount, currency_code: 'PEN', email, source_id: tokenId }),
        });
        charge = await res.json();
        if (!res.ok) {
          logger.warn('[chargeWithCulqi] card error', { uid, planName, charge });
          throw new HttpsError('aborted', charge.user_message || 'El pago no pudo procesarse.');
        }
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        logger.error('[chargeWithCulqi] card fetch error', { uid, err: e.message });
        throw new HttpsError('internal', 'Error al conectar con la pasarela de pago.');
      }
      if (charge.outcome && charge.outcome.type !== 'venta_exitosa') {
        throw new HttpsError('aborted', charge.user_message || 'El cargo fue rechazado.');
      }
      chargeId = charge.id;
    } else {
      // ── Yape: verify the order is paid ──
      let order;
      try {
        const res = await fetch(`https://api.culqi.com/v2/orders/${encodeURIComponent(orderId)}`, {
          headers: { Authorization: `Bearer ${culqiSecretKey.value()}` },
        });
        order = await res.json();
        if (!res.ok) {
          logger.warn('[chargeWithCulqi] order fetch error', { uid, orderId, order });
          throw new HttpsError('aborted', order.user_message || 'Error verificando el pago.');
        }
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        logger.error('[chargeWithCulqi] order fetch error', { uid, err: e.message });
        throw new HttpsError('internal', 'Error al verificar el pago con Culqi.');
      }
      if (order.state !== 'paid') {
        throw new HttpsError('aborted', 'El pago Yape aún no fue confirmado.');
      }
      if (order.amount !== plan.amount) {
        throw new HttpsError('aborted', 'El monto de la orden no coincide con el plan.');
      }
      chargeId = orderId;
    }

    const newBalance = await _grantKeysForPurchase(uid, planName, plan, chargeId, dniRuc);
    logger.info('[chargeWithCulqi] success', { uid, planName, qty: plan.qty, chargeId });
    return { success: true, keysLeft: newBalance, chargeId };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// grantKeys — admin-only callable that adds keys to a user's balance.
//
// Client contract:
//   const fn = firebase.app().functions('southamerica-east1')
//     .httpsCallable('grantKeys');
//   const { data } = await fn({ email: 'user@example.com', qty: 50 });
//   // data = { targetUid, email, added, newBalance }
//
// Errors (HttpsError):
//   unauthenticated       — no auth context / AppCheck failed
//   failed-precondition   — email not verified
//   permission-denied     — caller is not an admin
//   invalid-argument      — missing/malformed email or qty
//   not-found             — no user account with that email
// ─────────────────────────────────────────────────────────────────────────────
exports.grantKeys = onCall(
  {
    region: REGION,
    maxInstances: 5,
    consumeAppCheckToken: true,
    enforceAppCheck: true,
  },
  async (request) => {
    _logAppCheck(request, 'grantKeys');
    const caller = _requireAdminCaller(request);

    const targetEmailRaw = request.data && request.data.email;
    if (!targetEmailRaw || typeof targetEmailRaw !== 'string' || !/.+@.+\..+/.test(targetEmailRaw)) {
      throw new HttpsError('invalid-argument', 'email requerido.');
    }
    const targetEmail = targetEmailRaw.trim().toLowerCase();

    const qty = request.data && request.data.qty;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 10000) {
      throw new HttpsError('invalid-argument', 'qty requerido (entero entre 1 y 10000).');
    }

    let targetUser;
    try {
      targetUser = await getAuth().getUserByEmail(targetEmail);
    } catch (e) {
      throw new HttpsError('not-found', 'No hay una cuenta con ese email.');
    }

    const userRef = db.collection('users').doc(targetUser.uid);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : {};
      const currentKeys = Number(data.keysLeft) || 0;
      const newBalance = currentKeys + qty;

      const historyEntry = {
        type: 'grant',
        qty,
        grantedBy: caller.email,
        date: new Date().toISOString(),
      };
      const nextHistory = [historyEntry, ...(Array.isArray(data.keyHistory) ? data.keyHistory : [])].slice(0, HISTORY_CAP);

      tx.set(userRef, {
        keysLeft: newBalance,
        keyHistory: nextHistory,
      }, { merge: true });

      return { newBalance };
    });

    try {
      await db.collection('adminAuditLog').add({
        adminUid: caller.uid,
        adminEmail: caller.email || null,
        action: 'keys.grant',
        targetType: 'user',
        targetId: targetUser.uid,
        extras: { targetEmail, qty, newBalance: result.newBalance },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('[grantKeys] audit write failed', { err: e && e.message });
    }

    return {
      targetUid: targetUser.uid,
      email: targetEmail,
      added: qty,
      newBalance: result.newBalance,
    };
  }
);

// MEJ-04: generateListingCopy — AI-powered listing description
// Uses fetch() instead of the openai SDK to avoid an extra dependency in the
// Cloud Function bundle; functionally identical (gpt-4o-mini, temperature 0.7,
// response_format: json_object).
// ─────────────────────────────────────────────────────────────────────────────
const AI_COPY_LIMIT_PER_HOUR = 30;

exports.generateListingCopy = onCall(
  {
    region: REGION,
    maxInstances: 10,
    consumeAppCheckToken: true,
    enforceAppCheck: true,
    secrets: [openaiKey],
  },
  async (request) => {
    _logAppCheck(request, 'generateListingCopy');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;

    const d = request.data || {};
    const district = String(d.district || '').replace(/[\r\n]/g, ' ').trim().slice(0, 60);
    const area = Number(d.area) || 0;
    if (!district || !area) {
      throw new HttpsError('invalid-argument', 'Distrito y área son obligatorios.');
    }
    const type  = String(d.type  || '').slice(0, 40);
    const op    = String(d.op    || '').slice(0, 20);
    const beds  = Number(d.beds)  || 0;
    const baths = Number(d.baths) || 0;
    const parking = Number(d.parking) || 0;
    const features = Array.isArray(d.features) ? d.features.map(f => String(f).slice(0, 60)) : [];

    // ── Rate limit: hour-bucket in aiCopyUsage/{uid} ──
    const hour = new Date().toISOString().slice(0, 13); // e.g. "2026-09-08T14"
    const usageRef = db.collection('aiCopyUsage').doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const data = snap.data() || {};
      if (data.hour === hour && (data.count || 0) >= AI_COPY_LIMIT_PER_HOUR) {
        throw new HttpsError(
          'resource-exhausted',
          `Límite de ${AI_COPY_LIMIT_PER_HOUR} generaciones por hora alcanzado. Intenta más tarde.`
        );
      }
      if (data.hour === hour) {
        tx.update(usageRef, { count: (data.count || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
      } else {
        tx.set(usageRef, { hour, count: 1, updatedAt: FieldValue.serverTimestamp() });
      }
    });

    // ── Build ficha (never includes address — only district) ──
    const ficha = {
      distrito: district,
      area_m2: area,
      ...(type  && { tipo: type }),
      ...(op    && { operacion: op }),
      ...(beds  && { dormitorios: beds }),
      ...(baths && { banos: baths }),
      ...(parking && { estacionamientos: parking }),
      ...(features.length && { caracteristicas: features }),
    };

    const systemPrompt = `Eres un redactor inmobiliario profesional en Perú.
Genera un título y una descripción para un aviso clasificado a partir de la ficha técnica que te entregará el usuario.

Reglas:
1. Usa SOLO los datos de la ficha. No inventes metraje, ambientes ni amenities que no aparezcan.
2. No menciones el precio.
3. No uses mayúsculas sostenidas ni exclamaciones repetidas.
4. No prometas rentabilidad ni plusvalía.
5. No uses lenguaje discriminatorio ni excluyente.
6. Responde ÚNICAMENTE con un JSON válido (sin bloques de código) con esta forma:
   {"titulo":"...","descripcion":"..."}
   donde título ≤ 90 caracteres y descripción tiene entre 500 y 900 caracteres distribuidos en 2 a 3 párrafos separados por \\n\\n.`;

    // ── Call OpenAI via fetch ──
    const key = openaiKey.value();
    if (!key) throw new HttpsError('failed-precondition', 'Clave OpenAI no configurada.');

    let body;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(ficha) },
          ],
        }),
      });
      body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || `HTTP ${res.status}`);
    } catch (e) {
      logger.error('[generateListingCopy] OpenAI error', { err: e && e.message });
      throw new HttpsError('internal', 'Error al generar texto. Intenta de nuevo.');
    }

    const raw = (body.choices?.[0]?.message?.content || '').trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      const titleMatch = raw.match(/"titulo"\s*:\s*"([^"]+)"/);
      const descMatch = raw.match(/"descripcion"\s*:\s*"([^"]+)"/);
      parsed = {
        titulo: titleMatch ? titleMatch[1] : '',
        descripcion: descMatch ? descMatch[1] : '',
      };
    }

    if (!parsed.titulo && !parsed.descripcion) {
      throw new HttpsError('internal', 'La IA no generó contenido válido.');
    }

    return {
      titulo: String(parsed.titulo || '').trim().slice(0, 200),
      descripcion: String(parsed.descripcion || '').trim().slice(0, 5000),
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// extractListings — motor de extracción del roadmap de carga inteligente.
//
// Convierte una entrada libre en inmuebles del esquema canónico de 31
// columnas y los guarda como borradores en /importDrafts. Nunca publica: el
// usuario revisa y publica desde la bandeja de carga masiva (publishProperty
// con importDraftId). Extraer es gratis; las llaves se cobran al publicar.
//
// Entradas (kind):
//   'text'      notas o mensajes de WhatsApp pegados.
//   'document'  PDF, Word o PowerPoint leído en el navegador (index.html →
//               _pubDocRead), o un chat de WhatsApp exportado (fileType
//               'whatsapp', _pubWaRead; canal 'whatsapp'). El texto llega con encabezados "=== Página N ==="
//               y marcadores [FOTO id] donde estaban las fotos; las fotos
//               quedan en el navegador y la IA solo devuelve sus ids. Las
//               páginas escaneadas (sin capa de texto) llegan como imagen y
//               las lee el modelo con visión. Un documento largo se manda en
//               varias partes con el mismo batchId.
//
// Client contract:
//   const fn = _getFunctions().httpsCallable('extractListings');
//   const { data } = await fn({ kind: 'text', text, channel?: 'text'|'whatsapp', sourceName? });
//   const { data } = await fn({ kind: 'document', text, fileType: 'pdf'|'docx'|'pptx'|'whatsapp',
//     photoIds: ['p1-1', …], images: [{ page: '3', dataUrl: 'data:image/jpeg;base64,…' }],
//     sourceName?, batchId? });
//   // data = { batchId, drafts: [{ id, row, aiFields, inferredFields, notes, fotos }] }
//
// Errors (HttpsError):
//   unauthenticated / failed-precondition — sin sesión o email sin verificar
//   invalid-argument      — kind no soportado, entrada vacía, muy larga o
//                           imágenes inválidas / demasiadas
//   resource-exhausted    — superó IMPORT_AI_LIMIT_PER_HOUR (cada parte cuenta)
//   internal              — la IA falló o no devolvió JSON válido
//
// Antialucinación (en este orden): salida estructurada con null permitido,
// guardInvented (vacía precio/área/ambientes cuyo número no aparece en el
// texto fuente; con páginas escaneadas, también vale la transcripción que la
// IA devuelve en `evidencia`) y normalizeRow determinista (catálogo de
// sinónimos y abreviaturas, etiquetas, verificación por tipo en la bandeja).
// ─────────────────────────────────────────────────────────────────────────────
// 'imagenes': flyers o capturas de pantalla sueltas (cada imagen va como
// página escaneada).
const IMPORT_DOC_TYPES = ['pdf', 'docx', 'pptx', 'whatsapp', 'imagenes'];
const IMPORT_DOC_MAX_IMAGES = 6;
const IMPORT_DOC_MAX_IMAGE_CHARS = 1500000;
const IMPORT_DOC_MAX_PHOTO_IDS = 300;
const IMPORT_IMAGE_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const IMPORT_PHOTO_ID_RE = /^[a-z0-9-]{1,24}$/;

function _extractSystemPrompt() {
  const etiquetas = Object.entries(RecoCatalogo.ETIQUETAS)
    .map(([k, lista]) => `   ${k}: ${lista.join(' | ')}`).join('\n');
  return `Eres un asistente que extrae fichas de inmuebles en Perú a partir de texto libre o documentos (notas, chats de WhatsApp, avisos de portales, PDF, Word o presentaciones de inmobiliarias).

Reglas:
1. Un elemento en "inmuebles" por cada inmueble distinto. Si un mismo inmueble ocupa varias páginas o diapositivas, combina su información en un solo elemento. Si no hay ningún inmueble, devuelve "inmuebles": [].
2. Usa SOLO datos presentes en la entrada. Si un dato no aparece, devuelve null. Nunca inventes precio, área, dormitorios, baños ni dirección.
3. Copia los números tal como aparecen (ej. "185 mil", "US$ 185,000", "85 m2"); no conviertas monedas.
4. Interpreta sinónimos y abreviaturas habituales en Perú: Dpto./Depa/Depto. (departamento), Of. (oficina), Loc. (local), Lote/Terr. (terreno), Vta. (venta), Alq./Arriendo (alquiler), S/ o S/. (soles), US$ o U$S (dólares), dorm./hab. (dormitorios), bñs/SS.HH. (baños), cochera (estacionamiento), m2/mts (metros cuadrados), En planos/Preventa/Proy. (en proyecto), E/C/En obra/En const. (en construcción), A/E/a estrenar (construido, antigüedad 0).
5. tipo_publicacion: "Venta" o "Alquiler". tipo_propiedad: Departamento, Casa, Oficina, Local comercial, Terreno u Otros. estado: Construido, En proyecto o En construcción. tipo_moneda: USD o PEN.
6. distrito: el distrito tal como aparece (ej. "Miraflores", "Surco"). direccion: calle y número si aparecen; si solo hay referencia ("cerca al parque Kennedy"), úsala.
7. Áreas: area_techada es el área construida/techada/útil; area_terreno, la del terreno o lote. En un terreno o lote, el área va en area_terreno; area_techada solo si se menciona algo construido.
8. Etiquetas: usa SOLO valores exactos de estas listas, separados por ";" (null si ninguno aplica). "Piscina" de un edificio o condominio es "Piscina del edificio"; si es del inmueble, "Piscina propia".
${etiquetas}
9. departamento y provincia pueden ir en null. antiguedad: años o año de construcción tal como aparecen.
10. titulo: un título breve (máx. 90 caracteres) usando solo datos de la entrada. descripcion: el texto original de ese inmueble, sin teléfonos, correos ni nombres de personas.
11. campos_inferidos: lista los nombres de los campos que dedujiste y no estaban escritos literalmente (por ejemplo tipo_propiedad deducido de "depa" no es inferido; tipo_publicacion deducido del contexto sí lo es). El título siempre es inferido.
12. fotos: en documentos, las fotos aparecen como marcadores [FOTO id] en el lugar donde estaban. Asigna a cada inmueble los ids de SUS fotos (normalmente las de su misma página o diapositiva). No incluyas logos, íconos ni fotos de otro inmueble. En un chat de WhatsApp, las fotos de un inmueble suelen enviarse justo antes o justo después del mensaje que lo describe y por la misma persona. Sin marcadores, devuelve [].
13. evidencia: copia literal (máx. 600 caracteres) del fragmento de donde salen el precio, las áreas y los ambientes. En páginas escaneadas (imágenes), transcribe lo que lees en ellas.`;
}

async function _openaiStructured(systemPrompt, userContent, schemaName, schema) {
  const key = openaiKey.value();
  if (!key) throw new HttpsError('failed-precondition', 'Clave OpenAI no configurada.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `HTTP ${res.status}`);
  return JSON.parse(body.choices?.[0]?.message?.content || '{}');
}

// Valida la entrada de kind 'document' y arma el contenido multimodal.
function _extractDocumentInput(d, text) {
  const fileType = IMPORT_DOC_TYPES.includes(d.fileType) ? d.fileType : null;
  if (!fileType) throw new HttpsError('invalid-argument', 'Formato de documento no soportado (PDF, Word .docx, PowerPoint .pptx, chat de WhatsApp o imágenes).');
  const images = Array.isArray(d.images) ? d.images : [];
  if (images.length > IMPORT_DOC_MAX_IMAGES) {
    throw new HttpsError('invalid-argument', `Demasiadas páginas escaneadas en una parte (máx. ${IMPORT_DOC_MAX_IMAGES}).`);
  }
  images.forEach((im) => {
    const url = im && typeof im.dataUrl === 'string' ? im.dataUrl : '';
    if (!IMPORT_IMAGE_RE.test(url) || url.length > IMPORT_DOC_MAX_IMAGE_CHARS) {
      throw new HttpsError('invalid-argument', 'Imagen de página inválida o demasiado grande.');
    }
  });
  if (!text && !images.length) throw new HttpsError('invalid-argument', 'El documento no tiene texto ni páginas legibles.');
  const photoIds = (Array.isArray(d.photoIds) ? d.photoIds : [])
    .filter((id) => typeof id === 'string' && IMPORT_PHOTO_ID_RE.test(id)).slice(0, IMPORT_DOC_MAX_PHOTO_IDS);
  const content = [{ type: 'text', text: text || '(El documento solo tiene páginas escaneadas.)' }];
  images.forEach((im) => {
    content.push({ type: 'text', text: `Página escaneada ${String(im.page || '').slice(0, 10)}:` });
    content.push({ type: 'image_url', image_url: { url: im.dataUrl, detail: 'high' } });
  });
  return { fileType, photoIds, images: images.length, content };
}

// Límite por usuario y hora, compartido por todas las llamadas a la IA de
// importación (extractListings, mapImportColumns, importListingPage).
async function _importRateLimit(uid) {
  const hour = new Date().toISOString().slice(0, 13);
  const usageRef = db.collection('importUsage').doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const data = snap.data() || {};
    if (data.hour === hour && (data.count || 0) >= IMPORT_AI_LIMIT_PER_HOUR) {
      throw new HttpsError('resource-exhausted',
        `Límite de ${IMPORT_AI_LIMIT_PER_HOUR} importaciones por hora alcanzado. Intenta más tarde.`);
    }
    tx.set(usageRef, {
      hour,
      count: data.hour === hour ? (data.count || 0) + 1 : 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

// IA → antialucinación → normalización → borradores en /importDrafts.
//   text         fuente para guardInvented (y lo que ve la IA si no hay
//                userContent multimodal)
//   userContent  contenido para la IA (string o partes texto/imagen)
//   photoIds     ids de fotos válidos ([] si la fuente no tiene fotos)
//   useEvidence  la transcripción de la IA cuenta como fuente (escaneos)
//   draftExtra / eventExtra  campos adicionales para el borrador / evento
async function _extractAndSaveDrafts(o) {
  const t0 = Date.now();
  let parsed;
  try {
    parsed = await _openaiStructured(_extractSystemPrompt(), o.userContent || o.text, 'inmuebles', RecoImport.EXTRACTION_SCHEMA);
  } catch (e) {
    logger.error(`[${o.fn}] OpenAI error`, { err: e && e.message });
    throw new HttpsError('internal', o.errorMessage || 'No pudimos leer el contenido. Intenta de nuevo.');
  }
  const items = (Array.isArray(parsed.inmuebles) ? parsed.inmuebles : []).slice(0, IMPORT_MAX_LISTINGS_PER_CALL);

  // Las partes de una misma fuente comparten batchId (y su "Retomar").
  const batchId = (typeof o.batchId === 'string' && DRAFT_ID_RE.test(o.batchId))
    ? o.batchId : db.collection('importDrafts').doc().id;
  const expiresAt = Timestamp.fromMillis(Date.now() + IMPORT_DRAFT_TTL_DAYS * 864e5);
  const photoIds = o.photoIds || [];
  const batch = db.batch();
  const drafts = items.map((it) => {
    const rawRow = {};
    RecoImport.AI_FIELDS.forEach((k) => { rawRow[k] = it[k] == null ? '' : String(it[k]); });
    const fuente = o.useEvidence ? `${o.text}\n${String(it.evidencia || '')}` : o.text;
    const guarded = RecoImport.guardInvented(rawRow, fuente);
    const { row, changes, notas } = RecoImport.normalizeRow(guarded.row);
    const aiFields = RecoImport.COLS.filter((k) => row[k] !== '');
    const inferredFields = (Array.isArray(it.campos_inferidos) ? it.campos_inferidos : [])
      .filter((k) => aiFields.includes(k));
    const fotos = [...new Set((Array.isArray(it.fotos) ? it.fotos : []).filter((id) => photoIds.includes(id)))];
    const notes = guarded.dropped.map((k) => `Quitamos ${k}: no aparece en ${o.sourceLabel || 'el texto'}.`)
      .concat(changes.filter((c) => c.pii).map((c) => `Quitamos ${c.pii} dato(s) de contacto de ${c.field}.`))
      .concat(notas);
    const ref = db.collection('importDrafts').doc();
    batch.set(ref, {
      uid: o.uid, batchId, source: o.channel, sourceName: o.sourceName || null,
      ...(o.draftExtra || {}),
      ...(photoIds.length && { docPhotos: fotos.length }),
      row, aiFields, inferredFields, notes,
      fingerprint: RecoImport.fingerprint(row),
      status: 'draft',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt,
    });
    return { id: ref.id, row, aiFields, inferredFields, notes, fotos };
  });
  batch.set(db.collection('importEvents').doc(), {
    uid: o.uid, kind: o.kind, channel: o.channel, chars: o.text.length, listings: drafts.length,
    ...(o.eventExtra || {}),
    ms: Date.now() - t0, createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { batchId, drafts };
}

exports.extractListings = onCall(
  {
    region: REGION,
    maxInstances: 10,
    timeoutSeconds: 300,
    memory: '512MiB',
    consumeAppCheckToken: true,
    enforceAppCheck: true,
    secrets: [openaiKey],
  },
  async (request) => {
    _logAppCheck(request, 'extractListings');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const d = request.data || {};

    if (!IMPORT_AI_KINDS.includes(d.kind)) {
      throw new HttpsError('invalid-argument', 'Tipo de importación no soportado.');
    }
    const isDoc = d.kind === 'document';
    const text = String(d.text || '').trim();
    if (!text && !isDoc) throw new HttpsError('invalid-argument', 'Pega el texto con los inmuebles.');
    if (text.length > IMPORT_TEXT_MAX_CHARS) {
      throw new HttpsError('invalid-argument', `El texto es muy largo (máx. ${IMPORT_TEXT_MAX_CHARS} caracteres). Divídelo en partes.`);
    }
    const doc = isDoc ? _extractDocumentInput(d, text) : null;
    // Un chat de WhatsApp exportado llega como documento (texto + fotos)
    // pero se registra con su propio canal.
    const channel = isDoc ? (doc.fileType === 'whatsapp' ? 'whatsapp' : 'documento')
      : (IMPORT_TEXT_CHANNELS.includes(d.channel) ? d.channel : 'text');
    const sourceName = String(d.sourceName || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120) || null;

    await _importRateLimit(uid);

    return _extractAndSaveDrafts({
      fn: 'extractListings', uid, kind: d.kind, channel, sourceName, batchId: d.batchId,
      text, userContent: doc ? doc.content : text,
      photoIds: doc ? doc.photoIds : [],
      // Con páginas escaneadas el texto no tiene esos números: la
      // transcripción de la IA (evidencia) también cuenta como fuente.
      useEvidence: !!(doc && doc.images),
      sourceLabel: isDoc ? (channel === 'whatsapp' ? 'el chat' : 'el documento') : 'el texto',
      errorMessage: isDoc ? 'No pudimos leer el documento. Intenta de nuevo.' : 'No pudimos leer el texto. Intenta de nuevo.',
      draftExtra: doc ? { fileType: doc.fileType } : null,
      eventExtra: doc ? { fileType: doc.fileType, pageImages: doc.images, photos: doc.photoIds.length } : null,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// mapImportColumns — Excel propio (roadmap 1.1): cuando los sinónimos no
// alcanzan, la IA indica qué columna del archivo corresponde a cada campo de
// ReCo. Solo recibe cabeceras y hasta 5 filas de ejemplo; no crea borradores
// (el archivo se sigue procesando en el navegador).
//
// Client contract:
//   const { data } = await _getFunctions().httpsCallable('mapImportColumns')({ headers, sample });
//   // data = { mapeo: { direccion: 'Dirección del inmueble', precio: 'Valor', … } }
// Errors: invalid-argument, resource-exhausted (mismo límite por hora que
// extractListings), internal.
// ─────────────────────────────────────────────────────────────────────────────
const IMPORT_MAP_MAX_HEADERS = 80;
const IMPORT_COLUMN_HINTS = {
  direccion: 'dirección del inmueble', departamento: 'departamento/región (Lima…)', provincia: 'provincia',
  distrito: 'distrito o zona', latitud: 'latitud GPS', longitud: 'longitud GPS',
  mostrar_direccion: 'si se muestra la dirección exacta (sí/no)', tipo_publicacion: 'operación: venta o alquiler',
  tipo_propiedad: 'tipo de inmueble (departamento, casa, oficina, local, terreno…)', nro_dormitorios: 'dormitorios / habitaciones',
  nro_banos: 'baños', nro_estacionamientos: 'estacionamientos / cocheras', nro_pisos: 'pisos totales del edificio o casa',
  piso: 'piso en que está el inmueble', niveles: 'niveles que ocupa (dúplex = 2)', antiguedad: 'antigüedad en años o año de construcción',
  estado: 'estado: construido, en proyecto (en planos) o en construcción', ascensor: 'ascensor (sí/no)', amoblado: 'amoblado (sí/no)',
  pet_friendly: 'acepta mascotas (sí/no)', tipo_moneda: 'moneda (USD, PEN, S/, $)', precio: 'precio',
  area_terreno: 'área de terreno / lote (m²)', area_techada: 'área techada / construida / útil (m²)',
  etiquetas_generales: 'características del inmueble (separadas)', etiquetas_ambientes: 'áreas comunes del edificio',
  etiquetas_vista: 'vista', etiquetas_acceso: 'tipo de vía de acceso', etiquetas_zonas: 'zonificación o tipo de zona',
  titulo: 'título del aviso', descripcion: 'descripción o comentarios',
};

exports.mapImportColumns = onCall(
  {
    region: REGION,
    maxInstances: 10,
    consumeAppCheckToken: true,
    enforceAppCheck: true,
    secrets: [openaiKey],
  },
  async (request) => {
    _logAppCheck(request, 'mapImportColumns');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const d = request.data || {};
    const headers = [...new Set((Array.isArray(d.headers) ? d.headers : [])
      .map((h) => String(h == null ? '' : h).trim().slice(0, 80)).filter(Boolean))].slice(0, IMPORT_MAP_MAX_HEADERS);
    if (headers.length < 2) throw new HttpsError('invalid-argument', 'El archivo no tiene columnas suficientes.');
    const sample = (Array.isArray(d.sample) ? d.sample : []).slice(0, 5)
      .map((r) => (Array.isArray(r) ? r : []).slice(0, headers.length).map((v) => String(v == null ? '' : v).slice(0, 60)));

    await _importRateLimit(uid);

    const opcion = { anyOf: [{ type: 'string', enum: headers }, { type: 'null' }] };
    const schema = {
      type: 'object', additionalProperties: false, required: ['mapeo'],
      properties: {
        mapeo: {
          type: 'object', additionalProperties: false, required: RecoImport.COLS,
          properties: RecoImport.COLS.reduce((acc, k) => { acc[k] = opcion; return acc; }, {}),
        },
      },
    };
    const prompt = `Eres un asistente que ordena inventarios inmobiliarios de Perú. Te doy las columnas de un Excel de un corredor y algunas filas de ejemplo.
Para cada campo de ReCo, indica el nombre EXACTO de la columna que lo contiene, o null si ninguna lo contiene. No uses la misma columna para dos campos salvo que de verdad contenga ambos datos. Interpreta abreviaturas (Dpto., Dorm., Hab., Bñs, Cochera, m2, Vta./Alq., S/, US$).
Campos de ReCo:
${RecoImport.COLS.map((k) => `- ${k}: ${IMPORT_COLUMN_HINTS[k]}`).join('\n')}`;
    const user = `Columnas: ${JSON.stringify(headers)}\nFilas de ejemplo:\n${sample.map((r) => JSON.stringify(r)).join('\n')}`;
    let parsed;
    try {
      parsed = await _openaiStructured(prompt, user, 'mapeo_columnas', schema);
    } catch (e) {
      logger.error('[mapImportColumns] OpenAI error', { err: e && e.message });
      throw new HttpsError('internal', 'No pudimos reconocer las columnas. Indícalas a mano.');
    }
    const mapeo = {};
    Object.entries((parsed && parsed.mapeo) || {}).forEach(([k, v]) => {
      if (RecoImport.COLS.includes(k) && typeof v === 'string' && headers.includes(v)) mapeo[k] = v;
    });
    await db.collection('importEvents').doc().set({
      uid, kind: 'columns', channel: 'excel', headers: headers.length, mapped: Object.keys(mapeo).length,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { mapeo };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// importListingPage — importar desde el enlace de un aviso (roadmap 1.4/1.5).
//
// Dos entradas:
//   { url }            El servidor descarga la página, solo de portales
//                      conocidos (IMPORT_URL_HOSTS). Si el portal bloquea la
//                      descarga → failed-precondition, details.reason
//                      'blocked'; si el dominio no está en la lista →
//                      details.reason 'host-not-supported'. En ambos casos el
//                      cliente ofrece el marcador "Enviar a ReCo".
//   { url, modo: 'perfil' }  Página de perfil o resultados de un portal
//                      conocido: devuelve { avisos: [{ url, title }] } (máx.
//                      IMPORT_PROFILE_MAX_LISTINGS) sin usar la IA.
//   { url, pagina }    Lo manda el marcador del navegador, que corre en la
//                      página del aviso que el usuario ya tiene abierta:
//                      { title, meta, jsonld, text, images }. Sirve para
//                      cualquier dominio.
// Siempre: declaraAutorizacion === true (el usuario declara que es el
// anunciante o tiene autorización). Las fotos (máx. IMPORT_URL_MAX_PHOTOS)
// las descarga el servidor y vuelven como data URL con su id; la IA solo ve
// los marcadores [FOTO u-N].
//
// Seguridad (SSRF): solo http(s) en puertos 80/443, el nombre debe resolver
// a IPs públicas (se valida en cada redirección, máx. 3), 12 s de timeout y
// tope de tamaño por respuesta.
//
// Client contract:
//   const { data } = await _getFunctions().httpsCallable('importListingPage')({ url, declaraAutorizacion: true, pagina?, batchId? });
//   // data = { batchId, drafts: [{ id, row, aiFields, inferredFields, notes, fotos }], photos: [{ id, dataUrl }] }
// ─────────────────────────────────────────────────────────────────────────────
const IMPORT_URL_HOSTS = ['urbania.pe', 'adondevivir.com', 'properati.com.pe', 'babilonia.pe', 'nexoinmobiliario.pe',
  'mercadolibre.com.pe', 'infocasas.com.pe', 'remax.pe'];
const IMPORT_URL_MAX_PHOTOS = 12;
const IMPORT_PROFILE_MAX_LISTINGS = 60;
const IMPORT_URL_HTML_BYTES = 3 * 1024 * 1024;
const IMPORT_URL_PHOTO_BYTES = 4 * 1024 * 1024;
const IMPORT_URL_PHOTOS_TOTAL_BYTES = 9 * 1024 * 1024;
const IMPORT_URL_MIN_PHOTO_BYTES = 6 * 1024; // menos: ícono o miniatura
const IMPORT_FETCH_TIMEOUT_MS = 12000;
const IMPORT_FETCH_UA = 'Mozilla/5.0 (compatible; ReCoImport/1.0; +https://recosac.com)';

function _isPublicIp(ip) {
  const net = require('net');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224);
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return _isPublicIp(x.slice(7));
    return !(x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x));
  }
  return false;
}
function _importHostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return IMPORT_URL_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}
async function _assertPublicUrl(u) {
  let url;
  try { url = new URL(u); } catch (_) { throw new HttpsError('invalid-argument', 'Enlace inválido.'); }
  if (!/^https?:$/.test(url.protocol) || (url.port && !['80', '443'].includes(url.port)) || url.username || url.password) {
    throw new HttpsError('invalid-argument', 'Enlace inválido.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = require('net').isIP(host) ? [{ address: host }]
    : await require('dns').promises.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || !addrs.every((a) => _isPublicIp(a.address))) {
    throw new HttpsError('invalid-argument', 'No se puede acceder a ese enlace.');
  }
  return url;
}
// GET con validación SSRF en cada salto, timeout y tope de bytes.
async function _safeFetch(u, { maxBytes, accept }) {
  let url = await _assertPublicUrl(u);
  for (let hop = 0; hop <= 3; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMPORT_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url.href, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': IMPORT_FETCH_UA, 'Accept': accept, 'Accept-Language': 'es-PE,es;q=0.9' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = await _assertPublicUrl(new URL(res.headers.get('location'), url).href);
        continue;
      }
      const chunks = [];
      let size = 0;
      if (res.body) {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > maxBytes) { ctrl.abort(); break; }
          chunks.push(chunk);
        }
      }
      return { status: res.status, url: url.href, type: res.headers.get('content-type') || '', body: Buffer.concat(chunks), truncated: size > maxBytes };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new HttpsError('failed-precondition', 'El enlace redirige demasiadas veces.');
}
async function _downloadPhotos(urls) {
  const photos = [];
  let total = 0;
  for (const u of urls) {
    if (photos.length >= IMPORT_URL_MAX_PHOTOS || total >= IMPORT_URL_PHOTOS_TOTAL_BYTES) break;
    try {
      const r = await _safeFetch(u, { maxBytes: IMPORT_URL_PHOTO_BYTES, accept: 'image/jpeg,image/png,image/webp' });
      const type = (r.type.match(/^image\/(jpeg|png|webp)/i) || [])[0];
      if (r.status !== 200 || !type || r.truncated || r.body.length < IMPORT_URL_MIN_PHOTO_BYTES) continue;
      total += r.body.length;
      photos.push({ id: `u-${photos.length + 1}`, dataUrl: `data:${type.toLowerCase()};base64,${r.body.toString('base64')}` });
    } catch (_) { /* foto inaccesible: se omite */ }
  }
  return photos;
}
// HTML de una página de un portal conocido. 403/429/503 o páginas de
// verificación ("captcha", "Just a moment") = el portal no deja descargar
// desde un servidor → reason 'blocked' (el cliente ofrece el marcador).
async function _fetchPortalHtml(url) {
  if (!_importHostAllowed(url.hostname)) {
    throw new HttpsError('failed-precondition', 'Ese portal no se puede leer directamente. Usa el botón "Enviar a ReCo" desde tu navegador.', { reason: 'host-not-supported' });
  }
  const r = await _safeFetch(url.href, { maxBytes: IMPORT_URL_HTML_BYTES, accept: 'text/html,application/xhtml+xml' })
    .catch((e) => { if (e instanceof HttpsError) throw e; return null; });
  const html = r ? r.body.toString('utf8') : '';
  if (!r || r.status !== 200 || !/html/i.test(r.type) || /captcha|cf-chl|just a moment|access denied|attention required/i.test(html.slice(0, 5000))) {
    throw new HttpsError('failed-precondition', 'El portal no permitió leer la página desde ReCo. Usa el botón "Enviar a ReCo" desde tu navegador.', { reason: 'blocked' });
  }
  return { html, url: r.url };
}
// Página que manda el marcador: se aceptan solo strings y con tope.
function _cleanPagina(p) {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const meta = {};
  Object.entries(p && typeof p.meta === 'object' ? p.meta : {}).slice(0, 40)
    .forEach(([k, v]) => { meta[str(k, 60)] = str(v, 1000); });
  return {
    title: str(p.title, 300), meta,
    jsonld: (Array.isArray(p.jsonld) ? p.jsonld : []).slice(0, 5).map((x) => str(x, 8000)),
    datos: [],
    text: str(p.text, 30000),
    images: (Array.isArray(p.images) ? p.images : []).slice(0, 60).map((x) => str(x, 2000)).filter((x) => /^https?:\/\//.test(x)),
  };
}

exports.importListingPage = onCall(
  {
    region: REGION,
    maxInstances: 10,
    timeoutSeconds: 300,
    memory: '512MiB',
    consumeAppCheckToken: true,
    enforceAppCheck: true,
    secrets: [openaiKey],
  },
  async (request) => {
    _logAppCheck(request, 'importListingPage');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const d = request.data || {};
    if (d.declaraAutorizacion !== true) {
      throw new HttpsError('invalid-argument', 'Confirma que eres el anunciante o tienes autorización para usar este aviso.');
    }
    const urlStr = String(d.url || '').trim().slice(0, 2000);
    let url;
    try { url = new URL(urlStr); } catch (_) { throw new HttpsError('invalid-argument', 'Pega el enlace completo del aviso (https://…).'); }
    if (!/^https?:$/.test(url.protocol)) throw new HttpsError('invalid-argument', 'Pega el enlace completo del aviso (https://…).');

    // Perfil de inmobiliaria o corredor (roadmap 2.3): solo se listan sus
    // avisos, sin IA (no consume el límite por hora). El cliente elige
    // cuáles importar y llama de nuevo, uno por uno, con el mismo lote.
    if (d.modo === 'perfil') {
      const r = await _fetchPortalHtml(url);
      const avisos = RecoImport.extractListingLinks(r.html, r.url, IMPORT_PROFILE_MAX_LISTINGS);
      await db.collection('importEvents').doc().set({
        uid, kind: 'perfil', channel: 'url', host: url.hostname, listings: avisos.length, createdAt: FieldValue.serverTimestamp(),
      });
      return { avisos };
    }

    let pagina;
    const viaMarcador = !!(d.pagina && typeof d.pagina === 'object');
    if (viaMarcador) {
      pagina = _cleanPagina(d.pagina);
    } else {
      const r = await _fetchPortalHtml(url);
      pagina = RecoImport.parseListingHtml(r.html, r.url);
    }
    if (!pagina.text && !pagina.jsonld.length && !Object.keys(pagina.meta).length) {
      throw new HttpsError('invalid-argument', 'La página no tiene contenido legible.');
    }

    await _importRateLimit(uid);

    const photos = await _downloadPhotos(pagina.images);
    const photoIds = photos.map((p) => p.id);
    const text = RecoImport.pageToText(pagina, url.href, photoIds, IMPORT_TEXT_MAX_CHARS - 500);
    const result = await _extractAndSaveDrafts({
      fn: 'importListingPage', uid, kind: 'url', channel: 'url',
      sourceName: (url.hostname + url.pathname).slice(0, 120), batchId: d.batchId,
      text, photoIds, sourceLabel: 'la página',
      errorMessage: 'No pudimos leer el aviso. Intenta de nuevo o pega su texto.',
      draftExtra: { sourceUrl: url.href.slice(0, 500) },
      eventExtra: { host: url.hostname, viaMarcador, photos: photos.length },
    });
    // Un aviso suele ser un solo inmueble: si la IA no le asignó fotos, son
    // todas las de la página. Solo vuelven las fotos asignadas.
    if (result.drafts.length === 1 && !result.drafts[0].fotos.length) result.drafts[0].fotos = photoIds.slice();
    const usadas = new Set(result.drafts.flatMap((x) => x.fotos));
    return { ...result, photos: photos.filter((p) => usadas.has(p.id)) };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Bot de WhatsApp (roadmap 2.1) — el corredor envía texto, fotos o notas de
// voz al número de ReCo, escribe LISTO y recibe los inmuebles encontrados;
// los revisa y publica en recosac.com/#borradores.
//
//   whatsappLink           callable: código de 6 dígitos para conectar el
//                          número a la cuenta ("VINCULAR 123456"), estado y
//                          desconexión.
//   whatsappWebhook        HTTP para Meta: verificación (GET) y mensajes
//                          (POST con firma X-Hub-Signature-256). Solo guarda
//                          cada mensaje en /whatsappInbox/{wamid} (idempotente)
//                          y responde 200 al instante.
//   whatsappProcessMessage trigger de /whatsappInbox: comandos, sesión de
//                          mensajes y, con LISTO, transcripción de notas de
//                          voz, fotos a Storage (imports/{uid}/{lote}/) y el
//                          mismo pipeline de extracción (_extractAndSaveDrafts).
//
// Colecciones (solo servidor): whatsappLinks/{teléfono}, whatsappLinkCodes/
// {código}, whatsappSessions/{teléfono}, whatsappInbox/{wamid}.
// Configuración: secretos WHATSAPP_TOKEN, WHATSAPP_APP_SECRET,
// WHATSAPP_VERIFY_TOKEN y parámetro WHATSAPP_PHONE_NUMBER_ID.
// ─────────────────────────────────────────────────────────────────────────────
const WA_GRAPH = 'https://graph.facebook.com/v21.0';
const WA_LINK_CODE_MINUTES = 15;
const WA_SESSION_MAX_ITEMS = 80;
const WA_SESSION_MAX_PHOTOS = 30;
const WA_MAX_VOICE_NOTES = 5;
const WA_MEDIA_MAX_BYTES = 16 * 1024 * 1024;
const WA_SITE = 'https://recosac.com';
// create() sobre un documento que ya existe: el admin SDK devuelve el código
// gRPC 6 (ALREADY_EXISTS) numérico.
const _isAlreadyExists = (e) => !!e && (e.code === 6 || e.code === 'already-exists' || /already exists/i.test(String(e.message || '')));

exports.whatsappLink = onCall(
  { region: REGION, maxInstances: 10, consumeAppCheckToken: true, enforceAppCheck: true },
  async (request) => {
    _logAppCheck(request, 'whatsappLink');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const action = (request.data || {}).action;
    const links = await db.collection('whatsappLinks').where('uid', '==', uid).get();
    if (action === 'unlink') {
      const batch = db.batch();
      links.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      return { linked: [] };
    }
    const linked = links.docs.map((doc) => `+${doc.id.slice(0, -4).replace(/\d/g, '•')}${doc.id.slice(-4)}`);
    if (action !== 'code') return { linked };
    // Código de un solo uso, 15 min. Reintenta si el código ya existe.
    for (let i = 0; i < 5; i++) {
      const code = String(require('crypto').randomInt(0, 1e6)).padStart(6, '0');
      try {
        await db.collection('whatsappLinkCodes').doc(code).create({
          uid, expiresAt: Timestamp.fromMillis(Date.now() + WA_LINK_CODE_MINUTES * 60000), createdAt: FieldValue.serverTimestamp(),
        });
        return { code, minutes: WA_LINK_CODE_MINUTES, linked };
      } catch (e) {
        if (!_isAlreadyExists(e)) throw e;
      }
    }
    throw new HttpsError('internal', 'No se pudo generar el código. Intenta de nuevo.');
  }
);

exports.whatsappWebhook = onRequest(
  { region: REGION, maxInstances: 10, secrets: [waAppSecret, waVerifyToken] },
  async (req, res) => {
    if (req.method === 'GET') {
      const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === waVerifyToken.value();
      res.status(ok ? 200 : 403).send(ok ? String(req.query['hub.challenge'] || '') : 'forbidden');
      return;
    }
    if (req.method !== 'POST') { res.status(405).send('method not allowed'); return; }
    if (!WaCore.verifySignature(req.rawBody, req.get('x-hub-signature-256'), waAppSecret.value())) {
      logger.warn('[whatsappWebhook] firma inválida');
      res.status(401).send('bad signature');
      return;
    }
    const messages = WaCore.parseWebhook(req.body);
    await Promise.all(messages.map((m) => db.collection('whatsappInbox').doc(m.id.replace(/\//g, '_'))
      .create({ ...m, receivedAt: FieldValue.serverTimestamp() })
      .catch((e) => { if (!_isAlreadyExists(e)) throw e; })));
    res.status(200).send('ok');
  }
);

async function _waSend(to, body) {
  const phoneId = waPhoneNumberId.value();
  if (!phoneId) { logger.warn('[whatsapp] falta WHATSAPP_PHONE_NUMBER_ID'); return; }
  const r = await fetch(`${WA_GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${waToken.value()}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: String(body).slice(0, 4000) } }),
  });
  if (!r.ok) logger.error('[whatsapp] envío fallido', { status: r.status, body: (await r.text()).slice(0, 300) });
}
// Media de la Cloud API: id → URL temporal → bytes (con el token).
async function _waMedia(mediaId) {
  const auth = { Authorization: `Bearer ${waToken.value()}` };
  const meta = await (await fetch(`${WA_GRAPH}/${encodeURIComponent(mediaId)}`, { headers: auth })).json();
  if (!meta || !meta.url) throw new Error('media sin url');
  if (Number(meta.file_size) > WA_MEDIA_MAX_BYTES) throw new Error('media muy grande');
  const r = await fetch(meta.url, { headers: auth });
  if (!r.ok) throw new Error(`media HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > WA_MEDIA_MAX_BYTES) throw new Error('media muy grande');
  return { buf, mime: String(meta.mime_type || '').split(';')[0] };
}
async function _transcribe(buf, mime) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime || 'audio/ogg' }), 'nota.ogg');
  fd.append('model', 'whisper-1');
  fd.append('language', 'es');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${openaiKey.value()}` }, body: fd,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error?.message || `HTTP ${r.status}`);
  return String(body.text || '').trim().slice(0, 4000);
}
// Foto a Storage con token de descarga (la web la muestra y, al publicar,
// publishProperty la copia a publications/).
async function _savePhoto(uid, batchId, n, buf, mime) {
  const { getStorage } = require('firebase-admin/storage');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const path = `imports/${uid}/${batchId}/${n}.${ext}`;
  const file = getStorage().bucket().file(path);
  const token = require('crypto').randomUUID();
  await file.save(buf, { contentType: mime || 'image/jpeg', metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
  return `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function _waProcessSession(phone, uid) {
  const sessionRef = db.collection('whatsappSessions').doc(phone);
  // Se toma la sesión y se vacía en la misma transacción: un segundo LISTO
  // no procesa dos veces lo mismo.
  const items = await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    const it = (snap.exists && snap.data().items) || [];
    if (it.length) tx.set(sessionRef, { items: [], updatedAt: FieldValue.serverTimestamp() });
    return it;
  });
  if (!items.length) { await _waSend(phone, WaCore.MENSAJES.vacio); return; }
  try {
    await _importRateLimit(uid);
  } catch (e) {
    await sessionRef.set({ items, updatedAt: FieldValue.serverTimestamp() });
    await _waSend(phone, WaCore.MENSAJES.limite);
    return;
  }
  await _waSend(phone, WaCore.MENSAJES.procesando);
  const batchId = db.collection('importDrafts').doc().id;
  const transcripts = {};
  const urlById = {};
  let voces = 0, n = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      if (it.type === 'audio' && voces < WA_MAX_VOICE_NOTES) {
        voces++;
        const m = await _waMedia(it.mediaId);
        transcripts[i] = await _transcribe(m.buf, m.mime);
      } else if (it.type === 'image' && n < WA_SESSION_MAX_PHOTOS) {
        const m = await _waMedia(it.mediaId);
        if (!/^image\/(jpeg|png|webp)$/.test(m.mime)) continue;
        n++;
        it.photoId = `w-${n}`;
        urlById[it.photoId] = await _savePhoto(uid, batchId, n, m.buf, m.mime);
      }
    } catch (e) {
      logger.warn('[whatsapp] media no disponible', { err: e && e.message });
    }
  }
  const { text, photoIds } = WaCore.sessionToText(items, transcripts);
  try {
    const result = await _extractAndSaveDrafts({
      fn: 'whatsappProcessMessage', uid, kind: 'bot', channel: 'whatsapp', sourceName: 'WhatsApp (bot)', batchId,
      text: text.slice(0, IMPORT_TEXT_MAX_CHARS), photoIds, sourceLabel: 'tus mensajes',
      eventExtra: { photos: photoIds.length, voiceNotes: voces },
    });
    // Un solo inmueble sin fotos asignadas: son todas las enviadas.
    if (result.drafts.length === 1 && !result.drafts[0].fotos.length) result.drafts[0].fotos = photoIds.slice();
    // Las fotos quedan en el borrador (a diferencia de los archivos subidos
    // en la web, que viven solo en el navegador).
    const fotosBatch = db.batch();
    result.drafts.forEach((dr) => {
      const urls = dr.fotos.map((id) => urlById[id]).filter(Boolean).slice(0, 12);
      if (urls.length) fotosBatch.update(db.collection('importDrafts').doc(dr.id), { photoUrls: urls });
    });
    await fotosBatch.commit();
    await _waSend(phone, WaCore.summarizeDrafts(result.drafts, `${WA_SITE}/#borradores`));
  } catch (e) {
    logger.error('[whatsapp] extracción fallida', { err: e && e.message });
    await sessionRef.set({ items, updatedAt: FieldValue.serverTimestamp() });
    await _waSend(phone, WaCore.MENSAJES.error);
  }
}

exports.whatsappProcessMessage = onDocumentCreated(
  { region: REGION, document: 'whatsappInbox/{msgId}', timeoutSeconds: 540, memory: '1GiB', secrets: [openaiKey, waToken] },
  async (event) => {
    const m = event.data && event.data.data();
    if (!m || !m.from) return;
    const phone = m.from;
    const cmd = m.type === 'text' ? WaCore.parseCommand(m.text) : null;

    if (cmd && cmd.cmd === 'vincular') {
      const codeRef = db.collection('whatsappLinkCodes').doc(cmd.code);
      const uid = await db.runTransaction(async (tx) => {
        const snap = await tx.get(codeRef);
        if (!snap.exists || snap.data().expiresAt.toMillis() < Date.now()) return null;
        tx.delete(codeRef);
        tx.set(db.collection('whatsappLinks').doc(phone), { uid: snap.data().uid, linkedAt: FieldValue.serverTimestamp() });
        return snap.data().uid;
      });
      await _waSend(phone, uid ? WaCore.MENSAJES.vinculado : WaCore.MENSAJES.codigoInvalido);
      return;
    }
    const link = await db.collection('whatsappLinks').doc(phone).get();
    if (!link.exists) { await _waSend(phone, WaCore.MENSAJES.noVinculado(WA_SITE)); return; }
    const uid = link.data().uid;

    if (cmd && cmd.cmd === 'ayuda') { await _waSend(phone, WaCore.MENSAJES.ayuda(`${WA_SITE}/#borradores`)); return; }
    if (cmd && cmd.cmd === 'cancelar') {
      await db.collection('whatsappSessions').doc(phone).set({ items: [], updatedAt: FieldValue.serverTimestamp() });
      await _waSend(phone, WaCore.MENSAJES.cancelado);
      return;
    }
    if (cmd && cmd.cmd === 'listo') { await _waProcessSession(phone, uid); return; }
    if (m.type === 'other') { await _waSend(phone, WaCore.MENSAJES.otroTipo); return; }

    const item = m.type === 'text' ? { type: 'text', ts: m.ts, text: m.text }
      : { type: m.type, ts: m.ts, mediaId: m.mediaId, ...(m.caption && { caption: m.caption }) };
    const sessionRef = db.collection('whatsappSessions').doc(phone);
    const estado = await db.runTransaction(async (tx) => {
      const snap = await tx.get(sessionRef);
      const items = (snap.exists && snap.data().items) || [];
      if (items.length >= WA_SESSION_MAX_ITEMS) return 'lleno';
      tx.set(sessionRef, { items: items.concat([item]).sort((a, b) => a.ts - b.ts), updatedAt: FieldValue.serverTimestamp() });
      return items.length === 0 ? 'primero' : '';
    });
    if (estado === 'primero') await _waSend(phone, WaCore.MENSAJES.recibido);
    else if (estado === 'lleno') await _waSend(phone, WaCore.MENSAJES.lleno);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// sendPasswordResetViaResend — generate a password-reset link with the Admin
// SDK and queue a branded email through the /mail collection (→ Resend SMTP).
//
// Why not just firebase.auth().sendPasswordResetEmail() from the client?
// That uses Firebase Auth's built-in SMTP, which sends from
// noreply@reco-5a5dd.firebaseapp.com — a domain the project does not
// control and cannot add SPF/DKIM/DMARC records to. The result: reset
// emails land in spam or never arrive at all (BUG-06). By generating the
// action link server-side and dispatching it through Resend (which sends
// from no-reply@recosac.com with verified SPF/DKIM/DMARC), delivery is
// reliable and immediate.
//
// Does NOT require authentication (the user forgot their password and
// can't log in). App Check enforcement prevents bot abuse.
//
// Anti-enumeration: always returns { ok: true } regardless of whether the
// email is registered, so the response is identical for existing and
// non-existing accounts.
//
// Client contract:
//   const fn = firebase.functions().httpsCallable('sendPasswordResetViaResend');
//   await fn({ email: 'user@example.com' });
// ─────────────────────────────────────────────────────────────────────────────
exports.sendPasswordResetViaResend = onCall(
  {
    region: REGION,
    maxInstances: 10,
    consumeAppCheckToken: true,
    enforceAppCheck: true,
  },
  async (request) => {
    _logAppCheck(request, 'sendPasswordResetViaResend');
    const emailRaw = request.data && request.data.email;
    if (!emailRaw || typeof emailRaw !== 'string') {
      throw new HttpsError('invalid-argument', 'Email requerido.');
    }
    const email = emailRaw.trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) {
      throw new HttpsError('invalid-argument', 'Email inválido.');
    }

    // Rate limit: at most RESET_RATE_LIMIT_PER_EMAIL_PER_HOUR reset
    // emails per address per rolling hour. Uses /mail docs with
    // _resetFor == email as the counter — the same docs the extension
    // picks up, so no extra collection needed. The response is always
    // { ok: true } regardless of whether the limit was hit, preserving
    // anti-enumeration (caller cannot tell if the email exists or was
    // throttled).
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const recentResets = await db.collection('mail')
      .where('_resetFor', '==', email)
      .where('_queuedAt', '>', oneHourAgo)
      .count().get();
    if (recentResets.data().count >= RESET_RATE_LIMIT_PER_EMAIL_PER_HOUR) {
      logger.warn('[sendPasswordResetViaResend] rate-limit hit', {
        email, recent: recentResets.data().count,
        limit: RESET_RATE_LIMIT_PER_EMAIL_PER_HOUR,
      });
      return { ok: true };
    }

    try {
      const link = await getAuth().generatePasswordResetLink(email, { url: CONTINUE_URL });
      await db.collection('mail').add({
        to: email,
        _resetFor: email,
        _queuedAt: new Date(),
        message: {
          subject: 'Restablecé tu contraseña en Reco',
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="color:#0891b2">Restablecé tu contraseña</h2>
  <p>Recibimos un pedido para restablecer la contraseña de tu cuenta en Reco.</p>
  <p style="margin-top:24px">
    <a href="${link}" style="background:#0891b2;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Restablecer contraseña</a>
  </p>
  <p style="margin-top:24px;color:#64748b;font-size:.85rem">Si no pediste este cambio, ignorá este email. El enlace expira en 1 hora.</p>
  <p style="color:#64748b;font-size:.85rem;margin-top:32px">— Equipo Reco</p>
</div>`,
          text: `Recibimos un pedido para restablecer tu contraseña en Reco.\n\nHacé clic en el siguiente enlace:\n${link}\n\nSi no pediste este cambio, ignorá este email. El enlace expira en 1 hora.\n\n— Equipo Reco`,
        },
      });
    } catch (e) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-email') {
        return { ok: true };
      }
      logger.warn('[sendPasswordResetViaResend] failed', {
        email, code: e.code, err: e.message,
      });
      throw new HttpsError('internal', 'No pudimos procesar tu solicitud. Intentá de nuevo.');
    }
    return { ok: true };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// sendVerificationViaResend — generate an email-verification link with the
// Admin SDK and queue a branded email through /mail (→ Resend SMTP).
//
// Same motivation as sendPasswordResetViaResend: Firebase Auth's built-in
// verification email comes from firebaseapp.com which has no SPF/DKIM for
// this project's domain, so it often lands in spam.
//
// Requires authentication (the user just signed up and is logged in, but
// their email is not yet verified). Returns early if already verified.
//
// Client contract:
//   const fn = firebase.functions().httpsCallable('sendVerificationViaResend');
//   await fn();
// ─────────────────────────────────────────────────────────────────────────────
exports.sendVerificationViaResend = onCall(
  {
    region: REGION,
    maxInstances: 10,
    consumeAppCheckToken: true,
    enforceAppCheck: true,
  },
  async (request) => {
    _logAppCheck(request, 'sendVerificationViaResend');
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const token = request.auth.token || {};
    if (token.email_verified === true) {
      return { ok: true, alreadyVerified: true };
    }
    const email = token.email;
    if (!email) {
      throw new HttpsError('failed-precondition', 'Tu cuenta no tiene email asociado.');
    }
    try {
      const link = await getAuth().generateEmailVerificationLink(email, { url: CONTINUE_URL });
      const user = await getAuth().getUser(request.auth.uid);
      const name = (user.displayName || '').split(' ')[0];
      const greeting = name ? `Hola ${_esc(name)},` : 'Hola,';
      await db.collection('mail').add({
        to: email,
        message: {
          subject: 'Verificá tu email en Reco',
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="color:#0891b2">Verificá tu email</h2>
  <p>${greeting}</p>
  <p>Para completar tu registro en Reco y poder publicar, verificá tu dirección de email:</p>
  <p style="margin-top:24px">
    <a href="${link}" style="background:#0891b2;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Verificar email</a>
  </p>
  <p style="margin-top:24px;color:#64748b;font-size:.85rem">Si no creaste una cuenta en Reco, ignorá este email.</p>
  <p style="color:#64748b;font-size:.85rem;margin-top:32px">— Equipo Reco</p>
</div>`,
          text: `${name ? 'Hola ' + name + ',' : 'Hola,'}\n\nPara completar tu registro en Reco, verificá tu email:\n${link}\n\nSi no creaste una cuenta, ignorá este email.\n\n— Equipo Reco`,
        },
      });
    } catch (e) {
      logger.warn('[sendVerificationViaResend] failed', {
        uid: request.auth.uid, code: e.code, err: e.message,
      });
      throw new HttpsError('internal', 'No pudimos enviar el email de verificación. Intentá de nuevo.');
    }
    return { ok: true };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// onPublicationModerated — Firestore trigger on /publications/{pubId}.
//
// When a publication's status transitions to 'approved' or 'rejected',
// this trigger automatically queues a notification email to the publisher
// via the /mail collection (→ Resend SMTP).
//
// Replaces the old client-side _queueModerationEmail() which was fire-and-
// forget: if the admin's browser dropped the Firestore write, the user
// never got notified. This trigger fires server-side and is guaranteed to
// run as long as the status update itself succeeds.
// ─────────────────────────────────────────────────────────────────────────────
exports.onPublicationModerated = onDocumentWritten(
  { region: REGION, document: 'publications/{pubId}' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.data();
    if (!after) return;
    const before = event.data && event.data.before && event.data.before.data();
    const newStatus = after.status;
    const oldStatus = before && before.status;
    const pubId = event.params && event.params.pubId;

    if (newStatus === oldStatus) return;
    if (newStatus !== 'approved' && newStatus !== 'rejected') return;

    // Idempotency: skip if we already notified the user about this exact
    // status. Prevents duplicate emails on approve → unapprove → approve
    // cycles. A re-approval after rejection IS a new event and sends a
    // new email (the _lastNotifiedStatus would be 'rejected', not
    // 'approved'). We write _lastNotifiedStatus after queuing the email.
    if (after._lastNotifiedStatus === newStatus) {
      logger.info('[onPublicationModerated] already notified, skipping', {
        pubId, status: newStatus,
      });
      return;
    }

    // Resolve the recipient email. Prefer the publication's userEmail
    // field (set at publish time), but fall back to Firebase Auth as
    // the authoritative source. This handles edge cases where the
    // publication was created before userEmail was stored, or where the
    // user changed their email after publishing.
    let userEmail = after.userEmail;
    let userName = after.userName;
    if (!userEmail && after.userId) {
      try {
        const authUser = await getAuth().getUser(after.userId);
        userEmail = authUser.email;
        userName = userName || authUser.displayName;
      } catch (e) {
        logger.warn('[onPublicationModerated] Auth lookup failed', {
          pubId, userId: after.userId, err: e.message,
        });
      }
    }
    if (!userEmail) {
      logger.warn('[onPublicationModerated] no email for publication owner', {
        pubId, userId: after.userId,
      });
      return;
    }

    const name = (userName || '').split(' ')[0];
    const greeting = name ? `Hola ${_esc(name)},` : 'Hola,';
    const address = after.address || '—';
    const district = after.district || '—';

    let subject, html, text;
    if (newStatus === 'approved') {
      subject = 'Tu publicación en Reco fue aprobada';
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="color:#0891b2">¡Tu publicación está en línea!</h2>
  <p>${greeting}</p>
  <p>Acabamos de aprobar tu publicación de <strong>${_esc(address)}</strong> en <strong>${_esc(district)}</strong>.
  Ya aparece en los resultados de búsqueda de Reco junto a las propiedades oficiales.</p>
  <p style="margin-top:24px">
    <a href="${CONTINUE_URL}" style="background:#0891b2;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Ver en Reco</a>
  </p>
  <p style="color:#64748b;font-size:.85rem;margin-top:32px">— Equipo Reco</p>
</div>`;
      text = `${name ? 'Hola ' + name + ',' : 'Hola,'}\n\nTu publicación de ${address} en ${district} fue aprobada y ya está visible en Reco.\n\n— Equipo Reco`;
    } else {
      const reason = after.rejectionReason || '';
      subject = 'Tu publicación en Reco no pudo ser aprobada';
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="color:#dc2626">Tu publicación no pudo ser aprobada</h2>
  <p>${greeting}</p>
  <p>Revisamos tu publicación de <strong>${_esc(address)}</strong> en <strong>${_esc(district)}</strong>
  y, por el momento, no podemos publicarla en Reco.</p>
  ${reason ? `<p><strong>Razón:</strong> ${_esc(reason)}</p>` : ''}
  <p>Puedes corregir lo indicado y volver a enviarla desde "Mis publicaciones".</p>
  <p style="color:#64748b;font-size:.85rem;margin-top:32px">— Equipo Reco</p>
</div>`;
      text = `${name ? 'Hola ' + name + ',' : 'Hola,'}\n\nTu publicación de ${address} en ${district} no pudo ser aprobada.${reason ? '\nRazón: ' + reason : ''}\n\nPuedes corregirla y volver a enviarla.\n\n— Equipo Reco`;
    }

    try {
      const mailRef = db.collection('mail').doc();
      const batch = db.batch();
      batch.set(mailRef, { to: userEmail, message: { subject, html, text } });
      batch.update(event.data.after.ref, { _lastNotifiedStatus: newStatus });
      await batch.commit();
    } catch (e) {
      logger.warn('[onPublicationModerated] mail queue failed', {
        pubId, err: e.message,
      });
    }
  }
);
