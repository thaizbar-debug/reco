/**
 * Carga functions/index.js con Firebase simulado en memoria para ejecutar los
 * handlers REALES (callables, HTTP, triggers y tareas programadas).
 *
 *   const F = loadFunctions({ secrets: { NOMBRE: 'valor' } });
 *   await F.exports.importSources.__handler(F.req('u1', { action: 'list' }));
 *   F.db.store['publications/abc']  // documentos
 *   F.bucket.files['publications/…'] // archivos de Storage
 *
 * Firestore: doc/get/set (merge)/update/create/delete, where encadenado
 * (==, <=, <, >=, >), orderBy, limit, batch y runTransaction.
 */
const Module = require('module');
const path = require('path');

const STORAGE_MOCK_KEY = '__mock_firebase_admin_storage__';

const cmpVal = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);
function createMockFirestore() {
  const store = {};
  let seq = 0;
  const snapOf = (name, id) => {
    const key = `${name}/${id}`;
    const r = ref(name, id);
    return { id, ref: r, exists: !!store[key], data: () => (store[key] ? { ...store[key] } : undefined) };
  };
  function ref(name, id) {
    const key = `${name}/${id}`;
    return {
      _key: key, id,
      get() { return Promise.resolve(snapOf(name, id)); },
      set(data, opts) { store[key] = opts && opts.merge ? { ...store[key], ...data } : { ...data }; return Promise.resolve(); },
      update(fields) {
        if (!store[key]) return Promise.reject(Object.assign(new Error('5 NOT_FOUND'), { code: 5 }));
        store[key] = { ...store[key], ...fields }; return Promise.resolve();
      },
      create(data) {
        if (store[key]) return Promise.reject(Object.assign(new Error('6 ALREADY_EXISTS: Document already exists'), { code: 6 }));
        store[key] = { ...data }; return Promise.resolve();
      },
      delete() { delete store[key]; return Promise.resolve(); },
    };
  }
  function query(name, filters, order, lim) {
    return {
      where(f, op, v) { return query(name, filters.concat([[f, op, v]]), order, lim); },
      orderBy(f) { return query(name, filters, f, lim); },
      limit(n) { return query(name, filters, order, n); },
      get() {
        let ids = Object.keys(store).filter((k) => k.startsWith(`${name}/`) && !k.slice(name.length + 1).includes('/'))
          .map((k) => k.slice(name.length + 1))
          .filter((id) => filters.every(([f, op, v]) => {
            const a = cmpVal(store[`${name}/${id}`][f]), b = cmpVal(v);
            if (op === '==') return a === b;
            if (a == null) return false;
            return op === '<=' ? a <= b : op === '<' ? a < b : op === '>=' ? a >= b : op === '>' ? a > b : false;
          }));
        if (order) ids.sort((x, y) => cmpVal(store[`${name}/${x}`][order]) - cmpVal(store[`${name}/${y}`][order]));
        if (lim) ids = ids.slice(0, lim);
        const docs = ids.map((id) => snapOf(name, id));
        return Promise.resolve({ docs, empty: !docs.length, size: docs.length });
      },
    };
  }
  return {
    store,
    collection(name) {
      const q = query(name, [], null, 0);
      return { doc(id) { return ref(name, id || `auto${String(++seq).padStart(4, '0')}`); }, where: q.where, orderBy: q.orderBy, get: q.get };
    },
    batch() {
      const ops = [];
      return {
        set(r, data, opts) { ops.push(() => r.set(data, opts)); },
        update(r, fields) { ops.push(() => r.update(fields)); },
        delete(r) { ops.push(() => r.delete()); },
        create(r, data) { ops.push(() => r.create(data)); },
        async commit() { for (const op of ops) await op(); },
      };
    },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get(r) { return r.get(); },
        set(r, data, opts) { writes.push(() => r.set(data, opts)); },
        update(r, fields) { writes.push(() => r.update(fields)); },
        delete(r) { writes.push(() => r.delete()); },
        create(r, data) { writes.push(() => r.create(data)); },
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  };
}

function createMockBucket() {
  return {
    name: 'reco-test.appspot.com',
    files: {},
    file(p) {
      const b = this;
      return {
        bucket: b, _path: p,
        save(buf, opts) { b.files[p] = { buf, opts }; return Promise.resolve(); },
        copy(dest, opts) {
          if (!b.files[p]) return Promise.reject(new Error('No such object: ' + p));
          b.files[dest._path] = { ...b.files[p], opts }; return Promise.resolve();
        },
        download() { return b.files[p] ? Promise.resolve([b.files[p].buf]) : Promise.reject(new Error('No such object: ' + p)); },
      };
    },
  };
}

