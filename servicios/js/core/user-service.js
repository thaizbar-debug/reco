/* ============================================================
   UserService — Wraps existing Firebase Auth + Firestore /users/{uid}
   NO new user model. Reuses the CORE user entity.
   ============================================================ */
const UserService = (() => {
  'use strict';

  function _getAuth() {
    return RecoFirebase && RecoFirebase.auth ? RecoFirebase.auth : null;
  }

  function _getDb() {
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      return firebase.firestore();
    }
    return null;
  }

  function getCurrentUser() {
    var auth = _getAuth();
    return auth ? auth.currentUser : null;
  }

  function isAuthenticated() {
    return getCurrentUser() !== null;
  }

  function getUserId() {
    var user = getCurrentUser();
    return user ? user.uid : null;
  }

  function getUserProfile() {
    var user = getCurrentUser();
    if (!user) return null;
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: user.emailVerified
    };
  }

  function getUserDoc() {
    var db = _getDb();
    var uid = getUserId();
    if (!db || !uid) return Promise.resolve(null);
    return db.collection('users').doc(uid).get()
      .then(function(doc) {
        if (!doc.exists) return null;
        return Object.assign({ uid: uid }, doc.data());
      })
      .catch(function() { return null; });
  }

  function requireAuth() {
    if (isAuthenticated()) {
      return Promise.resolve(getCurrentUser());
    }
    RecoFirebase.openAuthModal('login');
    return Promise.reject({ type: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
  }

  function onAuthStateChanged(callback) {
    var auth = _getAuth();
    if (!auth) return function() {};
    return auth.onAuthStateChanged(callback);
  }

  return {
    getCurrentUser: getCurrentUser,
    isAuthenticated: isAuthenticated,
    getUserId: getUserId,
    getUserProfile: getUserProfile,
    getUserDoc: getUserDoc,
    requireAuth: requireAuth,
    onAuthStateChanged: onAuthStateChanged
  };
})();
