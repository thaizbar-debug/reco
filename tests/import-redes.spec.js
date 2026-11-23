// Mejoras de captación en la web: PDF de proyecto (fotos de páginas sin
// texto y planos), video de un reel (imágenes + audio), enlace de un post que
// la red no deja leer y la tarjeta de Facebook / Instagram en Integraciones.
// Las Cloud Functions se simulan; los archivos se leen de verdad.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { setupImportPage } = require('./helpers/browser-stubs');

const FIX = path.join(__dirname, 'fixtures', 'import');
const calls = (page, name) => page.evaluate((n) => __calls.filter(c => c.name === n).map(c => c.data), name);

test.describe('PDF de proyecto', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  test('página solo de fotos: van a la IA y quedan como fotos; el plano dibujado se guarda como foto', async ({ page }) => {
    await page.evaluate(() => { __fn.extractListings = () => ({ batchId: 'P1', drafts: [] }); });
    await page.setInputFiles('#pubBulkInput', path.join(FIX, 'brochure-proyecto.pdf'));
    await expect.poll(() => calls(page, 'extractListings').then((c) => c.length), { timeout: 60000 }).toBe(1);
    const [d] = await calls(page, 'extractListings');
    expect(d.images.map((i) => i.page)).toEqual(['1']); // la página sin texto se lee con visión
    expect(d.photoIds).toEqual(['p1-1', 'p1-2', 'p1-3', 'p2-1']);
    expect(d.text).toMatch(/=== Página 1 \(escaneada, ver imagen\) ===\s+\[FOTO p1-1\] \[FOTO p1-2\] \[FOTO p1-3\]/);
    expect(d.text).toContain('[FOTO p2-1] (plano)');
    expect(d.text).toContain('Otros proyectos');
    expect(d.text).not.toContain('[FOTO p3-');
  });
});

test.describe('Video de un reel o TikTok', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  test('toma imágenes del video y su audio (WAV 16 kHz) y los manda en una parte', async ({ page }) => {
    test.setTimeout(90000);
    await page.evaluate(() => {
      __fn.extractListings = () => ({ batchId: 'V1', drafts: [__draft('a', { direccion: 'Av. Arequipa 2450', distrito: 'Lince', tipo_propiedad: 'Dpto',
        tipo_publicacion: 'Alquiler', precio: 'S/ 2,300', area_techada: '70', titulo: 'Depa en Lince', descripcion: 'x' })] });
    });
    // Video de 3 s con imagen cambiante y un tono, grabado aquí mismo.
    await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240;
      const cx = cv.getContext('2d');
      const ac = new AudioContext();
      const osc = ac.createOscillator(); osc.frequency.value = 440;
      const dest = ac.createMediaStreamDestination(); osc.connect(dest); osc.start();
      const stream = new MediaStream([...cv.captureStream(15).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      let f = 0;
      const draw = setInterval(() => { cx.fillStyle = `hsl(${(f++ * 12) % 360},70%,50%)`; cx.fillRect(0, 0, 320, 240);
        cx.fillStyle = '#fff'; cx.font = '28px sans-serif'; cx.fillText('Depa Lince ' + f, 20, 120); }, 66);
      rec.start(250);
      await new Promise((r) => setTimeout(r, 3000));
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      clearInterval(draw); osc.stop(); ac.close();
      window.__video = new File(chunks, 'reel-lince.webm', { type: 'video/webm' });
    });
    await page.evaluate(() => _pubBulkFiles([window.__video]));
    await expect.poll(() => calls(page, 'extractListings').then((c) => c.length), { timeout: 60000 }).toBe(1);
    const [d] = await calls(page, 'extractListings');
    expect(d).toMatchObject({ kind: 'document', fileType: 'video', sourceName: 'reel-lince.webm' });
    expect(d.images.length).toBeGreaterThanOrEqual(2);
    expect(d.images.every((i) => i.dataUrl.startsWith('data:image/jpeg;base64,'))).toBe(true);
    expect(d.audio.dataUrl.startsWith('data:audio/wav;base64,UklGR')).toBe(true); // "RIFF"
    const wav = await page.evaluate((u) => { const b = atob(u.split(',')[1].slice(0, 64)); return [b.charCodeAt(24) | (b.charCodeAt(25) << 8), b.charCodeAt(22)]; }, d.audio.dataUrl);
    expect(wav).toEqual([16000, 1]); // 16 kHz, mono
    expect(d.text).toContain('=== Video: reel-lince.webm');
    const r = await page.evaluate(() => ({ step: _pubBulkStep, fotos: _pubBulkRows[0].photos.length, source: _pubBulkRows[0].source, toasts: __toasts }));
    expect(r.step).toBe(2);
    expect(r.fotos).toBe(d.images.length); // un solo inmueble: las imágenes del video son sus fotos
    expect(r.toasts.join(' ')).toContain('🎬 1 inmueble encontrado');
  });
});

test.describe('Enlace de un post', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  test('la tarjeta invita a pegar posts; post privado → subir captura o pegar texto; perfil → conectar', async ({ page }) => {
    await expect(page.locator('#pubModal')).toContainText('Facebook, Instagram o TikTok');
    const fail = (reason, msg) => page.evaluate(([r, m]) => {
      __fn.importListingPage = () => { const e = new Error(m); e.details = { reason: r }; throw e; };
    }, [reason, msg]);
    await page.fill('#pubUrlInput', 'https://www.facebook.com/share/abc/');
    await page.check('#pubUrlAuth');
    await fail('social-private', 'No pudimos leer ese post: puede ser privado.');
    await page.locator('button', { hasText: 'Importar aviso' }).click();
    await expect(page.locator('#pubBulkPreview')).toContainText('No pudimos leer ese post');
    await expect(page.locator('#pubBulkPreview label', { hasText: 'Subir captura del post' })).toHaveAttribute('for', 'pubBulkInput');
    await expect(page.locator('#pubBulkPreview')).not.toContainText('Conectar Facebook');
    await fail('social-profile', 'Ese enlace es de un perfil, no de un post.');
    await page.locator('button', { hasText: 'Importar aviso' }).click();
    await expect(page.locator('#pubBulkPreview button', { hasText: 'Conectar Facebook / Instagram' })).toBeVisible();
  });
});

