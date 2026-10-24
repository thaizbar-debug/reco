// Fase 1 de carga inteligente: pegar texto, chats de WhatsApp, importar
// desde enlace y marcador "Enviar a ReCo". Los archivos se leen de verdad
// (tests/fixtures/import); las Cloud Functions se simulan.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { routeStubs } = require('./helpers/browser-stubs');

const FIX = path.join(__dirname, 'fixtures', 'import');

async function setup(page) {
  await routeStubs(page);
  await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _pubTextImport === 'function' && typeof RecoImport !== 'undefined');
  await page.evaluate(() => {
    window.__user = { uid: 'u1', email: 'a@b.c', emailVerified: true, reload: async () => {}, getIdToken: async () => 't' };
    Object.defineProperty(auth, 'currentUser', { configurable: true, get: () => window.__user });
    window.__calls = [];
    window.__toasts = [];
    window.toast = (m) => window.__toasts.push(m);
    window.__fn = {}; // nombre → (data) => result
    window._getFunctions = () => ({
      httpsCallable: (name) => async (data) => {
        window.__calls.push({ name, data });
        if (!window.__fn[name]) return { data: {} };
        return { data: await window.__fn[name](data) };
      },
    });
    window.__draft = (id, row, fotos) => ({ id, row: RecoImport.normalizeRow(row).row, fotos: fotos || [], notes: [],
      aiFields: Object.keys(row), inferredFields: ['titulo'] });
    _pubTab = 'bulk'; _pubBulkStep = 1;
    document.getElementById('pubOverlay').classList.add('open');
    document.getElementById('pubModal').classList.add('open');
    renderPublish();
  });
}
const calls = (page, name) => page.evaluate((n) => __calls.filter(c => c.name === n).map(c => c.data), name);

test.describe('Fase 1: pegar texto', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('notas pegadas → extractListings (text) → bandeja', async ({ page }) => {
    await page.evaluate(() => {
      __fn.extractListings = () => ({ batchId: 'T1', drafts: [
        __draft('a', { direccion: 'Surco', distrito: 'Surco', tipo_publicacion: 'Vendo', tipo_propiedad: 'dpto', precio: 'US$ 185 mil', area_techada: '90', titulo: 'Dpto en Surco', descripcion: 'x' }),
        __draft('b', { direccion: 'La Molina', distrito: 'La Molina', tipo_publicacion: 'Alquilo', tipo_propiedad: 'casa', precio: 'S/ 6,500', area_techada: '250', titulo: 'Casa', descripcion: 'x' }),
      ] });
    });
    await page.fill('#pubPasteText', 'Vendo dpto. en Surco, 3 dorm, 90 m2, US$ 185 mil.\n\nAlquilo casa en La Molina 250 m2, S/ 6,500');
    await page.click('text=Buscar inmuebles con IA');
    await page.waitForFunction(() => _pubBulkStep === 2);
    const [d] = await calls(page, 'extractListings');
    expect(d).toMatchObject({ kind: 'text', channel: 'text', sourceName: 'Texto pegado' });
    expect(d.text).toContain('Vendo dpto. en Surco');
    const r = await page.evaluate(() => ({ rows: _pubBulkRows.map(a => [a.row.tipo_propiedad, a.row.tipo_publicacion, a.source]), name: _pubBulkFileName }));
    expect(r.rows).toEqual([['Departamento', 'Venta', 'text'], ['Casa', 'Alquiler', 'text']]);
    expect(r.name).toBe('Texto pegado');
  });

  test('un chat pegado se reconoce como WhatsApp y sin nombres', async ({ page }) => {
    await page.evaluate(() => { __fn.extractListings = () => ({ batchId: 'T2', drafts: [] }); });
    await page.fill('#pubPasteText', '24/10/26, 09:15 - Juan Pérez: Vendo depa en Lince 70 m2\n24/10/26, 09:16 - +51 987 654 321: precio?\n24/10/26, 09:17 - Juan Pérez: US$ 120 mil');
    await page.click('text=Buscar inmuebles con IA');
    await page.waitForFunction(() => __calls.length > 0);
    const [d] = await calls(page, 'extractListings');
    expect(d.channel).toBe('whatsapp');
    expect(d.text).toContain('[09:15] Contacto 1: Vendo depa en Lince 70 m2');
    expect(d.text).toContain('[09:16] Contacto 2: precio?');
    expect(d.text).not.toContain('Juan');
    expect(d.text).not.toContain('987');
  });

  test('texto largo: se divide en partes del mismo lote', async ({ page }) => {
    const r = await page.evaluate(() => {
      const bloques = Array.from({ length: 10 }, (_, i) => `Inmueble ${i}: ` + 'x'.repeat(4000));
      const parts = _pubSplitText(bloques.join('\n\n'));
      const huge = _pubSplitText('y'.repeat(40000));
      return { parts: parts.map(p => p.length), joined: parts.join('\n\n').length, total: bloques.join('\n\n').length, huge: huge.map(p => p.length) };
    });
    expect(r.parts.every(n => n <= 18000)).toBe(true);
    expect(r.joined).toBe(r.total);
    expect(r.huge.every(n => n <= 18000)).toBe(true);
    expect(r.huge.reduce((a, b) => a + b, 0)).toBe(40000);
  });

  test('texto muy corto o sin sesión no llama a la IA', async ({ page }) => {
    const r = await page.evaluate(async () => {
      document.getElementById('pubPasteText').value = 'hola';
      await _pubTextImport();
      document.getElementById('pubPasteText').value = 'Vendo depa en Lince 70 m2 US$ 120 mil';
      window.__user = null; window.openAuthModal = () => { window.__auth = true; };
      await _pubTextImport();
      return { calls: __calls.length, toasts: __toasts, auth: !!window.__auth };
    });
    expect(r.calls).toBe(0);
    expect(r.toasts[0]).toContain('Pega el texto');
    expect(r.auth).toBe(true);
  });
});

