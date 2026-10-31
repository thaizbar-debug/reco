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
const { onDocumentWritten, onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const RecoCatalogo = require('./shared/catalogo');
const RecoImport = require('./shared/import-core');
const WaCore = require('./whatsapp-core');
const RecoFeed = require('./feed-core');
const RecoSocial = require('./social-core');

initializeApp();
const db = getFirestore();

const openaiKey = defineSecret('OPENAI_API_KEY');
const culqiSecretKey = defineSecret('CULQI_SECRET_KEY');
// Bot de WhatsApp (Cloud API de Meta). Ver whatsappWebhook más abajo.
const waToken = defineSecret('WHATSAPP_TOKEN');
const waAppSecret = defineSecret('WHATSAPP_APP_SECRET');
const waVerifyToken = defineSecret('WHATSAPP_VERIFY_TOKEN');
const waPhoneNumberId = defineString('WHATSAPP_PHONE_NUMBER_ID', { default: '' });
// Geocodificación en el servidor (HERE) para lo que publican las conexiones
// automáticas y la API. Vacío = sin geocodificar (el inmueble se publica sin
// punto en el mapa hasta que el dueño o un admin lo ubique).
const hereApiKey = defineString('HERE_API_KEY', { default: '' });

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
const PUB_SOURCES = ['single', 'bulk', 'text', 'whatsapp', 'documento', 'url', 'pdf', 'feed', 'api', 'email', 'redes', 'video'];

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

    const { fields } = _pubFieldsFromRaw(raw);
    const source = PUB_SOURCES.includes(raw.source) ? raw.source : 'single';
    // Si viene de un borrador de importación, se borra en la misma
    // transacción: o queda publicado y sin borrador, o nada cambia.
    const draftRef = (typeof raw.importDraftId === 'string' && DRAFT_ID_RE.test(raw.importDraftId))
      ? db.collection('importDrafts').doc(raw.importDraftId) : null;
    const pubRef = db.collection('publications').doc(); // pre-generate id
    const out = await _createPublication({
      uid, email: (request.auth.token && request.auth.token.email) || null,
      fields, source, pubRef, draftRef, importEdits: raw.importEdits,
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

// Valida y arma los campos de una publicación. Es la única verificación previa
// a publicar: la usan publishProperty (formulario, carga masiva, borradores),
// las conexiones automáticas, la API pública y el correo de ingesta.
// raw.area = área techada; fields.area = área principal (de terreno en un
// Terreno). Lanza invalid-argument con details.errores.
function _pubFieldsFromRaw(raw) {
  // details.errores: los mismos textos de la verificación previa a publicar
  // ("descripción vacía", "área de terreno obligatoria para Terreno"…).
  const errores = (fallback) => {
    const e = RecoCatalogo.verificarPublicacion(raw).errores;
    return { errores: e.length ? e : [fallback] };
  };
  const strOrThrow = (v, name, max = 500) => {
    const s = v == null ? '' : String(v).trim();
    if (!s) throw new HttpsError('invalid-argument', `Falta ${name}.`, errores(`falta ${name}`));
    if (s.length > max) throw new HttpsError('invalid-argument', `${name} muy largo (máx ${max}).`, errores(`${name} muy largo (máx ${max})`));
    return s;
  };
  const address  = strOrThrow(raw.address, 'address');
  const district = strOrThrow(raw.district, 'district');
  const title    = strOrThrow(raw.title, 'title', 200);
  const desc     = strOrThrow(raw.desc, 'desc', 5000);

  const type = RecoCatalogo.matchType(raw.type);
  const op = RecoCatalogo.matchOp(raw.op);
  const currency = RecoCatalogo.matchCurrency(raw.currency);
  if (!type) throw new HttpsError('invalid-argument', 'type inválido.', { errores: ['tipo de propiedad inválido'] });
  if (!op) throw new HttpsError('invalid-argument', 'op inválido.', { errores: ['operación inválida'] });
  if (!currency) throw new HttpsError('invalid-argument', 'currency inválido.', { errores: ['moneda inválida (USD o PEN)'] });

  // Verificación previa a publicar (shared/catalogo.js): la misma que
  // corren la carga masiva y el formulario antes de llamar aquí. Exige el
  // área según el tipo (techada; de terreno para Terreno) y deja en 0 lo
  // que no aplica.
  const verif = RecoCatalogo.verificarPublicacion(raw);
  if (verif.errores.length) {
    throw new HttpsError('invalid-argument', verif.errores.join('; ') + '.', { errores: verif.errores });
  }
  // "En planos", "Preventa", "E/C"… → canónico. En proyecto y En
  // construcción siempre se guardan con antigüedad 0.
  const { estado, antiguedad: age } = RecoCatalogo.resolveEstadoAntiguedad(raw.estado, raw.age);
  const features = Array.isArray(raw.features)
    ? raw.features.filter(f => typeof f === 'string' && f.length < 100).slice(0, 30)
    : [];
  const lat = (typeof raw.lat === 'number' && isFinite(raw.lat)) ? raw.lat : null;
  const lng = (typeof raw.lng === 'number' && isFinite(raw.lng)) ? raw.lng : null;
  const numOrZero = (v) => { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0; };
  return {
    avisos: verif.avisos,
    fields: {
      address, district,
      lat, lng,
      type,
      op,
      currency,
      price: Number(raw.price),
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
      // area (principal), areaTech, areaTerr y los campos que no aplican
      // al tipo ya en 0 (p. ej. dormitorios en un Terreno).
      ...verif.datos,
    },
  };
}

// Crea la publicación (pendiente de moderación) y descuenta las llaves de
// PUBLISH_COST en la misma transacción. Con draftRef, borra el borrador de
// importación del mismo usuario y guarda sus métricas; un borrador de una
// conexión automática le pasa su vínculo (syncSourceId, syncKey…) para que
// las próximas sincronizaciones la actualicen. extra: campos adicionales
// (vínculo de sincronización, id externo de la API).
const SYNC_LINK_FIELDS = ['syncSourceId', 'syncKey', 'syncHash', 'syncPhotos', 'syncVersion', 'syncRaw'];
async function _createPublication(o) {
  const userRef = db.collection('users').doc(o.uid);
  const pubRef = o.pubRef || db.collection('publications').doc();
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const userData = userSnap.exists ? userSnap.data() : {};
    const draftSnap = o.draftRef ? await tx.get(o.draftRef) : null;
    const draft = (draftSnap && draftSnap.exists && draftSnap.data().uid === o.uid) ? draftSnap.data() : null;
    const currentKeys = Number(userData.keysLeft) || 0;
    if (PUBLISH_COST > 0 && currentKeys < PUBLISH_COST) {
      throw new HttpsError(
        'failed-precondition',
        `Sin llaves suficientes. Necesitas ${PUBLISH_COST} llaves para publicar (tenés ${currentKeys}).`
      );
    }

    const pubData = {
      userId: o.uid,
      userEmail: o.email || null,
      userName: (userData && userData.displayName) || null,
      status: 'pending',
      source: o.source,
      createdAt: FieldValue.serverTimestamp(),
      listedAt: new Date().toISOString(),
      ...o.fields,
      photoUrls: [],
      ...(o.extra || {}),
    };
    pubData.fingerprint = RecoImport.fingerprint(pubData);
    if (draft) {
      // Métricas de calidad de la importación (roadmap 0.5).
      pubData.importChannel = draft.source || null;
      pubData.importAiFields = Array.isArray(draft.aiFields) ? draft.aiFields.length : 0;
      pubData.importEdits = Math.min(50, Math.max(0, Math.floor(Number(o.importEdits) || 0)));
      SYNC_LINK_FIELDS.forEach((k) => { if (draft[k] != null) pubData[k] = draft[k]; });
    }

    tx.set(pubRef, pubData);
    if (draft) tx.delete(o.draftRef);

    // Con costo 0 no se debita nada ni se ensucia el historial de
    // llaves con movimientos vacíos.
    if (PUBLISH_COST > 0) {
      const historyEntry = {
        type: 'use',
        qty: PUBLISH_COST,
        propId: null,
        propLabel: 'Publicación: ' + o.fields.title,
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
}

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
const IMPORT_DOC_TYPES = ['pdf', 'docx', 'pptx', 'whatsapp', 'imagenes', 'video'];
// Audio de un video subido (WAV 16 kHz mono, máx. ~150 s) para Whisper.
const IMPORT_AUDIO_RE = /^data:audio\/(wav|x-wav|mpeg|mp4|webm|ogg);base64,[A-Za-z0-9+/=]+$/;
const IMPORT_AUDIO_MAX_CHARS = 7 * 1024 * 1024;
const IMPORT_DOC_MAX_IMAGES = 6;
const IMPORT_DOC_MAX_IMAGE_CHARS = 1500000;
const IMPORT_DOC_MAX_PHOTO_IDS = 300;
const IMPORT_IMAGE_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const IMPORT_PHOTO_ID_RE = /^[a-z0-9-]{1,24}$/;

function _extractSystemPrompt() {
  const etiquetas = Object.entries(RecoCatalogo.ETIQUETAS)
    .map(([k, lista]) => `   ${k}: ${lista.join(' | ')}`).join('\n');
  return `Eres un asistente que extrae fichas de inmuebles en Perú a partir de texto libre o documentos (notas, chats de WhatsApp, avisos de portales, posts de Facebook, Instagram o TikTok, transcripciones de videos, PDF, Word, brochures o presentaciones de inmobiliarias).

Reglas:
1. Un elemento en "inmuebles" por cada inmueble distinto. Si un mismo inmueble ocupa varias páginas o diapositivas, combina su información en un solo elemento. Si no hay ningún inmueble, devuelve "inmuebles": [].
   - Brochure o aviso de un proyecto con varias tipologías (p. ej. "Depa AX01", "Tipo B", "Flat 2 dorm."): un elemento por tipología, con el nombre del proyecto y de la tipología en el título. La dirección, el distrito y el estado del proyecto valen para todas.
   - Ignora las secciones de OTROS proyectos o inmuebles que el desarrollador promociona aparte ("Otros proyectos", "También te puede interesar", "Nuestros proyectos", portafolio, entregados): no son el inmueble ofrecido.
   - En capturas de pantalla o posts de redes, ignora los textos de la aplicación (botones, "Send WhatsApp message", "Me gusta", "Comentar", "Ver traducción", número de reacciones).
2. Usa SOLO datos presentes en la entrada. Si un dato no aparece, devuelve null. Nunca inventes precio, área, dormitorios, baños ni dirección.
3. Copia los números tal como aparecen (ej. "185 mil", "US$ 185,000", "85 m2"); no conviertas monedas.
4. Interpreta sinónimos y abreviaturas habituales en Perú: Dpto./Depa/Depto. (departamento), Of. (oficina), Loc. (local), Lote/Terr. (terreno), Vta. (venta), Alq./Arriendo (alquiler), S/ o S/. (soles), US$ o U$S (dólares), dorm./hab. (dormitorios), bñs/SS.HH. (baños), cochera (estacionamiento), m2/mts (metros cuadrados), En planos/Preventa/Proy. (en proyecto), E/C/En obra/En const. (en construcción), A/E/a estrenar (construido, antigüedad 0). "En lanzamiento", "Preventa" o "Próximamente" es En proyecto.
5. tipo_publicacion: "Venta" o "Alquiler" (un proyecto en lanzamiento, preventa o construcción que no dice alquiler es Venta, como campo inferido). tipo_propiedad: Departamento, Casa, Oficina, Local comercial, Terreno u Otros. estado: Construido, En proyecto o En construcción. tipo_moneda: USD o PEN.
6. distrito: el distrito tal como aparece (ej. "Miraflores", "Surco"). direccion: calle y número si aparecen; si solo hay referencia ("cerca al parque Kennedy"), úsala.
7. Áreas: area_techada es el área construida/techada/útil; area_terreno, la del terreno o lote. En un terreno o lote, el área va en area_terreno; area_techada solo si se menciona algo construido. En un departamento, oficina o local, el "área libre", terraza, balcón, patio o jardín NO es area_terreno: deja area_terreno en null y menciona esa área en la descripción. Si solo hay "área total" y "área techada", usa la techada.
   Pisos: nro_pisos son los pisos del edificio o de la casa ("edificio de 10 pisos", "5 PISOS"); piso es el piso donde está la unidad ("piso 7"). Si es un rango ("Piso 2 al 8"), piso va en null y el rango en la descripción. niveles = 2 para un dúplex (o "Nivel 1 / Nivel 2"), 3 para tríplex.
   Baños: nro_banos son los baños completos; el baño de visita o medio baño no se suma (menciónalo en la descripción).
8. Etiquetas: usa SOLO valores exactos de estas listas, separados por ";" (null si ninguno aplica). "Piscina" de un edificio o condominio es "Piscina del edificio"; si es del inmueble, "Piscina propia".
${etiquetas}
9. departamento y provincia pueden ir en null. antiguedad: años o año de construcción tal como aparecen.
10. titulo: un título breve (máx. 90 caracteres) usando solo datos de la entrada. descripcion: el texto original de ese inmueble, sin teléfonos, correos ni nombres de personas.
11. campos_inferidos: lista los nombres de los campos que dedujiste y no estaban escritos literalmente (por ejemplo tipo_propiedad deducido de "depa" no es inferido; tipo_publicacion deducido del contexto sí lo es). El título siempre es inferido.
12. fotos: en documentos, las fotos aparecen como marcadores [FOTO id] en el lugar donde estaban. Asigna a cada inmueble los ids de SUS fotos (normalmente las de su misma página o diapositiva). No incluyas logos, íconos ni fotos de otro inmueble. Un marcador seguido de "(plano)" es el plano de esa página: va con la tipología o el inmueble de esa misma página. Las fotos del edificio, la fachada o las áreas comunes de un proyecto valen para todas sus tipologías. En un chat de WhatsApp, las fotos de un inmueble suelen enviarse justo antes o justo después del mensaje que lo describe y por la misma persona. Sin marcadores, devuelve [].
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
  if (!fileType) throw new HttpsError('invalid-argument', 'Formato de documento no soportado (PDF, Word .docx, PowerPoint .pptx, chat de WhatsApp, imágenes o video).');
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
    let text = String(d.text || '').trim();
    if (!text && !isDoc) throw new HttpsError('invalid-argument', 'Pega el texto con los inmuebles.');
    if (text.length > IMPORT_TEXT_MAX_CHARS) {
      throw new HttpsError('invalid-argument', `El texto es muy largo (máx. ${IMPORT_TEXT_MAX_CHARS} caracteres). Divídelo en partes.`);
    }
    const doc = isDoc ? _extractDocumentInput(d, text) : null;
    // Un chat de WhatsApp exportado llega como documento (texto + fotos)
    // pero se registra con su propio canal.
    const channel = isDoc ? (doc.fileType === 'whatsapp' ? 'whatsapp' : doc.fileType === 'video' ? 'video' : 'documento')
      : (IMPORT_TEXT_CHANNELS.includes(d.channel) ? d.channel : 'text');
    const sourceName = String(d.sourceName || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120) || null;
    const audio = isDoc && doc.fileType === 'video' && d.audio && typeof d.audio.dataUrl === 'string' ? d.audio.dataUrl : '';
    if (audio && (!IMPORT_AUDIO_RE.test(audio) || audio.length > IMPORT_AUDIO_MAX_CHARS)) {
      throw new HttpsError('invalid-argument', 'Audio del video inválido o demasiado largo.');
    }

    await _importRateLimit(uid);

    // Video: lo que se dice (precio, áreas, distrito…) es parte de la fuente.
    let transcrito = false;
    if (audio) {
      try {
        const [head, b64] = audio.split(',');
        const mime = head.slice(5, head.indexOf(';'));
        const t = await _transcribe(Buffer.from(b64, 'base64'), mime, `audio.${mime.split('/')[1].replace('x-', '').replace('mpeg', 'mp3')}`);
        if (t) {
          text = `${text}\n\nLo que se dice en el video:\n${t}`.trim();
          doc.content[0] = { type: 'text', text };
          transcrito = true;
        }
      } catch (e) {
        logger.warn('[extractListings] audio no transcrito', { err: e && e.message });
      }
    }

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
      eventExtra: doc ? { fileType: doc.fileType, pageImages: doc.images, photos: doc.photoIds.length, ...(audio && { audio: transcrito }) } : null,
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

// Columnas (o rutas de un feed) + filas de ejemplo → { campo de ReCo: columna }.
// Solo devuelve columnas que existen. Lo usan mapImportColumns (Excel) y las
// conexiones automáticas (feeds y hojas de cálculo) la primera vez.
async function _aiMapColumns(headers, sample) {
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
  const prompt = `Eres un asistente que ordena inventarios inmobiliarios de Perú. Te doy las columnas de un Excel o feed de un corredor y algunas filas de ejemplo.
Para cada campo de ReCo, indica el nombre EXACTO de la columna que lo contiene, o null si ninguna lo contiene. No uses la misma columna para dos campos salvo que de verdad contenga ambos datos. Interpreta abreviaturas (Dpto., Dorm., Hab., Bñs, Cochera, m2, Vta./Alq., S/, US$) y nombres en inglés.
Campos de ReCo:
${RecoImport.COLS.map((k) => `- ${k}: ${IMPORT_COLUMN_HINTS[k]}`).join('\n')}`;
  const user = `Columnas: ${JSON.stringify(headers)}\nFilas de ejemplo:\n${sample.map((r) => JSON.stringify(r)).join('\n')}`;
  const parsed = await _openaiStructured(prompt, user, 'mapeo_columnas', schema);
  const mapeo = {};
  Object.entries((parsed && parsed.mapeo) || {}).forEach(([k, v]) => {
    if (RecoImport.COLS.includes(k) && typeof v === 'string' && headers.includes(v)) mapeo[k] = v;
  });
  return mapeo;
}

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

    let mapeo;
    try {
      mapeo = await _aiMapColumns(headers, sample);
    } catch (e) {
      logger.error('[mapImportColumns] OpenAI error', { err: e && e.message });
      throw new HttpsError('internal', 'No pudimos reconocer las columnas. Indícalas a mano.');
    }
    await db.collection('importEvents').doc().set({
      uid, kind: 'columns', channel: 'excel', headers: headers.length, mapped: Object.keys(mapeo).length,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { mapeo };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// importListingPage — importar desde un enlace (roadmap 1.4/1.5 y mejoras).
//
// Entradas:
//   { url }            Cualquier página pública: aviso de un portal, web
//                      propia de la inmobiliaria o post de Facebook,
//                      Instagram, TikTok o YouTube (social-core.js lee sus
//                      páginas públicas de inserción; si el post trae un video
//                      descargable, se transcribe su audio). Si el sitio
//                      bloquea la descarga → failed-precondition,
//                      details.reason 'blocked' (el cliente ofrece el marcador
//                      "Enviar a ReCo"); un post privado → 'social-private';
//                      el enlace de un perfil de red → 'social-profile'.
//   { url, modo: 'perfil' }  Perfil de un portal, página de resultados o
//                      listado de proyectos de una web: devuelve { avisos:
//                      [{ url, title }] } (máx. IMPORT_PROFILE_MAX_LISTINGS)
//                      sin usar la IA.
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
// Portales conocidos: en su perfil, los avisos tienen un código numérico.
// Cualquier otro sitio usa la detección genérica de enlaces de inmuebles.
const IMPORT_URL_HOSTS = ['urbania.pe', 'adondevivir.com', 'properati.com.pe', 'babilonia.pe', 'nexoinmobiliario.pe',
  'mercadolibre.com.pe', 'infocasas.com.pe', 'remax.pe'];
const IMPORT_VIDEO_MAX_BYTES = 24 * 1024 * 1024; // límite de Whisper: 25 MB
// Lecturas de páginas por usuario y hora (aparte del límite de la IA): un
// enlace que falla no gasta una importación, pero el servidor no se puede usar
// para descargar páginas sin tope.
const IMPORT_FETCH_LIMIT_PER_HOUR = 120;
async function _fetchRateLimit(uid) {
  const hour = new Date().toISOString().slice(0, 13);
  const ref = db.collection('importUsage').doc(`${uid}_lecturas`);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() || {};
    if (d.hour === hour && (d.count || 0) >= IMPORT_FETCH_LIMIT_PER_HOUR) {
      throw new HttpsError('resource-exhausted', `Límite de ${IMPORT_FETCH_LIMIT_PER_HOUR} enlaces por hora alcanzado. Intenta más tarde.`);
    }
    tx.set(ref, { hour, count: d.hour === hour ? (d.count || 0) + 1 : 1 });
  });
}
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
// Una foto por URL (validación SSRF, tope de tamaño, descarta íconos).
// → { buf, mime } o null.
async function _fetchImage(u) {
  try {
    const r = await _safeFetch(u, { maxBytes: IMPORT_URL_PHOTO_BYTES, accept: 'image/jpeg,image/png,image/webp' });
    const type = (r.type.match(/^image\/(jpeg|png|webp)/i) || [])[0];
    if (r.status !== 200 || !type || r.truncated || r.body.length < IMPORT_URL_MIN_PHOTO_BYTES) return null;
    return { buf: r.body, mime: type.toLowerCase() };
  } catch (_) { return null; /* foto inaccesible: se omite */ }
}
async function _downloadPhotos(urls) {
  const photos = [];
  let total = 0;
  for (const u of urls) {
    if (photos.length >= IMPORT_URL_MAX_PHOTOS || total >= IMPORT_URL_PHOTOS_TOTAL_BYTES) break;
    const im = await _fetchImage(u);
    if (!im) continue;
    total += im.buf.length;
    photos.push({ id: `u-${photos.length + 1}`, dataUrl: `data:${im.mime};base64,${im.buf.toString('base64')}` });
  }
  return photos;
}
// HTML de una página pública. 403/429/503 o páginas de verificación
// ("captcha", "Just a moment") = el sitio no deja descargar desde un
// servidor → reason 'blocked' (el cliente ofrece el marcador).
async function _fetchPageHtml(url) {
  const r = await _safeFetch(url.href, { maxBytes: IMPORT_URL_HTML_BYTES, accept: 'text/html,application/xhtml+xml' })
    .catch((e) => { if (e instanceof HttpsError) throw e; return null; });
  const html = r ? r.body.toString('utf8') : '';
  if (!r || r.status !== 200 || !/html/i.test(r.type) || /captcha|cf-chl|just a moment|access denied|attention required/i.test(html.slice(0, 5000))) {
    throw new HttpsError('failed-precondition', 'Esa página no permitió leerla desde ReCo. Usa el botón "Enviar a ReCo" desde tu navegador o pega el texto del aviso.', { reason: 'blocked' });
  }
  return { html, url: r.url };
}
// Sigue las redirecciones de un enlace corto (facebook.com/share/…, vm.tiktok…)
// sin leer el cuerpo. Si la red manda al login, el destino real va en next=.
async function _resolveUrl(u) {
  let url = await _assertPublicUrl(u);
  for (let hop = 0; hop < 5; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMPORT_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url.href, { redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': IMPORT_FETCH_UA, 'Accept': 'text/html', 'Accept-Language': 'es-PE,es;q=0.9' } });
      try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (_) { /* sin cuerpo */ }
      const loc = res.status >= 300 && res.status < 400 && res.headers.get('location');
      if (!loc) return url.href;
      const next = new URL(loc, url).href;
      const real = RecoSocial.unwrapLogin(next);
      if (real !== next) return RecoSocial.cleanUrl(real);
      url = await _assertPublicUrl(next);
    } finally {
      clearTimeout(timer);
    }
  }
  return url.href;
}
const _socialError = (reason) => new HttpsError('failed-precondition',
  reason === 'social-profile' ? RecoSocial.AYUDA.perfil : RecoSocial.AYUDA.privado, { reason });
// Post de una red social → página para la IA ({ title, meta, text, images, video }).
async function _readSocial(urlStr, det) {
  let target = urlStr;
  let d = det;
  if (d.tipo === 'corto' || d.tipo === 'login') {
    target = RecoSocial.cleanUrl(RecoSocial.unwrapLogin(await _resolveUrl(urlStr).catch((e) => {
      if (e instanceof HttpsError) throw e; throw _socialError('social-private');
    })));
    d = RecoSocial.detect(target) || d;
  }
  if (d.tipo === 'perfil') throw _socialError('social-profile');
  if (d.tipo === 'corto' || d.tipo === 'login') throw _socialError('social-private');
  const json = d.red === 'tiktok' || d.red === 'youtube';
  const r = await _safeFetch(RecoSocial.embedUrl(target, d), { maxBytes: IMPORT_URL_HTML_BYTES, accept: json ? 'application/json' : 'text/html' })
    .catch((e) => { if (e instanceof HttpsError && e.code !== 'failed-precondition') throw e; return null; });
  if (!r || r.status !== 200) throw _socialError('social-private');
  const body = r.body.toString('utf8');
  let pagina;
  if (json) {
    let data = null;
    try { data = JSON.parse(body); } catch (_) { data = null; }
    if (!data) throw _socialError('social-private');
    pagina = RecoSocial.parseOembed(data, d.red);
    // YouTube: la descripción del video está en la página (meta description).
    if (d.red === 'youtube') {
      const w = await _safeFetch(target, { maxBytes: IMPORT_URL_HTML_BYTES, accept: 'text/html' }).catch(() => null);
      const meta = w && w.status === 200 ? RecoImport.parseListingHtml(w.body.toString('utf8'), w.url).meta : {};
      const desc = meta['og:description'] || meta.description || '';
      if (desc) pagina.text = [pagina.text, desc].filter(Boolean).join('\n');
    }
  } else {
    pagina = d.red === 'facebook' ? RecoSocial.parseFacebookEmbed(body, r.url) : RecoSocial.parseInstagramEmbed(body, r.url);
  }
  if (pagina.login || (!pagina.text && !pagina.images.length)) throw _socialError('social-private');
  return { pagina, target, det: d };
}
// Audio del video de un post (si la red da una URL descargable) → texto.
async function _videoTranscript(videoUrl) {
  if (!videoUrl) return '';
  try {
    const r = await _safeFetch(videoUrl, { maxBytes: IMPORT_VIDEO_MAX_BYTES, accept: 'video/mp4,video/*' });
    if (r.status !== 200 || r.truncated || !/video|octet-stream/i.test(r.type) || r.body.length < 10000) return '';
    return await _transcribe(r.body, 'video/mp4', 'video.mp4');
  } catch (e) {
    logger.warn('[importListingPage] video no transcrito', { err: e && e.message });
    return '';
  }
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
    const social = RecoSocial.detect(url.href);
    if (!(d.pagina && typeof d.pagina === 'object')) await _fetchRateLimit(uid);
    if (d.modo === 'perfil') {
      // Perfiles de redes: solo con la cuenta conectada (Integraciones).
      if (social) throw _socialError('social-profile');
      const r = await _fetchPageHtml(url);
      const avisos = RecoImport.extractListingLinks(r.html, r.url, IMPORT_PROFILE_MAX_LISTINGS,
        { generic: !_importHostAllowed(new URL(r.url).hostname) });
      await db.collection('importEvents').doc().set({
        uid, kind: 'perfil', channel: 'url', host: url.hostname, listings: avisos.length, createdAt: FieldValue.serverTimestamp(),
      });
      return { avisos };
    }

    let pagina;
    let red = null;
    const viaMarcador = !!(d.pagina && typeof d.pagina === 'object');
    if (viaMarcador) {
      pagina = _cleanPagina(d.pagina);
    } else if (social) {
      const s = await _readSocial(url.href, social);
      pagina = s.pagina;
      red = s.det.red;
    } else {
      const r = await _fetchPageHtml(url);
      pagina = RecoImport.parseListingHtml(r.html, r.url);
    }
    if (!pagina.text && !pagina.jsonld.length && !Object.keys(pagina.meta).length && !(pagina.images || []).length) {
      throw new HttpsError('invalid-argument', 'La página no tiene contenido legible.');
    }

    await _importRateLimit(uid);

    // Video del post (reel, video de Facebook o Instagram): lo que se dice
    // también es fuente (precio, áreas…). Si no hay video descargable, el
    // corredor puede subir el archivo.
    let transcrito = false;
    if (pagina.video) {
      const t = await _videoTranscript(pagina.video);
      if (t) { pagina.text = `${pagina.text}\n\nLo que se dice en el video:\n${t}`.trim(); transcrito = true; }
    }

    const photos = await _downloadPhotos(pagina.images);
    const photoIds = photos.map((p) => p.id);
    const text = RecoImport.pageToText(pagina, url.href, photoIds, IMPORT_TEXT_MAX_CHARS - 500);
    const result = await _extractAndSaveDrafts({
      fn: 'importListingPage', uid, kind: 'url', channel: 'url',
      sourceName: (url.hostname + url.pathname).slice(0, 120), batchId: d.batchId,
      text, photoIds, sourceLabel: 'la página',
      errorMessage: 'No pudimos leer el aviso. Intenta de nuevo o pega su texto.',
      draftExtra: { sourceUrl: url.href.slice(0, 500) },
      eventExtra: { host: url.hostname, viaMarcador, photos: photos.length, ...(red && { red, video: transcrito }) },
    });
    // Un aviso suele ser un solo inmueble: si la IA no le asignó fotos, son
    // todas las de la página. Solo vuelven las fotos asignadas.
    if (result.drafts.length === 1 && !result.drafts[0].fotos.length) result.drafts[0].fotos = photoIds.slice();
    const usadas = new Set(result.drafts.flatMap((x) => x.fotos));
    return { ...result, photos: photos.filter((p) => usadas.has(p.id)), ...(red && { red, video: transcrito }) };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Conectar Facebook / Instagram (captar inventario desde redes) — el corredor
// autoriza a ReCo a leer SU página de Facebook y la cuenta de Instagram
// profesional vinculada; ve sus últimos posts y elige cuáles importar. Cada
// post (texto + fotos + video) pasa por el mismo pipeline de extracción.
//
//   metaConnect  callable: status · authUrl · posts · import · disconnect
//   metaOAuth    HTTP: vuelta del diálogo de Facebook Login (code → tokens)
//
// Colecciones (solo servidor): metaOAuthStates/{state} (15 min),
// metaAccounts/{uid} (páginas y posts ya importados), metaTokens/{uid}
// (tokens de página; nadie los lee desde la web).
// Configuración: parámetro META_APP_ID y secreto META_APP_SECRET (app de Meta
// con Facebook Login y los permisos pages_show_list, pages_read_engagement,
// instagram_basic, business_management). Ver docs/REDES-SOCIALES.md.
// Los perfiles personales de Facebook no se pueden leer con la API de Meta:
// para esos, el enlace de cada post (importListingPage).
// ─────────────────────────────────────────────────────────────────────────────
const metaAppId = defineString('META_APP_ID', { default: '' });
const metaAppSecret = defineSecret('META_APP_SECRET');
const META_GRAPH = 'https://graph.facebook.com/v21.0';
const META_SCOPES = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'business_management'];
const META_REDIRECT_PATH = 'metaOAuth';
const META_MAX_IMPORT = 10;          // posts por llamada
const META_PAGE_SIZE = 25;
const META_POST_ID_RE = /^[0-9_]{5,60}$/;

function _metaRedirectUri() {
  // URL de la función HTTP metaOAuth (la misma región y proyecto).
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'reco-5a5dd';
  return `https://${REGION}-${project}.cloudfunctions.net/${META_REDIRECT_PATH}`;
}
async function _graph(path, token, params) {
  const qs = new URLSearchParams({ ...(params || {}), access_token: token });
  if (metaAppSecret.value()) {
    qs.set('appsecret_proof', require('crypto').createHmac('sha256', metaAppSecret.value()).update(token).digest('hex'));
  }
  const r = await _fetchTimeout(`${META_GRAPH}/${path}?${qs}`, { headers: { Accept: 'application/json' } }, 20000);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) {
    const e = new Error((body.error && body.error.message) || `Graph HTTP ${r.status}`);
    e.graph = body.error || { status: r.status };
    throw e;
  }
  return body;
}
// Post de Facebook o Instagram → { id, text, images, video, permalink, fecha }.
function _metaPostOf(red, p) {
  if (red === 'instagram') {
    const kids = ((p.children && p.children.data) || []);
    const images = (kids.length ? kids : [p]).map((k) => (k.media_type === 'VIDEO' ? k.thumbnail_url : k.media_url)).filter(Boolean);
    const vid = p.media_type === 'VIDEO' || p.media_type === 'REELS' ? p.media_url : (kids.find((k) => k.media_type === 'VIDEO') || {}).media_url;
    return { id: String(p.id), text: String(p.caption || ''), images, video: vid || null, permalink: p.permalink || null, fecha: p.timestamp || null };
  }
  const att = ((p.attachments && p.attachments.data) || []);
  const images = [];
  let video = null;
  if (p.full_picture) images.push(p.full_picture);
  att.forEach((a) => {
    const subs = (a.subattachments && a.subattachments.data) || [a];
    subs.forEach((s) => {
      const src = s.media && s.media.image && s.media.image.src;
      if (src && !images.includes(src)) images.push(src);
      if (!video && /video/.test(String(s.media_type || s.type || '')) && s.media && s.media.source) video = s.media.source;
    });
  });
  return { id: String(p.id), text: String(p.message || ''), images, video, permalink: p.permalink_url || null, fecha: p.created_time || null };
}
async function _metaFetchPosts(red, pageId, token, after) {
  if (red === 'instagram') {
    return _graph(`${pageId}/media`, token, { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}',
      limit: String(META_PAGE_SIZE), ...(after && { after }) });
  }
  return _graph(`${pageId}/posts`, token, { fields: 'id,message,created_time,permalink_url,full_picture,attachments{media_type,type,media,subattachments{media,media_type,type}}',
    limit: String(META_PAGE_SIZE), ...(after && { after }) });
}

exports.metaConnect = onCall(
  { region: REGION, maxInstances: 10, timeoutSeconds: 540, memory: '1GiB', consumeAppCheckToken: true, enforceAppCheck: true,
    secrets: [openaiKey, metaAppSecret] },
  async (request) => {
    _logAppCheck(request, 'metaConnect');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const d = request.data || {};
    if (!metaAppId.value()) return { disponible: false };
    const accRef = db.collection('metaAccounts').doc(uid);
    const tokRef = db.collection('metaTokens').doc(uid);

    if (d.action === 'authUrl') {
      const state = require('crypto').randomBytes(16).toString('hex');
      await db.collection('metaOAuthStates').doc(state).set({ uid, expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60000) });
      const qs = new URLSearchParams({ client_id: metaAppId.value(), redirect_uri: _metaRedirectUri(), state,
        scope: META_SCOPES.join(','), response_type: 'code' });
      return { disponible: true, url: `https://www.facebook.com/v21.0/dialog/oauth?${qs}` };
    }
    if (d.action === 'disconnect') {
      await Promise.all([accRef.delete(), tokRef.delete()]);
      return { disponible: true, cuentas: [] };
    }
    const acc = (await accRef.get()).data() || {};
    const cuentas = (acc.pages || []).flatMap((p) => [{ red: 'facebook', id: p.id, nombre: p.name },
      ...(p.ig ? [{ red: 'instagram', id: p.ig.id, nombre: `@${p.ig.username}`, pageId: p.id }] : [])]);
    if (d.action !== 'posts' && d.action !== 'import') return { disponible: true, cuentas };

    const red = d.red === 'instagram' ? 'instagram' : 'facebook';
    const cuenta = cuentas.find((c) => c.red === red && c.id === String(d.id || ''));
    if (!cuenta) throw new HttpsError('not-found', 'Cuenta no conectada. Vuelve a conectar Facebook.');
    const toks = (await tokRef.get()).data() || {};
    const token = (toks.pages || {})[cuenta.pageId || cuenta.id];
    if (!token) throw new HttpsError('failed-precondition', 'La conexión venció. Vuelve a conectar Facebook.');
    const importados = new Set(acc.importados || []);

    if (d.action === 'posts') {
      let body;
      try {
        body = await _metaFetchPosts(red, cuenta.id, token, typeof d.after === 'string' ? d.after.slice(0, 200) : null);
      } catch (e) {
        logger.warn('[metaConnect] posts', { err: e.message });
        throw new HttpsError('failed-precondition', 'Facebook no devolvió los posts. Vuelve a conectar tu cuenta.');
      }
      const posts = (body.data || []).map((p) => _metaPostOf(red, p))
        .map((p) => ({ id: p.id, texto: p.text.slice(0, 300), foto: p.images[0] || null, fotos: p.images.length, video: !!p.video,
          enlace: p.permalink, fecha: p.fecha, importado: importados.has(p.id) }));
      return { posts, after: (body.paging && body.paging.next && body.paging.cursors && body.paging.cursors.after) || null };
    }

    // import: los posts elegidos (máx. META_MAX_IMPORT) → borradores con fotos.
    const ids = [...new Set((Array.isArray(d.postIds) ? d.postIds : []).map(String).filter((x) => META_POST_ID_RE.test(x)))].slice(0, META_MAX_IMPORT);
    if (!ids.length) throw new HttpsError('invalid-argument', 'Elige al menos un post.');
    const batchId = (typeof d.batchId === 'string' && DRAFT_ID_RE.test(d.batchId)) ? d.batchId : db.collection('importDrafts').doc().id;
    const fieldsFb = 'id,message,created_time,permalink_url,full_picture,attachments{media_type,type,media,subattachments{media,media_type,type}}';
    const fieldsIg = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}';
    let creados = 0, sinInmueble = 0, limite = false;
    const hechos = [];
    for (const id of ids) {
      let post;
      try {
        post = _metaPostOf(red, await _graph(id, token, { fields: red === 'instagram' ? fieldsIg : fieldsFb }));
      } catch (e) {
        logger.warn('[metaConnect] post no disponible', { id, err: e.message });
        continue;
      }
      try { await _importRateLimit(uid); } catch (e) { limite = true; break; }
      let text = post.text;
      if (post.video) {
        const t = await _videoTranscript(post.video);
        if (t) text = `${text}\n\nLo que se dice en el video:\n${t}`;
      }
      const photos = await _downloadPhotos(post.images);
      const photoIds = photos.map((p) => p.id);
      const full = `${text}\n${photoIds.map((x) => `[FOTO ${x}]`).join(' ')}`.trim().slice(0, IMPORT_TEXT_MAX_CHARS);
      const result = await _extractAndSaveDrafts({
        fn: 'metaConnect', uid, kind: 'redes', channel: 'redes', sourceName: `${red === 'instagram' ? 'Instagram' : 'Facebook'} · ${cuenta.nombre}`.slice(0, 120),
        batchId, text: full, photoIds, sourceLabel: 'el post',
        draftExtra: { ...(post.permalink && { sourceUrl: String(post.permalink).slice(0, 500) }), metaPostId: post.id },
        eventExtra: { red, photos: photos.length, video: !!post.video },
      });
      // Un post suele ser un solo inmueble: sin fotos asignadas, son todas.
      if (result.drafts.length === 1 && !result.drafts[0].fotos.length) result.drafts[0].fotos = photoIds.slice();
      for (const dr of result.drafts) {
        const urls = [];
        for (const fid of dr.fotos.slice(0, 12)) {
          const ph = photos.find((p) => p.id === fid);
          if (!ph) continue;
          const [meta, b64] = ph.dataUrl.split(',');
          const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
          urls.push(await _savePhoto(uid, dr.id, urls.length + 1, Buffer.from(b64, 'base64'), mime));
        }
        if (urls.length) await db.collection('importDrafts').doc(dr.id).update({ photoUrls: urls });
      }
      creados += result.drafts.length;
      if (!result.drafts.length) sinInmueble++;
      hechos.push(post.id);
    }
    if (hechos.length) {
      await accRef.set({ importados: [...importados, ...hechos].slice(-1000), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return { batchId, creados, sinInmueble, importados: hechos, limite };
  }
);

// Vuelta de Facebook Login: code → token de usuario de larga duración →
// páginas (y su Instagram) con sus tokens. Redirige a Integraciones.
exports.metaOAuth = onRequest(
  { region: REGION, maxInstances: 5, secrets: [metaAppSecret] },
  async (req, res) => {
    const back = (estado) => res.redirect(302, `${CONTINUE_URL}#integraciones-meta-${estado}`);
    const state = String(req.query.state || '');
    const code = String(req.query.code || '');
    if (!/^[0-9a-f]{32}$/.test(state)) { back('error'); return; }
    const stRef = db.collection('metaOAuthStates').doc(state);
    const snap = await stRef.get();
    const st = snap.exists ? snap.data() : null;
    await stRef.delete().catch(() => {});
    if (!st || st.expiresAt.toMillis() < Date.now()) { back('vencido'); return; }
    if (!code || req.query.error) { back('cancelado'); return; }
    const uid = st.uid;
    try {
      const base = { client_id: metaAppId.value(), client_secret: metaAppSecret.value() };
      const short = await (await _fetchTimeout(`${META_GRAPH}/oauth/access_token?${new URLSearchParams({ ...base, redirect_uri: _metaRedirectUri(), code })}`, {}, 20000)).json();
      if (!short.access_token) throw new Error('sin token');
      const long = await (await _fetchTimeout(`${META_GRAPH}/oauth/access_token?${new URLSearchParams({ ...base, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`, {}, 20000)).json();
      const userToken = long.access_token || short.access_token;
      const accts = await _graph('me/accounts', userToken, { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50' });
      const pages = (accts.data || []).map((p) => ({ id: String(p.id), name: String(p.name || '').slice(0, 120),
        ig: p.instagram_business_account ? { id: String(p.instagram_business_account.id), username: String(p.instagram_business_account.username || '') } : null }));
      const tokens = {};
      (accts.data || []).forEach((p) => { if (p.access_token) tokens[String(p.id)] = p.access_token; });
      await db.collection('metaTokens').doc(uid).set({ pages: tokens, updatedAt: FieldValue.serverTimestamp() });
      await db.collection('metaAccounts').doc(uid).set({ pages, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      back(pages.length ? 'ok' : 'sin-paginas');
    } catch (e) {
      logger.error('[metaOAuth] error', { err: e && e.message });
      back('error');
    }
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
async function _transcribe(buf, mime, filename) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime || 'audio/ogg' }), filename || 'nota.ogg');
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
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return _saveStorageFile(`imports/${uid}/${batchId}/${n}.${ext}`, buf, mime);
}
// Archivo a Storage con token de descarga → URL pública con token.
async function _saveStorageFile(path, buf, mime) {
  const { getStorage } = require('firebase-admin/storage');
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
// Conexiones automáticas (roadmap 3.1, 3.2 y 3.4) — ReCo lee cada X horas el
// inventario que la inmobiliaria ya mantiene en otro lado y lo refleja:
//   feed        URL de un feed XML (Kyero u otro), JSON o CSV de su CRM o web
//   sheet       Google Sheets ("cualquier persona con el enlace" o publicada)
//   easybroker  API de EasyBroker (clave de API de la cuenta)
//   wasi        API de Wasi (id de empresa + token)
//
// En cada sincronización:
//   - Inmueble nuevo → borrador en la bandeja (modo 'borradores', por defecto)
//     o publicación pendiente de moderación (modo 'publicar', solo si pasa la
//     verificación previa a publicar; si no, queda como borrador).
//   - Inmueble que cambió → se actualiza. Cambios de título, descripción,
//     dirección, distrito, tipo, operación, moneda, fotos o precio (más de
//     50 %) vuelven a moderación; el resto mantiene la aprobación.
//   - Inmueble que ya no está en el feed → la publicación queda "retirada"
//     (status 'withdrawn', no se ve en la búsqueda) y vuelve si reaparece.
//   - Protección: si el feed llega vacío o con menos de la mitad de los
//     inmuebles de la vez anterior, no se retira nada.
//
// Colecciones (solo servidor): importSources/{id} (el dueño la lee),
// importSourceSecrets/{id} (claves de los CRMs; nadie la lee desde la web).
// Vínculo en publications e importDrafts: syncSourceId, syncKey
// ("{fuente}:{id externo}"), syncHash (contenido), syncPhotos, syncVersion.
//
// Client contract (callable importSources):
//   { action: 'list' } → { sources: [...] }
//   { action: 'preview', kind, url?, credenciales? } → { formato, total, mapping, rutas, muestra }
//   { action: 'create', kind, nombre, url?, credenciales?, modo, cadaHoras, mapping? } → { id }
//   { action: 'update', id, nombre?, modo?, cadaHoras?, estado?, mapping? } → { ok }
//   { action: 'sync', id } → { result }
//   { action: 'delete', id, retirar? } → { ok, retiradas }
// ─────────────────────────────────────────────────────────────────────────────
const SYNC_KINDS = ['feed', 'sheet', 'easybroker', 'wasi'];
const SYNC_MODOS = ['borradores', 'publicar'];
const SYNC_HOURS = [6, 12, 24];
const SYNC_MAX_SOURCES = 5;
const SYNC_MAX_ITEMS = 1000;
const SYNC_MAX_LOADS = 80;         // detalles pedidos al CRM por corrida
const SYNC_MAX_PHOTO_ITEMS = 25;   // inmuebles con fotos nuevas por corrida
const SYNC_MAX_GEOCODES = 40;
const SYNC_FEED_BYTES = 15 * 1024 * 1024;
const SYNC_TIME_BUDGET_MS = 420000;
const SYNC_MAX_ERRORS = 5;         // errores seguidos → la conexión se pausa
const SYNC_MANUAL_MIN_MS = 5 * 60000;
const SYNC_LOCK_MS = 9 * 60000;
const SOURCE_ID_RE = /^[A-Za-z0-9]{1,40}$/;
const EASYBROKER_API = 'https://api.easybroker.com/v1';
const WASI_API = 'https://api.wasi.co/v1';
const SYNC_KIND_LABEL = { feed: 'el feed', sheet: 'la hoja de cálculo', easybroker: 'EasyBroker', wasi: 'Wasi' };

// fetch a un host fijo (APIs de CRMs) con timeout.
async function _fetchTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 20000);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(timer); }
}
const _syncError = (msg) => new HttpsError('failed-precondition', msg);

// Descarga un feed o una hoja (cualquier dominio público; validación SSRF).
async function _syncDownload(url, label) {
  const r = await _safeFetch(url, { maxBytes: SYNC_FEED_BYTES, accept: 'application/xml,text/xml,application/json,text/csv,text/plain,*/*' })
    .catch((e) => { if (e instanceof HttpsError) throw e; throw _syncError(`No pudimos descargar ${label}. Revisa el enlace.`); });
  if (r.truncated) throw _syncError(`${label[0].toUpperCase() + label.slice(1)} pesa más de 15 MB.`);
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    throw _syncError(label === 'la hoja de cálculo'
      ? 'La hoja no es pública. En Google Sheets: Compartir → "Cualquier persona con el enlace" → Lector.'
      : `${label[0].toUpperCase() + label.slice(1)} respondió ${r.status}. Revisa el enlace.`);
  }
  if (r.status !== 200) throw _syncError(`${label[0].toUpperCase() + label.slice(1)} respondió ${r.status}. Intenta más tarde.`);
  return { text: r.body.toString('utf8'), type: r.type };
}

// Inmuebles de una fuente: [{ extId, version?, data? | load() }]. data =
// { extId, row, photos } listo; load() lo trae (detalle de EasyBroker).
async function _syncEntries(src, secrets) {
  if (src.kind === 'feed' || src.kind === 'sheet') {
    const url = src.kind === 'sheet' ? RecoFeed.sheetCsvUrl(src.url) : src.url;
    if (!url) throw _syncError('Enlace de Google Sheets inválido.');
    const { text, type } = await _syncDownload(url, SYNC_KIND_LABEL[src.kind]);
    if (src.kind === 'sheet' && /^\s*<(!doctype|html)/i.test(text)) {
      throw _syncError('La hoja no es pública. En Google Sheets: Compartir → "Cualquier persona con el enlace" → Lector.');
    }
    const feed = RecoFeed.parseFeed(text, src.kind === 'sheet' ? 'text/csv' : type);
    if (feed.formato === 'html') throw _syncError('El enlace abre una página web, no un feed. Pide a tu CRM la URL del feed XML, JSON o CSV.');
    const flats = feed.items.slice(0, SYNC_MAX_ITEMS);
    const mapping = src.mapping && Object.keys(src.mapping).length ? src.mapping : RecoFeed.guessMapping(RecoFeed.pathsOf(flats), flats);
    return { formato: feed.formato, flats, mapping, entries: flats.map((f) => { const data = RecoFeed.itemToEntry(f, mapping); return { extId: data.extId, data }; }) };
  }
  if (src.kind === 'easybroker') {
    const headers = { 'X-Authorization': String((secrets && secrets.apiKey) || ''), Accept: 'application/json' };
    const entries = [];
    for (let page = 1; page <= 20 && entries.length < SYNC_MAX_ITEMS; page++) {
      const r = await _fetchTimeout(`${EASYBROKER_API}/properties?page=${page}&limit=50&search%5Bstatuses%5D%5B%5D=published`, { headers });
      if (r.status === 401 || r.status === 403) throw _syncError('EasyBroker rechazó la clave de API. Revísala en EasyBroker → Configuración → Integraciones → API.');
      if (!r.ok) throw _syncError(`EasyBroker respondió ${r.status}. Intenta más tarde.`);
      const body = await r.json();
      const content = Array.isArray(body.content) ? body.content : [];
      content.forEach((p) => {
        if (!p || !p.public_id) return;
        const id = String(p.public_id);
        entries.push({
          extId: id, version: p.updated_at ? String(p.updated_at) : null,
          load: async () => {
            const d = await _fetchTimeout(`${EASYBROKER_API}/properties/${encodeURIComponent(id)}`, { headers });
            if (!d.ok) throw new Error(`detalle HTTP ${d.status}`);
            return RecoFeed.easyBrokerToEntry(await d.json());
          },
        });
      });
      const pg = body.pagination || {};
      if (!content.length || !pg.next_page && (Number(pg.page) || page) * (Number(pg.limit) || 50) >= (Number(pg.total) || 0)) break;
    }
    return { formato: 'easybroker', entries };
  }
  if (src.kind === 'wasi') {
    const entries = [];
    for (let skip = 0; skip < SYNC_MAX_ITEMS; skip += 100) {
      const body = new URLSearchParams({ id_company: String((secrets && secrets.idCompany) || ''), wasi_token: String((secrets && secrets.wasiToken) || ''), take: '100', skip: String(skip) });
      const r = await _fetchTimeout(`${WASI_API}/property/search`, { method: 'POST', body, headers: { Accept: 'application/json' } });
      if (!r.ok) throw _syncError(`Wasi respondió ${r.status}. Intenta más tarde.`);
      const data = await r.json();
      if (data && data.status === 'error') throw _syncError('Wasi rechazó el id de empresa o el token. Revísalos en Wasi → Configuración → API.');
      const items = RecoFeed.findItems(data);
      items.forEach((p) => {
        const e = RecoFeed.wasiToEntry(p);
        if (e.extId) entries.push({ extId: e.extId, version: p.updated_at ? String(p.updated_at) : null, data: e });
      });
      if (items.length < 100 || entries.length >= (Number(data && data.total) || 0)) break;
    }
    return { formato: 'wasi', entries };
  }
  throw new HttpsError('invalid-argument', 'Tipo de conexión no soportado.');
}

async function _geocode(address, district) {
  const key = hereApiKey.value();
  if (!key || !address) return null;
  try {
    const q = encodeURIComponent(`${address}, ${district}, Perú`);
    const r = await _fetchTimeout(`https://geocode.search.hereapi.com/v1/geocode?q=${q}&in=countryCode:PER&limit=1&lang=es&apiKey=${encodeURIComponent(key)}`, {}, 8000);
    const pos = r.ok && ((await r.json()).items || [])[0];
    return pos && pos.position && isFinite(pos.position.lat) ? { lat: pos.position.lat, lng: pos.position.lng } : null;
  } catch (_) { return null; }
}

// Fotos de una publicación: publications/{id}/{uid}/{i}.jpg (como las sube la web).
async function _storePubPhotos(pubId, uid, urls) {
  const out = [];
  for (const u of (urls || []).slice(0, RecoFeed.MAX_PHOTOS)) {
    const im = await _fetchImage(u);
    if (!im) continue;
    try { out.push(await _saveStorageFile(`publications/${pubId}/${uid}/${out.length}.jpg`, im.buf, im.mime)); } catch (e) {
      logger.warn('[sync] foto no guardada', { err: e && e.message });
    }
  }
  return out;
}
// Fotos de un borrador: imports/{uid}/{id del borrador}/{n}.ext (publishProperty
// las copia al publicar).
async function _storeDraftPhotos(uid, draftId, urls) {
  const out = [];
  for (const u of (urls || []).slice(0, RecoFeed.MAX_PHOTOS)) {
    const im = await _fetchImage(u);
    if (!im) continue;
    try { out.push(await _savePhoto(uid, draftId, out.length + 1, im.buf, im.mime)); } catch (e) {
      logger.warn('[sync] foto no guardada', { err: e && e.message });
    }
  }
  return out;
}

// Publicación guardada → datos de entrada de _pubFieldsFromRaw (area = techada).
function _pubToRaw(p) {
  const raw = {};
  ['address', 'district', 'lat', 'lng', 'type', 'op', 'currency', 'price', 'areaTerr', 'beds', 'baths', 'parking', 'floor',
    'unitFloors', 'floors', 'age', 'estado', 'ascensor', 'amoblado', 'petFriendly', 'features', 'title', 'desc'].forEach((k) => { raw[k] = p[k]; });
  raw.area = p.areaTech != null ? p.areaTech : (p.type === 'Terreno' ? 0 : p.area);
  raw.hideExact = !!p.hideExact;
  return raw;
}
const _differs = (a, b) => JSON.stringify(a == null ? null : a) !== JSON.stringify(b == null ? null : b);
// Campos de la publicación que la sincronización mantiene (sin pisar una
// ubicación ya puesta con null).
function _syncPubUpdate(before, fields) {
  const up = {};
  RecoFeed.SYNC_FIELDS.forEach((k) => { if (fields[k] !== undefined) up[k] = fields[k]; });
  if (up.lat == null && before.lat != null) { delete up.lat; delete up.lng; }
  up.fingerprint = RecoImport.fingerprint({ ...before, ...up });
  return up;
}

// Una sincronización completa de una fuente (sin el bloqueo; ver _runSource).
async function _syncSource(srcId, src, secrets, budgetMs) {
  const t0 = Date.now();
  const limite = Math.min(SYNC_TIME_BUDGET_MS, budgetMs || SYNC_TIME_BUDGET_MS);
  const uid = src.uid;
  const res = { total: 0, nuevos: 0, borradores: 0, actualizados: 0, revision: 0, retirados: 0, restaurados: 0,
    sinCambios: 0, conErrores: 0, pendientes: 0, duplicados: 0, aviso: null };
  const { entries } = await _syncEntries(src, secrets);
  res.total = entries.length;

  const [pubSnap, draftSnap] = await Promise.all([
    db.collection('publications').where('syncSourceId', '==', srcId).get(),
    db.collection('importDrafts').where('syncSourceId', '==', srcId).get(),
  ]);
  const pubs = new Map(), drafts = new Map();
  pubSnap.docs.forEach((d) => { if (d.data().userId === uid) pubs.set(d.data().syncKey, d); });
  draftSnap.docs.forEach((d) => { if (d.data().uid === uid) drafts.set(d.data().syncKey, d); });

  const seen = new Set();
  // Un inmueble sin código que no se alcanzó a leer no está en "seen": esa
  // vez no se retira nada (podría ser él).
  let sinIdPendientes = false;
  const budget = { loads: SYNC_MAX_LOADS, photos: SYNC_MAX_PHOTO_ITEMS, geocodes: SYNC_MAX_GEOCODES };
  const fuera = () => Date.now() - t0 > limite;
  const now = () => FieldValue.serverTimestamp();
  const expiresAt = () => Timestamp.fromMillis(Date.now() + IMPORT_DRAFT_TTL_DAYS * 864e5);

  for (const e of entries) {
    let key = e.extId ? `${srcId}:${e.extId}` : null;
    if (key && seen.has(key)) { res.duplicados++; continue; }
    if (key) seen.add(key);
    const prevPub = key && pubs.get(key), prevDraft = key && drafts.get(key);
    const prev = prevPub || prevDraft;
    const withdrawnBySync = prevPub && prevPub.data().status === 'withdrawn' && prevPub.data().withdrawnBy === 'sync';
    // Con versión (updated_at del CRM) igual: sin cambios, sin pedir el detalle.
    if (prev && e.version && prev.data().syncVersion === e.version && !withdrawnBySync) { res.sinCambios++; continue; }
    if (fuera() || (e.load && budget.loads <= 0)) { res.pendientes++; if (!key) sinIdPendientes = true; continue; }

    let data;
    try {
      if (e.load) budget.loads--;
      data = e.data || await e.load();
    } catch (err) {
      logger.warn('[sync] inmueble no disponible', { srcId, extId: e.extId, err: err && err.message });
      res.conErrores++;
      continue;
    }
    const { row, notes } = RecoFeed.prepareRow(data.row);
    if (!key) {
      key = `${srcId}:${RecoFeed.syntheticId(row)}`;
      if (seen.has(key)) { res.duplicados++; continue; }
      seen.add(key);
    }
    const raw = RecoFeed.rowToPub(row);
    let fields = null, errores = [];
    try { fields = _pubFieldsFromRaw(raw).fields; } catch (err) { errores = (err.details && err.details.errores) || [err.message]; }
    const hash = RecoFeed.contentHash(raw, data.photos);
    const photosKey = RecoFeed.photosHash(data.photos);
    const link = { syncSourceId: srcId, syncKey: key, syncHash: hash, syncPhotos: photosKey, syncVersion: e.version || null, syncRaw: raw };

    // ── Ya publicado ──
    const pubDoc = prevPub || pubs.get(key);
    if (pubDoc) {
      const before = pubDoc.data();
      if (before.syncHash === hash) {
        if (before.status === 'withdrawn' && before.withdrawnBy === 'sync') {
          await pubDoc.ref.update({ status: before.withdrawnFrom === 'approved' ? 'approved' : 'pending', withdrawnBy: null, withdrawnAt: null, syncedAt: now() });
          res.restaurados++;
        } else {
          if (e.version && before.syncVersion !== e.version) await pubDoc.ref.update({ syncVersion: e.version });
          res.sinCambios++;
        }
        continue;
      }
      // Solo se aplica lo que cambió en el feed desde la última vez: lo que el
      // dueño corrigió al revisar el borrador (o después) se respeta.
      const merged = _pubToRaw(before);
      Object.keys(raw).forEach((k) => { if (!before.syncRaw || _differs(before.syncRaw[k], raw[k])) merged[k] = raw[k]; });
      try { fields = _pubFieldsFromRaw(merged).fields; } catch (err) {
        await pubDoc.ref.update({ syncError: ((err.details && err.details.errores) || [err.message]).join('; ').slice(0, 500), syncedAt: now() });
        res.conErrores++;
        continue;
      }
      const fotosCambian = before.syncPhotos !== photosKey && data.photos.length > 0;
      if (fotosCambian && budget.photos <= 0) { res.pendientes++; continue; }
      const up = { ..._syncPubUpdate(before, fields), ...link, syncError: null, syncedAt: now() };
      if (fotosCambian) {
        budget.photos--;
        const urls = await _storePubPhotos(pubDoc.id, uid, data.photos);
        if (urls.length) up.photoUrls = urls;
      }
      const { revisar } = RecoFeed.cambios(before, fields);
      if (before.status === 'withdrawn' && before.withdrawnBy === 'sync') {
        Object.assign(up, { status: 'pending', withdrawnBy: null, withdrawnAt: null });
        res.restaurados++;
      } else if ((revisar || fotosCambian) && (before.status === 'approved' || before.status === 'rejected')) {
        up.status = 'pending';
        res.revision++;
      }
      if (up.lat == null && before.lat == null && budget.geocodes > 0 && (up.address !== before.address || !before.geocodedAt)) {
        budget.geocodes--;
        const g = await _geocode(fields.address, fields.district);
        if (g) Object.assign(up, g, { geocodedAt: now() });
      }
      await pubDoc.ref.update(up);
      res.actualizados++;
      continue;
    }

    // ── Borrador sin publicar ──
    const draftDoc = prevDraft || drafts.get(key);
    if (draftDoc) {
      const before = draftDoc.data();
      if (before.syncHash === hash) { res.sinCambios++; continue; }
      // Igual que en una publicación: solo los campos que cambiaron en el feed.
      const merged = { ...before.row };
      Object.keys(row).forEach((k) => { if (!before.syncRow || before.syncRow[k] !== row[k]) merged[k] = row[k]; });
      const up = { row: merged, notes: notes.concat(errores.map((x) => `Para publicar: ${x}.`)), fingerprint: RecoImport.fingerprint(merged),
        ...link, syncRow: row, updatedAt: now(), expiresAt: expiresAt() };
      if (before.syncPhotos !== photosKey) {
        if (data.photos.length && budget.photos <= 0) { res.pendientes++; continue; }
        if (data.photos.length) budget.photos--;
        up.photoUrls = await _storeDraftPhotos(uid, draftDoc.id, data.photos);
      }
      await draftDoc.ref.update(up);
      res.actualizados++;
      continue;
    }

    // ── Nuevo ──
    if (data.photos.length && budget.photos <= 0) { res.pendientes++; continue; }
    if (data.photos.length) budget.photos--;
    if (src.modo === 'publicar' && fields) {
      const pubRef = db.collection('publications').doc();
      if (fields.lat == null && budget.geocodes > 0) {
        budget.geocodes--;
        const g = await _geocode(fields.address, fields.district);
        if (g) Object.assign(fields, g);
      }
      await _createPublication({ uid, email: src.email || null, fields, source: 'feed', pubRef,
        extra: { ...link, syncSourceName: src.nombre || null, syncedAt: now() } });
      const urls = await _storePubPhotos(pubRef.id, uid, data.photos);
      if (urls.length) await pubRef.update({ photoUrls: urls });
      res.nuevos++;
    } else {
      const ref = db.collection('importDrafts').doc();
      const photoUrls = await _storeDraftPhotos(uid, ref.id, data.photos);
      await ref.set({
        uid, batchId: srcId, source: 'feed', sourceName: src.nombre || SYNC_KIND_LABEL[src.kind],
        row, aiFields: [], inferredFields: [], notes: notes.concat(errores.map((x) => `Para publicar: ${x}.`)),
        fingerprint: RecoImport.fingerprint(row), status: 'draft', ...link, syncRow: row, ...(photoUrls.length && { photoUrls }),
        createdAt: now(), updatedAt: now(), expiresAt: expiresAt(),
      });
      res.borradores++;
    }
  }

  // ── Lo que ya no está ──
  const previo = Number(src.total) || 0;
  const vacio = entries.length === 0 && (previo > 0 || pubs.size > 0);
  const caida = previo >= 10 && entries.length < previo / 2;
  if (vacio || caida) {
    res.aviso = vacio ? `${SYNC_KIND_LABEL[src.kind]} llegó vacío: no retiramos nada.`
      : `${SYNC_KIND_LABEL[src.kind]} trajo ${entries.length} inmuebles (antes ${previo}): no retiramos nada por si es un error.`;
  } else if (sinIdPendientes) {
    res.aviso = 'Quedaron inmuebles sin código por revisar: retiraremos lo que falte en la próxima sincronización.';
  } else {
    for (const [key, doc] of pubs) {
      if (seen.has(key)) continue;
      const d = doc.data();
      if (d.status === 'withdrawn') continue;
      await doc.ref.update({ status: 'withdrawn', withdrawnFrom: d.status || 'pending', withdrawnBy: 'sync', withdrawnAt: now(),
        withdrawnReason: `Ya no está en ${src.nombre || SYNC_KIND_LABEL[src.kind]}.` });
      res.retirados++;
    }
    for (const [key, doc] of drafts) {
      if (!seen.has(key)) await doc.ref.delete();
    }
  }
  res.ms = Date.now() - t0;
  return res;
}

// Corre una fuente con bloqueo (el programador y "Sincronizar ahora" no se
// pisan) y guarda el resultado. Errores seguidos → se pausa y se avisa.
async function _runSource(srcId, opts) {
  const ref = db.collection('importSources').doc(srcId);
  const src = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data();
    if (opts && opts.uid && d.uid !== opts.uid) return null;
    if (d.runningUntil && d.runningUntil.toMillis && d.runningUntil.toMillis() > Date.now()) return { ocupado: true };
    tx.update(ref, { runningUntil: Timestamp.fromMillis(Date.now() + SYNC_LOCK_MS) });
    return d;
  });
  if (!src) throw new HttpsError('not-found', 'Conexión no encontrada.');
  if (src.ocupado) throw new HttpsError('failed-precondition', 'Esta conexión ya se está sincronizando. Espera unos minutos.');
  const secrets = (src.kind === 'easybroker' || src.kind === 'wasi')
    ? ((await db.collection('importSourceSecrets').doc(srcId).get()).data() || {}) : null;
  const horas = SYNC_HOURS.includes(src.cadaHoras) ? src.cadaHoras : 24;
  try {
    const result = await _syncSource(srcId, src, secrets, opts && opts.budgetMs);
    await ref.update({
      lastRunAt: FieldValue.serverTimestamp(), lastResult: result, total: result.aviso ? (Number(src.total) || 0) : result.total,
      nextRunAt: Timestamp.fromMillis(Date.now() + (result.pendientes ? 1 : horas) * 3600e3),
      errores: 0, ultimoError: null, runningUntil: null,
    });
    await db.collection('importEvents').doc().set({
      uid: src.uid, kind: 'sync', channel: 'feed', sourceKind: src.kind, manual: !!(opts && opts.manual),
      listings: result.total, nuevos: result.nuevos, borradores: result.borradores, actualizados: result.actualizados,
      retirados: result.retirados, ms: result.ms, createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  } catch (e) {
    const errores = (Number(src.errores) || 0) + 1;
    const msg = (e instanceof HttpsError ? e.message : 'Error inesperado al sincronizar.').slice(0, 300);
    if (!(e instanceof HttpsError)) logger.error('[sync] error', { srcId, err: e && e.message });
    const pausar = errores >= SYNC_MAX_ERRORS;
    await ref.update({
      lastRunAt: FieldValue.serverTimestamp(), errores, ultimoError: msg, runningUntil: null,
      nextRunAt: Timestamp.fromMillis(Date.now() + horas * 3600e3), ...(pausar && { estado: 'pausada' }),
    });
    if (pausar && src.email) {
      await db.collection('mail').doc().set({ to: src.email, message: {
        subject: 'Pausamos la sincronización de tu inventario en ReCo',
        text: `Hola,\n\nNo pudimos leer "${src.nombre}" ${SYNC_MAX_ERRORS} veces seguidas, así que pausamos la conexión.\nÚltimo error: ${msg}\n\nCuando lo corrijas, reactívala en recosac.com → Mi cuenta → Integraciones.\n\n— Equipo Reco`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a"><p>Hola,</p><p>No pudimos leer <strong>${_esc(src.nombre)}</strong> ${SYNC_MAX_ERRORS} veces seguidas, así que pausamos la conexión.</p><p><strong>Último error:</strong> ${_esc(msg)}</p><p>Cuando lo corrijas, reactívala en <a href="${CONTINUE_URL}#integraciones">Mi cuenta → Integraciones</a>.</p><p style="color:#64748b;font-size:.85rem">— Equipo Reco</p></div>`,
      } });
    }
    throw e instanceof HttpsError ? e : new HttpsError('internal', msg);
  }
}

// Valida el pedido de una conexión. → { kind, url, secrets }
function _sourceInput(d) {
  const kind = SYNC_KINDS.includes(d.kind) ? d.kind : null;
  if (!kind) throw new HttpsError('invalid-argument', 'Tipo de conexión no soportado.');
  const c = d.credenciales && typeof d.credenciales === 'object' ? d.credenciales : {};
  if (kind === 'feed' || kind === 'sheet') {
    const url = String(d.url || '').trim().slice(0, 2000);
    let u;
    try { u = new URL(url); } catch (_) { throw new HttpsError('invalid-argument', 'Pega el enlace completo (https://…).'); }
    if (!/^https?:$/.test(u.protocol)) throw new HttpsError('invalid-argument', 'Pega el enlace completo (https://…).');
    if (kind === 'sheet' && !RecoFeed.sheetCsvUrl(url)) throw new HttpsError('invalid-argument', 'Ese enlace no es de una hoja de Google Sheets.');
    return { kind, url, secrets: null };
  }
  if (kind === 'easybroker') {
    const apiKey = String(c.apiKey || '').trim();
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(apiKey)) throw new HttpsError('invalid-argument', 'Clave de API de EasyBroker inválida.');
    return { kind, url: null, secrets: { apiKey } };
  }
  const idCompany = String(c.idCompany || '').trim();
  const wasiToken = String(c.wasiToken || '').trim();
  if (!/^\d{1,20}$/.test(idCompany) || !/^[A-Za-z0-9_-]{6,200}$/.test(wasiToken)) {
    throw new HttpsError('invalid-argument', 'Id de empresa o token de Wasi inválidos.');
  }
  return { kind, url: null, secrets: { idCompany, wasiToken } };
}
function _sourcePublic(doc) {
  const d = doc.data();
  const ts = (t) => (t && t.toMillis ? t.toMillis() : null);
  return {
    id: doc.id, kind: d.kind, nombre: d.nombre, url: d.url || null, modo: d.modo, cadaHoras: d.cadaHoras, estado: d.estado,
    total: d.total || 0, lastResult: d.lastResult || null, ultimoError: d.ultimoError || null,
    lastRunAt: ts(d.lastRunAt), nextRunAt: ts(d.nextRunAt), mapping: d.mapping || null, cuenta: d.cuenta || null,
  };
}
// Vista previa: primeras filas como quedarían, con sus errores y avisos.
async function _sourcePreview(input, mapping, usarIA) {
  const { formato, flats, mapping: guessed, entries } = await _syncEntries({ kind: input.kind, url: input.url, mapping }, input.secrets);
  const map = guessed ? { ...guessed } : null;
  const rutas = flats ? RecoFeed.pathsOf(flats).slice(0, 150) : null;
  // Faltan obligatorios → la IA completa el mapeo (una vez, al conectar).
  if (flats && usarIA && !mapping) {
    const faltan = RecoImport.REQUIRED.filter((k) => !map[k]).length + (map.area_techada || map.area_terreno ? 0 : 1);
    if (faltan && rutas.length >= 2) {
      try {
        const ia = await _aiMapColumns(rutas, flats.slice(0, 5).map((f) => rutas.map((p) => String((f[p] || [])[0] || '').slice(0, 60))));
        Object.entries(ia).forEach(([k, v]) => { if (!map[k] && !Object.values(map).includes(v)) map[k] = v; });
      } catch (e) {
        logger.warn('[importSources] mapeo IA fallido', { err: e && e.message });
      }
    }
  }
  const muestra = [];
  for (const e of entries.slice(0, 5)) {
    let data = e.data;
    if (!data && e.load) { try { data = await e.load(); } catch (_) { continue; } }
    if (flats) data = RecoFeed.itemToEntry(flats[entries.indexOf(e)], map);
    const { row, notes } = RecoFeed.prepareRow(data.row);
    const v = RecoCatalogo.verificarPublicacion(RecoFeed.rowToPub(row));
    muestra.push({ extId: data.extId || null, row, fotos: data.photos.length, errores: v.errores, avisos: notes.concat(v.avisos) });
  }
  return { formato, total: entries.length, mapping: map, rutas, muestra };
}

exports.importSources = onCall(
  {
    region: REGION, maxInstances: 10, timeoutSeconds: 540, memory: '1GiB',
    consumeAppCheckToken: true, enforceAppCheck: true, secrets: [openaiKey],
  },
  async (request) => {
    _logAppCheck(request, 'importSources');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const d = request.data || {};
    const col = db.collection('importSources');

    if (d.action === 'list') {
      const snap = await col.where('uid', '==', uid).get();
      return { sources: snap.docs.map(_sourcePublic) };
    }
    if (d.action === 'preview') {
      const input = _sourceInput(d);
      // Cada prueba descarga el feed (y puede usar la IA): cuenta en el
      // límite por hora compartido de importación.
      await _importRateLimit(uid);
      return _sourcePreview(input, null, d.usarIA !== false);
    }
    if (d.action === 'create') {
      const input = _sourceInput(d);
      const existentes = await col.where('uid', '==', uid).get();
      if (existentes.size >= SYNC_MAX_SOURCES) throw new HttpsError('resource-exhausted', `Puedes tener hasta ${SYNC_MAX_SOURCES} conexiones.`);
      const nombre = String(d.nombre || '').replace(/[\r\n]/g, ' ').trim().slice(0, 80) || SYNC_KIND_LABEL[input.kind];
      let mapping = null;
      if (input.kind === 'feed' || input.kind === 'sheet') {
        // Se vuelve a leer el feed: el mapeo enviado solo puede usar rutas reales.
        const prev = await _sourcePreview(input, null, false);
        if (!prev.total) throw _syncError(`No encontramos inmuebles en ${SYNC_KIND_LABEL[input.kind]}.`);
        mapping = { ...prev.mapping };
        const enviado = d.mapping && typeof d.mapping === 'object' ? d.mapping : null;
        if (enviado) {
          mapping = {};
          Object.entries(enviado).forEach(([k, v]) => {
            if (k === 'fotos') { const f = (Array.isArray(v) ? v : []).filter((p) => prev.rutas.includes(p)); if (f.length) mapping.fotos = f; }
            else if ((RecoImport.COLS.includes(k) || k === 'id') && typeof v === 'string' && prev.rutas.includes(v)) mapping[k] = v;
          });
        }
      }
      const ref = col.doc();
      await ref.set({
        uid, email: (request.auth.token && request.auth.token.email) || null,
        kind: input.kind, nombre, url: input.url, mapping,
        cuenta: input.secrets ? (input.secrets.apiKey ? `…${input.secrets.apiKey.slice(-4)}` : `Empresa ${input.secrets.idCompany}`) : null,
        modo: SYNC_MODOS.includes(d.modo) ? d.modo : 'borradores',
        cadaHoras: SYNC_HOURS.includes(Number(d.cadaHoras)) ? Number(d.cadaHoras) : 24,
        estado: 'activa', errores: 0, total: 0,
        nextRunAt: Timestamp.fromMillis(Date.now()), createdAt: FieldValue.serverTimestamp(),
      });
      if (input.secrets) await db.collection('importSourceSecrets').doc(ref.id).set({ uid, ...input.secrets });
      return { id: ref.id };
    }

    // Acciones sobre una conexión existente (solo su dueño).
    const id = String(d.id || '');
    if (!SOURCE_ID_RE.test(id)) throw new HttpsError('invalid-argument', 'Conexión inválida.');
    const ref = col.doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== uid) throw new HttpsError('not-found', 'Conexión no encontrada.');
    const src = snap.data();

    if (d.action === 'update') {
      const up = { updatedAt: FieldValue.serverTimestamp() };
      if (d.nombre != null) up.nombre = String(d.nombre).replace(/[\r\n]/g, ' ').trim().slice(0, 80) || src.nombre;
      if (SYNC_MODOS.includes(d.modo)) up.modo = d.modo;
      if (SYNC_HOURS.includes(Number(d.cadaHoras))) up.cadaHoras = Number(d.cadaHoras);
      if (d.estado === 'activa' || d.estado === 'pausada') {
        up.estado = d.estado;
        if (d.estado === 'activa') { up.errores = 0; up.nextRunAt = Timestamp.fromMillis(Date.now()); }
      }
      if (d.mapping && typeof d.mapping === 'object' && src.mapping) {
        const m = {};
        Object.entries(d.mapping).forEach(([k, v]) => {
          if (k === 'fotos' && Array.isArray(v)) m.fotos = v.filter((p) => typeof p === 'string').slice(0, 10).map((p) => p.slice(0, 200));
          else if ((RecoImport.COLS.includes(k) || k === 'id') && typeof v === 'string' && v) m[k] = v.slice(0, 200);
        });
        up.mapping = m;
      }
      await ref.update(up);
      return { ok: true };
    }
    if (d.action === 'sync') {
      const last = src.lastRunAt && src.lastRunAt.toMillis ? src.lastRunAt.toMillis() : 0;
      if (Date.now() - last < SYNC_MANUAL_MIN_MS) {
        throw new HttpsError('resource-exhausted', 'Ya sincronizamos hace poco. Espera unos minutos para volver a intentarlo.');
      }
      return { result: await _runSource(id, { uid, manual: true }) };
    }
    if (d.action === 'delete') {
      let retiradas = 0;
      const [pubs, drafts] = await Promise.all([
        db.collection('publications').where('syncSourceId', '==', id).get(),
        db.collection('importDrafts').where('syncSourceId', '==', id).get(),
      ]);
      for (const p of pubs.docs) {
        if (p.data().userId !== uid) continue;
        // Las publicaciones quedan (sin vínculo) salvo que pida retirarlas.
        const up = { syncSourceId: null };
        if (d.retirar === true && p.data().status !== 'withdrawn') {
          Object.assign(up, { status: 'withdrawn', withdrawnFrom: p.data().status || 'pending', withdrawnBy: 'owner', withdrawnAt: FieldValue.serverTimestamp(),
            withdrawnReason: 'Conexión eliminada.' });
          retiradas++;
        }
        await p.ref.update(up);
      }
      for (const dr of drafts.docs) { if (dr.data().uid === uid) await dr.ref.delete(); }
      await db.collection('importSourceSecrets').doc(id).delete();
      await ref.delete();
      return { ok: true, retiradas };
    }
    throw new HttpsError('invalid-argument', 'Acción no soportada.');
  }
);

// Cada hora: las conexiones activas que toca sincronizar (máx. 8 por vuelta).
// Todas comparten los 540 s de la función: cada una usa lo que queda (lo que
// no alcanza queda pendiente) y no se empieza otra con menos de 1 minuto.
const SYNC_SCHEDULE_BUDGET_MS = 480000;
exports.syncImportSources = onSchedule(
  { region: REGION, schedule: 'every 60 minutes', timeoutSeconds: 540, memory: '1GiB' },
  async () => {
    const t0 = Date.now();
    const snap = await db.collection('importSources')
      .where('estado', '==', 'activa').where('nextRunAt', '<=', Timestamp.fromMillis(Date.now()))
      .orderBy('nextRunAt').limit(8).get();
    for (const doc of snap.docs) {
      const queda = SYNC_SCHEDULE_BUDGET_MS - (Date.now() - t0);
      if (queda < 60000) break;
      try {
        await _runSource(doc.id, { budgetMs: queda - 30000 });
      } catch (e) {
        logger.warn('[syncImportSources] fuente con error', { id: doc.id, err: e && e.message });
      }
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// API pública de ReCo (roadmap 3.3) — para CRMs, webs de inmobiliarias e
// integradores. Documentación: docs/API.md.
//
//   GET    /v1/ping                    prueba la clave
//   GET    /v1/properties              publicaciones de la cuenta (?status=&page=)
//   GET    /v1/properties/{id}
//   POST   /v1/properties              crea (con external_id: crea o actualiza)
//   PATCH  /v1/properties/{id}         actualiza lo enviado
//   DELETE /v1/properties/{id}         retira (status 'withdrawn')
//
// Autenticación: "Authorization: Bearer reco_live_…" (o X-Api-Key). La clave
// se crea en Mi cuenta → Integraciones; se guarda solo su hash (apiKeys/{sha256}).
// Límite: API_RATE_PER_MIN pedidos por minuto y clave.
// Los campos se aceptan en inglés (address, price…), RESO (UnparsedAddress,
// ListPrice…) o con los nombres de la plantilla (direccion, precio…), y pasan
// por los mismos sinónimos y la misma verificación previa a publicar.
// Todo lo creado o cambiado (contenido) queda pendiente de moderación.
//
// Webhooks (apiAccounts/{uid}.webhookUrl): property.created, property.approved,
// property.rejected, property.pending, property.withdrawn, property.deleted y
// lead.created, firmados con X-Reco-Signature: t=…,v1=HMAC-SHA256(secreto, "t.cuerpo").
// ─────────────────────────────────────────────────────────────────────────────
const API_RATE_PER_MIN = 120;
const API_MAX_KEYS = 3;
const API_MAX_BODY = 1024 * 1024;
const API_PAGE_SIZE = 50;
const API_KEY_RE = /^reco_live_[A-Za-z0-9]{32}$/;
const API_EVENTS = ['property.created', 'property.approved', 'property.rejected', 'property.pending', 'property.withdrawn', 'property.deleted', 'lead.created'];
const API_HTTP = { 'invalid-argument': 422, unauthenticated: 401, 'permission-denied': 403, 'not-found': 404,
  'resource-exhausted': 429, 'failed-precondition': 409, 'already-exists': 409 };
const _sha256 = (s) => require('crypto').createHash('sha256').update(String(s)).digest('hex');

// Claves, webhook y su secreto. La clave completa se muestra una sola vez.
exports.apiAccess = onCall(
  { region: REGION, maxInstances: 10, consumeAppCheckToken: true, enforceAppCheck: true },
  async (request) => {
    _logAppCheck(request, 'apiAccess');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const d = request.data || {};
    const accRef = db.collection('apiAccounts').doc(uid);
    const keysOf = async () => (await db.collection('apiKeys').where('uid', '==', uid).get()).docs
      .filter((k) => !k.data().revoked)
      .map((k) => ({ prefix: k.data().prefix, nombre: k.data().nombre || '', createdAt: k.data().createdAt && k.data().createdAt.toMillis ? k.data().createdAt.toMillis() : null,
        lastUsedAt: k.data().lastUsedAt && k.data().lastUsedAt.toMillis ? k.data().lastUsedAt.toMillis() : null }));
    const estado = async () => {
      const acc = (await accRef.get()).data() || {};
      return { keys: await keysOf(), webhook: acc.webhookUrl ? { url: acc.webhookUrl, secret: acc.webhookSecret, lastWebhook: acc.lastWebhook || null } : null, eventos: API_EVENTS };
    };

    if (d.action === 'createKey') {
      if ((await keysOf()).length >= API_MAX_KEYS) throw new HttpsError('resource-exhausted', `Puedes tener hasta ${API_MAX_KEYS} claves activas. Revoca una antes.`);
      const crypto = require('crypto');
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const key = 'reco_live_' + Array.from(crypto.randomBytes(32), (b) => abc[b % abc.length]).join('');
      const prefix = key.slice(0, 14);
      await db.collection('apiKeys').doc(_sha256(key)).set({
        uid, prefix, nombre: String(d.nombre || '').trim().slice(0, 60), revoked: false, createdAt: FieldValue.serverTimestamp(),
      });
      return { key, prefix, ...(await estado()) };
    }
    if (d.action === 'revokeKey') {
      const snap = await db.collection('apiKeys').where('uid', '==', uid).get();
      const k = snap.docs.find((x) => x.data().prefix === d.prefix && !x.data().revoked);
      if (!k) throw new HttpsError('not-found', 'Clave no encontrada.');
      await k.ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp() });
      return estado();
    }
    if (d.action === 'setWebhook') {
      const url = d.url == null ? '' : String(d.url).trim().slice(0, 500);
      if (!url) { await accRef.set({ webhookUrl: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); return estado(); }
      let u;
      try { u = new URL(url); } catch (_) { throw new HttpsError('invalid-argument', 'URL del webhook inválida.'); }
      if (u.protocol !== 'https:') throw new HttpsError('invalid-argument', 'El webhook debe usar https://.');
      await _assertPublicUrl(url);
      const acc = (await accRef.get()).data() || {};
      await accRef.set({
        webhookUrl: u.href, webhookSecret: acc.webhookSecret || 'whsec_' + require('crypto').randomBytes(24).toString('hex'),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return estado();
    }
    if (d.action === 'rotateSecret') {
      await accRef.set({ webhookSecret: 'whsec_' + require('crypto').randomBytes(24).toString('hex'), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return estado();
    }
    if (d.action === 'testWebhook') {
      const r = await _deliverWebhook(uid, 'ping', { mensaje: 'Prueba del webhook de ReCo' });
      return { ...(await estado()), entrega: r };
    }
    return estado();
  }
);

// Entrega un evento al webhook de la cuenta (si tiene). 3 intentos.
async function _deliverWebhook(uid, type, data) {
  const accRef = db.collection('apiAccounts').doc(uid);
  const acc = (await accRef.get()).data();
  if (!acc || !acc.webhookUrl || !acc.webhookSecret) return null;
  const crypto = require('crypto');
  const body = JSON.stringify({ id: 'evt_' + crypto.randomBytes(12).toString('hex'), type, created_at: new Date().toISOString(), data });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', acc.webhookSecret).update(`${t}.${body}`).digest('hex');
  let status = 0, error = null;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, i * 2000));
    try {
      await _assertPublicUrl(acc.webhookUrl);
      const r = await _fetchTimeout(acc.webhookUrl, {
        method: 'POST', redirect: 'manual', body,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'ReCo-Webhooks/1.0', 'X-Reco-Event': type, 'X-Reco-Signature': `t=${t},v1=${sig}` },
      }, 10000);
      status = r.status;
      error = null;
      if (r.status >= 200 && r.status < 300) break;
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
    } catch (e) {
      error = String((e && e.message) || e).slice(0, 200);
    }
  }
  const ok = status >= 200 && status < 300;
  await accRef.set({ lastWebhook: { type, status, ok, error, at: new Date().toISOString() } }, { merge: true });
  return { ok, status, error };
}

const _apiStatusEvent = { approved: 'property.approved', rejected: 'property.rejected', pending: 'property.pending', withdrawn: 'property.withdrawn' };
exports.apiWebhookPublication = onDocumentWritten(
  { region: REGION, document: 'publications/{pubId}', timeoutSeconds: 60 },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    const pubId = event.params && event.params.pubId;
    let type = null;
    if (!before && after) type = 'property.created';
    else if (before && !after) type = 'property.deleted';
    else if (before && after && before.status !== after.status) type = _apiStatusEvent[after.status] || null;
    if (!type) return;
    const owner = (after || before).userId;
    if (!owner) return;
    await _deliverWebhook(owner, type, RecoFeed.pubToApi(pubId, after || before));
  }
);
exports.apiWebhookLead = onDocumentCreated(
  { region: REGION, document: 'contactRequests/{reqId}', timeoutSeconds: 60 },
  async (event) => {
    const c = event.data && event.data.data();
    if (!c || !c.publicationOwnerId) return;
    await _deliverWebhook(c.publicationOwnerId, 'lead.created', {
      id: event.params && event.params.reqId, property_id: c.propertyId || null, kind: c.kind || null,
      from_name: c.fromName || null, from_email: c.fromEmail || null, from_phone: c.fromPhone || null,
      message: c.message || null, created_at: new Date().toISOString(),
    });
  }
);

// Cuerpo de la API → campos validados. base: publicación actual (PATCH).
function _apiFields(body, base) {
  const { row: parcial, extId, photos, desconocidos } = RecoFeed.apiBodyToRow(body);
  const row = { ...(base ? RecoFeed.pubToRow(base) : {}), ...parcial };
  const { row: lista, notes } = RecoFeed.prepareRow(row);
  const raw = RecoFeed.rowToPub(lista);
  // Coordenadas explícitas (o las ya guardadas) se respetan tal cual.
  if (raw.lat == null && base && base.lat != null && !('latitud' in parcial)) { raw.lat = base.lat; raw.lng = base.lng; }
  const { fields, avisos } = _pubFieldsFromRaw(raw);
  return { fields, extId, photos, avisos: notes.concat(avisos, desconocidos.length ? [`Campos ignorados: ${desconocidos.slice(0, 10).join(', ')}.`] : []) };
}

async function _apiAuth(req) {
  const h = String(req.get('authorization') || '');
  const key = (h.match(/^Bearer\s+(\S+)$/i) || [])[1] || String(req.get('x-api-key') || '').trim();
  if (!API_KEY_RE.test(key)) throw new HttpsError('unauthenticated', 'Falta la clave de API (Authorization: Bearer reco_live_…).');
  const hash = _sha256(key);
  const ref = db.collection('apiKeys').doc(hash);
  const snap = await ref.get();
  if (!snap.exists || snap.data().revoked) throw new HttpsError('unauthenticated', 'Clave de API inválida o revocada.');
  const minute = new Date().toISOString().slice(0, 16);
  const usageRef = db.collection('apiUsage').doc(hash);
  await db.runTransaction(async (tx) => {
    const u = (await tx.get(usageRef)).data() || {};
    const count = u.minute === minute ? (u.count || 0) + 1 : 1;
    if (count > API_RATE_PER_MIN) throw new HttpsError('resource-exhausted', `Límite de ${API_RATE_PER_MIN} pedidos por minuto.`);
    tx.set(usageRef, { minute, count });
  });
  ref.update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});
  return { uid: snap.data().uid, prefix: snap.data().prefix };
}
async function _apiOwnPub(uid, id) {
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) throw new HttpsError('not-found', 'Publicación no encontrada.');
  const snap = await db.collection('publications').doc(id).get();
  if (!snap.exists || snap.data().userId !== uid) throw new HttpsError('not-found', 'Publicación no encontrada.');
  return snap;
}
// PATCH (o POST con un external_id que ya existe).
async function _apiUpdate(uid, snap, body) {
  const before = snap.data();
  const { fields, photos, avisos } = _apiFields(body, before);
  const up = { ...fields, fingerprint: RecoImport.fingerprint({ ...before, ...fields }), apiUpdatedAt: FieldValue.serverTimestamp() };
  const fotosCambian = photos && photos.length && JSON.stringify(photos) !== JSON.stringify(before.apiPhotoSources || []);
  if (fotosCambian) {
    const urls = await _storePubPhotos(snap.id, uid, photos);
    if (urls.length) { up.photoUrls = urls; up.apiPhotoSources = photos; }
  }
  const { revisar } = RecoFeed.cambios(before, fields);
  if (before.status === 'withdrawn' || ((revisar || fotosCambian) && before.status !== 'pending')) {
    up.status = 'pending';
    if (before.status === 'withdrawn') Object.assign(up, { withdrawnBy: null, withdrawnAt: null, withdrawnReason: null });
  }
  if (fields.lat == null && before.lat == null) {
    const g = await _geocode(fields.address, fields.district);
    if (g) Object.assign(up, g);
  }
  await snap.ref.update(up);
  return { avisos, revisar: up.status === 'pending' };
}

