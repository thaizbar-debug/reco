/**
 * Fase 3 del roadmap de carga inteligente — handlers REALES de
 * functions/index.js con Firebase en memoria (tests/helpers/mock-functions.js):
 *   - importSources + syncImportSources: feeds (Kyero, JSON), Google Sheets,
 *     EasyBroker y Wasi; crear / actualizar / retirar / restaurar.
 *   - api (HTTP) + apiAccess + webhooks firmados.
 *   - emailIngest / emailInbound / emailProcess (correo de ingesta).
 */
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { loadFunctions, req, httpReq, httpRes, mockFetch, jpeg } = require('./helpers/mock-functions');

const FIX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'feeds', f), 'utf8');
const KYERO = FIX('kyero.xml');
const JSON_FEED = FIX('generico.json');
const SHEET = FIX('sheet.csv');
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0';
const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=csv&gid=0';
const xml = (s) => new Response(s, { status: 200, headers: { 'content-type': 'application/xml' } });
const json = (o, status) => new Response(typeof o === 'string' ? o : JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
const csv = (s) => new Response(s, { status: 200, headers: { 'content-type': 'text/csv' } });
const openai = (payload) => json({ choices: [{ message: { content: JSON.stringify(payload) } }] });

let origFetch, origLookup;
test.beforeEach(() => {
  origFetch = global.fetch;
  origLookup = dns.promises.lookup;
  dns.promises.lookup = async (host) => [{ address: host === 'interno.local' ? '10.0.0.5' : '93.184.216.34', family: 4 }];
});
test.afterEach(() => { global.fetch = origFetch; dns.promises.lookup = origLookup; });

const H = (F) => F.exports.importSources.__handler;
const docs = (F, col, pred) => Object.entries(F.db.store)
  .filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => ({ id: k.slice(col.length + 1), ...v })).filter(pred || (() => true));
const lastRun0 = (F, id) => { F.db.store[`importSources/${id}`].lastRunAt = { toMillis: () => 0 }; };

async function crearFuente(F, uid, data) {
  const { id } = await H(F)(req(uid, { action: 'create', ...data }));
  return id;
}
async function sync(F, uid, id) {
  lastRun0(F, id);
  return (await H(F)(req(uid, { action: 'sync', id }))).result;
}