test.describe('Fase 1: chat de WhatsApp exportado', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('Android .zip: mensajes por día, seudónimos, fotos (sin stickers) y asignación', async ({ page }) => {
    await page.evaluate(() => {
      __fn.extractListings = (d) => ({ batchId: 'W1', drafts: [
        __draft('a', { direccion: 'Av. Pardo 500', distrito: 'Miraflores', tipo_propiedad: 'Dpto', tipo_publicacion: 'Venta', precio: 'US$ 240,000', area_techada: '110', titulo: 'Dpto en Miraflores', descripcion: 'x' }, ['w-1', 'w-2']),
        __draft('b', { direccion: 'Surquillo', distrito: 'Surquillo', tipo_propiedad: 'local', tipo_publicacion: 'Alquilo', precio: 'S/ 4,800', area_techada: '60', titulo: 'Local', descripcion: 'x' }, ['w-3']),
      ] });
    });
    await page.setInputFiles('#pubBulkInput', path.join(FIX, 'chat-whatsapp.zip'));
    await page.waitForFunction(() => _pubBulkStep === 2, null, { timeout: 30000 });
    const [d] = await calls(page, 'extractListings');
    expect(d).toMatchObject({ kind: 'document', fileType: 'whatsapp', sourceName: 'chat-whatsapp.zip' });
    expect(d.photoIds).toEqual(['w-1', 'w-2', 'w-3']); // el sticker no cuenta
    expect(d.images).toEqual([]);
    expect(d.text).toContain('=== Chat 24/10/26 ===');
    expect(d.text).toContain('=== Chat 25/10/26 ===');
    expect(d.text).toContain('[09:16] Contacto 1: [FOTO w-1]');
    expect(d.text).toContain('Dpto en Miraflores, Av. Pardo 500\n3 dorm, 2 baños, 110 m2');
    expect(d.text).toContain('Contacto 2: Interesante!');
    expect(d.text).not.toMatch(/Juan|María|cifrados/);
    const r = await page.evaluate(() => _pubBulkRows.map(a => [a.row.tipo_propiedad, a.photos.length, a.source]));
    expect(r).toEqual([['Departamento', 2, 'whatsapp'], ['Local comercial', 1, 'whatsapp']]);
  });

  test('iPhone .txt: formato [fecha, hora p. m.], adjuntos y fotos omitidas', async ({ page }) => {
    await page.evaluate(() => { __fn.extractListings = () => ({ batchId: 'W2', drafts: [] }); });
    await page.setInputFiles('#pubBulkInput', path.join(FIX, 'chat-iphone.txt'));
    await page.waitForFunction(() => __calls.length > 0, null, { timeout: 30000 });
    const [d] = await calls(page, 'extractListings');
    expect(d.fileType).toBe('whatsapp');
    expect(d.photoIds).toEqual([]);
    expect(d.text).toContain('[2:06] Contacto 1: Casa en Chorrillos, 4 dorm, terreno 200 m2,\ntechada 180 m2. Vta. US$ 320 mil');
    expect(d.text).toContain('[foto no incluida]');
    expect(d.text).not.toContain('Ana');
    expect(d.text).not.toContain('PHOTO');
  });

  test('archivo que no es un chat: mensaje claro', async ({ page }) => {
    const r = await page.evaluate(async () => {
      await _pubWaImport(new File(['solo una nota suelta'], 'nota.txt'));
      return { calls: __calls.length, msg: document.getElementById('pubBulkPreview').textContent };
    });
    expect(r.calls).toBe(0);
    expect(r.msg).toContain('Exportar chat');
  });
});

