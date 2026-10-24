// Stubs compartidos por los tests de navegador que no pueden salir a la red
// (el sandbox de CI no siempre llega a gstatic ni a cdnjs).
const path = require('path');

// `firebase` falso mínimo para que el script de la app cargue; Auth y los
// callables se reemplazan en cada test.
const FIREBASE_STUB = `
(function(){
  const noop = () => {};
  const p = (v) => Promise.resolve(v);
  const snap = { exists: false, data: () => ({}), docs: [], empty: true, size: 0, forEach: noop };
  function ref(){
    const r = {
      collection: () => ref(), doc: () => ref(), where: () => r, orderBy: () => r, limit: () => r,
      get: () => p(snap), set: () => p(), update: () => p(), add: () => p(ref()), delete: () => p(),
      onSnapshot: () => noop, count: () => ({ get: () => p({ data: () => ({ count: 0 }) }) }),
    };
    return r;
  }
  const authObj = { currentUser: null, onAuthStateChanged: () => noop, signOut: () => p(),
    signInWithEmailAndPassword: () => p(), signInWithPopup: () => p(), createUserWithEmailAndPassword: () => p() };
  const fsFn = () => Object.assign(ref(), { batch: () => ({ set: noop, update: noop, delete: noop, commit: () => p() }) });
  fsFn.FieldValue = { serverTimestamp: () => 'ts', delete: () => 'del', arrayUnion: () => [], increment: () => 0 };
  fsFn.Timestamp = { fromMillis: (ms) => ({ ms }) };
  const authFn = () => authObj;
  authFn.GoogleAuthProvider = function(){}; authFn.EmailAuthProvider = { credential: noop };
  const fnsObj = { httpsCallable: () => () => p({ data: {} }) };
  window.firebase = {
    initializeApp: noop,
    app: () => ({ functions: () => fnsObj }),
    auth: authFn, firestore: fsFn,
    storage: () => ({ ref: () => ({ child: () => ({}) }) }),
    functions: () => fnsObj,
  };
})();`;

const NM = path.resolve(__dirname, '..', '..', 'node_modules');
// Mismas versiones que index.html carga desde cdnjs (devDependencies).
const CDN_LOCAL = {
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js': `${NM}/pdfjs-dist/build/pdf.min.js`,
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js': `${NM}/pdfjs-dist/build/pdf.worker.min.js`,
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js': `${NM}/jszip/dist/jszip.min.js`,
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': `${NM}/xlsx/dist/xlsx.full.min.js`,
};

async function routeStubs(page) {
  await page.route(/gstatic\.com\/firebasejs\//, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: route.request().url().includes('firebase-app-compat') ? FIREBASE_STUB : '',
  }));
  for (const [url, file] of Object.entries(CDN_LOCAL)) {
    await page.route(url, (route) => route.fulfill({
      path: file, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' },
    }));
  }
}

module.exports = { FIREBASE_STUB, routeStubs };
