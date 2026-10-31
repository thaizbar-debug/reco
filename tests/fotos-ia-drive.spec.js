// Fotos con IA (portada, orden, ambientes y marcas de agua) y fotos desde
// Google Drive (enlace de carpeta compartida y Google Picker). La Cloud
// Function y la API de Drive se simulan; las fotos se generan con canvas.
const { test, expect } = require('@playwright/test');
const { setupImportPage } = require('./helpers/browser-stubs');

const GEN = `
window.__mkBlob = async (seed, W) => {
  const cv = document.createElement('canvas'); cv.width = W || 1200; cv.height = Math.round((W || 1200) * 0.75);
  const cx = cv.getContext('2d');
  let r = seed || 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  cx.fillStyle = '#e8e0d0'; cx.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 700; i++) { cx.fillStyle = 'hsl(' + Math.floor(rnd() * 360) + ',60%,' + (30 + Math.floor(rnd() * 50)) + '%)';
    cx.fillRect(rnd() * cv.width, rnd() * cv.height, 8 + rnd() * 60, 8 + rnd() * 60); }
  return new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.9));
};
window.__mkFoto = async (name, seed) => new File([await __mkBlob(seed)], name, { type: 'image/jpeg' });
// API de Drive simulada: carpetas[id] = { name, hijos:[ids] }, archivos[id] = { name, mimeType } o error.
window.__drive = { carpetas: {}, archivos: {}, error: null, pedidos: [] };
const _fetch0 = window.fetch;
window.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.hostname !== 'www.googleapis.com') return _fetch0(url, init);
  const D = window.__drive;
  D.pedidos.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), headers: (init && init.headers) || {} });
  const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'content-type': 'application/json' } });
  if (D.error) return json({ error: D.error }, D.error.code);
  const id = u.pathname.split('/files/')[1];
  const metaOf = (x) => D.carpetas[x] ? { id: x, name: D.carpetas[x].name, mimeType: 'application/vnd.google-apps.folder' } : D.archivos[x] ? { id: x, ...D.archivos[x] } : null;
  if (id) {
    const m = metaOf(id);
    if (!m) return json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404);
    if (u.searchParams.get('alt') === 'media') return new Response(await __mkBlob([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483646, 7) + 1), { headers: { 'content-type': m.mimeType } });
    return json(m);
  }
  const padre = (u.searchParams.get('q').match(/'([^']+)' in parents/) || [])[1];
  return json({ files: ((D.carpetas[padre] || {}).hijos || []).map(metaOf).filter(Boolean) });
};`;