test.describe('Fase 1: desde un enlace y marcador', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  // PNG real de 300×300 (las fotos de los portales llegan en PNG/WebP y se pasan a JPEG).
  const pngDataUrl = () => { const c = document.createElement('canvas'); c.width = c.height = 300; c.getContext('2d').fillRect(0, 0, 300, 300); return c.toDataURL('image/png'); };

  test('importa el aviso: autorización obligatoria, fotos a JPEG y bandeja', async ({ page }) => {
    await page.evaluate((mk) => {
      const png = new Function(`return (${mk})()`)();
      __fn.importListingPage = () => ({ batchId: 'U1', photos: [{ id: 'u-1', dataUrl: png }], drafts: [
        __draft('a', { direccion: 'Av. Larco 1150', distrito: 'Miraflores', tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta', precio: '185000', area_techada: '85', titulo: 'Dpto', descripcion: 'x' }, ['u-1']),
      ] });
    }, pngDataUrl.toString());
    await page.fill('#pubUrlInput', 'https://urbania.pe/inmueble/dpto-123');
    await page.click('text=Importar aviso');
    expect(await page.evaluate(() => __calls.length)).toBe(0); // falta la autorización
    expect(await page.evaluate(() => __toasts.pop())).toContain('autorización');
    await page.check('#pubUrlAuth');
    await page.click('text=Importar aviso');
    await page.waitForFunction(() => _pubBulkStep === 2);
    const [d] = await calls(page, 'importListingPage');
    expect(d).toEqual({ url: 'https://urbania.pe/inmueble/dpto-123', declaraAutorizacion: true });
    const r = await page.evaluate(() => ({ photo: _pubBulkRows[0].photos[0].slice(0, 23), source: _pubBulkRows[0].source, name: _pubBulkFileName }));
    expect(r).toEqual({ photo: 'data:image/jpeg;base64,', source: 'url', name: 'urbania.pe' });
  });

  test('portal bloqueado: se abre la ayuda del marcador', async ({ page }) => {
    await page.evaluate(() => {
      __fn.importListingPage = () => { throw Object.assign(new Error('El portal no permitió leer el aviso desde ReCo. Usa el botón "Enviar a ReCo" desde tu navegador.'), { code: 'functions/failed-precondition', details: { reason: 'blocked' } }); };
    });
    await page.fill('#pubUrlInput', 'https://otro-portal.pe/aviso/1');
    await page.check('#pubUrlAuth');
    await page.click('text=Importar aviso');
    await page.waitForFunction(() => document.getElementById('pubMarcador').open);
    const html = await page.evaluate(() => document.getElementById('pubMarcador').innerHTML);
    expect(html).toContain('href="javascript:');
    expect(html).toContain('Enviar a ReCo');
  });

  test('marcador: el código abre ReCo y envía el aviso solo a su origen', async ({ page }) => {
    const code = await page.evaluate(() => decodeURIComponent(_pubBookmarkletCode().slice('javascript:'.length)));
    expect(code).toContain('"http://localhost:3123/#importar"');
    expect(code).toContain('w.postMessage(msg,"http://localhost:3123")');
    expect(() => new Function(code)).not.toThrow(); // es JavaScript válido
  });

  test('ReCo recibe el aviso del marcador solo de la pestaña que lo abrió', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const acks = [];
      const opener = { postMessage: (m) => acks.push(m) };
      Object.defineProperty(window, 'opener', { configurable: true, get: () => opener });
      const pagina = { title: 'Casa en venta - Portal X', meta: {}, jsonld: [], text: 'Casa 200 m2 US$ 300 mil', images: [] };
      // De otra ventana: se ignora.
      _pubOnImportMessage({ data: { type: 'reco-import', url: 'https://x.pe/1', pagina }, source: {}, origin: 'https://x.pe' });
      const ignored = _pubPendingPage === null;
      _pubOnImportMessage({ data: { type: 'reco-import', url: 'https://x.pe/1', pagina }, source: opener, origin: 'https://x.pe' });
      const banner = document.getElementById('pubPendingPage').innerHTML;
      __fn.importListingPage = () => ({ batchId: 'U2', photos: [], drafts: [] });
      await _pubUrlImport(true);
      const blocked = __calls.length;
      document.getElementById('pubPendAuth').checked = true;
      await _pubUrlImport(true);
      return { ignored, acks, banner, blocked, call: __calls.find(c => c.name === 'importListingPage') };
    });
    expect(r.ignored).toBe(true);
    expect(r.acks).toEqual(['reco-import-ok']);
    expect(r.banner).toContain('Recibimos un aviso de x.pe');
    expect(r.banner).toContain('Casa en venta - Portal X');
    expect(r.blocked).toBe(0);
    expect(r.call.data).toMatchObject({ url: 'https://x.pe/1', declaraAutorizacion: true, pagina: { text: 'Casa 200 m2 US$ 300 mil' } });
  });
});

