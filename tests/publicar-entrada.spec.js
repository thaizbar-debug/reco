// Una sola entrada para publicar: "¿Qué tienes?" (archivo, enlace, texto o
// fotos con nota) y, si lo prefieren, el formulario a mano.
const { test, expect } = require('@playwright/test');
const { setupImportPage } = require('./helpers/browser-stubs');

const FOTO = `window.__foto = (h) => { const c = document.createElement('canvas'); c.width = 320; c.height = 240;
  const x = c.getContext('2d'); let r = h + 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) { x.fillStyle = 'hsl(' + Math.floor(rnd() * 360) + ',60%,50%)'; x.fillRect(rnd() * 320, rnd() * 240, 10 + rnd() * 50, 10 + rnd() * 50); }
  return new Promise((ok) => c.toBlob((b) => ok(new File([b], 'f' + h + '.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9)); };`;

test.describe('Publicar: una sola entrada', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); await page.evaluate(FOTO); });

  test('abrir publicar lleva a "¿Qué tienes?", sin pestañas, con la opción de llenarlo a mano', async ({ page }) => {
    await page.evaluate(() => { _pubTab = 'single'; openPublish(); });
    const modal = page.locator('#pubModal');
    await expect(modal).toContainText('Publicar inmuebles');
    await expect(modal).toContainText('¿Qué tienes de tus inmuebles?');
    await expect(modal).toContainText('📷 Fotos del inmueble');
    expect(await page.locator('#pubModal .pub-tab').count()).toBe(0);
    await page.locator('#pubModal button', { hasText: 'Prefiero llenarlo a mano' }).click();
    await expect(modal).toContainText('Ubicación y datos');
    await page.locator('#pubModal button', { hasText: 'Otras formas de publicar' }).click();
    await expect(modal).toContainText('¿Qué tienes de tus inmuebles?');
  });

  test('fotos sin nota: una ficha con las fotos para completar', async ({ page }) => {
    const r = await page.evaluate(async () => {
      await _pubDriveAdd('start', [await __foto(10), await __foto(200)]);
      const tiras = document.getElementById('pubStartFotos').textContent;
      await _pubStartImport();
      return { tiras, step: _pubBulkStep, rows: _pubBulkRows.length, photos: _pubBulkRows[0].photos.length,
        abierta: _pubBulkPhotoIdx, source: _pubBulkRows[0].source, ia: __calls.filter((c) => c.name === 'extractListings').length,
        quedan: _pubStartPhotos.length };
    });
    expect(r.tiras).toContain('2 fotos listas');
    expect(r).toMatchObject({ step: 2, rows: 1, photos: 2, abierta: 0, source: 'single', ia: 0, quedan: 0 });
  });

  test('fotos con nota: la IA arma la ficha y las fotos son suyas', async ({ page }) => {
    const r = await page.evaluate(async () => {
      __fn.extractListings = () => ({ batchId: 'B', drafts: [__draft('a', { direccion: 'Av. Pardo 340', distrito: 'Miraflores',
        tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta', precio: '185000', area_techada: '90', titulo: 't', descripcion: 'd' })] });
      await _pubDriveAdd('start', [await __foto(10), await __foto(120), await __foto(240)]);
      document.getElementById('pubStartNota').value = 'Depa en Av. Pardo 340 Miraflores, 90 m2, US$ 185 mil';
      await _pubStartImport();
      const call = __calls.find((c) => c.name === 'extractListings').data;
      return { text: call.text, distrito: _pubBulkRows[0].row.distrito, photos: _pubBulkRows[0].photos.length, abierta: _pubBulkPhotoIdx };
    });
    expect(r.text).toContain('Av. Pardo 340');
    expect(r).toMatchObject({ distrito: 'Miraflores', photos: 3, abierta: 0 });
  });

  test('si la IA no encuentra datos en la nota, no hay callejón: queda la ficha con fotos y la nota', async ({ page }) => {
    const r = await page.evaluate(async () => {
      __fn.extractListings = () => ({ batchId: 'B', drafts: [] });
      await _pubDriveAdd('start', [await __foto(10)]);
      document.getElementById('pubStartNota').value = 'Bonito, con mucha luz y buena vista';
      await _pubStartImport();
      return { step: _pubBulkStep, desc: _pubBulkRows[0].row.descripcion, photos: _pubBulkRows[0].photos.length, toasts: __toasts.join(' ') };
    });
    expect(r).toMatchObject({ step: 2, desc: 'Bonito, con mucha luz y buena vista', photos: 1 });
    expect(r.toasts).toContain('complétalos en la ficha');
  });

  test('sin fotos pide elegirlas; el dictado aparece solo si el navegador lo permite', async ({ page }) => {
    const r = await page.evaluate(async () => {
      await _pubStartImport();
      delete window.webkitSpeechRecognition; delete window.SpeechRecognition; renderPublish();
      const sin = document.getElementById('pubModal').innerHTML.includes('🎤 Dictar');
      window.webkitSpeechRecognition = function () { this.start = () => {}; this.stop = () => {}; };
      renderPublish();
      return { toasts: __toasts, sin, con: document.getElementById('pubModal').innerHTML.includes('🎤 Dictar') };
    });
    expect(r.toasts[0]).toContain('elige las fotos');
    expect(r.sin).toBe(false);
    expect(r.con).toBe(true);
  });

  test('a mano: al pasar a fotos y descripción, la IA redacta sola si están vacíos', async ({ page }) => {
    const r = await page.evaluate(async () => {
      __fn.generateListingCopy = () => ({ titulo: 'Depa luminoso en Miraflores', descripcion: 'Tres dormitorios y vista al parque.' });
      _pubSetTab('single');
      Object.assign(_pd, { address: 'Av. Pardo 340', district: 'Miraflores', lat: -12.1, lng: -77.0, price: '185000', area: '90' });
      _pn();
      await new Promise((ok) => setTimeout(ok, 50));
      return { ps: _ps, title: _pd.title, input: document.getElementById('pubTitleInput').value, toasts: __toasts.join(' ') };
    });
    expect(r.ps).toBe(2);
    expect(r.title).toBe('Depa luminoso en Miraflores');
    expect(r.input).toBe('Depa luminoso en Miraflores');
    expect(r.toasts).toContain('La IA redactó');
  });

  test('si una importación falla, ofrece seguir de otra forma y lo registra', async ({ page }) => {
    const r = await page.evaluate(async () => {
      __fn.extractListings = () => { throw new Error('La IA no respondió.'); };
      document.getElementById('pubPasteText').value = 'Vendo depa en Surco, 3 dorm, 90 m2, US$ 185 mil';
      await _pubTextImport();
      return { html: document.getElementById('pubBulkPreview').innerHTML, pasos: window.__track || [] };
    });
    expect(r.html).toContain('La IA no respondió');
    expect(r.html).toContain('Pegar el texto del aviso');
    expect(r.html).toContain('Subir una captura');
    expect(r.html).toContain('Llenarlo a mano');
    expect(r.pasos).toContain('fallo');
  });

  test('embudo: inicio, importado, revisar y manual se registran', async ({ page }) => {
    const pasos = await page.evaluate(async () => {
      __fn.extractListings = () => ({ batchId: 'B', drafts: [__draft('a', { direccion: 'A 1', distrito: 'Lince', tipo_propiedad: 'Casa', tipo_publicacion: 'Venta', precio: '1', area_techada: '90', titulo: 't', descripcion: 'd' })] });
      _pubBulkStep = 1; openPublish();
      document.getElementById('pubPasteText').value = 'Vendo casa en Lince, 90 m2, US$ 100 mil, buena ubicación';
      await _pubTextImport();
      _pubSetTab('single');
      return window.__track;
    });
    expect(pasos).toEqual(['inicio', 'revisar', 'importado', 'manual']);
  });

  test('en el celular sugiere instalar ReCo para compartir; se puede cerrar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { try { localStorage.removeItem('reco_movil_tip'); } catch (_) {} renderPublish(); });
    const tip = page.locator('#pubMovilTip');
    await expect(tip).toContainText('Compartir → ReCo');
    await tip.locator('button[title="Cerrar"]').click();
    await page.evaluate(() => renderPublish());
    await expect(page.locator('#pubMovilTip')).toHaveCount(0);
  });

  test('panel de admin: el embudo se muestra con conversión, canales y sitios bloqueados', async ({ page }) => {
    const html = await page.evaluate(() => _adminStatsHTML({ dias: 30, total: 5, truncado: false, conversionPct: 40, respaldoPct: 12.5,
      embudo: [{ paso: 'inicio', eventos: 9, usuarios: 5 }, { paso: 'publicado', eventos: 2, usuarios: 2 }],
      canales: [{ canal: 'url', veces: 4, inmuebles: 3, vaciasPct: 25, msPromedio: 4200 }], bloqueados: [{ host: 'portal.pe', veces: 2 }] }));
    expect(html).toContain('Abrió publicar');
    expect(html).toContain('40%');
    expect(html).toContain('4.2 s');
    expect(html).toContain('portal.pe (2)');
  });
});
