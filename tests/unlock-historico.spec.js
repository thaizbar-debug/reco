// Flujos de desbloqueo de históricos. Firebase Auth y los callables se
// simulan en el navegador: lo que se prueba es la orquestación del
// cliente (login → reanudar, sin llaves → comprar → reanudar, reintento
// ante errores de transporte, token con email sin verificar).
const { test, expect } = require('@playwright/test');

// El sandbox de CI no siempre llega a gstatic: se sirve un `firebase`
// falso mínimo para que el script de la
// app cargue; Auth y los callables se reemplazan en setup().
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
  const fsFn = () => ref();
  fsFn.FieldValue = { serverTimestamp: () => 'ts', delete: () => 'del', arrayUnion: () => [], increment: () => 0 };
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

async function setup(page) {
  await page.route(/gstatic\.com\/firebasejs\//, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: route.request().url().includes('firebase-app-compat') ? FIREBASE_STUB : '',
  }));
  await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof properties !== 'undefined'
    && properties.some(p => p.op === 'Histórico'), null, { timeout: 20000 });
  return page.evaluate(() => {
    const p = properties.find(x => x.op === 'Histórico');
    window.__user = null;
    Object.defineProperty(auth, 'currentUser', { configurable: true, get: () => window.__user });
    window.__calls = [];
    window.__responders = {}; // name -> array of (data) => result | throws
    window._getFunctions = () => ({
      httpsCallable: (name) => async (data) => {
        window.__calls.push(name);
        const q = window.__responders[name] || [];
        const fn = q.length > 1 ? q.shift() : q[0];
        if (!fn) return { data: {} };
        return { data: await fn(data) };
      },
    });
    window.__err = (code, message, details) => Object.assign(new Error(message), { code: 'functions/' + code, details });
    window.__login = () => {
      window.__user = {
        uid: 'u1', email: 'a@b.c', emailVerified: true,
        reload: async () => {}, getIdToken: async () => 't',
      };
    };
    window.fetchHistDetail = async (pid) => { const q = properties.find(x => x.id === pid); if (q) q._detailLoaded = true; return q; };
    window.__ok = (already) => () => ({ premium: { owner: 'X' }, keysLeft: 2, alreadyUnlocked: !!already });
    return p.id;
  });
}

test.describe('Desbloqueo de históricos', () => {
  test('sin sesión → login → se reanuda aunque el modal se cierre antes del listener', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate((id) => {
      window.__responders.unlockProperty = [window.__ok(false)];
      openDetail(id);
      unlockAndOpen(id);
    }, id);
    await expect(page.locator('#authOverlay')).toHaveClass(/open/);
    await page.evaluate(() => {
      window.__login();
      // .then() del sign-in corre primero, luego onAuthStateChanged
      _hideAuthModalAfterLogin();
      _runPendingAuthAction();
    });
    await page.waitForFunction((id) => S.unlockedIds.has(id), id);
    expect(await page.evaluate(() => window.__calls.filter(c => c === 'unlockProperty').length)).toBe(1);
    expect(await page.evaluate(() => !!document.querySelector('.detail-gate'))).toBe(false);
  });

  test('error "internal" transitorio → reintenta y abre', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate((id) => {
      window.__login();
      window.__responders.unlockProperty = [
        () => { throw window.__err('internal', 'internal'); },
        window.__ok(false),
      ];
      openDetail(id);
      return unlockAndOpen(id);
    }, id);
    expect(await page.evaluate((id) => S.unlockedIds.has(id), id)).toBe(true);
    expect(await page.evaluate(() => window.__calls.filter(c => c === 'unlockProperty').length)).toBe(2);
  });

  test('token con email sin verificar → refresca token y abre (no manda a comprar)', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate((id) => {
      window.__login();
      window.__responders.unlockProperty = [
        () => { throw window.__err('failed-precondition', 'Verificá tu email antes de continuar.', { reason: 'email_not_verified' }); },
        window.__ok(false),
      ];
      openDetail(id);
      return unlockAndOpen(id);
    }, id);
    expect(await page.evaluate((id) => S.unlockedIds.has(id), id)).toBe(true);
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('sin llaves → modal de compra → pago → se desbloquea y abre', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate((id) => {
      window.__login();
      window.__responders.unlockProperty = [
        () => { throw window.__err('failed-precondition', 'Sin llaves suficientes.', { reason: 'no_keys' }); },
        window.__ok(false),
      ];
      openDetail(id);
      return unlockAndOpen(id);
    }, id);
    await expect(page.locator('#modal')).toHaveClass(/open/);
    expect(await page.evaluate(() => S.pendingUnlockId)).toBe(id);
    await page.evaluate(() => {
      window.__responders.chargeWithCulqi = [() => ({ keysLeft: 5 })];
      return _processPayment({ tokenId: 'tok' });
    });
    await page.waitForFunction((id) => S.unlockedIds.has(id), id);
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('ya desbloqueado en el servidor → abre sin descontar ni registrar uso', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate((id) => {
      window.__login();
      window.__responders.unlockProperty = [window.__ok(true)];
      openDetail(id);
      return unlockAndOpen(id);
    }, id);
    expect(await page.evaluate((id) => S.unlockedIds.has(id), id)).toBe(true);
    expect(await page.evaluate(() => {
      const h = typeof _getKeyHistory === 'function' ? _getKeyHistory() : [];
      return (h || []).filter(x => x.type === 'use').length;
    })).toBe(0);
  });
});
