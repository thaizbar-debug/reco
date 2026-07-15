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

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Seed admin allowlist. Mirrors firestore.rules → isAdmin() fallback.
// Used by setAdminClaim to accept the current caller as admin even if
// their token does not yet carry the `admin` custom claim — needed so
// the very first invocation (when nobody has the claim yet) doesn't
// hit chicken-and-egg. Keep in sync with the rules block AND the
// client-side _ADMIN_EMAILS constant.
const SEED_ADMIN_EMAILS = ['webmaster@recosac.com', 'sebastiand@recosac.com'];

const REGION = 'southamerica-east1';
const UNLOCK_COST = 1;
const PUBLISH_COST = 3;
const HISTORY_CAP = 200;
// Max contactRequests a single fromUserId can create in the rolling
// last hour. Above this, submitContactRequest throws resource-exhausted.
// A legit user contacting 15 property owners in 60 minutes is already
// aggressive; anything much beyond that is scraper behaviour.
const CONTACT_RATE_LIMIT_PER_HOUR = 15;
const CONTACT_KINDS = ['arrendador', 'vendedor', 'asesor_reco'];
// Max getHistoricoDetail calls per authenticated user per rolling hour.
// A user browsing 500 histórico cards in one hour is already very
// intense; beyond that suggests a script trying to pull the full
// dataset. Hitting the cap throws resource-exhausted (client shows
// "demasiadas consultas, espera un momento").
const HIST_DETAIL_RATE_LIMIT_PER_HOUR = 500;

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
      'Verificá tu email antes de continuar. Revisá tu bandeja de entrada (y spam) por el link que te enviamos.'
    );
  }
}

const PUB_TYPES = ['Departamento', 'Casa', 'Oficina', 'Local comercial', 'Terreno', 'Otros'];
const PUB_OPS = ['Venta', 'Alquiler'];
const PUB_CURRENCIES = ['USD', 'PEN'];
const PUB_ESTADOS = ['En proyecto', 'En construcción', 'Construido'];
const PUB_SOURCES = ['single', 'bulk'];

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
        throw new HttpsError('failed-precondition', `Sin llaves suficientes. Necesitas ${UNLOCK_COST} llave para desbloquear este inmueble.`);
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
);

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
//
// Errors (HttpsError):
//   unauthenticated       — no auth context
//   invalid-argument      — missing / malformed field
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

    if (!PUB_TYPES.includes(raw.type)) throw new HttpsError('invalid-argument', 'type inválido.');
    if (!PUB_OPS.includes(raw.op)) throw new HttpsError('invalid-argument', 'op inválido.');
    if (!PUB_CURRENCIES.includes(raw.currency)) throw new HttpsError('invalid-argument', 'currency inválido.');

    const price = Number(raw.price);
    if (!isFinite(price) || price <= 0) throw new HttpsError('invalid-argument', 'price inválido.');
    const area = Number(raw.area);
    if (!isFinite(area) || area <= 0) throw new HttpsError('invalid-argument', 'area inválida.');

    const estado = PUB_ESTADOS.includes(raw.estado) ? raw.estado : 'Construido';
    const source = PUB_SOURCES.includes(raw.source) ? raw.source : 'single';
    const features = Array.isArray(raw.features)
      ? raw.features.filter(f => typeof f === 'string' && f.length < 100).slice(0, 30)
      : [];

    const lat = (typeof raw.lat === 'number' && isFinite(raw.lat)) ? raw.lat : null;
    const lng = (typeof raw.lng === 'number' && isFinite(raw.lng)) ? raw.lng : null;

    const numOrZero = (v) => { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0; };

    const userRef = db.collection('users').doc(uid);
    const pubRef = db.collection('publications').doc(); // pre-generate id

    return db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : {};
      const currentKeys = Number(userData.keysLeft) || 0;
      if (currentKeys < PUBLISH_COST) {
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
        type: raw.type,
        op: raw.op,
        currency: raw.currency,
        price,
        areaTerr: numOrZero(raw.areaTerr),
        area,
        beds: numOrZero(raw.beds),
        baths: numOrZero(raw.baths),
        parking: numOrZero(raw.parking),
        floor: numOrZero(raw.floor),
        floors: numOrZero(raw.floors),
        age: numOrZero(raw.age),
        estado,
        ascensor: Boolean(raw.ascensor),
        amoblado: Boolean(raw.amoblado),
        petFriendly: Boolean(raw.petFriendly),
        features,
        title, desc,
        photoUrls: [],
      };

      tx.set(pubRef, pubData);

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

      return {
        publicationId: pubRef.id,
        keysLeft: currentKeys - PUBLISH_COST,
      };
    });
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

    const propertyId = str(raw.propertyId, 'propertyId', 128);
    const kind = raw.kind;
    if (!CONTACT_KINDS.includes(kind)) {
      throw new HttpsError('invalid-argument', 'kind inválido.');
    }
    const fromName  = str(raw.fromName, 'fromName', 200);
    const fromEmail = str(raw.fromEmail, 'fromEmail', 200);
    if (!/.+@.+\..+/.test(fromEmail)) {
      throw new HttpsError('invalid-argument', 'fromEmail inválido.');
    }
    const message = str(raw.message, 'message', 2000);
    if (message.length < 10) {
      throw new HttpsError('invalid-argument', 'El mensaje debe tener al menos 10 caracteres.');
    }

    const reqId = `${uid}_${propertyId}_${kind}`;
    const reqRef = db.collection('contactRequests').doc(reqId);

    // Existence check + rate limit outside the transaction. Duplicates
    // are impossible-to-race on the deterministic ID (Firestore create
    // with an existing ID fails naturally), and the rate-limit query
    // trades a tiny lag window for a much simpler / cheaper Function
    // (transactional aggregation queries are unavailable in Firestore).
    const existing = await reqRef.get();
    if (existing.exists) {
      throw new HttpsError(
        'already-exists',
        'Ya contactaste al propietario de este inmueble.'
      );
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

    await reqRef.create({
      propertyId,
      propertyAddress:     optStr(raw.propertyAddress, 500),
      propertyDistrict:    optStr(raw.propertyDistrict, 100),
      propertyOp:          optStr(raw.propertyOp, 40),
      propertyPrice:       (typeof raw.propertyPrice === 'number' && isFinite(raw.propertyPrice)) ? raw.propertyPrice : null,
      propertyCurrency:    optStr(raw.propertyCurrency, 10),
      publicationOwnerId:  optStr(raw.publicationOwnerId, 128),
      kind,
      fromUserId:          uid,
      fromName,
      fromEmail,
      fromPhone:           optStr(raw.fromPhone, 40),
      message,
      status:              'new',
      createdAt:           FieldValue.serverTimestamp(),
    });

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
