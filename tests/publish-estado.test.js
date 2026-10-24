/**
 * publishProperty: valores estándar (shared/catalogo.js). "En planos" = "En
 * proyecto", y En proyecto / En construcción se guardan con antigüedad 0.
 * Ejecuta el handler REAL de functions/index.js con Firestore en memoria
 * (mismo enfoque que rate-limit-stress.test.js).
 */
const { test, expect } = require('@playwright/test');
const Module = require('module');
const path = require('path');

function loadPublish() {
  const store = {};
  let seq = 0;
  const ref = (name, id) => ({
    _key: `${name}/${id}`, id,
    get: () => Promise.resolve({ exists: !!store[`${name}/${id}`], data: () => store[`${name}/${id}`] }),
  });
  const db = {
    collection: (name) => ({ doc: (id) => ref(name, id || `auto${++seq}`) }),
    async runTransaction(fn) {
      const writes = [];
      const out = await fn({
        get: (r) => r.get(),
        set: (r, data) => writes.push(() => { store[r._key] = { ...data }; }),
      });
      writes.forEach((w) => w());
      return out;
    },
  };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const mocks = {
    'firebase-functions/v2/https': { onCall: (c, h) => ({ __handler: typeof c === 'function' ? c : h }), HttpsError },
    'firebase-functions/params': { defineSecret: (name) => ({ value: () => 'k', name }) },
    'firebase-functions/v2/firestore': { onDocumentWritten: () => ({}), onDocumentCreated: () => ({}) },
    'firebase-functions/v2/scheduler': { onSchedule: () => ({}) },
    'firebase-functions': { logger: { info() {}, warn() {}, error() {} } },
    'firebase-admin/app': { initializeApp() {} },
    'firebase-admin/auth': { getAuth: () => ({}) },
    'firebase-admin/firestore': { getFirestore: () => db, FieldValue: { serverTimestamp: () => 'TS' } },
  };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    return mocks[request] ? request : originalResolve.call(this, request, ...rest);
  };
  for (const [name, exp] of Object.entries(mocks)) {
    const m = new Module(name); m.exports = exp; m.loaded = true; require.cache[name] = m;
  }
  const functionsPath = path.resolve(__dirname, '..', 'functions', 'index.js');
  delete require.cache[functionsPath];
  let exp;
  try { exp = require(functionsPath); } finally {
    Module._resolveFilename = originalResolve;
    Object.keys(mocks).forEach((n) => delete require.cache[n]);
    delete require.cache[functionsPath];
  }
  return { publish: exp.publishProperty.__handler, store };
}

const req = (data) => ({
  auth: { uid: 'u1', token: { email_verified: true, email: 'a@b.pe' } }, app: { appId: 't' }, rawRequest: { headers: {} },
  data: { source: 'bulk', address: 'A 1', district: 'Lince', type: 'Departamento', op: 'Venta', currency: 'USD',
    price: 100000, area: 60, title: 't', desc: 'd', age: 7, ...data },
});

test.describe('publishProperty: estado y antigüedad', () => {
  const cases = [
    ['En planos', 'En proyecto', 0],
    ['En proyecto', 'En proyecto', 0],
    ['Preventa', 'En proyecto', 0],
    ['En construcción', 'En construcción', 0],
    ['E/C', 'En construcción', 0],
    ['Construido', 'Construido', 7],
    ['Bueno', 'Construido', 7],
  ];
  for (const [input, estado, age] of cases) {
    test(`"${input}" → ${estado}, antigüedad ${age}`, async () => {
      const { publish, store } = loadPublish();
      const { publicationId } = await publish(req({ estado: input }));
      const p = store[`publications/${publicationId}`];
      expect(p.estado).toBe(estado);
      expect(p.age).toBe(age);
    });
  }

  test('acepta sinónimos y abreviaturas de tipo, operación y moneda', async () => {
    const { publish, store } = loadPublish();
    const { publicationId } = await publish(req({ type: 'Dpto.', op: 'Vta.', currency: 'S/' }));
    const p = store[`publications/${publicationId}`];
    expect([p.type, p.op, p.currency]).toEqual(['Departamento', 'Venta', 'PEN']);
  });

  test('rechaza valores que no reconoce', async () => {
    const { publish } = loadPublish();
    await expect(publish(req({ type: 'Planeta' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(publish(req({ op: 'Anticresis' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(publish(req({ currency: 'EUR' }))).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
