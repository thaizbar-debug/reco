/* ============================================================
   Firebase Init — Shared Firebase configuration for Servicios
   Initializes Firebase App, AppCheck, Auth, and Functions.
   Connects auth state to RecoGateway and header UI.
   Principle 7: prepared for real integration.
   Principle 8: clearly identified shared session (same project as index.html).
   ============================================================ */
const RecoFirebase = (() => {
  'use strict';

  // ── Firebase Config (same project as index.html) ──────────
  const firebaseConfig = {
    apiKey:            'AIzaSyCri1KjwpUKfYMhjYf0nPU9KD1LipVbh3M',
    authDomain:        'reco-5a5dd.firebaseapp.com',
    projectId:         'reco-5a5dd',
    storageBucket:     'reco-5a5dd.firebasestorage.app',
    messagingSenderId: '553146114942',
    appId:             '1:553146114942:web:3dcba5bb9bd1276c6b892f'
  };

  var auth = null;
  var _firebaseReady = false;

  // Graceful Firebase init — SDK may not be available in all environments
  if (typeof firebase !== 'undefined' && firebase.initializeApp) {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }

      // AppCheck (reCAPTCHA v3, soft mode)
      var RECAPTCHA_V3_SITE_KEY = '6LeiqVItAAAAAGetmfxZfyeharbBORuUE02hG6t2';
      if (RECAPTCHA_V3_SITE_KEY && firebase.appCheck) {
        try {
          firebase.appCheck().activate(
            new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
            true
          );
        } catch (e) {
          console.warn('[RecoFirebase] AppCheck activate failed:', e && e.message);
        }
      }

      auth = firebase.auth();
      auth.languageCode = 'es';
      _firebaseReady = true;
    } catch (e) {
      console.warn('[RecoFirebase] Firebase init failed:', e && e.message);
    }
  } else {
    console.warn('[RecoFirebase] Firebase SDK not loaded — auth features unavailable');
  }

  function getFunctions() {
    if (!_firebaseReady) return null;
    return firebase.app().functions('southamerica-east1');
  }

  function isReady() {
    return _firebaseReady;
  }

  // ── Auth state → Gateway + Header UI ──────────────────────
  function _getInitials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }

  function _updateHeaderUI(user) {
    var ingresarBtn = document.getElementById('svcIngresarBtn');
    var userWrap = document.getElementById('svcUserWrap');
    if (!ingresarBtn || !userWrap) return;

    if (user) {
      ingresarBtn.style.display = 'none';
      userWrap.style.display = 'flex';
      userWrap.innerHTML =
        '<div class="user-wrap" style="position:relative">' +
          '<button class="user-btn" onclick="RecoFirebase.toggleUserDropdown(this)">' +
            _getInitials(user.displayName || user.email) +
          '</button>' +
          '<div class="user-dropdown"><div class="user-dropdown-inner">' +
            '<div class="u-header">' +
              '<div class="u-name">' + (user.displayName || user.email) + '</div>' +
              '<div class="u-email">' + user.email + '</div>' +
            '</div>' +
            '<a href="index.html#perfil">Mi perfil</a>' +
            '<a href="index.html#favoritos">Mis favoritos</a>' +
            '<a href="index.html#publicaciones">Mis publicaciones</a>' +
            '<hr/>' +
            '<a href="#" onclick="event.preventDefault();RecoFirebase.signOut()">Cerrar sesión</a>' +
          '</div></div>' +
        '</div>';
    } else {
      ingresarBtn.style.display = '';
      userWrap.style.display = 'none';
      userWrap.innerHTML = '';
    }
  }

  if (auth) {
    auth.onAuthStateChanged(function(user) {
      if (user) {
        user.getIdToken().then(function(token) {
          if (typeof RecoGateway !== 'undefined') {
            RecoGateway.setAuthToken(token);
          }
        });
      } else {
        if (typeof RecoGateway !== 'undefined') {
          RecoGateway.clearAuth();
        }
      }
      _updateHeaderUI(user);
    });

    auth.onIdTokenChanged(function(user) {
      if (user) {
        user.getIdToken().then(function(token) {
          if (typeof RecoGateway !== 'undefined') {
            RecoGateway.setAuthToken(token);
          }
        });
      }
    });
  }

  // ── Auth Modal functions (work regardless of Firebase state) ──
  function openAuthModal(tab) {
    // Preserve property context before auth (Flow 3)
    if (typeof PropertyContext !== 'undefined') {
      PropertyContext.preserveForAuth();
    }
    var el = document.getElementById('authOverlay');
    if (el) el.classList.add('open');
    switchAuthTab(tab || 'login');
    clearAuthMessages();
  }

  function closeAuthModal() {
    var el = document.getElementById('authOverlay');
    if (el) el.classList.remove('open');
    clearAuthMessages();
  }

  function switchAuthTab(tab) {
    ['Login', 'Register', 'Forgot'].forEach(function(t) {
      var panel = document.getElementById('panel' + t);
      if (panel) panel.classList.remove('active');
    });
    var panelId = 'panel' + tab.charAt(0).toUpperCase() + tab.slice(1);
    var target = document.getElementById(panelId);
    if (target) target.classList.add('active');
    var tabLogin = document.getElementById('authTabLogin');
    var tabRegister = document.getElementById('authTabRegister');
    if (tabLogin) tabLogin.classList.toggle('active', tab === 'login');
    if (tabRegister) tabRegister.classList.toggle('active', tab === 'register');
    clearAuthMessages();
  }

  function showAuthError(msg) {
    var el = document.getElementById('authError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    var s = document.getElementById('authSuccess');
    if (s) s.style.display = 'none';
  }

  function showAuthSuccess(msg) {
    var el = document.getElementById('authSuccess');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    var e = document.getElementById('authError');
    if (e) e.style.display = 'none';
  }

  function clearAuthMessages() {
    var e = document.getElementById('authError');
    var s = document.getElementById('authSuccess');
    if (e) e.style.display = 'none';
    if (s) s.style.display = 'none';
  }

  function setAuthLoading(btnId, loading) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
  }

  function _requireFirebase() {
    if (!_firebaseReady) {
      showAuthError('Servicio de autenticación no disponible. Recarga la página.');
      return false;
    }
    return true;
  }

  function signInWithGoogle() {
    if (!_requireFirebase()) return;
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
      .then(function() { closeAuthModal(); })
      .catch(function(e) { showAuthError(friendlyError(e.code)); });
  }

  function signInWithEmail() {
    if (!_requireFirebase()) return;
    var email = document.getElementById('loginEmail').value.trim();
    var pass = document.getElementById('loginPassword').value;
    if (!email || !pass) return showAuthError('Completa todos los campos.');
    setAuthLoading('loginBtn', true);
    auth.signInWithEmailAndPassword(email, pass)
      .then(function() { closeAuthModal(); })
      .catch(function(e) { showAuthError(friendlyError(e.code)); })
      .finally(function() { setAuthLoading('loginBtn', false); });
  }

  function registerWithEmail() {
    if (!_requireFirebase()) return;
    var name = document.getElementById('registerName').value.trim();
    var email = document.getElementById('registerEmail').value.trim();
    var pass = document.getElementById('registerPassword').value;
    var pass2 = document.getElementById('registerPassword2').value;
    if (!name || !email || !pass) return showAuthError('Completa todos los campos.');
    if (pass !== pass2) return showAuthError('Las contraseñas no coinciden.');
    if (pass.length < 8) return showAuthError('La contraseña debe tener al menos 8 caracteres.');
    setAuthLoading('registerBtn', true);
    var createdUser = null;
    auth.createUserWithEmailAndPassword(email, pass)
      .then(function(cred) {
        createdUser = cred.user;
        return cred.user.updateProfile({ displayName: name });
      })
      .then(function() {
        if (createdUser && typeof createdUser.sendEmailVerification === 'function') {
          return createdUser.sendEmailVerification().catch(function(err) {
            console.warn('[RecoFirebase] sendEmailVerification failed:', err && err.message);
          });
        }
      })
      .then(function() { closeAuthModal(); })
      .catch(function(e) { showAuthError(friendlyError(e.code)); })
      .finally(function() { setAuthLoading('registerBtn', false); });
  }

  function sendPasswordReset() {
    if (!_requireFirebase()) return;
    var email = document.getElementById('forgotEmail').value.trim();
    if (!email) return showAuthError('Ingresa tu email.');
    setAuthLoading('forgotBtn', true);
    auth.sendPasswordResetEmail(email)
      .catch(function(e) { if (e.code !== 'auth/user-not-found') throw e; })
      .then(function() { showAuthSuccess('Si el email está registrado, te enviamos un enlace para restablecer tu contraseña.'); })
      .catch(function(e) { showAuthError(friendlyError(e.code)); })
      .finally(function() { setAuthLoading('forgotBtn', false); });
  }

  function friendlyError(code) {
    var map = {
      'auth/user-not-found':         'Email o contraseña incorrectos.',
      'auth/wrong-password':         'Email o contraseña incorrectos.',
      'auth/invalid-credential':     'Email o contraseña incorrectos.',
      'auth/email-already-in-use':   'No se pudo crear la cuenta. Si ya tienes una, inicia sesión.',
      'auth/invalid-email':          'El email no es válido.',
      'auth/weak-password':          'La contraseña es muy débil (mínimo 8 caracteres).',
      'auth/too-many-requests':      'Demasiados intentos. Intenta más tarde.',
      'auth/popup-closed-by-user':   'Cerraste la ventana de Google.',
      'auth/network-request-failed': 'Error de conexión. Verifica tu internet.',
      'auth/requires-recent-login':  'Por seguridad, confirma tu contraseña actual para continuar.'
    };
    return map[code] || 'Ocurrió un error. Intenta de nuevo.';
  }

  function signOut() {
    if (auth) auth.signOut();
  }

  function toggleUserDropdown(btn) {
    var wrap = btn.closest('.user-wrap');
    if (wrap) wrap.classList.toggle('open');
  }

  // Close dropdown on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.user-wrap')) {
      var openDropdowns = document.querySelectorAll('.user-wrap.open');
      for (var i = 0; i < openDropdowns.length; i++) {
        openDropdowns[i].classList.remove('open');
      }
    }
  });

  // ── Public API ────────────────────────────────────────────
  return {
    auth: auth,
    getFunctions: getFunctions,
    isReady: isReady,
    openAuthModal: openAuthModal,
    closeAuthModal: closeAuthModal,
    switchAuthTab: switchAuthTab,
    signInWithGoogle: signInWithGoogle,
    signInWithEmail: signInWithEmail,
    registerWithEmail: registerWithEmail,
    sendPasswordReset: sendPasswordReset,
    signOut: signOut,
    toggleUserDropdown: toggleUserDropdown
  };
})();

// Global shortcuts for onclick handlers in HTML
function openAuthModal(tab) { RecoFirebase.openAuthModal(tab); }
function closeAuthModal() { RecoFirebase.closeAuthModal(); }
function switchAuthTab(tab) { RecoFirebase.switchAuthTab(tab); }
function signInWithGoogle() { RecoFirebase.signInWithGoogle(); }
function signInWithEmail() { RecoFirebase.signInWithEmail(); }
function registerWithEmail() { RecoFirebase.registerWithEmail(); }
function sendPasswordReset() { RecoFirebase.sendPasswordReset(); }