test.describe('Fotos con IA', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); await page.evaluate(GEN); });

  test('ordena con la portada propuesta, muestra ambientes y avisa de marcas de agua', async ({ page }) => {
    const r = await page.evaluate(async () => {
      _pd.photos = [];
      await _pubHandleFiles([await __mkFoto('bano.jpg', 3), await __mkFoto('fachada.jpg', 5), await __mkFoto('sala.jpg', 9)]);
      const antes = _pd.photos.slice();
      __fn.analyzePhotos = (d) => ({
        fotos: [{ ambiente: 'bano', calidad: 4 }, { ambiente: 'fachada', calidad: 5, marcaAgua: true }, { ambiente: 'sala', calidad: 5 }]
          .map((f) => ({ marcaAgua: false, texto: false, personas: false, ...f })),
        portada: 2, orden: [2, 0, 1],
      });
      const tools = _pubPhotoToolsHTML('pd');
      await _pubPhotoAiRun('pd');
      const [call] = __calls.filter((c) => c.name === 'analyzePhotos').map((c) => c.data);
      const dims = await Promise.all(call.photos.map((u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(Math.max(i.width, i.height)); i.src = u; })));
      return { tools, orden: _pd.photos.map((u) => antes.indexOf(u)), dims, issues: _pd.photos.map(_pubPhotoIssues),
        strip: _pubPhotoStripHTML('pd', _pd.photos), advice: _pubPhotoAdviceHTML(_pd.photos), toasts: __toasts.join(' | ') };
    });
    expect(r.tools).toContain('✨ Ordenar con IA');
    expect(r.tools).toContain('📁 Desde Google Drive');
    expect(r.orden).toEqual([2, 0, 1]);
    expect(r.dims.every((d) => d <= 512)).toBe(true); // a la IA va una copia chica
    expect(r.issues).toEqual([[], [], ['Marca de agua']]);
    expect(r.strip).toContain('>Sala<');
    expect(r.strip).toContain('>Baño<');
    expect(r.advice).toContain('marca de agua de otro portal');
    expect(r.toasts).toContain('portada: sala');
    expect(r.toasts).toContain('1 con marca de agua');
  });

  test('si la lista cambió mientras la IA revisaba, no se reordena; con 1 foto no aparece el botón', async ({ page }) => {
    const r = await page.evaluate(async () => {
      _pd.photos = [];
      await _pubHandleFiles([await __mkFoto('a.jpg', 3), await __mkFoto('b.jpg', 5)]);
      const antes = _pd.photos.slice();
      __fn.analyzePhotos = () => { _pd.photos.reverse(); return { fotos: [{ ambiente: 'cocina' }, { ambiente: 'sala' }], portada: 1, orden: [1, 0] }; };
      await _pubPhotoAiRun('pd');
      const despues = _pd.photos.map((u) => antes.indexOf(u));
      _pd.photos = _pd.photos.slice(0, 1);
      return { despues, uno: _pubPhotoToolsHTML('pd'), amb: _pubPhotoStripHTML('pd', antes) };
    });
    expect(r.despues).toEqual([1, 0]); // el cambio del usuario, no el de la IA
    expect(r.uno).not.toContain('Ordenar con IA');
    expect(r.amb).toContain('>Cocina<'); // los ambientes sí se guardan
  });

  test('editor de una publicación: las fotos ya subidas se mandan por URL (la miniatura) con el pubId', async ({ page }) => {
    const r = await page.evaluate(async () => {
      __fn.analyzePhotos = () => ({ fotos: [{ ambiente: 'cocina' }, { ambiente: 'sala' }], portada: 1, orden: [1, 0] });
      closePublish();
      _pubPhotoEditor({ id: 'P1', status: 'approved', photoUrls: ['https://f/0.jpg', 'https://f/1.jpg'], thumbUrls: ['https://f/t0.jpg', ''] });
      await _pubPhotoAiRun('pe');
      const [call] = __calls.filter((c) => c.name === 'analyzePhotos').map((c) => c.data);
      return { call, photos: _pe.photos };
    });
    expect(r.call).toEqual({ pubId: 'P1', photos: [{ url: 'https://f/t0.jpg' }, { url: 'https://f/1.jpg' }] });
    expect(r.photos).toEqual(['https://f/1.jpg', 'https://f/0.jpg']);
    await expect(page.locator('#pubPeOverlay')).toContainText('✨ Ordenar con IA');
  });
});

