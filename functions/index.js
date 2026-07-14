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
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const REGION = 'southamerica-east1';
const UNLOCK_COST = 1;
const PUBLISH_COST = 3;
const HISTORY_CAP = 200;

// AppCheck is in SOFT mode on both callables (consumeAppCheckToken:
// true, enforceAppCheck: false). Tokens are consumed and logged but
// requests without a valid token are still allowed through. Enforce
// was tried in PR #69 and rolled back because the client on
// github.io was returning 401 unauthenticated on unlockProperty
// (authenticated users, valid session — tokens were not being
// attached from the production origin). To re-enable enforcement:
// confirm the reCAPTCHA site key is authorized for the production
// domain and the AppCheck provider is registered in Firebase
// Console, then flip both callables back to `enforceAppCheck: true`.
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
    // AppCheck in SOFT mode: tokens are consumed and logged, but
    // requests without a valid token are not rejected. Enforce was
    // enabled in PR #69 and rolled back here because the client on
    // github.io was failing to attach tokens (auth was valid, calls
    // still returned 401 unauthenticated). Once the reCAPTCHA site
    // key / AppCheck provider registration is confirmed for the
    // production domain, flip enforceAppCheck back to true.
    consumeAppCheckToken: true,
    enforceAppCheck: false,
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
    // AppCheck in SOFT mode (same as unlockProperty). See the header
    // comment on unlockProperty for the reason behind this rollback.
    consumeAppCheckToken: true,
    enforceAppCheck: false,
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
