// ─────────────────────────────────────────────────────────────────────────────
// Reco Admin Cloud Functions
//
// New callable functions for the admin panel (admin.html). These provide
// server-side operations that Firestore rules cannot support from the
// client: listing users, managing key balances, and reading server-only
// collections.
//
// INTEGRATION: To deploy these functions alongside the existing ones,
// add this single line to the end of functions/index.js:
//
//   Object.assign(exports, require('./admin'));
//
// All functions reuse the same Firebase Admin SDK app instance
// (initializeApp is idempotent — the second call returns the existing
// app), the same region, and the same admin-caller guard pattern.
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { getApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

let db;
try { db = getFirestore(getApp()); } catch (_) { db = getFirestore(); }

const REGION = 'southamerica-east1';
const SEED_ADMIN_EMAILS = ['webmaster@recosac.com', 'sebastiand@recosac.com'];
const HISTORY_CAP = 200;

function _requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const token = request.auth.token || {};
  if (token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verificá tu email antes de continuar.');
  }
  const email = String(token.email || '').toLowerCase();
  const isAdmin = token.admin === true || SEED_ADMIN_EMAILS.includes(email);
  if (!isAdmin) {
    throw new HttpsError('permission-denied', 'Solo un admin puede realizar esta acción.');
  }
  return { uid: request.auth.uid, email };
}

