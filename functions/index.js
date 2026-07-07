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
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const REGION = 'southamerica-east1';
const UNLOCK_COST = 1;
const HISTORY_CAP = 200;

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
  { region: REGION, maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión para desbloquear una propiedad.');
    }
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