test.describe('Fotos desde Google Drive', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); await page.evaluate(GEN); });

  test('reconoce los enlaces de Drive', async ({ page }) => {
    const r = await page.evaluate(() => [
      'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing',
      'https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMn',
      'https://drive.google.com/file/d/1FileIdXyz123/view?usp=drive_link',
      'https://drive.google.com/open?id=1OpenIdXyz123&resourcekey=0-abc',
      'https://www.dropbox.com/s/abc', 'no es un enlace',
    ].map(_driveLinkInfo));
    expect(r).toEqual([
      { id: '1AbCdEfGhIjKlMn', tipo: 'carpeta', resourceKey: '' },
      { id: '1AbCdEfGhIjKlMn', tipo: 'carpeta', resourceKey: '' },
      { id: '1FileIdXyz123', tipo: 'archivo', resourceKey: '' },
      { id: '1OpenIdXyz123', tipo: null, resourceKey: '0-abc' },
      null, null,
    ]);
  });

  test('carpeta compartida: trae solo las fotos, en orden, con la clave de la web', async ({ page }) => {
    await page.evaluate(() => {
      Object.assign(__drive.carpetas, { CARPETA0001: { name: 'Depa Lince', hijos: ['FOTO10xxxx', 'FOTO02xxxx', 'PDF0000001'] } });
      Object.assign(__drive.archivos, { FOTO10xxxx: { name: 'IMG_10.jpg', mimeType: 'image/jpeg' }, FOTO02xxxx: { name: 'IMG_2.jpg', mimeType: 'image/jpeg' },
        PDF0000001: { name: 'brochure.pdf', mimeType: 'application/pdf' } });
      _pd.photos = [];
      _pubDriveOpen('pd');
    });
    await expect(page.locator('#pubDriveOverlay')).toContainText('Cualquier persona con el enlace');
    await expect(page.locator('#pubDriveOverlay')).not.toContainText('Elegir fotos de mi Google Drive'); // Picker sin configurar
    await page.locator('#pubDriveLink').fill('https://drive.google.com/drive/folders/CARPETA0001?usp=sharing');
    await page.locator('#pubDriveOverlay button', { hasText: 'Traer fotos' }).click();
    await expect(page.locator('#pubDriveOverlay')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => _pd.photos.length)).toBe(2);
    const r = await page.evaluate(() => ({ n: _pd.photos.length, pedidos: __drive.pedidos }));
    expect(r.n).toBe(2);
    const medias = r.pedidos.filter((p) => p.params.alt === 'media').map((p) => p.path.split('/').pop());
    expect(medias).toEqual(['FOTO02xxxx', 'FOTO10xxxx']); // IMG_2 antes que IMG_10; el PDF no se descarga
    expect(r.pedidos.every((p) => p.params.key === 'AIzaSyCri1KjwpUKfYMhjYf0nPU9KD1LipVbh3M' && p.params.supportsAllDrives === 'true')).toBe(true);
  });

  test('carpeta con subcarpetas: elige la del inmueble; no pasa el máximo de 20', async ({ page }) => {
    await page.evaluate(async () => {
      const hijos = Array.from({ length: 25 }, (_, i) => 'FOTOCASA' + String(i).padStart(2, '0'));
      Object.assign(__drive.carpetas, { RAIZ000001: { name: 'Inventario', hijos: ['SUBDEPA001', 'SUBCASA001'] },
        SUBDEPA001: { name: 'Depa Lince', hijos: ['FOTODEPA01'] }, SUBCASA001: { name: 'Casa Surco', hijos } });
      __drive.archivos.FOTODEPA01 = { name: '1.jpg', mimeType: 'image/jpeg' };
      hijos.forEach((h, i) => { __drive.archivos[h] = { name: i + '.jpg', mimeType: 'image/jpeg' }; });
      _pd.photos = [];
      await _pubHandleFiles([await __mkFoto('mia.jpg', 999)]);
      _pubDriveOpen('pd');
    });
    await page.locator('#pubDriveLink').fill('https://drive.google.com/drive/folders/RAIZ000001');
    await page.locator('#pubDriveOverlay button', { hasText: 'Traer fotos' }).click();
    await expect(page.locator('#pubDriveOverlay')).toContainText('¿Cuál es la de este inmueble?');
    await page.locator('#pubDriveOverlay button', { hasText: '📂 Casa Surco (25 fotos)' }).click();
    await expect(page.locator('#pubDriveOverlay')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => _pd.photos.length)).toBe(20);
    const r = await page.evaluate(() => ({ n: _pd.photos.length, bajadas: __drive.pedidos.filter((p) => p.params.alt === 'media').length, toasts: __toasts.join(' | ') }));
    expect(r.bajadas).toBe(19); // solo lo que entra (ya tenía 1)
    expect(r.n).toBe(20);
    expect(r.toasts).toContain('trajimos 19 de 25');
  });

  test('carga masiva: una subcarpeta por inmueble, asignada por nombre', async ({ page }) => {
    await page.evaluate(() => {
      const row = (direccion, distrito) => _pubBulkEntry({ direccion, distrito, tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta',
        tipo_moneda: 'USD', precio: '100000', area_techada: '80', titulo: 'Depa', descripcion: 'x' }, { photos: [] });
      _pubBulkRows = [row('Av. Pardo 340', 'Miraflores'), row('Jr. Huiracocha 1200', 'Jesús María')];
      _pubBulkPhotoIdx = 0; _pubBulkGo(3);
      Object.assign(__drive.carpetas, { RAIZ000002: { name: 'Fotos', hijos: ['SUBHUIRA01', 'SUBPARDO01'] },
        SUBHUIRA01: { name: 'Huiracocha 1200', hijos: ['FOTOHUI001', 'FOTOHUI002'] }, SUBPARDO01: { name: 'Pardo 340 - Miraflores', hijos: ['FOTOPAR001'] } });
      Object.assign(__drive.archivos, { FOTOHUI001: { name: 'a.jpg', mimeType: 'image/jpeg' }, FOTOHUI002: { name: 'b.jpg', mimeType: 'image/jpeg' },
        FOTOPAR001: { name: 'c.jpg', mimeType: 'image/jpeg' } });
    });
    await page.locator('#pubModal a', { hasText: 'Pega el enlace de la carpeta' }).click();
    await expect(page.locator('#pubDriveOverlay')).toContainText('una subcarpeta por inmueble');
    await page.locator('#pubDriveLink').fill('https://drive.google.com/drive/folders/RAIZ000002');
    await page.locator('#pubDriveOverlay button', { hasText: 'Traer fotos' }).click();
    await expect(page.locator('#pubModal')).toContainText('📂 Huiracocha 1200');
    const g = await page.evaluate(() => _pubPhotoGroups.map((x) => ({ nombre: x.nombre, n: x.photos.length, row: x.row })));
    expect(g).toEqual([{ nombre: 'Huiracocha 1200', n: 2, row: 1 }, { nombre: 'Pardo 340 - Miraflores', n: 1, row: 0 }]);
    await page.locator('#pubModal button', { hasText: 'Asignar fotos' }).click();
    expect(await page.evaluate(() => _pubBulkValidRows().map((a) => a.photos.length))).toEqual([1, 2]);
  });

  test('errores claros: carpeta no compartida y Drive no activado', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const msg = async () => { try { await _driveRead('https://drive.google.com/drive/folders/NOEXISTE01'); return ''; } catch (e) { return e.message; } };
      const noCompartida = await msg();
      __drive.error = { code: 403, status: 'PERMISSION_DENIED', message: 'Google Drive API has not been used in project 123', errors: [{ reason: 'accessNotConfigured' }] };
      const noActivado = await msg();
      let link = ''; try { await _driveRead('https://www.dropbox.com/x'); } catch (e) { link = e.message; }
      return { noCompartida, noActivado, link };
    });
    expect(r.noCompartida).toContain('Cualquier persona con el enlace');
    expect(r.noActivado).toContain('todavía no está activado');
    expect(r.link).toContain('enlace de una carpeta o una foto de Google Drive');
  });

  test('Google Picker: con clientId aparece "Elegir de mi Google Drive" y descarga con el token', async ({ page }) => {
    await page.evaluate(() => {
      _GOOGLE_DRIVE.clientId = 'cid.apps.googleusercontent.com'; _GOOGLE_DRIVE.appId = '123';
      __drive.archivos.PICKFOTO01 = { name: 'p.jpg', mimeType: 'image/jpeg' };
      // Google Identity Services y Picker simulados.
      window.gapi = { load: (n, cb) => cb() };
      const built = { setVisible: () => setTimeout(() => window.__pickerCb({ action: 'picked', docs: [{ id: 'PICKFOTO01', name: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 }] }), 10) };
      const B = function () { const b = {}; ['addView', 'enableFeature', 'setMaxItems', 'setOAuthToken', 'setDeveloperKey', 'setAppId', 'setLocale', 'setTitle']
        .forEach((k) => { b[k] = () => b; }); b.setCallback = (cb) => { window.__pickerCb = cb; return b; }; b.build = () => built; return b; };
      const V = function () { this.setIncludeFolders = () => this; };
      window.google = {
        accounts: { oauth2: { initTokenClient: (o) => ({ requestAccessToken: () => o.callback({ access_token: 'TOKEN123' }) }) } },
        picker: { PickerBuilder: B, DocsView: V, ViewId: {}, Feature: {}, Action: { PICKED: 'picked', CANCEL: 'cancel' } },
      };
      _pd.photos = [];
      _pubDriveOpen('pd');
    });
    await page.locator('#pubDriveOverlay button', { hasText: 'Elegir fotos de mi Google Drive' }).click();
    await expect(page.locator('#pubDriveOverlay')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => _pd.photos.length)).toBe(1);
    const r = await page.evaluate(() => ({ n: _pd.photos.length, p: __drive.pedidos.find((x) => x.params.alt === 'media') }));
    expect(r.n).toBe(1);
    expect(r.p.headers.Authorization).toBe('Bearer TOKEN123');
    expect(r.p.params.key).toBeUndefined();
  });
});