exports.api = onRequest(
  { region: REGION, maxInstances: 20, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    const send = (code, obj) => res.status(code).set('Cache-Control', 'no-store').json(obj);
    try {
      const auth = await _apiAuth(req);
      const uid = auth.uid;
      const parts = String(req.path || '/').split('/').filter(Boolean);
      if (parts[0] !== 'v1') throw new HttpsError('not-found', 'Ruta no encontrada. Usa /v1/properties.');
      if ((req.rawBody && req.rawBody.length > API_MAX_BODY)) throw new HttpsError('invalid-argument', 'El cuerpo supera 1 MB.');
      const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
      const m = req.method;

      if (parts[1] === 'ping' && parts.length === 2 && m === 'GET') {
        send(200, { ok: true, key: auth.prefix, limits: { per_minute: API_RATE_PER_MIN } });
        return;
      }
      if (parts[1] !== 'properties' || parts.length > 3) throw new HttpsError('not-found', 'Ruta no encontrada.');
      const id = parts[2];

      if (!id && m === 'GET') {
        const snap = await db.collection('publications').where('userId', '==', uid).get();
        const status = String(req.query.status || '');
        const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
        const all = snap.docs.filter((d) => !status || d.data().status === status)
          .sort((a, b) => String(b.data().listedAt || '').localeCompare(String(a.data().listedAt || '')));
        send(200, {
          data: all.slice((page - 1) * API_PAGE_SIZE, page * API_PAGE_SIZE).map((d) => RecoFeed.pubToApi(d.id, d.data())),
          page, per_page: API_PAGE_SIZE, total: all.length,
        });
        return;
      }
      if (!id && m === 'POST') {
        const { extId } = RecoFeed.apiBodyToRow(body);
        if (extId) {
          const prev = (await db.collection('publications').where('apiExternalId', '==', extId).get()).docs.find((d) => d.data().userId === uid);
          if (prev) {
            const r = await _apiUpdate(uid, prev, body);
            const now = await prev.ref.get();
            send(200, { data: RecoFeed.pubToApi(prev.id, now.data()), warnings: r.avisos, updated: true });
            return;
          }
        }
        const { fields, photos, avisos } = _apiFields(body, null);
        if (fields.lat == null) { const g = await _geocode(fields.address, fields.district); if (g) Object.assign(fields, g); }
        const pubRef = db.collection('publications').doc();
        await _createPublication({ uid, email: null, fields, source: 'api', pubRef,
          extra: { ...(extId && { apiExternalId: extId }), apiUpdatedAt: FieldValue.serverTimestamp() } });
        if (photos && photos.length) {
          const urls = await _storePubPhotos(pubRef.id, uid, photos);
          if (urls.length) await pubRef.update({ photoUrls: urls, apiPhotoSources: photos });
        }
        send(201, { data: RecoFeed.pubToApi(pubRef.id, (await pubRef.get()).data()), warnings: avisos });
        return;
      }
      if (id && m === 'GET') {
        const snap = await _apiOwnPub(uid, id);
        send(200, { data: RecoFeed.pubToApi(id, snap.data()) });
        return;
      }
      if (id && m === 'PATCH') {
        const snap = await _apiOwnPub(uid, id);
        const r = await _apiUpdate(uid, snap, body);
        send(200, { data: RecoFeed.pubToApi(id, (await snap.ref.get()).data()), warnings: r.avisos });
        return;
      }
      if (id && m === 'DELETE') {
        const snap = await _apiOwnPub(uid, id);
        if (snap.data().status !== 'withdrawn') {
          await snap.ref.update({ status: 'withdrawn', withdrawnFrom: snap.data().status || 'pending', withdrawnBy: 'api',
            withdrawnAt: FieldValue.serverTimestamp(), withdrawnReason: 'Retirada por la API.' });
        }
        send(200, { data: RecoFeed.pubToApi(id, (await snap.ref.get()).data()) });
        return;
      }
      throw new HttpsError('not-found', 'Método no soportado en esta ruta.');
    } catch (e) {
      if (e instanceof HttpsError) {
        send(API_HTTP[e.code] || 400, { error: { code: e.code, message: e.message, ...(e.details && e.details.errores && { errors: e.details.errores }) } });
      } else {
        logger.error('[api] error', { err: e && e.message });
        send(500, { error: { code: 'internal', message: 'Error interno. Intenta de nuevo.' } });
      }
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Correo de ingesta (roadmap 3.5) — el corredor reenvía un correo con la ficha
// (texto, fotos adjuntas y/o PDF) a su dirección personal
// "<buzón>+<código>@<dominio>" y recibe por correo el resumen y el enlace a
// sus borradores.
//
//   emailIngest      callable: dirección personal (get) y cambio de código (rotate)
//   emailInbound     HTTP para el proveedor de correo entrante (Postmark
//                    Inbound, JSON). Autenticación básica con el secreto
//                    INBOUND_EMAIL_SECRET. Guarda adjuntos en Storage y el
//                    mensaje en /emailInbox/{id} (idempotente), responde 200.
//   emailProcess     trigger de /emailInbox: mismo pipeline de extracción
//                    (_extractAndSaveDrafts) y respuesta por /mail.
// Configuración: parámetro INBOUND_EMAIL_ADDRESS (p. ej.
// "abc123@inbound.postmarkapp.com") y secreto INBOUND_EMAIL_SECRET.
// ─────────────────────────────────────────────────────────────────────────────
const inboundAddress = defineString('INBOUND_EMAIL_ADDRESS', { default: '' });
const inboundSecret = defineSecret('INBOUND_EMAIL_SECRET');
const EMAIL_MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const EMAIL_MAX_PHOTOS = 12;
const EMAIL_MAX_PDFS = 2;
const EMAIL_TOKEN_RE = /^[a-z0-9]{10}$/;

function _ingestAddress(token) {
  const base = inboundAddress.value();
  const at = base.indexOf('@');
  return at > 0 ? `${base.slice(0, at)}+${token}${base.slice(at)}` : null;
}
exports.emailIngest = onCall(
  { region: REGION, maxInstances: 10, consumeAppCheckToken: true, enforceAppCheck: true },
  async (request) => {
    _logAppCheck(request, 'emailIngest');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    if (!inboundAddress.value()) return { disponible: false };
    const userRef = db.collection('emailIngestUsers').doc(uid);
    const cur = (await userRef.get()).data();
    if (cur && cur.token && (request.data || {}).action !== 'rotate') return { disponible: true, address: _ingestAddress(cur.token) };
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const token = Array.from(require('crypto').randomBytes(10), (b) => abc[b % abc.length]).join('');
    const batch = db.batch();
    if (cur && cur.token) batch.delete(db.collection('emailIngestTokens').doc(cur.token));
    batch.set(db.collection('emailIngestTokens').doc(token), { uid, createdAt: FieldValue.serverTimestamp() });
    batch.set(userRef, { token, email: (request.auth.token && request.auth.token.email) || null, updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return { disponible: true, address: _ingestAddress(token) };
  }
);

// "+código" del destinatario (MailboxHash de Postmark o la dirección To).
function _inboundToken(p) {
  const hash = String(p.MailboxHash || '').trim().toLowerCase();
  if (EMAIL_TOKEN_RE.test(hash)) return hash;
  const tos = [p.OriginalRecipient, p.To, ...(Array.isArray(p.ToFull) ? p.ToFull.map((t) => t && t.Email) : [])].join(',');
  const m = tos.toLowerCase().match(/\+([a-z0-9]{10})@/);
  return m ? m[1] : null;
}
exports.emailInbound = onRequest(
  { region: REGION, maxInstances: 10, timeoutSeconds: 120, memory: '512MiB', secrets: [inboundSecret] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('method not allowed'); return; }
    const basic = String(req.get('authorization') || '').match(/^Basic\s+(\S+)$/i);
    const pass = basic ? Buffer.from(basic[1], 'base64').toString('utf8').split(':').slice(1).join(':') : '';
    const secret = inboundSecret.value();
    const crypto = require('crypto');
    const ok = !!secret && pass.length === secret.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(secret));
    if (!ok) { res.status(401).send('unauthorized'); return; }
    const p = req.body && typeof req.body === 'object' ? req.body : {};
    const token = _inboundToken(p);
    const tok = token ? await db.collection('emailIngestTokens').doc(token).get() : null;
    // Código desconocido: 200 igual (el proveedor no reintenta) y se ignora.
    if (!tok || !tok.exists) { res.status(200).send('ignored'); return; }
    const uid = tok.data().uid;
    const msgId = _sha256(String(p.MessageID || '') + '|' + String(p.Date || '') + '|' + String(p.Subject || '')).slice(0, 32);
    const inboxRef = db.collection('emailInbox').doc(msgId);
    if ((await inboxRef.get()).exists) { res.status(200).send('ok'); return; }
    const fotos = [], pdfs = [], otros = [];
    for (const a of (Array.isArray(p.Attachments) ? p.Attachments : [])) {
      const type = String(a && a.ContentType || '').toLowerCase().split(';')[0];
      const name = String(a && a.Name || 'adjunto').slice(0, 120);
      let buf;
      try { buf = Buffer.from(String(a.Content || ''), 'base64'); } catch (_) { continue; }
      if (!buf.length || buf.length > EMAIL_MAX_ATTACH_BYTES) { otros.push(name); continue; }
      if (/^image\/(jpeg|png|webp)$/.test(type) && fotos.length < EMAIL_MAX_PHOTOS) {
        if (buf.length < IMPORT_URL_MIN_PHOTO_BYTES) continue; // logos e íconos de la firma
        fotos.push({ url: await _savePhoto(uid, msgId.slice(0, 32), fotos.length + 1, buf, type), name });
      } else if (type === 'application/pdf' && pdfs.length < EMAIL_MAX_PDFS) {
        const path = `imports/${uid}/${msgId.slice(0, 32)}/doc${pdfs.length + 1}.pdf`;
        await _saveStorageFile(path, buf, 'application/pdf');
        pdfs.push({ path, name });
      } else otros.push(name);
    }
    await inboxRef.create({
      uid, from: String(p.From || '').slice(0, 200), subject: String(p.Subject || '').slice(0, 300),
      text: String(p.TextBody || '').slice(0, 30000) || RecoFeed.htmlToText(String(p.HtmlBody || '')).slice(0, 30000),
      fotos, pdfs, otros, receivedAt: FieldValue.serverTimestamp(),
      // TTL (firestore.indexes.json): el correo se borra solo a los 30 días.
      expiresAt: Timestamp.fromMillis(Date.now() + IMPORT_DRAFT_TTL_DAYS * 864e5),
    }).catch((e) => { if (!_isAlreadyExists(e)) throw e; });
    res.status(200).send('ok');
  }
);

// Recorta la firma (lo que sigue a "-- "). En un reenvío, el mensaje citado
// es justamente la ficha: no se quita.
function _emailBody(text) {
  return String(text || '').replace(/\r/g, '').replace(/\n-- ?\n[\s\S]*$/, '').replace(/\n{3,}/g, '\n\n').trim();
}
exports.emailProcess = onDocumentCreated(
  { region: REGION, document: 'emailInbox/{msgId}', timeoutSeconds: 300, memory: '1GiB', secrets: [openaiKey] },
  async (event) => {
    const m = event.data && event.data.data();
    if (!m || !m.uid) return;
    const msgId = event.params && event.params.msgId;
    const userDoc = (await db.collection('emailIngestUsers').doc(m.uid).get()).data() || {};
    const reply = async (subject, text) => {
      if (!userDoc.email) return;
      await db.collection('mail').doc().set({ to: userDoc.email, message: { subject, text,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;white-space:pre-line">${_esc(text)}</div>` } });
    };
    const asunto = `Re: ${m.subject || 'tu correo a ReCo'}`.slice(0, 200);
    try {
      await _importRateLimit(m.uid);
    } catch (e) {
      await reply(asunto, `Hola,\n\nAlcanzaste el límite de ${IMPORT_AI_LIMIT_PER_HOUR} importaciones por hora. Reenvía el correo en un rato.\n\n— Equipo Reco`);
      return;
    }
    const photoIds = (m.fotos || []).map((_, i) => `e-${i + 1}`);
    const cuerpo = _emailBody(m.text);
    const text = [`Asunto: ${m.subject || ''}`, cuerpo,
      photoIds.length ? `Fotos adjuntas: ${photoIds.map((id) => `[FOTO ${id}]`).join(' ')}` : ''].filter(Boolean).join('\n\n').slice(0, IMPORT_TEXT_MAX_CHARS);
    const content = [{ type: 'text', text }];
    const { getStorage } = require('firebase-admin/storage');
    for (const pdf of (m.pdfs || [])) {
      try {
        const [buf] = await getStorage().bucket().file(pdf.path).download();
        content.push({ type: 'file', file: { filename: pdf.name || 'ficha.pdf', file_data: `data:application/pdf;base64,${buf.toString('base64')}` } });
      } catch (e) {
        logger.warn('[emailProcess] PDF no disponible', { err: e && e.message });
      }
    }
    try {
      const result = await _extractAndSaveDrafts({
        fn: 'emailProcess', uid: m.uid, kind: 'email', channel: 'email', sourceName: `Correo: ${m.subject || ''}`.slice(0, 120),
        batchId: String(msgId || '').slice(0, 32).replace(/[^A-Za-z0-9]/g, '') || undefined,
        text, userContent: content.length > 1 ? content : text, photoIds,
        // Con PDF, los números vienen del PDF: la transcripción (evidencia) cuenta.
        useEvidence: content.length > 1, sourceLabel: 'el correo',
        eventExtra: { photos: photoIds.length, pdfs: (m.pdfs || []).length },
      });
      if (result.drafts.length === 1 && !result.drafts[0].fotos.length) result.drafts[0].fotos = photoIds.slice();
      const byId = {};
      (m.fotos || []).forEach((f, i) => { byId[`e-${i + 1}`] = f.url; });
      const batch = db.batch();
      result.drafts.forEach((dr) => {
        const urls = dr.fotos.map((id) => byId[id]).filter(Boolean).slice(0, 12);
        if (urls.length) batch.update(db.collection('importDrafts').doc(dr.id), { photoUrls: urls });
      });
      await batch.commit();
      const resumen = WaCore.summarizeDrafts(result.drafts, `${WA_SITE}/#borradores`);
      const extra = (m.otros || []).length ? `\n\nNo leímos estos adjuntos: ${m.otros.join(', ')}. Los Word y Excel se suben en recosac.com → Publicar → Subir varios.` : '';
      await reply(asunto, `Hola,\n\n${resumen}${extra}\n\n— Equipo Reco`);
    } catch (e) {
      logger.error('[emailProcess] extracción fallida', { err: e && e.message });
      await reply(asunto, 'Hola,\n\nNo pudimos leer tu correo. Inténtalo de nuevo o pega el texto en recosac.com → Publicar → Subir varios → Pegar texto.\n\n— Equipo Reco');
    }
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
// Fotos de publicaciones (Storage: publications/{pubId}/{uid}/{n}.jpg y su
// miniatura t{n}.jpg).
//
//   cleanupPublicationPhotos  trigger: al eliminar una publicación (el dueño
//                             o un admin) se borran todas sus fotos.
//   updatePublicationPhotos   callable: el dueño cambia las fotos de una
//                             publicación ya enviada (quitar, ordenar, elegir
//                             portada, agregar las que no se subieron). Si
//                             agrega fotos a una publicación aprobada o
//                             rechazada, vuelve a revisión.
//
// Client contract:
//   await httpsCallable('updatePublicationPhotos')({ pubId, photoUrls, thumbUrls })
//   // → { status, photoUrls, thumbUrls, removed }
// Las fotos nuevas las sube el navegador antes (storage.rules deja escribir
// al dueño en publications/{pubId}/{uid}/); aquí solo se aceptan URLs de esa
// carpeta.
// ─────────────────────────────────────────────────────────────────────────────
const PUB_MAX_PHOTOS = 20;
exports.cleanupPublicationPhotos = onDocumentDeleted(
  { region: REGION, document: 'publications/{pubId}' },
  async (event) => {
    const pubId = event.params && event.params.pubId;
    if (!pubId || !/^[A-Za-z0-9]{1,40}$/.test(pubId)) return;
    try {
      const { getStorage } = require('firebase-admin/storage');
      await getStorage().bucket().deleteFiles({ prefix: `publications/${pubId}/` });
    } catch (e) {
      logger.warn('[cleanupPublicationPhotos] no se borraron las fotos', { pubId, err: e && e.message });
    }
  }
);

// URL de descarga de Storage → ruta del archivo ('' si no es de Storage).
function _storagePathOf(u) {
  const m = String(u || '').match(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?#]+)/);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (_) { return ''; }
}
exports.updatePublicationPhotos = onCall(
  { region: REGION, maxInstances: 10, consumeAppCheckToken: true, enforceAppCheck: true },
  async (request) => {
    _logAppCheck(request, 'updatePublicationPhotos');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const d = request.data || {};
    const pubId = String(d.pubId || '');
    if (!/^[A-Za-z0-9]{1,40}$/.test(pubId)) throw new HttpsError('invalid-argument', 'Publicación inválida.');
    const ref = db.collection('publications').doc(pubId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== uid) throw new HttpsError('not-found', 'Publicación no encontrada.');
    const pub = snap.data();

    const own = (u, thumb) => {
      const p = _storagePathOf(u);
      return new RegExp(`^publications/${pubId}/${uid}/${thumb ? 't' : ''}\\d{1,3}\\.jpg$`).test(p) ? p : '';
    };
    const urls = Array.isArray(d.photoUrls) ? d.photoUrls.map(String) : [];
    if (urls.length > PUB_MAX_PHOTOS) throw new HttpsError('invalid-argument', `Máximo ${PUB_MAX_PHOTOS} fotos.`);
    if (new Set(urls).size !== urls.length) throw new HttpsError('invalid-argument', 'Hay fotos repetidas.');
    // Las fotos que ya tenía (p. ej. copiadas del bot) se aceptan aunque no
    // sigan el patrón; las nuevas tienen que estar en la carpeta del dueño.
    const antes = new Set(Array.isArray(pub.photoUrls) ? pub.photoUrls : []);
    if (!urls.every((u) => antes.has(u) || own(u, false))) throw new HttpsError('invalid-argument', 'Foto no válida para esta publicación.');
    let thumbs = Array.isArray(d.thumbUrls) ? d.thumbUrls.map(String) : [];
    const thumbsAntes = new Set(Array.isArray(pub.thumbUrls) ? pub.thumbUrls : []);
    if (thumbs.length !== urls.length || !thumbs.every((u) => !u || thumbsAntes.has(u) || own(u, true))) thumbs = [];

    const nuevas = urls.filter((u) => !antes.has(u));
    const quitadas = [...antes].filter((u) => !urls.includes(u));
    const quitadasThumbs = [...thumbsAntes].filter((u) => !thumbs.includes(u));
    const up = {
      photoUrls: urls, thumbUrls: thumbs, photosPending: false, photoError: null,
      photosUpdatedAt: FieldValue.serverTimestamp(),
    };
    // Fotos nuevas en una publicación ya revisada: vuelve a moderación.
    if (nuevas.length && (pub.status === 'approved' || pub.status === 'rejected')) up.status = 'pending';
    await ref.update(up);

    // Se borran del Storage las que se quitaron (solo las de la carpeta del dueño).
    const { getStorage } = require('firebase-admin/storage');
    const bucket = getStorage().bucket();
    let removed = 0;
    for (const u of quitadas.concat(quitadasThumbs)) {
      const path = _storagePathOf(u);
      if (!path.startsWith(`publications/${pubId}/`)) continue;
      try { await bucket.file(path).delete(); removed++; } catch (_) { /* ya no estaba */ }
    }
    return { status: up.status || pub.status, photoUrls: urls, thumbUrls: thumbs, removed };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// analyzePhotos — fotos con IA: ambiente de cada foto, calidad, marcas de
// agua, texto encima y personas; propone la portada y el orden
// (functions/photo-core.js). Cuenta en el límite por hora de la IA.
//   photos  [dataUrl JPEG chico (~512 px)] o [{ url }] de una publicación
//           propia (pubId): las URLs se leen de Storage en el servidor.
// No guarda nada: el navegador aplica el orden y muestra los avisos.
// ─────────────────────────────────────────────────────────────────────────────
const RecoPhotos = require('./photo-core');
const PHOTO_AI_MAX_CHARS = 400 * 1024;
const PHOTO_AI_MAX_BYTES = 3 * 1024 * 1024;
exports.analyzePhotos = onCall(
  {
    region: REGION, maxInstances: 10, timeoutSeconds: 120, memory: '512MiB',
    consumeAppCheckToken: true, enforceAppCheck: true, secrets: [openaiKey],
  },
  async (request) => {
    _logAppCheck(request, 'analyzePhotos');
    requireVerifiedAuth(request);
    const uid = request.auth.uid;
    const d = request.data || {};
    const items = Array.isArray(d.photos) ? d.photos : [];
    if (items.length < 2) throw new HttpsError('invalid-argument', 'Agrega al menos 2 fotos.');
    if (items.length > PUB_MAX_PHOTOS) throw new HttpsError('invalid-argument', `Máximo ${PUB_MAX_PHOTOS} fotos.`);

    // Fotos ya subidas: solo las de una publicación propia.
    let permitidas = null;
    if (items.some((it) => typeof it !== 'string')) {
      const pubId = String(d.pubId || '');
      if (!/^[A-Za-z0-9]{1,40}$/.test(pubId)) throw new HttpsError('invalid-argument', 'Publicación inválida.');
      const snap = await db.collection('publications').doc(pubId).get();
      if (!snap.exists || snap.data().userId !== uid) throw new HttpsError('not-found', 'Publicación no encontrada.');
      const p = snap.data();
      permitidas = new Set([].concat(p.photoUrls || [], p.thumbUrls || []));
    }
    const sinFoto = () => new HttpsError('invalid-argument', 'Foto no válida.');
    const leer = [];
    for (const it of items) {
      if (typeof it === 'string') {
        if (!IMPORT_IMAGE_RE.test(it) || it.length > PHOTO_AI_MAX_CHARS) throw sinFoto();
        leer.push(it);
        continue;
      }
      const url = it && typeof it.url === 'string' ? it.url : '';
      const path = _storagePathOf(url);
      if (!permitidas || !permitidas.has(url) || !path.startsWith('publications/')) throw sinFoto();
      leer.push(path);
    }

    await _importRateLimit(uid);
    const { getStorage } = require('firebase-admin/storage');
    const bucket = getStorage().bucket();
    const dataUrls = [];
    for (const x of leer) {
      if (x.startsWith('data:')) { dataUrls.push(x); continue; }
      let buf;
      try { [buf] = await bucket.file(x).download(); } catch (_) { throw new HttpsError('not-found', 'Una de las fotos ya no existe. Recarga la página.'); }
      if (buf.length > PHOTO_AI_MAX_BYTES) throw new HttpsError('invalid-argument', 'Una de las fotos es demasiado grande.');
      dataUrls.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    }

    let parsed;
    try {
      parsed = await _openaiStructured(RecoPhotos.PROMPT, RecoPhotos.content(dataUrls), 'fotos', RecoPhotos.SCHEMA);
    } catch (e) {
      logger.error('[analyzePhotos] OpenAI error', { err: e && e.message });
      throw new HttpsError('internal', 'No pudimos revisar las fotos. Intenta de nuevo.');
    }
    const r = RecoPhotos.normalizar(parsed, dataUrls.length);
    await db.collection('importEvents').doc().set({
      uid, kind: 'fotos', channel: 'fotos', photos: dataUrls.length,
      marcaAgua: r.fotos.filter((f) => f.marcaAgua).length, createdAt: FieldValue.serverTimestamp(),
    });
    return r;
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
