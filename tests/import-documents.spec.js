// Importar documentos (PDF, Word, PowerPoint): lectura real de los archivos
// de tests/fixtures/import en el navegador (texto, fotos, páginas
// escaneadas) y orquestación con extractListings simulado.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { routeStubs } = require('./helpers/browser-stubs');

const FIX = path.join(__dirname, 'fixtures', 'import');

async function setup(page) {
  await routeStubs(page);
  await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _pubDocImport === 'function' && typeof RecoImport !== 'undefined');
  await page.evaluate(() => {
    window.__user = { uid: 'u1', email: 'a@b.c', emailVerified: true, reload: async () => {}, getIdToken: async () => 't' };
    Object.defineProperty(auth, 'currentUser', { configurable: true, get: () => window.__user });
    window.__calls = [];
    window.__toasts = [];
    window.toast = (m) => window.__toasts.push(m);
    window.__extract = null; // (data) => result
    window._getFunctions = () => ({
      httpsCallable: (name) => async (data) => {
        window.__calls.push({ name, data });
        if (name !== 'extractListings' || !window.__extract) return { data: {} };
        return { data: await window.__extract(data) };
      },
    });
    // Respuesta típica del servidor: borradores ya normalizados.
    window.__draft = (id, row, fotos) => ({
      id, row: RecoImport.normalizeRow(row).row, fotos, notes: [],
      aiFields: Object.keys(row), inferredFields: ['titulo'],
    });
    _pubTab = 'bulk'; _pubBulkStep = 1;
    document.getElementById('pubOverlay').classList.add('open');
    document.getElementById('pubModal').classList.add('open');
    renderPublish();
  });
}

const upload = (page, file) => page.setInputFiles('#pubBulkInput', path.join(FIX, file));