// ─────────────────────────────────────────────────────────────────────────────
// adminUpdateUserKeys — add or remove keys from a user's balance.
//
// Client contract:
//   const fn = fns.httpsCallable('adminUpdateUserKeys');
//   const { data } = await fn({ email: 'user@test.com', amount: 5 });
//   // data = { targetUid, newBalance, previousBalance }
//
// amount > 0 adds keys; amount < 0 subtracts (floor at 0).
// Records a keyHistory entry with type 'admin_grant' or 'admin_revoke'.
// ─────────────────────────────────────────────────────────────────────────────
exports.adminUpdateUserKeys = onCall(
  { region: REGION, maxInstances: 5 },
  async (request) => {
    const caller = _requireAdmin(request);

    const targetEmail = request.data && request.data.email;
    if (!targetEmail || typeof targetEmail !== 'string' || !/.+@.+\..+/.test(targetEmail)) {
      throw new HttpsError('invalid-argument', 'email requerido.');
    }
    const amount = request.data && request.data.amount;
    if (typeof amount !== 'number' || !isFinite(amount) || amount === 0) {
      throw new HttpsError('invalid-argument', 'amount requerido (número distinto de cero).');
    }
    if (Math.abs(amount) > 1000) {
      throw new HttpsError('invalid-argument', 'amount máximo: 1000.');
    }

    let targetUser;
    try {
      targetUser = await getAuth().getUserByEmail(targetEmail.trim().toLowerCase());
    } catch (e) {
      throw new HttpsError('not-found', 'No hay una cuenta con ese email.');
    }

    const userRef = db.collection('users').doc(targetUser.uid);

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : {};
      const currentKeys = Number(data.keysLeft) || 0;
      const newBalance = Math.max(0, currentKeys + Math.round(amount));

      const historyEntry = {
        type: amount > 0 ? 'admin_grant' : 'admin_revoke',
        qty: Math.abs(Math.round(amount)),
        propId: null,
        propLabel: `Admin: ${amount > 0 ? '+' : ''}${Math.round(amount)} llaves por ${caller.email}`,
        date: new Date().toISOString(),
      };
      const currentHistory = Array.isArray(data.keyHistory) ? data.keyHistory : [];
      const nextHistory = [historyEntry, ...currentHistory].slice(0, HISTORY_CAP);

      tx.set(userRef, {
        keysLeft: newBalance,
        keyHistory: nextHistory,
      }, { merge: true });

      return {
        targetUid: targetUser.uid,
        previousBalance: currentKeys,
        newBalance,
      };
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// adminListUsers — paginated list of users with their key balances.
//
// Client contract:
//   const fn = fns.httpsCallable('adminListUsers');
//   const { data } = await fn({ limit: 20, pageToken: '...' });
//   // data = { users: [{uid, email, displayName, keysLeft, ...}], nextPageToken }
// ─────────────────────────────────────────────────────────────────────────────
exports.adminListUsers = onCall(
  { region: REGION, maxInstances: 5 },
  async (request) => {
    _requireAdmin(request);

    const limit = Math.min(Math.max(Number(request.data && request.data.limit) || 20, 1), 100);
    const pageToken = (request.data && request.data.pageToken) || undefined;

    const listResult = await getAuth().listUsers(limit, pageToken);

    const uids = listResult.users.map(u => u.uid);
    const userDocs = {};
    if (uids.length > 0) {
      const chunks = [];
      for (let i = 0; i < uids.length; i += 10) {
        chunks.push(uids.slice(i, i + 10));
      }
      for (const chunk of chunks) {
        const snap = await db.collection('users').where('__name__', 'in', chunk).get();
        snap.docs.forEach(d => { userDocs[d.id] = d.data(); });
      }
    }

    const users = listResult.users.map(u => {
      const doc = userDocs[u.uid] || {};
      return {
        uid: u.uid,
        email: u.email || null,
        displayName: u.displayName || doc.displayName || null,
        emailVerified: u.emailVerified,
        disabled: u.disabled,
        createdAt: u.metadata.creationTime || null,
        lastSignIn: u.metadata.lastSignInTime || null,
        isAdmin: !!(u.customClaims && u.customClaims.admin),
        keysLeft: Number(doc.keysLeft) || 0,
        favoritesCount: Array.isArray(doc.favorites) ? doc.favorites.length : 0,
        keyHistoryCount: Array.isArray(doc.keyHistory) ? doc.keyHistory.length : 0,
      };
    });

    return {
      users,
      nextPageToken: listResult.pageToken || null,
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// adminGetStats — aggregate platform metrics for the dashboard.
//
// Returns counts and breakdowns that the admin panel dashboard uses.
// Running these aggregations server-side avoids pulling every document
// to the client.
// ─────────────────────────────────────────────────────────────────────────────
exports.adminGetStats = onCall(
  { region: REGION, maxInstances: 5 },
  async (request) => {
    _requireAdmin(request);

    const [
      totalUsersResult,
      pubPendingSnap,
      pubApprovedSnap,
      pubRejectedSnap,
      contactNewSnap,
      contactHandledSnap,
    ] = await Promise.all([
      getAuth().listUsers(1),
      db.collection('publications').where('status', '==', 'pending').count().get(),
      db.collection('publications').where('status', '==', 'approved').count().get(),
      db.collection('publications').where('status', '==', 'rejected').count().get(),
      db.collection('contactRequests').where('status', '==', 'new').count().get(),
      db.collection('contactRequests').where('status', '==', 'handled').count().get(),
    ]);

    return {
      publications: {
        pending: pubPendingSnap.data().count,
        approved: pubApprovedSnap.data().count,
        rejected: pubRejectedSnap.data().count,
      },
      contacts: {
        new: contactNewSnap.data().count,
        handled: contactHandledSnap.data().count,
      },
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// adminDisableUser — enable or disable a Firebase Auth account.
//
// Client contract:
//   const fn = fns.httpsCallable('adminDisableUser');
//   const { data } = await fn({ uid: '...', disabled: true });
//   // data = { uid, disabled }
// ─────────────────────────────────────────────────────────────────────────────
exports.adminDisableUser = onCall(
  { region: REGION, maxInstances: 5 },
  async (request) => {
    const caller = _requireAdmin(request);

    const targetUid = request.data && request.data.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid requerido.');
    }
    const disabled = !!(request.data && request.data.disabled);

    if (targetUid === caller.uid) {
      throw new HttpsError('failed-precondition', 'No puedes deshabilitarte a ti mismo.');
    }

    let targetUser;
    try {
      targetUser = await getAuth().getUser(targetUid);
    } catch (e) {
      throw new HttpsError('not-found', 'Usuario no encontrado.');
    }

    if (SEED_ADMIN_EMAILS.includes((targetUser.email || '').toLowerCase())) {
      throw new HttpsError('permission-denied', 'No se puede deshabilitar un admin semilla.');
    }

    await getAuth().updateUser(targetUid, { disabled });

    try {
      await db.collection('adminAuditLog').add({
        adminUid: caller.uid,
        adminEmail: caller.email,
        action: disabled ? 'user.disable' : 'user.enable',
        targetType: 'user',
        targetId: targetUid,
        extras: { targetEmail: targetUser.email || null },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('[adminDisableUser] audit write failed', { err: e && e.message });
    }

    return { uid: targetUid, disabled };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// adminUpdateUser — update a user's display name or email from the admin panel.
//
// Client contract:
//   const fn = fns.httpsCallable('adminUpdateUser');
//   const { data } = await fn({ uid, displayName, email });
//   // data = { uid, updated: ['displayName', ...] }
// ─────────────────────────────────────────────────────────────────────────────
exports.adminUpdateUser = onCall(
  { region: REGION, maxInstances: 5 },
  async (request) => {
    const caller = _requireAdmin(request);

    const targetUid = request.data && request.data.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid requerido.');
    }

    const updates = {};
    const updatedFields = [];
    if (request.data.displayName !== undefined) {
      updates.displayName = String(request.data.displayName).trim().slice(0, 100);
      updatedFields.push('displayName');
    }
    if (request.data.email !== undefined) {
      const newEmail = String(request.data.email).trim().toLowerCase();
      if (!/.+@.+\..+/.test(newEmail)) {
        throw new HttpsError('invalid-argument', 'Email inválido.');
      }
      updates.email = newEmail;
      updatedFields.push('email');
    }

    if (!updatedFields.length) {
      throw new HttpsError('invalid-argument', 'Nada que actualizar.');
    }

    try {
      await getAuth().getUser(targetUid);
    } catch (e) {
      throw new HttpsError('not-found', 'Usuario no encontrado.');
    }

    await getAuth().updateUser(targetUid, updates);

    try {
      await db.collection('adminAuditLog').add({
        adminUid: caller.uid,
        adminEmail: caller.email,
        action: 'user.update',
        targetType: 'user',
        targetId: targetUid,
        extras: { fields: updatedFields },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('[adminUpdateUser] audit write failed', { err: e && e.message });
    }

    return { uid: targetUid, updated: updatedFields };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// adminListAdmins — list all users who have the admin custom claim.
//
// Client contract:
//   const fn = fns.httpsCallable('adminListAdmins');
//   const { data } = await fn({});
//   // data = { admins: [{uid, email, displayName, role, lastSignIn}] }
//
// Iterates all Firebase Auth users to find those with admin=true claim.
// For small user bases this is fine; for very large ones consider caching.
// ─────────────────────────────────────────────────────────────────────────────
exports.adminListAdmins = onCall(
  { region: REGION, maxInstances: 5 },
  async (request) => {
    _requireAdmin(request);

    const admins = [];
    let pageToken;

    do {
      const listResult = await getAuth().listUsers(1000, pageToken);
      for (const u of listResult.users) {
        const claims = u.customClaims || {};
        const email = (u.email || '').toLowerCase();
        if (claims.admin === true || SEED_ADMIN_EMAILS.includes(email)) {
          admins.push({
            uid: u.uid,
            email: u.email || null,
            displayName: u.displayName || null,
            disabled: u.disabled,
            lastSignIn: u.metadata.lastSignInTime || null,
            createdAt: u.metadata.creationTime || null,
            isSeed: SEED_ADMIN_EMAILS.includes(email),
            role: claims.adminRole || (SEED_ADMIN_EMAILS.includes(email) ? 'Super-admin' : 'Admin'),
          });
        }
      }
      pageToken = listResult.pageToken;
    } while (pageToken);

    return { admins };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// adminSetRole — set a custom adminRole label on a user's custom claims.
//
// Client contract:
//   const fn = fns.httpsCallable('adminSetRole');
//   const { data } = await fn({ uid, role: 'Editor data' });
//   // data = { uid, role }
//
// The role is a display label stored in customClaims.adminRole.
// The user must already have admin=true claim.
// ─────────────────────────────────────────────────────────────────────────────
exports.adminSetRole = onCall(
  { region: REGION, maxInstances: 5 },
  async (request) => {
    const caller = _requireAdmin(request);

    const targetUid = request.data && request.data.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid requerido.');
    }
    const role = request.data && request.data.role;
    if (!role || typeof role !== 'string') {
      throw new HttpsError('invalid-argument', 'role requerido.');
    }
    const VALID_ROLES = ['Super-admin', 'Admin', 'Editor data', 'Servicio', 'Solo lectura'];
    if (!VALID_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', 'Rol inválido. Válidos: ' + VALID_ROLES.join(', '));
    }

    let targetUser;
    try {
      targetUser = await getAuth().getUser(targetUid);
    } catch (e) {
      throw new HttpsError('not-found', 'Usuario no encontrado.');
    }

    const existing = targetUser.customClaims || {};
    if (!existing.admin && !SEED_ADMIN_EMAILS.includes((targetUser.email || '').toLowerCase())) {
      throw new HttpsError('failed-precondition', 'El usuario no es admin. Primero otorga permisos de admin.');
    }

    await getAuth().setCustomUserClaims(targetUid, { ...existing, admin: true, adminRole: role });

    try {
      await db.collection('adminAuditLog').add({
        adminUid: caller.uid,
        adminEmail: caller.email,
        action: 'admin.role.set',
        targetType: 'user',
        targetId: targetUid,
        extras: { role, targetEmail: targetUser.email || null },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('[adminSetRole] audit write failed', { err: e && e.message });
    }

    return { uid: targetUid, role };
  }
);
