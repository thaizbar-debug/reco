/**
 * Fase 0 del roadmap de carga inteligente — ejecuta los handlers REALES de
 * extractListings y publishProperty (functions/index.js) con Firestore en
 * memoria y la API de OpenAI simulada (global.fetch), igual que
 * rate-limit-stress.test.js.
 */
const { test, expect } = require('@playwright/test');
const Module = require('module');
const path = require('path');
const STORAGE_MOCK_KEY = '__mock_firebase_admin_storage__';

function createMockFirestore() {
  const store = {};
  let seq = 0;
  const ref = (name, id) => ({
    _key: `${name}/${id}`,
    id,
    get() {
      const key = `${name}/${id}`;
      return Promise.resolve({ id, exists: !!store[key], data: () => (store[key] ? { ...store[key] } : undefined) });
    },
    set(data) { store[`${name}/${id}`] = { ...data }; return Promise.resolve(); },
    update(fields) { store[`${name}/${id}`] = { ...store[`${name}/${id}`], ...fields }; return Promise.resolve(); },
    create(data) {
      const key = `${name}/${id}`;
      if (store[key]) return Promise.reject(Object.assign(new Error('6 ALREADY_EXISTS: Document already exists'), { code: 6 }));
      store[key] = { ...data };
      return Promise.resolve();
    },
  });
  // where('campo', '==', valor) sobre los documentos de una colección.
  const query = (name, field, value) => ({
    get() {
      const docs = Object.keys(store).filter((k) => k.startsWith(`${name}/`) && store[k][field] === value)
        .map((k) => { const r = ref(name, k.slice(name.length + 1)); return { id: r.id, ref: r, data: () => ({ ...store[k] }) }; });
      return Promise.resolve({ docs, empty: !docs.length, size: docs.length });
    },
  });
  return {
    store,
    collection(name) {
      return { doc(id) { return ref(name, id || `auto${++seq}`); }, where(f, op, v) { return query(name, f, v); } };
    },
    batch() {
      const ops = [];
      return {
        set(r, data) { ops.push(() => { store[r._key] = { ...data }; }); },
        update(r, fields) { ops.push(() => { store[r._key] = { ...store[r._key], ...fields }; }); },
        delete(r) { ops.push(() => { delete store[r._key]; }); },
        commit() { ops.forEach((op) => op()); return Promise.resolve(); },
      };
    },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get(r) { return r.get(); },
        set(r, data, opts) { writes.push(() => { store[r._key] = opts && opts.merge ? { ...store[r._key], ...data } : { ...data }; }); },
        update(r, fields) { writes.push(() => { store[r._key] = { ...store[r._key], ...fields }; }); },
        delete(r) { writes.push(() => { delete store[r._key]; }); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    },
  };
}

function loadHandlers() {
  const mockDb = createMockFirestore();
  class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
  const mocks = {
    'firebase-functions/v2/https': {
      onCall: handlerOf,
      onRequest: handlerOf,
      HttpsError,
    },
    'firebase-functions/params': {
      defineSecret(name) { return { value: () => (SECRETS[name] != null ? SECRETS[name] : 'fake-key'), name }; },
      defineString(name) { return { value: () => (SECRETS[name] != null ? SECRETS[name] : ''), name }; },
    },
    'firebase-functions/v2/firestore': { onDocumentWritten: () => ({}), onDocumentCreated: handlerOf },
    'firebase-functions/v2/scheduler': { onSchedule: () => ({}) },
    'firebase-functions': { logger: { info() {}, warn() {}, error() {} } },
    'firebase-admin/app': { initializeApp() {} },
    'firebase-admin/auth': { getAuth() { return {}; } },
    'firebase-admin/firestore': {
      getFirestore() { return mockDb; },
      FieldValue: { serverTimestamp() { return 'SERVER_TS'; }, increment(n) { return n; } },
      Timestamp: { fromMillis(ms) { return { ms, toMillis: () => ms }; } },
    },
  };
  // firebase-admin/storage se pide dentro de las funciones (no al cargar), así que
  // su resolución queda interceptada siempre (en CI no existe functions/node_modules).
  global.__recoMockBucket = mockBucket;
  if (!require.cache[STORAGE_MOCK_KEY]) {
    const sm = new Module(STORAGE_MOCK_KEY); sm.loaded = true;
    // Mismo módulo que tests/helpers/mock-functions.js: el bucket de la última carga.
    sm.exports = { getStorage: () => ({ bucket: () => global.__recoMockBucket }) };
    require.cache[STORAGE_MOCK_KEY] = sm;
    const prevResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === 'firebase-admin/storage') return STORAGE_MOCK_KEY;
      return prevResolve.call(this, request, ...rest);
    };
  }
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (mocks[request]) return request;
    return originalResolve.call(this, request, parent, ...rest);
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
  return {
    extract: exp.extractListings.__handler,
    publish: exp.publishProperty.__handler,
    mapColumns: exp.mapImportColumns.__handler,
    importPage: exp.importListingPage.__handler,
    waLink: exp.whatsappLink.__handler,
    waWebhook: exp.whatsappWebhook.__handler,
    waProcess: exp.whatsappProcessMessage.__handler,
    db: mockDb,
    bucket: mockBucket,
  };
}
const handlerOf = (configOrHandler, maybeHandler) => ({ __handler: typeof configOrHandler === 'function' ? configOrHandler : maybeHandler });
// Secretos/parámetros por nombre (el resto: 'fake-key' / '').
const SECRETS = { WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_VERIFY_TOKEN: 'verify-123', WHATSAPP_PHONE_NUMBER_ID: '111222' };
// Bucket de Storage en memoria: save / copy.
const mockBucket = {
  name: 'reco-test.appspot.com',
  files: {},
  file(p) {
    const b = this;
    return {
      bucket: b,
      save(buf, opts) { b.files[p] = { buf, opts }; return Promise.resolve(); },
      copy(dest, opts) {
        if (!b.files[p]) return Promise.reject(new Error('No such object: ' + p));
        b.files[dest._path] = { ...b.files[p], opts }; return Promise.resolve();
      },
      _path: p,
    };
  },
};