test.describe('Importar documentos con IA', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('PDF: texto por página, fotos sin logos, página escaneada como imagen y fotos asignadas', async ({ page }) => {
    await page.evaluate(() => {
      window.__extract = (d) => ({ batchId: 'B1', drafts: [
        __draft('a', { direccion: 'Av. Larco 1150', distrito: 'Miraflores', tipo_publicacion: 'Vta.', tipo_propiedad: 'Dpto.',
          precio: 'US$ 185,000', area_techada: '85', titulo: 'Dpto. en Miraflores', descripcion: 'x', etiquetas_vista: 'Vista al mar' }, ['p1-1', 'p1-2']),
        __draft('b', { direccion: 'Calle Los Pinos 120', distrito: 'La Molina', tipo_publicacion: 'Alq.', tipo_propiedad: 'Casa',
          precio: 'S/ 6,500', area_techada: '250', area_terreno: '300', estado: 'E/C', titulo: 'Casa en La Molina', descripcion: 'x' }, ['p2-1']),
        __draft('c', { direccion: 'Lurín', distrito: 'Lurín', tipo_publicacion: 'Venta', tipo_propiedad: 'Lote',
          precio: 'US$ 90,000', area_terreno: '500', titulo: 'Terreno en Lurín', descripcion: 'x' }, []),
      ] });
    });
    await upload(page, 'inventario.pdf');
    await page.waitForFunction(() => _pubBulkStep === 2, null, { timeout: 30000 });

    const r = await page.evaluate(() => {
      const call = __calls.find(c => c.name === 'extractListings');
      return {
        calls: __calls.filter(c => c.name === 'extractListings').length,
        data: { ...call.data, images: call.data.images.map(i => ({ page: i.page, jpeg: i.dataUrl.startsWith('data:image/jpeg;base64,'), len: i.dataUrl.length })) },
        rows: _pubBulkRows.map(a => ({ tipo: a.row.tipo_propiedad, op: a.row.tipo_publicacion, estado: a.row.estado,
          antig: a.row.antiguedad, valid: a.valid, photos: a.photos.length, source: a.source, ai: a.aiFields.length })),
        pool: _pubDocPhotoPool.length, name: _pubBulkFileName, batch: _pubBulkBatchId, toasts: __toasts,
        payload: _pubBulkSubmitPayload(_pubBulkRows[2]),
      };
    });
    expect(r.calls).toBe(1);
    expect(r.data.kind).toBe('document');
    expect(r.data.fileType).toBe('pdf');
    expect(r.data.sourceName).toBe('inventario.pdf');
    expect(r.data.text).toContain('=== Página 1 ===');
    expect(r.data.text).toContain('Dpto. en Miraflores - Vta.');
    expect(r.data.text).toContain('[FOTO p1-1] [FOTO p1-2]');
    expect(r.data.text).toContain('[FOTO p2-1]');
    expect(r.data.text).toContain('Página 3 (escaneada, ver imagen)');
    expect(r.data.photoIds).toEqual(['p1-1', 'p1-2', 'p2-1']); // el logo de 48 px no cuenta
    expect(r.data.images).toHaveLength(1);
    expect(r.data.images[0]).toMatchObject({ page: '3', jpeg: true });
    expect(r.data.images[0].len).toBeLessThan(1500000);

    expect(r.rows.map(x => [x.tipo, x.op, x.photos])).toEqual([
      ['Departamento', 'Venta', 2], ['Casa', 'Alquiler', 1], ['Terreno', 'Venta', 0]]);
    expect([r.rows[1].estado, r.rows[1].antig]).toEqual(['En construcción', '0']);
    expect(r.rows.every(x => x.valid)).toBe(true); // Terreno sin área techada es válido
    expect(r.rows.every(x => x.source === 'documento')).toBe(true);
    expect(r.pool).toBe(3);
    expect(r.name).toBe('inventario.pdf');
    expect(r.batch).toBe('B1');
    expect(r.toasts.join(' ')).toContain('3 inmuebles encontrados');
    expect(r.payload.source).toBe('documento');
  });

  test('paso de fotos: las fotos del documento se pueden asignar a mano', async ({ page }) => {
    await page.evaluate(() => {
      window.__extract = () => ({ batchId: 'B2', drafts: [
        __draft('a', { direccion: 'A 1', distrito: 'Lince', tipo_propiedad: 'Casa', precio: '1', area_techada: '90', titulo: 't', descripcion: 'd' }, []),
      ] });
    });
    await upload(page, 'inventario.pdf');
    await page.waitForFunction(() => _pubBulkStep === 2, null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      _pubBulkGo(3);
      const html = document.getElementById('pubBulkStepBody').innerHTML;
      _pubBulkPoolAdd(1); _pubBulkPoolAdd(1);
      return { html, photos: _pubBulkRows[0].photos.length };
    });
    expect(r.html).toContain('Fotos del documento');
    expect(r.photos).toBe(1); // la misma foto no se agrega dos veces
  });

  test('Word: tablas en una línea, fotos por sección y logo descartado', async ({ page }) => {
    await page.evaluate(() => { window.__extract = () => ({ batchId: 'B3', drafts: [] }); });
    await upload(page, 'inventario.docx');
    await page.waitForFunction(() => __calls.some(c => c.name === 'extractListings'), null, { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('pubBulkPreview').textContent.includes('No encontramos inmuebles'));
    const d = await page.evaluate(() => __calls.find(c => c.name === 'extractListings').data);
    expect(d.fileType).toBe('docx');
    expect(d.text).toContain('=== Sección 1 ===');
    expect(d.text).toContain('Estacionamientos | 1');
    expect(d.text).toContain('Antigüedad | 2015');
    expect(d.text).toContain('=== Sección 2 ===');
    expect(d.photoIds).toEqual(['d1-1', 'd2-1']);
    expect(d.images).toEqual([]);
  });

  test('PowerPoint: diapositivas en orden, notas del orador y fotos por diapositiva', async ({ page }) => {
    await page.evaluate(() => { window.__extract = () => ({ batchId: 'B4', drafts: [] }); });
    await upload(page, 'inventario.pptx');
    await page.waitForFunction(() => __calls.some(c => c.name === 'extractListings'), null, { timeout: 30000 });
    const d = await page.evaluate(() => __calls.find(c => c.name === 'extractListings').data);
    expect(d.fileType).toBe('pptx');
    expect(d.text.indexOf('Diapositiva 1')).toBeLessThan(d.text.indexOf('Diapositiva 2'));
    expect(d.text).toContain('Casa de playa en Punta Hermosa');
    expect(d.text).toContain('Notas: Nota: incluye 2 estacionamientos.');
    expect(d.text).toContain('Of. en San Isidro - Alq.');
    expect(d.photoIds).toEqual(['s1-1', 's2-1']);
  });

  test('documento largo: se envía en varias partes con el mismo lote', async ({ page }) => {
    const r = await page.evaluate(() => {
      const doc = { sections: [], scans: [] };
      for (let i = 1; i <= 8; i++) doc.sections.push({ label: `Página ${i}`, text: 'x'.repeat(5000), photoIds: [`p${i}-1`] });
      for (let i = 9; i <= 16; i++) { doc.sections.push({ label: `Página ${i}`, text: 'e', photoIds: [], scan: true }); doc.scans.push({ page: String(i), dataUrl: 'data:image/jpeg;base64,AA' }); }
      return _pubDocParts(doc).map(p => ({ len: p.text.length, ids: p.photoIds.length, imgs: p.images.length }));
    });
    expect(r.every(p => p.len <= 18000 && p.imgs <= 6)).toBe(true);
    expect(r.reduce((s, p) => s + p.ids, 0)).toBe(8);
    expect(r.reduce((s, p) => s + p.imgs, 0)).toBe(8);
  });

  test('partes: el batchId de la primera respuesta se reutiliza en las siguientes', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._pubDocRead = async () => ({ fileType: 'pdf', photos: [], scans: [], sections: [
        { label: 'Página 1', text: 'a'.repeat(15000), photoIds: [] }, { label: 'Página 2', text: 'b'.repeat(15000), photoIds: [] }] });
      let n = 0;
      window.__extract = () => ({ batchId: 'LOTE', drafts: [__draft('x' + (++n), { direccion: 'A', distrito: 'Lince', precio: '1', area_techada: '1', titulo: 't', descripcion: 'd' }, [])] });
      await _pubDocImport(new File(['x'], 'largo.pdf'));
      return { batchIds: __calls.filter(c => c.name === 'extractListings').map(c => c.data.batchId || null), rows: _pubBulkRows.length };
    });
    expect(r.batchIds).toEqual([null, 'LOTE']);
    expect(r.rows).toBe(2);
  });

  test('errores: formato antiguo, sin sesión y límite de la IA', async ({ page }) => {
    const r = await page.evaluate(async () => {
      _pubBulkFile(new File(['x'], 'viejo.doc'));
      window.__user = null;
      window.openAuthModal = () => { window.__login = true; };
      await _pubDocImport(new File(['x'], 'a.pdf'));
      window.__user = { uid: 'u1', emailVerified: true };
      window._pubDocRead = async () => ({ fileType: 'pdf', sections: [{ label: 'Página 1', text: 'Depa', photoIds: [] }], photos: [], scans: [] });
      window.__extract = () => { throw Object.assign(new Error('Límite de 30 importaciones por hora alcanzado. Intenta más tarde.'), { code: 'functions/resource-exhausted' }); };
      await _pubDocImport(new File(['x'], 'b.pdf'));
      return { toasts: __toasts, login: !!window.__login, preview: document.getElementById('pubBulkPreview').textContent };
    });
    expect(r.toasts[0]).toContain('.docx / .pptx');
    expect(r.login).toBe(true);
    expect(r.toasts.join(' ')).toContain('Límite de 30 importaciones');
    expect(r.preview).toContain('Límite de 30 importaciones');
  });
});