class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const handlerOf = (configOrHandler, maybeHandler) => ({ __handler: typeof configOrHandler === 'function' ? configOrHandler : maybeHandler });

// Storage se pide dentro de las funciones (no al cargar): la resolución queda
// interceptada y getStorage() devuelve el bucket de la última carga.
function installStorageMock() {
  if (require.cache[STORAGE_MOCK_KEY]) return;
  const sm = new Module(STORAGE_MOCK_KEY); sm.loaded = true;
  sm.exports = { getStorage: () => ({ bucket: () => global.__recoMockBucket }) };
  require.cache[STORAGE_MOCK_KEY] = sm;
  const prev = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'firebase-admin/storage') return STORAGE_MOCK_KEY;
    return prev.call(this, request, ...rest);
  };
}

function loadFunctions(opts) {
  const secrets = (opts && opts.secrets) || {};
  const db = createMockFirestore();
  const bucket = createMockBucket();
  const authUsers = (opts && opts.authUsers) || {};
  global.__recoMockBucket = bucket;
  installStorageMock();
  const mocks = {
    'firebase-functions/v2/https': { onCall: handlerOf, onRequest: handlerOf, HttpsError },
    'firebase-functions/params': {
      defineSecret(name) { return { value: () => (secrets[name] != null ? secrets[name] : 'fake-key'), name }; },
      defineString(name) { return { value: () => (secrets[name] != null ? secrets[name] : ''), name }; },
    },
    'firebase-functions/v2/firestore': { onDocumentWritten: handlerOf, onDocumentCreated: handlerOf },
    'firebase-functions/v2/scheduler': { onSchedule: handlerOf },
    'firebase-functions': { logger: { info() {}, warn() {}, error() {} } },
    'firebase-admin/app': { initializeApp() {} },
    'firebase-admin/auth': { getAuth() { return { getUser: async (uid) => authUsers[uid] || { uid } }; } },
    'firebase-admin/firestore': {
      getFirestore() { return db; },
      FieldValue: { serverTimestamp() { return 'SERVER_TS'; }, increment(n) { return n; } },
      Timestamp: { fromMillis(ms) { return { ms, toMillis: () => ms }; } },
    },
  };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (mocks[request]) return request;
    return originalResolve.call(this, request, parent, ...rest);
  };
  for (const [name, exp] of Object.entries(mocks)) {
    const m = new Module(name); m.exports = exp; m.loaded = true; require.cache[name] = m;
  }
  const functionsPath = path.resolve(__dirname, '..', '..', 'functions', 'index.js');
  delete require.cache[functionsPath];
  let exp;
  try { exp = require(functionsPath); } finally {
    Module._resolveFilename = originalResolve;
    Object.keys(mocks).forEach((n) => delete require.cache[n]);
    delete require.cache[functionsPath];
  }
  return { exports: exp, db, bucket, HttpsError };
}

// Pedido a un callable con usuario verificado.
const req = (uid, data, email) => ({ auth: { uid, token: { email_verified: true, email: email || `${uid}@test.pe` } }, app: { appId: 't' }, data, rawRequest: { headers: {} } });

// Pedido / respuesta HTTP (onRequest).
function httpReq({ method, path: p, headers, body, query }) {
  const h = {};
  Object.entries(headers || {}).forEach(([k, v]) => { h[k.toLowerCase()] = v; });
  const raw = body != null ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : Buffer.alloc(0);
  return { method: method || 'GET', path: p || '/', query: query || {}, headers: h, get: (k) => h[String(k).toLowerCase()],
    body: typeof body === 'string' ? body : body, rawBody: raw };
}
function httpRes() {
  return {
    statusCode: 0, body: undefined, headers: {},
    status(c) { this.statusCode = c; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
}

// fetch simulado por URL: rutas = [[regex | string, (url, init) => Response | objeto]].
function mockFetch(routes) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    for (const [pat, fn] of routes) {
      if (typeof pat === 'string' ? String(url).startsWith(pat) : pat.test(String(url))) {
        const r = await fn(String(url), init || {});
        return r instanceof Response ? r : new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('not found', { status: 404 });
  };
  return calls;
}
const jpeg = (n, seed) => new Response(Buffer.alloc(n || 9000, seed || 7), { status: 200, headers: { 'content-type': 'image/jpeg' } });

module.exports = { loadFunctions, createMockFirestore, req, httpReq, httpRes, mockFetch, jpeg, STORAGE_MOCK_KEY };