test.describe('Fase 1: Excel de cualquier formato', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('detecta la fila de títulos, celdas combinadas, títulos repetidos y todas las hojas', async ({ page }) => {
    await page.evaluate(() => { window.__user = null; }); // sin sesión: sin IA, mapeo a mano
    await page.setInputFiles('#pubBulkInput', path.join(FIX, 'inventario-corredor.xlsx'));
    await page.waitForFunction(() => _pubBulkStep === 'map', null, { timeout: 30000 });
    const r = await page.evaluate(() => ({ raw: _pubBulkRaw, headers: _pubBulkHeaders, map: _pubBulkMap }));
    expect(r.headers).toEqual(['Ubicación', 'Sector', 'Tipo inmueble', 'Operación', 'Valor', 'Mts2 const.', 'Dorm', 'Título aviso', 'Comentario']);
    expect(r.raw.map(x => [x['Ubicación'], x.Sector])).toEqual([
      ['Av. Larco 1150', 'Miraflores'], ['Calle Berlín 300', 'Miraflores'], // combinada
      ['Jr. Junín 400', 'Magdalena'], ['Av. Angamos 1200', 'Surquillo'], // tras títulos repetidos / otra hoja
    ]);
    expect(r.map).toMatchObject({ direccion: 'Ubicación', distrito: 'Sector', precio: 'Valor', titulo: 'Título aviso' });
    expect(r.map.area_techada).toBeUndefined();
  });

  test('la IA completa las columnas que faltan (✨), se recuerda el formato y la segunda vez no pregunta', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('reco_formatos_excel');
      __fn.mapImportColumns = () => ({ mapeo: { area_techada: 'Mts2 const.', descripcion: 'Comentario', direccion: 'Sector', nro_dormitorios: 'Dorm' } });
    });
    await page.setInputFiles('#pubBulkInput', path.join(FIX, 'inventario-corredor.xlsx'));
    await page.waitForFunction(() => _pubBulkStep === 'map', null, { timeout: 30000 });
    const m = await page.evaluate(() => ({ map: _pubBulkMap, ai: _pubBulkMapAI, html: document.getElementById('pubBulkStepBody').innerHTML,
      call: __calls.find(c => c.name === 'mapImportColumns').data }));
    expect(m.call.headers).toHaveLength(9);
    expect(m.call.sample[0]).toEqual(['Av. Larco 1150', 'Miraflores', 'Dpto.', 'Vta.', 'US$ 185,000', '85 m2', '3 dorm', 'Dpto. con vista', 'A estrenar']);
    expect(m.map.area_techada).toBe('Mts2 const.');
    expect(m.map.descripcion).toBe('Comentario');
    expect(m.map.direccion).toBe('Ubicación'); // la IA no pisa lo reconocido
    expect(Object.keys(m.ai).sort()).toEqual(['area_techada', 'descripcion']); // "Dorm" ya lo reconocen los sinónimos
    expect(m.html).toContain('✨ 2 con IA');

    await page.click('text=Continuar a revisar');
    await page.waitForFunction(() => _pubBulkStep === 2);
    const rows = await page.evaluate(() => _pubBulkRows.map(a => [a.row.tipo_propiedad, a.row.tipo_publicacion, a.row.precio, a.row.tipo_moneda, a.row.area_techada, a.row.nro_dormitorios, a.valid]));
    expect(rows).toEqual([
      ['Departamento', 'Venta', '185000', 'USD', '85', '3', true],
      ['Departamento', 'Venta', '210000', 'USD', '95', '3', true],
      ['Casa', 'Alquiler', '3500', 'PEN', '120', '4', true],
      ['Local comercial', 'Alquiler', '4800', 'PEN', '60', '0', true],
    ]);
    expect(await page.evaluate(() => document.getElementById('pubBulkStepBody').innerHTML)).toContain('Revisar columnas');

    // Segunda vez, mismo formato: directo a revisar, sin IA.
    await page.evaluate(() => { __calls.length = 0; _pubBulkGo(1); });
    await page.setInputFiles('#pubBulkInput', path.join(FIX, 'inventario-corredor.xlsx'));
    await page.waitForFunction(() => _pubBulkStep === 2 && _pubBulkRows.length === 4, null, { timeout: 30000 });
    const again = await page.evaluate(() => ({ calls: __calls.length, toasts: __toasts }));
    expect(again.calls).toBe(0);
    expect(again.toasts.join(' ')).toContain('formato que guardaste');
  });

  test('CSV con filas de título antes de la tabla', async ({ page }) => {
    const rows = await page.evaluate(() => _pubParseCSV('Reporte de inventario;;\n;;\ndireccion;distrito;precio\nAv Test;Lince;100000\n;;\n'));
    expect(rows).toEqual([{ direccion: 'Av Test', distrito: 'Lince', precio: '100000' }]);
  });
});