test.describe('Integraciones: Facebook e Instagram', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  // meta: cuerpo de la función simulada metaConnect (se pasa como texto).
  const abrir = (page, meta) => page.evaluate((src) => {
    __fn.importSources = () => ({ sources: [] });
    __fn.emailIngest = () => ({ disponible: false });
    __fn.apiAccess = () => ({ keys: [] });
    __fn.metaConnect = new Function('d', src);
    closePublish(); navigateUserSection('integraciones');
  }, meta);

  test('sin configurar: explica cómo pegar enlaces; sin conectar: botón Conectar con Facebook', async ({ page }) => {
    await page.evaluate(() => {
      window.__metaDisp = false;
      window.__metaFn = (d) => (!window.__metaDisp ? { disponible: false } : d.action === 'authUrl' ? { disponible: true, url: '#fb-dialog' } : { disponible: true, cuentas: [] });
    });
    await page.evaluate(() => { __fn.importSources = () => ({ sources: [] }); __fn.emailIngest = () => ({ disponible: false });
      __fn.apiAccess = () => ({ keys: [] }); __fn.metaConnect = (d) => window.__metaFn(d); closePublish(); navigateUserSection('integraciones'); });
    await expect(page.locator('#intMeta')).toContainText('Muy pronto');
    await page.evaluate(() => { window.__metaDisp = true; _intLoadMeta(); });
    await page.locator('#intMeta button', { hasText: 'Conectar con Facebook' }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#fb-dialog');
  });

  test('conectado: elige cuenta, ve posts (preselecciona los de texto no importados), importa en tandas y abre la revisión', async ({ page }) => {
    await page.evaluate(() => {
      window.__posts = Array.from({ length: 12 }, (_, i) => ({ id: `111_${i}`, texto: i === 0 ? '¡Feliz día!' : `Vendo depa ${i} en Surco, 3 dorm, 90 m2, US$ 185 mil`,
        foto: null, fotos: 2, video: i === 1, enlace: 'x', fecha: '2026-10-20', importado: i === 2 }));
    });
    await abrir(page, `
      if (d.action === 'posts') return { posts: window.__posts, after: null };
      if (d.action === 'import') return { batchId: 'M1', creados: d.postIds.length, importados: d.postIds, limite: false };
      return { disponible: true, cuentas: [{ red: 'facebook', id: '111', nombre: 'Inmobiliaria Sol' }, { red: 'instagram', id: '178', nombre: '@inmobiliaria.sol', pageId: '111' }] };`);
    await expect(page.locator('#intMeta')).toContainText('Inmobiliaria Sol');
    await page.locator('#intMeta button', { hasText: '@inmobiliaria.sol' }).click();
    await page.locator('#intMeta button', { hasText: 'Ver mis posts' }).click();
    await expect(page.locator('#intMeta')).toContainText('10 elegidos');
    await expect(page.locator('#intMeta')).toContainText('ya importado');
    await expect(page.locator('#intMeta')).toContainText('🎬 video');
    await page.evaluate(() => {
      window.__drafts = [];
      _pubDraftsLoad = async () => { _pubDraftGroups = [{ batchId: 'M1', source: 'redes', sourceName: 'Instagram · @inmobiliaria.sol', at: 1,
        docs: [{ id: 'd1', row: { direccion: 'Av. X 1', distrito: 'Surco', precio: '185000' }, photoUrls: [] }] }]; };
    });
    await page.locator('#intMeta button', { hasText: 'Importar 10 posts' }).click();
    await expect.poll(() => page.evaluate(() => _pubBulkStep)).toBe(2);
    const imp = (await calls(page, 'metaConnect')).filter((c) => c.action === 'import');
    expect(imp.map((c) => c.postIds.length)).toEqual([10]);
    expect(imp[0]).toMatchObject({ red: 'instagram', id: '178' });
    expect(imp[0].postIds).not.toContain('111_0'); // sin texto de inmueble
    expect(imp[0].postIds).not.toContain('111_2'); // ya importado
    expect((await page.evaluate(() => __toasts)).join(' ')).toContain('10 inmuebles listos para revisar');
  });

  test('vuelta de Facebook Login: abre Integraciones con el aviso y limpia el enlace', async ({ page }) => {
    await page.evaluate(() => { __fn.importSources = () => ({ sources: [] }); __fn.emailIngest = () => ({ disponible: false });
      __fn.apiAccess = () => ({ keys: [] }); __fn.metaConnect = () => ({ disponible: true, cuentas: [] });
      auth.onAuthStateChanged = (cb) => { setTimeout(() => cb(window.__user), 0); return () => {}; };
      closePublish(); _intMetaReturn('#integraciones-meta-sin-paginas'); });
    await expect(page.locator('#userSectionContent')).toContainText('🔌 Integraciones');
    await expect.poll(() => page.evaluate(() => __toasts.join(' '))).toContain('no administra ninguna página');
    expect(await page.evaluate(() => location.hash)).toBe('#integraciones');
  });
});