const req = (uid, data) => ({ auth: { uid, token: { email_verified: true, email: 'a@b.pe' } }, app: { appId: 't' }, data, rawRequest: { headers: {} } });

function mockOpenAI(payload) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) };
  };
  return calls;
}

function aiItem(over) {
  const R = require('../functions/shared/import-core');
  const it = {};
  R.AI_FIELDS.forEach((k) => { it[k] = null; });
  return Object.assign(it, { campos_inferidos: [] }, over);
}

const SOURCE_TEXT = `Vendo depa en Surco, 3 dormitorios, 2 baños, 90 m2, US$ 185 mil. Cel 987654321
Alquilo casa en La Molina 250m2 a S/ 6,500 mensual`;

test.describe('Fase 0: extractListings + publishProperty (handlers reales)', () => {
  let originalFetch;
  test.beforeEach(() => { originalFetch = global.fetch; });
  test.afterEach(() => { global.fetch = originalFetch; });

  test('extrae, normaliza, descarta números inventados y guarda borradores', async () => {
    const { extract, db } = loadHandlers();
    const calls = mockOpenAI({ inmuebles: [
      aiItem({ distrito: 'Surco', tipo_publicacion: 'Venta', tipo_propiedad: 'depa', nro_dormitorios: '3', nro_banos: '2',
        nro_estacionamientos: '1', area_techada: '90 m2', precio: 'US$ 185 mil', titulo: 'Depa en Surco',
        descripcion: 'Vendo depa en Surco, 3 dormitorios. Cel 987654321', campos_inferidos: ['titulo', 'precio_x'] }),
      aiItem({ distrito: 'La Molina', tipo_publicacion: 'Alquiler', tipo_propiedad: 'casa', area_techada: '250',
        precio: 'S/ 6,500', titulo: 'Casa en La Molina', descripcion: 'Alquilo casa en La Molina' }),
    ] });

    const res = await extract(req('u1', { kind: 'text', text: SOURCE_TEXT, channel: 'whatsapp' }));

    // Salida estructurada estricta con el esquema compartido
    expect(calls[0].response_format.type).toBe('json_schema');
    expect(calls[0].response_format.json_schema.strict).toBe(true);
    expect(calls[0].temperature).toBe(0);

    expect(res.drafts).toHaveLength(2);
    const [a, b] = res.drafts;
    expect(a.row.distrito).toBe('Santiago de Surco');
    expect(a.row.tipo_propiedad).toBe('Departamento');
    expect(a.row.precio).toBe('185000');
    expect(a.row.tipo_moneda).toBe('USD');
    expect(a.row.area_techada).toBe('90');
    expect(a.row.nro_banos).toBe('2');
    expect(a.row.nro_estacionamientos).toBe(''); // "1" no está en el texto
    expect(a.notes.join(' ')).toContain('nro_estacionamientos');
    expect(a.row.descripcion).not.toContain('987654321');
    expect(a.inferredFields).toEqual(['titulo']); // ignora campos inexistentes
    expect(b.row.tipo_publicacion).toBe('Alquiler');
    expect(b.row.precio).toBe('6500');
    expect(b.row.tipo_moneda).toBe('PEN');

    const drafts = Object.entries(db.store).filter(([k]) => k.startsWith('importDrafts/'));
    expect(drafts).toHaveLength(2);
    const d0 = drafts[0][1];
    expect(d0.uid).toBe('u1');
    expect(d0.source).toBe('whatsapp');
    expect(d0.status).toBe('draft');
    expect(d0.batchId).toBe(res.batchId);
    expect(d0.expiresAt.ms).toBeGreaterThan(Date.now() + 29 * 864e5);
    expect(d0.fingerprint).toBe('santiago de surco|venta|departamento|90|185000|3');

    const events = Object.values(db.store).filter((v) => v.listings != null);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uid: 'u1', kind: 'text', channel: 'whatsapp', listings: 2 });
    expect(db.store['importUsage/u1'].count).toBe(1);
  });

  test('valida entrada: tipo no soportado, texto vacío y texto demasiado largo', async () => {
    const { extract } = loadHandlers();
    mockOpenAI({ inmuebles: [] });
    await expect(extract(req('u1', { kind: 'url', text: 'x' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(extract(req('u1', { kind: 'text', text: '   ' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(extract(req('u1', { kind: 'text', text: 'x'.repeat(20001) }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(extract({ data: { kind: 'text', text: 'x' } })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  test('rate limit: la llamada 31 de la hora se rechaza', async () => {
    const { extract, db } = loadHandlers();
    mockOpenAI({ inmuebles: [] });
    db.store['importUsage/u2'] = { hour: new Date().toISOString().slice(0, 13), count: 30 };
    await expect(extract(req('u2', { kind: 'text', text: 'depa' }))).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  test('error de OpenAI → internal, sin borradores', async () => {
    const { extract, db } = loadHandlers();
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) });
    await expect(extract(req('u3', { kind: 'text', text: 'depa' }))).rejects.toMatchObject({ code: 'internal' });
    expect(Object.keys(db.store).filter((k) => k.startsWith('importDrafts/'))).toHaveLength(0);
  });

  const pub = (over) => ({ source: 'bulk', address: 'Av. Pardo 500', district: 'Miraflores', type: 'Departamento', op: 'Venta',
    currency: 'USD', price: 185000, area: 90, beds: 3, title: 'Depa', desc: 'Desc', ...over });

  test('publishProperty borra el borrador propio en la misma transacción y guarda métricas', async () => {
    const { publish, db } = loadHandlers();
    db.store['importDrafts/dr1'] = { uid: 'u1', source: 'whatsapp', aiFields: ['precio', 'distrito', 'titulo'] };
    const res = await publish(req('u1', pub({ source: 'whatsapp', importDraftId: 'dr1', importEdits: 2 })));
    const p = db.store[`publications/${res.publicationId}`];
    expect(p.source).toBe('whatsapp');
    expect(p.importChannel).toBe('whatsapp');
    expect(p.importAiFields).toBe(3);
    expect(p.importEdits).toBe(2);
    expect(p.fingerprint).toBe('miraflores|venta|departamento|90|185000|3');
    expect(db.store['importDrafts/dr1']).toBeUndefined();
  });

  test('publishProperty no toca borradores ajenos ni ids inválidos', async () => {
    const { publish, db } = loadHandlers();
    db.store['importDrafts/dr2'] = { uid: 'otro', source: 'excel', aiFields: [] };
    const r1 = await publish(req('u1', pub({ importDraftId: 'dr2', importEdits: 5 })));
    expect(db.store['importDrafts/dr2']).toBeDefined();
    expect(db.store[`publications/${r1.publicationId}`].importChannel).toBeUndefined();
    const r2 = await publish(req('u1', pub({ importDraftId: '../users/u1' })));
    expect(db.store[`publications/${r2.publicationId}`].source).toBe('bulk');
    const r3 = await publish(req('u1', pub({ source: 'hack' })));
    expect(db.store[`publications/${r3.publicationId}`].source).toBe('single');
  });
});

// ── Documentos (PDF, Word, PowerPoint) ──
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(200);
const DOC_TEXT = `=== Página 1 ===
Dpto. en Miraflores - Vta. 3 dorm. Área techada 85 m2. Precio US$ 185,000. Vista al mar, gimnasio.
[FOTO p1-1] [FOTO p1-2]
=== Página 2 (escaneada, ver imagen) ===`;

test.describe('extractListings: documentos', () => {
  let originalFetch;
  test.beforeEach(() => { originalFetch = global.fetch; });
  test.afterEach(() => { global.fetch = originalFetch; });

  const docReq = (over) => req('u1', { kind: 'document', fileType: 'pdf', text: DOC_TEXT, photoIds: ['p1-1', 'p1-2'],
    images: [{ page: '2', dataUrl: IMG }], sourceName: 'inventario.pdf', ...over });

  test('envía texto + páginas escaneadas a la IA y devuelve las fotos de cada inmueble', async () => {
    const { extract, db } = loadHandlers();
    const calls = mockOpenAI({ inmuebles: [
      aiItem({ distrito: 'Miraflores', tipo_publicacion: 'Vta.', tipo_propiedad: 'Dpto.', nro_dormitorios: '3', area_techada: '85 m2',
        precio: 'US$ 185,000', titulo: 'Dpto. en Miraflores', descripcion: 'Dpto. en Miraflores',
        etiquetas_vista: 'vista al mar', etiquetas_ambientes: 'Gimnasio; Helipuerto',
        fotos: ['p1-1', 'p1-2', 'p9-9', 'p1-1'], evidencia: 'Precio US$ 185,000' }),
      // Solo está en la página escaneada: sus números vienen de la evidencia (transcripción).
      aiItem({ distrito: 'Lurín', tipo_publicacion: 'Venta', tipo_propiedad: 'Lote', area_terreno: '500 m2', precio: 'US$ 90,000',
        titulo: 'Terreno en Lurín', descripcion: 'Terreno', fotos: [], evidencia: 'TERRENO EN VENTA - LURIN Lote de 500 m2 Precio: US$ 90,000' }),
    ] });

    const res = await extract(docReq());

    const msg = calls[0].messages;
    expect(msg[0].content).toContain('etiquetas_vista: Vista a parque | Vista al mar');
    expect(msg[0].content).toContain('[FOTO id]');
    expect(Array.isArray(msg[1].content)).toBe(true);
    expect(msg[1].content[0]).toMatchObject({ type: 'text' });
    expect(msg[1].content[0].text).toContain('[FOTO p1-1]');
    expect(msg[1].content[1].text).toBe('Página escaneada 2:');
    expect(msg[1].content[2]).toEqual({ type: 'image_url', image_url: { url: IMG, detail: 'high' } });

    const [a, b] = res.drafts;
    expect(a.fotos).toEqual(['p1-1', 'p1-2']); // ids que no vinieron del documento se descartan
    expect([a.row.tipo_propiedad, a.row.tipo_publicacion, a.row.precio, a.row.area_techada]).toEqual(['Departamento', 'Venta', '185000', '85']);
    expect(a.row.etiquetas_vista).toBe('Vista al mar');
    expect(a.row.etiquetas_ambientes).toBe('Gimnasio;Helipuerto');
    expect([b.row.tipo_propiedad, b.row.area_terreno, b.row.precio]).toEqual(['Terreno', '500', '90000']);

    const drafts = Object.values(db.store).filter((v) => v.status === 'draft');
    expect(drafts.every((x) => x.source === 'documento' && x.fileType === 'pdf')).toBe(true);
    expect(drafts.map((x) => x.docPhotos)).toEqual([2, 0]);
    const ev = Object.values(db.store).find((v) => v.listings != null);
    expect(ev).toMatchObject({ kind: 'document', channel: 'documento', fileType: 'pdf', pageImages: 1, photos: 2 });
  });

  test('sin páginas escaneadas, la evidencia de la IA no alcanza para validar números', async () => {
    const { extract } = loadHandlers();
    mockOpenAI({ inmuebles: [aiItem({ tipo_propiedad: 'Casa', precio: '999000', area_techada: '85', evidencia: 'Precio 999000', fotos: [] })] });
    const res = await extract(docReq({ images: [] }));
    expect(res.drafts[0].row.precio).toBe('');
    expect(res.drafts[0].row.area_techada).toBe('85');
    expect(res.drafts[0].notes.join(' ')).toContain('no aparece en el documento');
  });

  test('las partes de un documento comparten batchId', async () => {
    const { extract } = loadHandlers();
    mockOpenAI({ inmuebles: [] });
    const r1 = await extract(docReq());
    const r2 = await extract(docReq({ batchId: r1.batchId }));
    const r3 = await extract(docReq({ batchId: '../x' }));
    expect(r2.batchId).toBe(r1.batchId);
    expect(r3.batchId).not.toBe('../x');
  });

  test('valida el documento: formato, imágenes y contenido', async () => {
    const { extract } = loadHandlers();
    mockOpenAI({ inmuebles: [] });
    const bad = (over) => expect(extract(docReq(over))).rejects.toMatchObject({ code: 'invalid-argument' });
    await bad({ fileType: 'doc' });
    await bad({ images: Array.from({ length: 7 }, (_, i) => ({ page: String(i), dataUrl: IMG })) });
    await bad({ images: [{ page: '1', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }] });
    await bad({ images: [{ page: '1', dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(1500001) }] });
    await bad({ text: '', images: [] });
    await bad({ text: 'x'.repeat(20001) });
    // Solo páginas escaneadas (sin texto) es válido.
    await expect(extract(docReq({ text: '' }))).resolves.toMatchObject({ drafts: [] });
  });
});

// ── Fase 1: mapImportColumns e importListingPage ──
const dns = require('dns');

// fetch simulado por URL: OpenAI, páginas y fotos. Devuelve Response reales
// (el servidor lee el cuerpo como stream).
function mockNet(routes, aiPayload) {
  const seen = [];
  global.fetch = async (url, init) => {
    seen.push(String(url));
    if (String(url).startsWith('https://api.openai.com/')) {
      seen.ai = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiPayload) } }] }), { status: 200 });
    }
    const r = routes[String(url)];
    if (!r) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return typeof r === 'function' ? r() : r;
  };
  return seen;
}
// DNS simulado: nombres públicos salvo los que apuntan a la red interna.
function mockDns(map) {
  const orig = dns.promises.lookup;
  dns.promises.lookup = async (host) => [{ address: (map || {})[host] || '93.184.216.34', family: 4 }];
  return () => { dns.promises.lookup = orig; };
}
const jpeg = (n) => new Response(Buffer.alloc(n, 7), { status: 200, headers: { 'content-type': 'image/jpeg' } });
const html = (body, status) => new Response(body, { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const AVISO = `<html><head><title>Departamento en venta en Miraflores | Urbania</title>
<meta property="og:image" content="https://img.urbania.pe/foto1.jpg">
<script type="application/ld+json">{"@type":"Residence","name":"Dpto 3 dorm","offers":{"price":"185000","priceCurrency":"USD"},"image":["https://img.urbania.pe/foto2.jpg"]}</script>
</head><body><h1>Departamento en venta</h1><p>Av. Larco 1150, Miraflores. 3 dormitorios, 85 m² techados. US$ 185,000. Llamar al 987654321</p>
<img src="https://img.urbania.pe/icono.png"></body></html>`;

test.describe('importListingPage', () => {
  let originalFetch, restoreDns;
  test.beforeEach(() => { originalFetch = global.fetch; });
  test.afterEach(() => { global.fetch = originalFetch; if (restoreDns) restoreDns(); restoreDns = null; });

  const ok = { declaraAutorizacion: true };

  test('portal conocido: lee JSON-LD y texto, descarga fotos y asigna todas al único inmueble', async () => {
    const { importPage, db } = loadHandlers();
    restoreDns = mockDns();
    const seen = mockNet({
      'https://urbania.pe/inmueble/dpto-123': html(AVISO),
      'https://img.urbania.pe/foto1.jpg': () => jpeg(20000),
      'https://img.urbania.pe/foto2.jpg': () => jpeg(30000),
    }, { inmuebles: [aiItem({ distrito: 'Miraflores', direccion: 'Av. Larco 1150', tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta',
      precio: 'US$ 185,000', area_techada: '85 m²', nro_dormitorios: '3', titulo: 'Dpto en Miraflores', descripcion: 'Llamar al 987654321', fotos: [], evidencia: null })] });

    const res = await importPage(req('u1', { ...ok, url: 'https://urbania.pe/inmueble/dpto-123' }));

    const user = seen.ai.messages[1].content;
    expect(user).toContain('URL: https://urbania.pe/inmueble/dpto-123');
    expect(user).toContain('"priceCurrency":"USD"');
    expect(user).toContain('Av. Larco 1150, Miraflores. 3 dormitorios, 85 m² techados');
    expect(user).toContain('[FOTO u-1] [FOTO u-2]');
    expect(seen).not.toContain('https://img.urbania.pe/icono.png'); // íconos: ni se descargan
    expect(res.photos.map((p) => p.id)).toEqual(['u-1', 'u-2']);
    expect(res.photos[0].dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    const [d] = res.drafts;
    expect(d.fotos).toEqual(['u-1', 'u-2']);
    expect([d.row.precio, d.row.area_techada, d.row.nro_dormitorios]).toEqual(['185000', '85', '3']);
    expect(d.row.descripcion).not.toContain('987654321');
    const draft = Object.values(db.store).find((v) => v.status === 'draft');
    expect(draft).toMatchObject({ source: 'url', sourceUrl: 'https://urbania.pe/inmueble/dpto-123', sourceName: 'urbania.pe/inmueble/dpto-123' });
    const ev = Object.values(db.store).find((v) => v.kind === 'url');
    expect(ev).toMatchObject({ channel: 'url', host: 'urbania.pe', viaMarcador: false, photos: 2 });
  });

  test('sin autorización o enlace inválido (cualquier web pública se acepta)', async () => {
    const { importPage } = loadHandlers();
    restoreDns = mockDns();
    mockNet({}, { inmuebles: [] });
    await expect(importPage(req('u1', { url: 'https://urbania.pe/x' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(importPage(req('u1', { ...ok, url: 'urbania.pe/x' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(importPage(req('u1', { ...ok, url: 'ftp://urbania.pe/x' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    // Otros sitios ya no se rechazan por dominio: se leen (aquí responden 404 → blocked).
    await expect(importPage(req('u1', { ...ok, url: 'https://otro-portal.pe/aviso' })))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'blocked' } });
  });

  test('portal que bloquea (403 o página de verificación) → reason blocked', async () => {
    const { importPage } = loadHandlers();
    restoreDns = mockDns();
    mockNet({
      'https://urbania.pe/a': html('Forbidden', 403),
      'https://www.adondevivir.com/b': html('<html><title>Just a moment...</title>cf-chl</html>'),
    }, { inmuebles: [] });
    await expect(importPage(req('u1', { ...ok, url: 'https://urbania.pe/a' }))).rejects.toMatchObject({ details: { reason: 'blocked' } });
    await expect(importPage(req('u1', { ...ok, url: 'https://www.adondevivir.com/b' }))).rejects.toMatchObject({ details: { reason: 'blocked' } });
  });

  test('SSRF: un portal que resuelve o redirige a la red interna se rechaza', async () => {
    const { importPage } = loadHandlers();
    restoreDns = mockDns({ 'urbania.pe': '10.0.0.5' });
    mockNet({}, { inmuebles: [] });
    await expect(importPage(req('u1', { ...ok, url: 'https://urbania.pe/x' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    restoreDns();
    restoreDns = mockDns();
    const seen = mockNet({
      'https://babilonia.pe/x': new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    }, { inmuebles: [] });
    await expect(importPage(req('u1', { ...ok, url: 'https://babilonia.pe/x' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(seen).not.toContain('http://169.254.169.254/latest/meta-data');
  });

  test('marcador: cualquier dominio; fotos a la red interna o chicas se omiten', async () => {
    const { importPage } = loadHandlers();
    restoreDns = mockDns({ 'intranet.local': '192.168.1.10' });
    const seen = mockNet({
      'https://cdn.portal-x.pe/a.jpg': () => jpeg(50000),
      'https://cdn.portal-x.pe/mini.jpg': () => jpeg(500),
    }, { inmuebles: [aiItem({ tipo_propiedad: 'Casa', precio: 'US$ 300 mil', area_techada: '200', fotos: ['u-1'], evidencia: null })] });
    const pagina = { title: 'Casa en venta', meta: { 'og:title': 'Casa' }, jsonld: [], text: 'Casa 200 m2 US$ 300 mil',
      images: ['http://127.0.0.1/x.jpg', 'https://intranet.local/y.jpg', 'https://cdn.portal-x.pe/mini.jpg', 'https://cdn.portal-x.pe/a.jpg', 'javascript:alert(1)'] };
    const res = await importPage(req('u1', { ...ok, url: 'https://portal-x.pe/aviso/9', pagina }));
    expect(seen).not.toContain('http://127.0.0.1/x.jpg');
    expect(seen).not.toContain('https://intranet.local/y.jpg');
    expect(seen).not.toContain('https://portal-x.pe/aviso/9'); // el servidor no descarga la página
    expect(res.photos.map((p) => p.id)).toEqual(['u-1']);
    expect(res.drafts[0].row.precio).toBe('300000');
  });
});

test.describe('mapImportColumns', () => {
  let originalFetch;
  test.beforeEach(() => { originalFetch = global.fetch; });
  test.afterEach(() => { global.fetch = originalFetch; });

  test('esquema con las columnas del archivo; descarta respuestas fuera de la lista', async () => {
    const { mapColumns, db } = loadHandlers();
    const seen = mockNet({}, { mapeo: { area_techada: 'Mts2 const.', descripcion: 'Comentario', precio: 'Columna inventada' } });
    const res = await mapColumns(req('u1', { headers: ['Ubicación', 'Mts2 const.', 'Comentario', 'Ubicación', ''], sample: [['Av. 1', '85', 'ok']] }));
    expect(res.mapeo).toEqual({ area_techada: 'Mts2 const.', descripcion: 'Comentario' });
    const schema = seen.ai.response_format.json_schema;
    expect(schema.strict).toBe(true);
    expect(schema.schema.properties.mapeo.properties.precio.anyOf[0].enum).toEqual(['Ubicación', 'Mts2 const.', 'Comentario']);
    expect(seen.ai.messages[1].content).toContain('["Av. 1","85","ok"]');
    expect(Object.values(db.store).find((v) => v.kind === 'columns')).toMatchObject({ headers: 3, mapped: 2 });
  });

  test('pocas columnas → invalid-argument; comparte el límite por hora', async () => {
    const { mapColumns, db } = loadHandlers();
    mockNet({}, { mapeo: {} });
    await expect(mapColumns(req('u1', { headers: ['solo'] }))).rejects.toMatchObject({ code: 'invalid-argument' });
    db.store['importUsage/u9'] = { hour: new Date().toISOString().slice(0, 13), count: 30 };
    await expect(mapColumns(req('u9', { headers: ['a', 'b'] }))).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});

// ── Fase 2: bot de WhatsApp ──
const crypto = require('crypto');
const PHONE = '51987654321';
const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', SECRETS.WHATSAPP_APP_SECRET).update(raw).digest('hex');
const mkRes = () => ({ statusCode: 0, body: '', status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; } });
const webhookReq = (payload, signature) => {
  const raw = Buffer.from(JSON.stringify(payload));
  return { method: 'POST', query: {}, rawBody: raw, body: payload, get: (h) => (h === 'x-hub-signature-256' ? (signature === undefined ? sign(raw) : signature) : undefined) };
};
const waMsg = (id, extra) => ({ id, from: PHONE, ts: 1761332700 + Number(String(id).replace(/\D/g, '') || 0), type: 'text', ...extra });
const event = (msg) => ({ data: { data: () => msg } });

// Red simulada: Graph API (envíos y media), descarga de media, OpenAI.
function mockWaNet(aiPayload) {
  const sent = [];
  const seen = { sent, ai: null, transcriptions: 0 };
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u === 'https://graph.facebook.com/v21.0/111222/messages') { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
    if (u === 'https://graph.facebook.com/v21.0/MEDIA_IMG') return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/img', mime_type: 'image/jpeg', file_size: 30000 }), { status: 200 });
    if (u === 'https://graph.facebook.com/v21.0/MEDIA_AUD') return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/aud', mime_type: 'audio/ogg; codecs=opus' }), { status: 200 });
    if (u === 'https://lookaside.fbsbx.com/img') return new Response(Buffer.alloc(30000, 1), { status: 200 });
    if (u === 'https://lookaside.fbsbx.com/aud') return new Response(Buffer.alloc(5000, 2), { status: 200 });
    if (u === 'https://api.openai.com/v1/audio/transcriptions') { seen.transcriptions++; return new Response(JSON.stringify({ text: 'tiene dos dormitorios y cochera' }), { status: 200 }); }
    if (u === 'https://api.openai.com/v1/chat/completions') {
      seen.ai = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiPayload || { inmuebles: [] }) } }] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return seen;
}

test.describe('Bot de WhatsApp', () => {
  let originalFetch;
  test.beforeEach(() => { originalFetch = global.fetch; mockBucket.files = {}; });
  test.afterEach(() => { global.fetch = originalFetch; });

  test('webhook: verificación de Meta (GET)', async () => {
    const { waWebhook } = loadHandlers();
    const ok = mkRes();
    await waWebhook({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-123', 'hub.challenge': 'CH4LL' } }, ok);
    expect([ok.statusCode, ok.body]).toEqual([200, 'CH4LL']);
    const bad = mkRes();
    await waWebhook({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': 'x' } }, bad);
    expect(bad.statusCode).toBe(403);
  });

  test('webhook: firma obligatoria y mensajes guardados una sola vez', async () => {
    const { waWebhook, db } = loadHandlers();
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: 'wamid.A', from: PHONE, timestamp: '1761332700', type: 'text', text: { body: 'hola' } }] } }] }] };
    const r1 = mkRes(); await waWebhook(webhookReq(payload, 'sha256=' + '0'.repeat(64)), r1);
    expect(r1.statusCode).toBe(401);
    expect(Object.keys(db.store).filter((k) => k.startsWith('whatsappInbox/'))).toHaveLength(0);
    const r2 = mkRes(); await waWebhook(webhookReq(payload), r2);
    const r3 = mkRes(); await waWebhook(webhookReq(payload), r3); // Meta reintenta
    expect([r2.statusCode, r3.statusCode]).toEqual([200, 200]);
    expect(db.store['whatsappInbox/wamid.A']).toMatchObject({ from: PHONE, type: 'text', text: 'hola' });
  });

  test('número sin conectar → instrucciones; VINCULAR con código válido → conectado (una sola vez)', async () => {
    const { waLink, waProcess, db } = loadHandlers();
    const net = mockWaNet();
    await waProcess(event(waMsg('m1', { text: 'Vendo depa' })));
    expect(net.sent[0]).toMatchObject({ messaging_product: 'whatsapp', to: PHONE, type: 'text' });
    expect(net.sent[0].text.body).toContain('primero conecta este número');

    const { code, minutes } = await waLink(req('u1', { action: 'code' }));
    expect(code).toMatch(/^\d{6}$/);
    expect(minutes).toBe(15);
    await waProcess(event(waMsg('m2', { text: `Vincular ${code}` })));
    expect(db.store[`whatsappLinks/${PHONE}`]).toMatchObject({ uid: 'u1' });
    expect(db.store[`whatsappLinkCodes/${code}`]).toBeUndefined();
    expect(net.sent[1].text.body).toContain('quedó conectado');
    await waProcess(event(waMsg('m3', { text: `VINCULAR ${code}` }))); // reusar el código
    expect(net.sent[2].text.body).toContain('no es válido');

    const st = await waLink(req('u1', {}));
    expect(st.linked).toEqual(['+•••••••4321']);
    await waLink(req('u1', { action: 'unlink' }));
    expect(db.store[`whatsappLinks/${PHONE}`]).toBeUndefined();
  });

  test('código vencido no conecta', async () => {
    const { waProcess, db } = loadHandlers();
    const net = mockWaNet();
    db.store['whatsappLinkCodes/111111'] = { uid: 'u1', expiresAt: { toMillis: () => Date.now() - 1000 } };
    await waProcess(event(waMsg('m1', { text: 'VINCULAR 111111' })));
    expect(db.store[`whatsappLinks/${PHONE}`]).toBeUndefined();
    expect(net.sent[0].text.body).toContain('ya venció');
  });

  test('sesión: texto + foto + nota de voz, LISTO → transcribe, guarda la foto, crea el borrador y responde', async () => {
    const { waProcess, db } = loadHandlers();
    db.store[`whatsappLinks/${PHONE}`] = { uid: 'u1' };
    const net = mockWaNet({ inmuebles: [aiItem({ distrito: 'Lince', tipo_propiedad: 'depa', tipo_publicacion: 'Vendo', precio: 'US$ 120 mil', area_techada: '70 m2',
      nro_dormitorios: 'dos', titulo: 'Depa en Lince', descripcion: 'Vendo depa en Lince', fotos: [], evidencia: null })] });

    await waProcess(event(waMsg('m1', { text: 'Vendo depa en Lince 70 m2 US$ 120 mil' })));
    await waProcess(event(waMsg('m2', { type: 'image', mediaId: 'MEDIA_IMG', caption: 'Sala' })));
    await waProcess(event(waMsg('m3', { type: 'audio', mediaId: 'MEDIA_AUD' })));
    expect(net.sent.map((m) => m.text.body)).toEqual([expect.stringContaining('📥 Recibido')]); // solo al primero
    expect(db.store[`whatsappSessions/${PHONE}`].items.map((i) => i.type)).toEqual(['text', 'image', 'audio']);

    await waProcess(event(waMsg('m4', { text: 'LISTO' })));
    expect(net.transcriptions).toBe(1);
    const user = net.ai.messages[1].content;
    expect(user).toContain('Corredor: Vendo depa en Lince 70 m2 US$ 120 mil');
    expect(user).toContain('Corredor: Sala [FOTO w-1]');
    expect(user).toContain('(nota de voz) tiene dos dormitorios y cochera');
    const saved = Object.keys(mockBucket.files);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^imports\/u1\/[A-Za-z0-9]+\/1\.jpg$/);
    const draft = Object.values(db.store).find((v) => v.status === 'draft');
    expect(draft).toMatchObject({ uid: 'u1', source: 'whatsapp', sourceName: 'WhatsApp (bot)' });
    expect(draft.photoUrls).toHaveLength(1); // un solo inmueble: la foto es suya
    expect(draft.photoUrls[0]).toContain(encodeURIComponent(saved[0]));
    expect([draft.row.tipo_propiedad, draft.row.precio, draft.row.nro_dormitorios]).toEqual(['Departamento', '120000', '2']);
    const last = net.sent[net.sent.length - 1].text.body;
    expect(last).toContain('Encontré 1 inmueble');
    expect(last).toContain('https://recosac.com/#borradores');
    expect(db.store[`whatsappSessions/${PHONE}`].items).toEqual([]);
    expect(Object.values(db.store).find((v) => v.kind === 'bot')).toMatchObject({ channel: 'whatsapp', photos: 1, voiceNotes: 1 });
  });

  test('LISTO sin mensajes, CANCELAR, AYUDA y tipos no soportados', async () => {
    const { waProcess, db } = loadHandlers();
    db.store[`whatsappLinks/${PHONE}`] = { uid: 'u1' };
    const net = mockWaNet();
    await waProcess(event(waMsg('m1', { text: 'listo' })));
    await waProcess(event(waMsg('m2', { text: 'Casa en Surco' })));
    await waProcess(event(waMsg('m3', { text: 'cancelar' })));
    await waProcess(event(waMsg('m4', { text: 'ayuda' })));
    await waProcess(event(waMsg('m5', { type: 'other', kind: 'document' })));
    const bodies = net.sent.map((m) => m.text.body);
    expect(bodies[0]).toContain('Todavía no me enviaste nada');
    expect(bodies[2]).toContain('borré lo que me habías enviado');
    expect(bodies[3]).toContain('escribe *LISTO*');
    expect(bodies[4]).toContain('Para PDF, Word, Excel');
    expect(db.store[`whatsappSessions/${PHONE}`].items).toEqual([]);
    expect(net.ai).toBeNull();
  });

  test('límite por hora: no procesa, conserva los mensajes y avisa', async () => {
    const { waProcess, db } = loadHandlers();
    db.store[`whatsappLinks/${PHONE}`] = { uid: 'u1' };
    db.store['importUsage/u1'] = { hour: new Date().toISOString().slice(0, 13), count: 30 };
    const net = mockWaNet();
    await waProcess(event(waMsg('m1', { text: 'Casa en Surco 200 m2' })));
    await waProcess(event(waMsg('m2', { text: 'LISTO' })));
    expect(net.sent[net.sent.length - 1].text.body).toContain('límite');
    expect(db.store[`whatsappSessions/${PHONE}`].items).toHaveLength(1);
    expect(net.ai).toBeNull();
  });

  test('publishProperty copia las fotos del bot (solo del propio usuario) a la publicación', async () => {
    const { publish, db } = loadHandlers();
    mockBucket.files['imports/u1/B1/1.jpg'] = { buf: Buffer.alloc(10) };
    mockBucket.files['imports/u2/B1/1.jpg'] = { buf: Buffer.alloc(10) };
    const res = await publish(req('u1', { source: 'whatsapp', address: 'Av. 1', district: 'Lince', type: 'Departamento', op: 'Venta', currency: 'USD',
      price: 120000, area: 70, title: 't', desc: 'd', importPhotos: ['imports/u1/B1/1.jpg', 'imports/u2/B1/1.jpg', '../imports/u1/x.jpg'] }));
    expect(res.photoUrls).toHaveLength(1);
    expect(mockBucket.files[`publications/${res.publicationId}/u1/0.jpg`]).toBeDefined();
    expect(db.store[`publications/${res.publicationId}`].photoUrls).toEqual(res.photoUrls);
    expect(res.photoUrls[0]).toContain(encodeURIComponent(`publications/${res.publicationId}/u1/0.jpg`));
  });
});

test.describe('Fase 2: perfil de portal e imágenes sueltas', () => {
  let originalFetch, restoreDns;
  test.beforeEach(() => { originalFetch = global.fetch; });
  test.afterEach(() => { global.fetch = originalFetch; if (restoreDns) restoreDns(); restoreDns = null; });

  test('modo perfil: lista los avisos del portal sin usar la IA ni el límite por hora', async () => {
    const { importPage, db } = loadHandlers();
    restoreDns = mockDns();
    const seen = mockNet({
      'https://urbania.pe/inmobiliarias/demo-1234567': html(`<a href="/inmueble/dpto-miraflores-145678901.html">Dpto</a>
        <a href="/inmueble/casa-molina-145678902.html">Casa</a><a href="/buscar/dptos-1234567">Buscar</a>`),
    }, { inmuebles: [] });
    db.store['importUsage/u1'] = { hour: new Date().toISOString().slice(0, 13), count: 30 }; // límite agotado
    const res = await importPage(req('u1', { url: 'https://urbania.pe/inmobiliarias/demo-1234567', declaraAutorizacion: true, modo: 'perfil' }));
    expect(res.avisos).toEqual([
      { url: 'https://urbania.pe/inmueble/dpto-miraflores-145678901.html', title: 'Dpto' },
      { url: 'https://urbania.pe/inmueble/casa-molina-145678902.html', title: 'Casa' },
    ]);
    expect(seen.ai).toBeUndefined();
    expect(Object.values(db.store).find((v) => v.kind === 'perfil')).toMatchObject({ host: 'urbania.pe', listings: 2 });
    await expect(importPage(req('u1', { url: 'https://otro.pe/perfil', declaraAutorizacion: true, modo: 'perfil' })))
      .rejects.toMatchObject({ details: { reason: 'blocked' } });
    await expect(importPage(req('u1', { url: 'https://www.facebook.com/inmobiliaria.sol', declaraAutorizacion: true, modo: 'perfil' })))
      .rejects.toMatchObject({ details: { reason: 'social-profile' } });
  });

  test('imágenes sueltas (flyers): documento con páginas escaneadas', async () => {
    const { extract, db } = loadHandlers();
    const calls = mockOpenAI({ inmuebles: [aiItem({ tipo_propiedad: 'Lote', area_terreno: '500', precio: 'US$ 90,000', fotos: [],
      evidencia: 'TERRENO EN VENTA Lote de 500 m2 Precio US$ 90,000' })] });
    const res = await extract(req('u1', { kind: 'document', fileType: 'imagenes', text: '=== Imagen 1: flyer.jpg (ver imagen) ===',
      images: [{ page: '1', dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(100) }], photoIds: [] }));
    expect(calls[0].messages[1].content[2].type).toBe('image_url');
    expect([res.drafts[0].row.area_terreno, res.drafts[0].row.precio]).toEqual(['500', '90000']); // vienen de la transcripción
    expect(Object.values(db.store).find((v) => v.status === 'draft')).toMatchObject({ source: 'documento', fileType: 'imagenes' });
  });
});