test.describe('Fase 3: conexiones automáticas (importSources)', () => {
  test('feed Kyero en modo borradores: borradores con fotos, sin cambios, publicar, actualizar, retirar y restaurar', async () => {
    const F = loadFunctions();
    let feed = KYERO;
    mockFetch([
      ['https://crm.example.com/feed.xml', () => xml(feed)],
      [/cdn\.example\.com/, () => jpeg(9000)],
    ]);
    // Vista previa: mapeo y primeras filas, sin guardar nada.
    const prev = await H(F)(req('u1', { action: 'preview', kind: 'feed', url: 'https://crm.example.com/feed.xml' }));
    expect(prev.formato).toBe('kyero');
    expect(prev.total).toBe(2);
    expect(prev.mapping.area_terreno).toBe('surface_area.plot');
    expect(prev.muestra[0].row.tipo_propiedad).toBe('Departamento');
    expect(prev.muestra[0].errores).toEqual([]);
    expect(prev.muestra[1].row.tipo_publicacion).toBe('Alquiler');
    expect(docs(F, 'importSources')).toHaveLength(0);

    const id = await crearFuente(F, 'u1', { kind: 'feed', url: 'https://crm.example.com/feed.xml', nombre: 'Mi CRM', cadaHoras: 6 });
    const r1 = await sync(F, 'u1', id);
    expect(r1).toMatchObject({ total: 2, borradores: 2, nuevos: 0, retirados: 0 });
    const drafts = docs(F, 'importDrafts');
    expect(drafts).toHaveLength(2);
    const d1 = drafts.find((d) => d.syncKey === `${id}:KY-1001`);
    expect(d1).toMatchObject({ uid: 'u1', source: 'feed', sourceName: 'Mi CRM', batchId: id, syncSourceId: id });
    expect(d1.row.titulo).toBe('Departamento en venta en Miraflores · 3 dorm. · 90 m²');
    expect(d1.photoUrls).toHaveLength(2);
    expect(Object.keys(F.bucket.files).filter((p) => p.startsWith(`imports/u1/${d1.id}/`))).toEqual([`imports/u1/${d1.id}/1.jpg`, `imports/u1/${d1.id}/2.jpg`]);
    const src = F.db.store[`importSources/${id}`];
    expect(src.total).toBe(2);
    expect(src.nextRunAt.toMillis()).toBeGreaterThan(Date.now() + 5 * 3600e3);
    expect(src.runningUntil).toBeNull();

    // Segunda vez, mismo feed: nada cambia.
    expect(await sync(F, 'u1', id)).toMatchObject({ sinCambios: 2, borradores: 0, actualizados: 0 });

    // Publica el borrador desde la web (bandeja): la publicación hereda el vínculo.
    const { publicationId } = await F.exports.publishProperty.__handler(req('u1', {
      address: d1.row.direccion, district: d1.row.distrito, type: 'Departamento', op: 'Venta', currency: 'USD',
      price: 185000, area: 90, beds: 3, baths: 2, title: d1.row.titulo, desc: 'Departamento con vista al mar.',
      source: 'feed', importDraftId: d1.id,
      importPhotos: d1.photoUrls.map((u) => decodeURIComponent(u.split('/o/')[1].split('?')[0])),
    }));
    const pub = () => F.db.store[`publications/${publicationId}`];
    expect(pub().syncKey).toBe(`${id}:KY-1001`);
    expect(pub().photoUrls).toHaveLength(2);
    expect(F.db.store[`importDrafts/${d1.id}`]).toBeUndefined();
    pub().status = 'approved';

    // Baja el precio 5 %: se actualiza y sigue aprobada. La descripción que el
    // corredor corrigió al revisar el borrador no se pisa.
    feed = KYERO.replace('<price>185000</price>', '<price>175000</price>');
    expect(await sync(F, 'u1', id)).toMatchObject({ actualizados: 1, revision: 0, sinCambios: 1 });
    expect(pub()).toMatchObject({ price: 175000, status: 'approved', desc: 'Departamento con vista al mar.' });

    // Cambia la descripción: vuelve a moderación.
    feed = feed.replace('Cerca al parque Kennedy.', 'A una cuadra del parque Kennedy.');
    expect(await sync(F, 'u1', id)).toMatchObject({ actualizados: 1, revision: 1 });
    expect(pub().status).toBe('pending');
    expect(pub().desc).toContain('A una cuadra');
    pub().status = 'approved';

    // Desaparece del feed: retirada (y el borrador del otro, también fuera, se borra).
    const sinPrimero = feed.replace(/<property>\s*<id>KY-1001[\s\S]*?<\/property>/, '');
    feed = sinPrimero.replace(/<property>\s*<id>KY-1002[\s\S]*?<\/property>/, '<property><id>KY-2000</id><price>99000</price><currency>USD</currency><type>apartment</type><town>Lince</town><location_detail>Av. Arequipa 100</location_detail><surface_area><built>50</built></surface_area><desc><es>Mini depa.</es></desc></property>');
    const r4 = await sync(F, 'u1', id);
    expect(r4).toMatchObject({ retirados: 1, borradores: 1 });
    expect(pub()).toMatchObject({ status: 'withdrawn', withdrawnFrom: 'approved', withdrawnBy: 'sync' });
    expect(pub().withdrawnReason).toContain('Mi CRM');
    expect(docs(F, 'importDrafts').map((d) => d.syncKey)).toEqual([`${id}:KY-2000`]);

    // Vuelve a aparecer igual que antes: se restaura aprobada.
    feed = KYERO.replace('<price>185000</price>', '<price>175000</price>').replace('Cerca al parque Kennedy.', 'A una cuadra del parque Kennedy.');
    expect(await sync(F, 'u1', id)).toMatchObject({ restaurados: 1 });
    expect(pub().status).toBe('approved');

    // Feed vacío: no se retira nada.
    feed = '<?xml version="1.0"?><root><kyero><feed_version>3</feed_version></kyero></root>';
    const r6 = await sync(F, 'u1', id);
    expect(r6.retirados).toBe(0);
    expect(r6.aviso).toContain('vacío');
    expect(pub().status).toBe('approved');
    expect(F.db.store[`importSources/${id}`].total).toBe(2);
  });

  test('modo publicar (JSON): publica lo que pasa la verificación, con fotos; lo demás queda como borrador', async () => {
    const F = loadFunctions();
    const feed = JSON.parse(JSON_FEED);
    delete feed.data.listings[1].descripcion; // sin descripción: no se puede publicar
    mockFetch([
      ['https://web.example.com/inmuebles.json', () => json(feed)],
      [/cdn\.example\.com/, () => jpeg(12000)],
    ]);
    const id = await crearFuente(F, 'u1', { kind: 'feed', url: 'https://web.example.com/inmuebles.json', modo: 'publicar' });
    const r = await sync(F, 'u1', id);
    expect(r).toMatchObject({ nuevos: 1, borradores: 1 });
    const [p] = docs(F, 'publications');
    expect(p).toMatchObject({ userId: 'u1', userEmail: 'u1@test.pe', status: 'pending', source: 'feed', syncKey: `${id}:INM-7`,
      type: 'Casa', price: 420000, currency: 'USD', area: 280, areaTerr: 350, lat: -12.08 });
    expect(p.photoUrls).toHaveLength(2);
    expect(F.bucket.files[`publications/${p.id}/u1/0.jpg`]).toBeTruthy();
    const [dr] = docs(F, 'importDrafts');
    expect(dr.syncKey).toBe(`${id}:INM-8`);
    expect(dr.notes.join(' ')).toContain('Para publicar: descripción vacía');
  });

  test('Google Sheets: convierte el enlace, avisa si no es pública y pausa tras 5 errores seguidos (con correo)', async () => {
    const F = loadFunctions();
    let publica = true;
    const calls = mockFetch([
      [SHEET_CSV, () => (publica ? csv(SHEET) : new Response('<!DOCTYPE html><html>Iniciar sesión</html>', { status: 200, headers: { 'content-type': 'text/html' } }))],
      [/cdn\.example\.com/, () => jpeg()],
    ]);
    await expect(H(F)(req('u1', { action: 'create', kind: 'sheet', url: 'https://example.com/hoja' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    const id = await crearFuente(F, 'u1', { kind: 'sheet', url: SHEET_URL, nombre: 'Inventario' });
    expect(calls.some((c) => c.url === SHEET_CSV)).toBe(true);
    expect(await sync(F, 'u1', id)).toMatchObject({ total: 2, borradores: 2 });

    publica = false;
    for (let i = 1; i <= 5; i++) {
      await expect(sync(F, 'u1', id)).rejects.toThrow(/no es pública/);
    }
    const src = F.db.store[`importSources/${id}`];
    expect(src).toMatchObject({ estado: 'pausada', errores: 5 });
    expect(src.ultimoError).toContain('Cualquier persona con el enlace');
    const [mail] = docs(F, 'mail');
    expect(mail.to).toBe('u1@test.pe');
    expect(mail.message.subject).toContain('Pausamos');
    // Reactivar limpia los errores.
    await H(F)(req('u1', { action: 'update', id, estado: 'activa' }));
    expect(F.db.store[`importSources/${id}`]).toMatchObject({ estado: 'activa', errores: 0 });
  });

  test('EasyBroker: lista + detalle; con el mismo updated_at no vuelve a pedir el detalle; clave inválida', async () => {
    const F = loadFunctions();
    let updated = '2026-10-01T10:00:00Z';
    const list = () => json({ pagination: { limit: 50, page: 1, total: 1, next_page: null },
      content: [{ public_id: 'EB-XY1', title: 'Depa Barranco', updated_at: updated, location: 'Barranco, Lima, Lima' }] });
    const detail = () => json({ public_id: 'EB-XY1', title: 'Departamento en Barranco', property_type: 'Departamento', updated_at: updated,
      description: 'Vista al mar, a 2 cuadras del malecón.', location: { name: 'Barranco, Lima, Lima', street: 'Jr. Domeyer 210' },
      operations: [{ type: 'sale', amount: 250000, currency: 'USD' }], bedrooms: 2, bathrooms: 2, construction_size: 95,
      property_images: [{ url: 'https://assets.easybroker.com/1.jpg' }] });
    const calls = mockFetch([
      [/api\.easybroker\.com\/v1\/properties\?/, (u, init) => (init.headers['X-Authorization'] === 'eb_clave_valida_123' ? list() : json({ error: 'x' }, 401))],
      [/api\.easybroker\.com\/v1\/properties\/EB-XY1/, detail],
      [/assets\.easybroker\.com/, () => jpeg()],
    ]);
    await expect(H(F)(req('u1', { action: 'preview', kind: 'easybroker', credenciales: { apiKey: 'eb_clave_mala_000' } })))
      .rejects.toThrow(/EasyBroker rechazó la clave/);
    const id = await crearFuente(F, 'u1', { kind: 'easybroker', credenciales: { apiKey: 'eb_clave_valida_123' }, modo: 'publicar' });
    expect(F.db.store[`importSources/${id}`].cuenta).toBe('…_123');
    expect(F.db.store[`importSourceSecrets/${id}`]).toMatchObject({ uid: 'u1', apiKey: 'eb_clave_valida_123' });
    expect((await H(F)(req('u1', { action: 'list' }))).sources[0]).not.toHaveProperty('apiKey');

    expect(await sync(F, 'u1', id)).toMatchObject({ nuevos: 1 });
    const [p] = docs(F, 'publications');
    expect(p).toMatchObject({ address: 'Jr. Domeyer 210', district: 'Barranco', price: 250000, syncVersion: updated });
    const detalles = () => calls.filter((c) => /properties\/EB-XY1/.test(c.url)).length;
    expect(detalles()).toBe(1);
    const antes = detalles();
    expect(await sync(F, 'u1', id)).toMatchObject({ sinCambios: 1 });
    expect(detalles()).toBe(antes);
    updated = '2026-10-05T10:00:00Z';
    expect(await sync(F, 'u1', id)).toMatchObject({ sinCambios: 1 }); // cambió la versión pero no el contenido
    expect(detalles()).toBe(antes + 1);
  });

  test('Wasi: búsqueda paginada con id de empresa y token', async () => {
    const F = loadFunctions();
    let body;
    mockFetch([
      ['https://api.wasi.co/v1/property/search', (u, init) => {
        body = String(init.body);
        return json({ 0: { id_property: 55, id_property_type: 2, for_sale: 'true', sale_price: '199000', iso_currency: 'USD', title: 'Depa en Lince',
          address: 'Av. Arequipa 2000', zone_label: 'Lince', built_area: '80', bedrooms: '2', bathrooms: '2', observations: 'Cerca a todo.' },
        total: 1, status: 'success' });
      }],
    ]);
    await expect(H(F)(req('u1', { action: 'create', kind: 'wasi', credenciales: { idCompany: 'abc', wasiToken: 'tok' } }))).rejects.toMatchObject({ code: 'invalid-argument' });
    const id = await crearFuente(F, 'u1', { kind: 'wasi', credenciales: { idCompany: '123', wasiToken: 'wasi_token_ok' } });
    expect(await sync(F, 'u1', id)).toMatchObject({ total: 1, borradores: 1 });
    expect(body).toContain('id_company=123');
    expect(body).toContain('wasi_token=wasi_token_ok');
    expect(docs(F, 'importDrafts')[0].row).toMatchObject({ tipo_propiedad: 'Departamento', precio: '199000', distrito: 'Lince' });
  });

  test('solo el dueño; máximo 5 conexiones; SSRF; programador por hora; borrar con o sin retirar', async () => {
    const F = loadFunctions();
    mockFetch([['https://crm.example.com/feed.xml', () => xml(KYERO)], [/cdn\.example\.com/, () => jpeg()]]);
    const id = await crearFuente(F, 'u1', { kind: 'feed', url: 'https://crm.example.com/feed.xml', modo: 'publicar' });
    for (const action of ['update', 'sync', 'delete']) {
      await expect(H(F)(req('intruso', { action, id }))).rejects.toMatchObject({ code: 'not-found' });
    }
    await expect(H(F)(req('u1', { action: 'preview', kind: 'feed', url: 'http://interno.local/feed' }))).rejects.toThrow(/No se puede acceder/);
    for (let i = 0; i < 4; i++) await crearFuente(F, 'u1', { kind: 'feed', url: 'https://crm.example.com/feed.xml' });
    await expect(crearFuente(F, 'u1', { kind: 'feed', url: 'https://crm.example.com/feed.xml' })).rejects.toMatchObject({ code: 'resource-exhausted' });

    // Programador: corre solo las activas que ya tocan (las 5 recién creadas).
    const ids = docs(F, 'importSources').map((s) => s.id);
    await H(F)(req('u1', { action: 'update', id: ids[1], estado: 'pausada' }));
    F.db.store[`importSources/${ids[2]}`].nextRunAt = { toMillis: () => Date.now() + 3600e3 };
    await F.exports.syncImportSources.__handler({});
    const corridas = docs(F, 'importSources').filter((s) => s.lastResult).map((s) => s.id).sort();
    expect(corridas).toEqual([ids[0], ids[3], ids[4]].sort());
    // "Sincronizar ahora" justo después: hay que esperar.
    F.db.store[`importSources/${id}`].lastRunAt = { toMillis: () => Date.now() - 60000 };
    await expect(H(F)(req('u1', { action: 'sync', id }))).rejects.toMatchObject({ code: 'resource-exhausted' });

    const pubsDe = () => docs(F, 'publications', (p) => p.syncSourceId === id);
    expect(pubsDe()).toHaveLength(2);
    const r = await H(F)(req('u1', { action: 'delete', id, retirar: true }));
    expect(r.retiradas).toBe(2);
    expect(F.db.store[`importSources/${id}`]).toBeUndefined();
    expect(docs(F, 'publications').filter((p) => p.status === 'withdrawn' && p.withdrawnBy === 'owner')).toHaveLength(2);
  });
});

// ── API pública ──
async function apiCall(F, key, method, p, body, query) {
  const res = httpRes();
  await F.exports.api.__handler(httpReq({ method, path: p, headers: key ? { Authorization: `Bearer ${key}` } : {}, body, query }), res);
  return res;
}
const BODY = { external_id: 'CRM-1', type: 'Dpto.', operation: 'Vta', price: 'US$ 185,000', address: 'Av. Larco 1234', district: 'Miraflores',
  area_built: 90, bedrooms: 3, bathrooms: 2, elevator: true, features: ['Gimnasio', 'Vista al mar'], title: 'Depa con vista al mar',
  description: 'Departamento luminoso. Cel 987654321', photos: ['https://cdn.example.com/a.jpg'], color_favorito: 'azul' };

test.describe('Fase 3: API pública y webhooks', () => {
  test('claves, crear, upsert por external_id, editar, retirar, listar y errores', async () => {
    const F = loadFunctions();
    mockFetch([[/cdn\.example\.com/, () => jpeg()]]);
    const acc = F.exports.apiAccess.__handler;
    const { key, prefix } = await acc(req('u1', { action: 'createKey', nombre: 'CRM' }));
    expect(key).toMatch(/^reco_live_[A-Za-z0-9]{32}$/);
    expect(F.db.store[`apiKeys/${crypto.createHash('sha256').update(key).digest('hex')}`]).toMatchObject({ uid: 'u1', prefix, revoked: false });
    expect(JSON.stringify(F.db.store)).not.toContain(key);

    expect((await apiCall(F, null, 'GET', '/v1/ping')).statusCode).toBe(401);
    expect((await apiCall(F, 'reco_live_' + 'x'.repeat(32), 'GET', '/v1/ping')).statusCode).toBe(401);
    expect((await apiCall(F, key, 'GET', '/v1/ping')).body).toMatchObject({ ok: true, key: prefix });

    const c = await apiCall(F, key, 'POST', '/v1/properties', BODY);
    expect(c.statusCode).toBe(201);
    const id = c.body.data.id;
    expect(c.body.data).toMatchObject({ external_id: 'CRM-1', status: 'pending', type: 'Departamento', operation: 'Venta', currency: 'USD',
      price: 185000, area_built: 90, elevator: true, district: 'Miraflores' });
    expect(c.body.data.features).toEqual(expect.arrayContaining(['Gimnasio', 'Vista al mar']));
    expect(c.body.data.description).not.toContain('987654321');
    expect(c.body.data.photos).toHaveLength(1);
    expect(c.body.data.reso).toMatchObject({ ListingKey: id, ListPrice: 185000, StandardStatus: 'Coming Soon' });
    expect(c.body.warnings.join(' ')).toContain('color_favorito');
    expect(F.db.store[`publications/${id}`]).toMatchObject({ source: 'api', userId: 'u1', apiExternalId: 'CRM-1' });

    // Mismo external_id: actualiza (no duplica).
    F.db.store[`publications/${id}`].status = 'approved';
    const u = await apiCall(F, key, 'POST', '/v1/properties', { ...BODY, price: 179000 });
    expect(u.statusCode).toBe(200);
    expect(u.body).toMatchObject({ updated: true, data: { id, price: 179000, status: 'approved' } });
    expect(docs(F, 'publications')).toHaveLength(1);

    // PATCH parcial: cambiar el título vuelve a moderación.
    const p = await apiCall(F, key, 'PATCH', `/v1/properties/${id}`, { title: 'Nuevo título' });
    expect(p.body.data).toMatchObject({ title: 'Nuevo título', price: 179000, status: 'pending', bedrooms: 3 });

    // Verificación previa a publicar: Terreno sin área de terreno → 422 con la lista de errores.
    const bad = await apiCall(F, key, 'POST', '/v1/properties', { type: 'Lote', operation: 'Venta', price: 90000, currency: 'USD',
      address: 'Km 40', district: 'Lurín', title: 'Lote', description: 'Plano' });
    expect(bad.statusCode).toBe(422);
    expect(bad.body.error.errors.join(' ')).toMatch(/área de terreno/i);
    // Terreno con área de terreno y sin techada: OK.
    expect((await apiCall(F, key, 'POST', '/v1/properties', { type: 'Lote', operation: 'Venta', price: 90000, currency: 'USD',
      address: 'Km 40', district: 'Lurín', title: 'Lote', description: 'Plano', LotSizeArea: 1200 })).statusCode).toBe(201);

    const list = await apiCall(F, key, 'GET', '/v1/properties', null, { status: 'pending' });
    expect(list.body.total).toBe(2);

    const del = await apiCall(F, key, 'DELETE', `/v1/properties/${id}`);
    expect(del.body.data.status).toBe('withdrawn');
    // Una edición la vuelve a enviar a revisión.
    expect((await apiCall(F, key, 'PATCH', `/v1/properties/${id}`, { price: 175000 })).body.data.status).toBe('pending');

    // Otra cuenta no la ve.
    const otra = (await acc(req('u2', { action: 'createKey' }))).key;
    expect((await apiCall(F, otra, 'GET', `/v1/properties/${id}`)).statusCode).toBe(404);
    expect((await apiCall(F, key, 'GET', '/v2/x')).statusCode).toBe(404);

    // Revocar: deja de funcionar.
    await acc(req('u1', { action: 'revokeKey', prefix }));
    expect((await apiCall(F, key, 'GET', '/v1/ping')).statusCode).toBe(401);
  });

  test('límite por minuto → 429', async () => {
    const F = loadFunctions();
    const { key } = await F.exports.apiAccess.__handler(req('u1', { action: 'createKey' }));
    for (let i = 0; i < 120; i++) await apiCall(F, key, 'GET', '/v1/ping');
    const r = await apiCall(F, key, 'GET', '/v1/ping');
    expect(r.statusCode).toBe(429);
    expect(r.body.error.code).toBe('resource-exhausted');
  });

  test('webhooks: solo https público, eventos de estado y de leads firmados con HMAC', async () => {
    const F = loadFunctions();
    const acc = F.exports.apiAccess.__handler;
    await expect(acc(req('u1', { action: 'setWebhook', url: 'http://crm.example.com/hook' }))).rejects.toThrow(/https/);
    await expect(acc(req('u1', { action: 'setWebhook', url: 'https://interno.local/hook' }))).rejects.toThrow(/No se puede acceder/);
    const st = await acc(req('u1', { action: 'setWebhook', url: 'https://crm.example.com/hook' }));
    expect(st.webhook.secret).toMatch(/^whsec_/);
    const recibidos = [];
    mockFetch([['https://crm.example.com/hook', (u, init) => { recibidos.push(init); return new Response('ok', { status: 200 }); }]]);

    const ev = (before, after) => ({ params: { pubId: 'P1' }, data: {
      before: { exists: !!before, data: () => before }, after: { exists: !!after, data: () => after } } });
    const base = { userId: 'u1', status: 'pending', title: 'Depa', price: 100, type: 'Departamento' };
    const wh = F.exports.apiWebhookPublication.__handler;
    await wh(ev(null, base));
    await wh(ev(base, { ...base, title: 'Depa 2' })); // sin cambio de estado: nada
    await wh(ev(base, { ...base, status: 'approved' }));
    await wh(ev({ ...base, userId: 'sin-webhook' }, { ...base, userId: 'sin-webhook', status: 'rejected' }));
    await F.exports.apiWebhookLead.__handler({ params: { reqId: 'R1' }, data: { data: () => ({ publicationOwnerId: 'u1', propertyId: 'P1', kind: 'vendedor', fromName: 'Ana', fromEmail: 'ana@x.pe', message: 'Hola' }) } });

    expect(recibidos.map((r) => r.headers['X-Reco-Event'])).toEqual(['property.created', 'property.approved', 'lead.created']);
    for (const r of recibidos) {
      const [, t, v1] = r.headers['X-Reco-Signature'].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
      expect(crypto.createHmac('sha256', st.webhook.secret).update(`${t}.${r.body}`).digest('hex')).toBe(v1);
    }
    expect(JSON.parse(recibidos[1].body)).toMatchObject({ type: 'property.approved', data: { id: 'P1', status: 'approved' } });
    expect(JSON.parse(recibidos[2].body).data).toMatchObject({ property_id: 'P1', from_email: 'ana@x.pe' });
    expect(F.db.store['apiAccounts/u1'].lastWebhook).toMatchObject({ type: 'lead.created', ok: true, status: 200 });
  });
});

// ── Correo de ingesta ──
const SECRETS = { INBOUND_EMAIL_ADDRESS: 'buzon@inbound.postmarkapp.com', INBOUND_EMAIL_SECRET: 's3creto-de-prueba' };
const basic = (pass) => 'Basic ' + Buffer.from('postmark:' + pass).toString('base64');
function aiItem(over) {
  const R = require('../functions/shared/import-core');
  const it = {};
  R.AI_FIELDS.forEach((k) => { it[k] = null; });
  return Object.assign(it, { campos_inferidos: [], fotos: [], evidencia: '' }, over);
}

test.describe('Fase 3: correo de ingesta', () => {
  test('dirección personal, autenticación, adjuntos a Storage, borradores con fotos y respuesta por correo', async () => {
    const F = loadFunctions({ secrets: SECRETS });
    const { address, disponible } = await F.exports.emailIngest.__handler(req('u1', {}));
    expect(disponible).toBe(true);
    const token = address.match(/^buzon\+([a-z0-9]{10})@inbound\.postmarkapp\.com$/)[1];
    expect((await F.exports.emailIngest.__handler(req('u1', {}))).address).toBe(address);

    const inbound = F.exports.emailInbound.__handler;
    const correo = {
      MessageID: 'msg-1', Date: 'Fri, 24 Oct 2026', From: 'corredor@gmail.com', Subject: 'Fwd: Depa en Surco', MailboxHash: token,
      TextBody: 'Vendo depa en Surco, 3 dormitorios, 2 baños, 90 m2, US$ 185 mil. Av. Primavera 1450.\n-- \nJuan Pérez\nCel 987654321',
      Attachments: [
        { Name: 'sala.jpg', ContentType: 'image/jpeg', Content: Buffer.alloc(9000, 1).toString('base64') },
        { Name: 'logo.png', ContentType: 'image/png', Content: Buffer.alloc(800, 2).toString('base64') },
        { Name: 'ficha.pdf', ContentType: 'application/pdf', Content: Buffer.from('%PDF-1.4 ficha').toString('base64') },
        { Name: 'precios.xlsx', ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Content: Buffer.from('x').toString('base64') },
      ],
    };
    let res = httpRes();
    await inbound(httpReq({ method: 'POST', headers: { Authorization: basic('otra') }, body: correo }), res);
    expect(res.statusCode).toBe(401);
    res = httpRes();
    await inbound(httpReq({ method: 'POST', headers: { Authorization: basic(SECRETS.INBOUND_EMAIL_SECRET) }, body: { ...correo, MailboxHash: 'desconocid' } }), res);
    expect(res.body).toBe('ignored');
    expect(docs(F, 'emailInbox')).toHaveLength(0);

    res = httpRes();
    await inbound(httpReq({ method: 'POST', headers: { Authorization: basic(SECRETS.INBOUND_EMAIL_SECRET) }, body: correo }), res);
    expect(res.statusCode).toBe(200);
    // Reintento del proveedor: no duplica.
    await inbound(httpReq({ method: 'POST', headers: { Authorization: basic(SECRETS.INBOUND_EMAIL_SECRET) }, body: correo }), httpRes());
    const inbox = docs(F, 'emailInbox');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].fotos).toHaveLength(1); // el logo chico se descarta
    expect(inbox[0].pdfs).toHaveLength(1);
    expect(inbox[0].otros).toEqual(['precios.xlsx']);

    let aiBody;
    mockFetch([['https://api.openai.com/', (u, init) => {
      aiBody = JSON.parse(init.body);
      return openai({ inmuebles: [aiItem({ tipo_publicacion: 'Venta', tipo_propiedad: 'depa', distrito: 'Surco', direccion: 'Av. Primavera 1450',
        nro_dormitorios: '3', nro_banos: '2', area_techada: '90 m2', precio: 'US$ 185 mil', titulo: 'Depa en Surco', descripcion: 'Vendo depa en Surco' })] });
    }]]);
    await F.exports.emailProcess.__handler({ params: { msgId: inbox[0].id }, data: { data: () => F.db.store[`emailInbox/${inbox[0].id}`] } });
    const userMsg = aiBody.messages[1].content;
    expect(userMsg.find((c) => c.type === 'file').file.file_data).toMatch(/^data:application\/pdf;base64,/);
    expect(userMsg[0].text).toContain('[FOTO e-1]');
    expect(userMsg[0].text).not.toContain('Juan Pérez'); // firma recortada
    const [dr] = docs(F, 'importDrafts');
    expect(dr).toMatchObject({ uid: 'u1', source: 'email' });
    expect(dr.row).toMatchObject({ distrito: 'Santiago de Surco', precio: '185000', tipo_propiedad: 'Departamento' });
    expect(dr.photoUrls).toHaveLength(1);
    const [mail] = docs(F, 'mail');
    expect(mail.to).toBe('u1@test.pe');
    expect(mail.message.text).toContain('recosac.com/#borradores');
    expect(mail.message.text).toContain('precios.xlsx');

    // Cambiar el código invalida la dirección anterior.
    const nueva = (await F.exports.emailIngest.__handler(req('u1', { action: 'rotate' }))).address;
    expect(nueva).not.toBe(address);
    expect(F.db.store[`emailIngestTokens/${token}`]).toBeUndefined();
  });

  test('sin configurar: no disponible', async () => {
    const F = loadFunctions();
    expect(await F.exports.emailIngest.__handler(req('u1', {}))).toEqual({ disponible: false });
  });
});
