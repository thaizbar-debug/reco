// Fotos en la web: calidad automática (repetidas, oscuras, borrosas, baja
// resolución), portada y orden, HEIC en cualquier navegador, subida en
// paralelo con reintentos y miniaturas, y edición de las fotos de una
// publicación ya enviada. Las fotos se generan en el navegador; Storage y
// las Cloud Functions se simulan.
const { test, expect } = require('@playwright/test');
const { setupImportPage } = require('./helpers/browser-stubs');

// Fotos de prueba generadas con canvas → File.
const GEN = `
window.__mkFoto = async (kind, name, seed) => {
  const W = kind === 'chica' ? 600 : kind === 'repetida' ? 1000 : 1200, H = Math.round(W * 0.75);
  const base = document.createElement('canvas'); base.width = 1200; base.height = 900;
  const bx = base.getContext('2d');
  let r = seed || 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  bx.fillStyle = '#e8e0d0'; bx.fillRect(0, 0, 1200, 900);
  for (let i = 0; i < 900; i++) { bx.fillStyle = 'hsl(' + Math.floor(rnd() * 360) + ',60%,' + (30 + Math.floor(rnd() * 50)) + '%)';
    bx.fillRect(rnd() * 1200, rnd() * 900, 8 + rnd() * 60, 8 + rnd() * 60); }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  if (kind === 'borrosa') cx.filter = 'blur(14px)';
  if (kind === 'oscura') { cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H); cx.globalAlpha = 0.12; }
  cx.drawImage(base, 0, 0, W, H);
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.9));
  return new File([blob], name || kind + '.jpg', { type: 'image/jpeg' });
};`;

test.describe('Fotos: calidad, portada y orden', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); await page.evaluate(GEN); });

  test('detecta repetidas, oscuras, borrosas y de baja resolución', async ({ page }) => {
    const r = await page.evaluate(async () => {
      _pd.photos = [];
      const files = [await __mkFoto('nitida', 'sala.jpg', 7), await __mkFoto('repetida', 'sala-copia.jpg', 7), await __mkFoto('borrosa', 'mov.jpg', 9),
        await __mkFoto('oscura', 'noche.jpg', 11), await __mkFoto('chica', 'mini.jpg', 13), await __mkFoto('nitida', 'cocina.jpg', 21)];
      await _pubHandleFiles(files);
      return { n: _pd.photos.length, issues: _pd.photos.map(_pubPhotoIssues), toasts: __toasts.join(' | '),
        advice: _pubPhotoAdviceHTML(_pd.photos), strip: _pubPhotoStripHTML('pd', _pd.photos) };
    });
    expect(r.n).toBe(5); // la copia de la sala no entra
    expect(r.toasts).toContain('1 foto repetida');
    expect(r.issues).toEqual([[], ['Borrosa'], ['Oscura'], ['Baja resolución'], []]);
    expect(r.advice).toContain('3 fotos con aviso');
    expect(r.advice).not.toContain('5 fotos o más'); // ya tiene 5
    expect(r.strip).toContain('⚠️ Borrosa');
    expect(r.strip).toContain('⭐ PORTADA');
  });

  test('portada, mover y arrastrar (formulario y carga masiva); máximo 20 en ambos', async ({ page }) => {
    const r = await page.evaluate(async () => {
      _pd.photos = ['data:a', 'data:b', 'data:c', 'data:d'];
      _pubPhotoOp('pd', 'portada', 2);           // c, a, b, d
      const p1 = _pd.photos.join('');
      _pubPhotoOp('pd', 'der', 1);               // c, b, a, d
      _pubPhotoOp('pd', 'izq', 3);               // c, b, d, a
      const p2 = _pd.photos.join('');
      _pubPhotoOp('pd', 'mover', 0, 3);          // arrastrar la 1 al final: b, d, a, c
      _pubPhotoOp('pd', 'quitar', 1);            // b, a, c
      _pubPhotoOp('pd', 'izq', 0);               // nada
      const strip = _pubPhotoStripHTML('pd', ['data:x', 'data:y']);
      return { p1, p2, p3: _pd.photos.join(''), bulkMax: _PUB_BULK_PHOTO_MAX, max: _PUB_MAX_PHOTOS, strip };
    });
    expect(r.p1).toBe('data:cdata:adata:bdata:d');
    expect(r.p2).toBe('data:cdata:bdata:ddata:a');
    expect(r.p3).toBe('data:bdata:adata:c');
    expect([r.max, r.bulkMax]).toEqual([20, 20]);
    expect(r.strip).toContain('title="Usar como portada"');
    expect(r.strip).toContain('draggable="true"');
  });

  test('carga masiva: la tira del inmueble usa portada, orden y avisos', async ({ page }) => {
    await page.evaluate(async () => {
      _pubBulkRows = [_pubBulkEntry({ direccion: 'Av. X 1', distrito: 'Lince', tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta',
        tipo_moneda: 'USD', precio: '100000', area_techada: '80', titulo: 'Depa', descripcion: 'x' }, { photos: [] })];
      _pubBulkPhotoIdx = 0; _pubBulkGo(3);
      await _pubBulkPhotoFiles([await __mkFoto('nitida', 'a.jpg', 3), await __mkFoto('oscura', 'b.jpg', 5)]);
    });
    await expect(page.locator('#pubModal')).toContainText('⭐ PORTADA');
    await expect(page.locator('#pubModal')).toContainText('⚠️ Oscura');
    await expect(page.locator('#pubModal')).toContainText('5 fotos o más');
    await page.locator('#pubModal button[title="Usar como portada"]').first().click();
    expect(await page.evaluate(() => _pubPhotoIssues(_pubBulkCurrentRow().photos[0]))).toEqual(['Oscura']);
  });
});

test.describe('Fotos de iPhone (HEIC)', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); await page.evaluate(GEN); });

  test('si el navegador no abre la foto HEIC, se convierte con heic2any', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const jpg = await __mkFoto('nitida', 'x.jpg', 3);
      let llamado = null;
      window.heic2any = async (o) => { llamado = { name: o.blob.name, toType: o.toType }; return jpg; };
      const heic = new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99])], 'IMG_0001.HEIC', { type: 'image/heic' });
      const url = await _pubToJpegDataUrl(heic);
      let error = '';
      try { await _pubToJpegDataUrl(new File([new Uint8Array([1, 2, 3])], 'roto.png', { type: 'image/png' })); } catch (e) { error = e.message; }
      return { llamado, jpeg: url.startsWith('data:image/jpeg;base64,'), error };
    });
    expect(r.llamado).toEqual({ name: 'IMG_0001.HEIC', toType: 'image/jpeg' });
    expect(r.jpeg).toBe(true);
    expect(r.error).toContain('Formato no soportado'); // un PNG roto no pasa por el convertidor
  });
});

test.describe('Subida de fotos', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); await page.evaluate(GEN); });

  test('3 a la vez, con miniatura, reintenta lo que falla y respeta el orden', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const fotos = [];
      for (let i = 0; i < 7; i++) fotos.push(await _pubToJpegDataUrl(await __mkFoto('nitida', i + '.jpg', 50 + i)));
      const puts = []; let activos = 0, maxActivos = 0; const fallos = { 'publications/P1/u1/4.jpg': 1, 'publications/P1/u1/6.jpg': 9 };
      storage.ref = (path) => ({
        put: async (blob) => {
          activos++; maxActivos = Math.max(maxActivos, activos);
          await new Promise((ok) => setTimeout(ok, 20));
          activos--;
          if (fallos[path]) { fallos[path]--; throw Object.assign(new Error('red'), { code: 'storage/retry-limit-exceeded' }); }
          puts.push({ path, size: blob.size });
          return { ref: { getDownloadURL: async () => 'https://st/' + path } };
        },
      });
      const prog = [];
      const t0 = Date.now();
      const up = await _uploadPublicationPhotos('P1', fotos, 0, (d, t) => prog.push(d + '/' + t));
      const thumbSize = puts.find((p) => p.path.endsWith('/t0.jpg')).size, fullSize = puts.find((p) => p.path.endsWith('/0.jpg') && !p.path.endsWith('t0.jpg')).size;
      return { up, maxActivos, prog, thumbChica: thumbSize < fullSize, ms: Date.now() - t0 };
    });
    expect(r.maxActivos).toBeLessThanOrEqual(3);
    expect(r.maxActivos).toBeGreaterThan(1);
    expect(r.up.failed).toBe(1); // la 6 falló 3 veces
    expect(r.up.urls).toEqual([0, 1, 2, 3, 4, 5].map((n) => `https://st/publications/P1/u1/${n}.jpg`)); // la 4 entró al reintentar
    expect(r.up.thumbs).toEqual([0, 1, 2, 3, 4, 5].map((n) => `https://st/publications/P1/u1/t${n}.jpg`));
    expect(r.thumbChica).toBe(true);
    expect(r.prog[r.prog.length - 1]).toBe('7/7');
  });

  test('las tarjetas y el mapa usan la miniatura; el detalle, la foto grande', async ({ page }) => {
    const r = await page.evaluate(() => {
      const p = _pubDocToProperty('X1', { address: 'a', photoUrls: ['https://f/0.jpg', 'https://f/1.jpg'], thumbUrls: ['https://f/t0.jpg', ''] });
      const a = driveAssets(p);
      return { photos: a.photos, thumbs: a.thumbs, card: _propCard(p) };
    });
    expect(r.photos).toEqual(['https://f/0.jpg', 'https://f/1.jpg']);
    expect(r.thumbs).toEqual(['https://f/t0.jpg', 'https://f/1.jpg']); // sin miniatura: la foto
    expect(r.card).toContain('https://f/t0.jpg');
  });
});

test.describe('Editar fotos de una publicación enviada', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); await page.evaluate(GEN); });

  test('quitar, agregar y ordenar: sube las nuevas después de la más alta y guarda el orden', async ({ page }) => {
    await page.evaluate(() => {
      storage.ref = (path) => ({ put: async () => ({ ref: { getDownloadURL: async () => 'https://st/' + path } }) });
      __fn.updatePublicationPhotos = (d) => ({ status: 'pending', photoUrls: d.photoUrls, thumbUrls: d.thumbUrls });
      const enc = (p) => 'https://firebasestorage.googleapis.com/v0/b/b/o/' + encodeURIComponent(p) + '?alt=media';
      window.__u = (n) => enc('publications/P1/u1/' + n + '.jpg');
      window.__t = (n) => enc('publications/P1/u1/t' + n + '.jpg');
      closePublish();
      _pubPhotoEditor({ id: 'P1', status: 'approved', photoUrls: [__u(0), __u(4)], thumbUrls: [__t(0), __t(4)] });
    });
    await expect(page.locator('#pubPeOverlay')).toContainText('vuelve a revisión');
    await page.evaluate(async () => {
      await _pubPeAdd([await __mkFoto('nitida', 'nueva.jpg', 77)]);
      _pubPhotoOp('pe', 'portada', 2);   // la nueva de portada
      _pubPhotoOp('pe', 'quitar', 1);    // quita la 0 (queda: nueva, 4)
    });
    await expect(page.locator('#pubPeSave')).toHaveText('Guardar (1 nueva)');
    await page.locator('#pubPeSave').click();
    await expect(page.locator('#pubPeOverlay')).toHaveCount(0);
    const [call] = await page.evaluate(() => __calls.filter((c) => c.name === 'updatePublicationPhotos').map((c) => c.data));
    const r = await page.evaluate(() => ({ u4: __u(4), t4: __t(4) }));
    expect(call.pubId).toBe('P1');
    expect(call.photoUrls).toEqual(['https://st/publications/P1/u1/5.jpg', r.u4]); // la nueva es la 5 (después de la 4)
    expect(call.thumbUrls).toEqual(['https://st/publications/P1/u1/t5.jpg', r.t4]);
    expect((await page.evaluate(() => __toasts)).join(' ')).toContain('vuelve a revisión');
  });

  test('Mis publicaciones: botón 📷 Fotos y aviso cuando las fotos no se subieron', async ({ page }) => {
    await page.evaluate(async () => {
      const pubs = [{ id: 'P9', status: 'pending', photosPending: true, photoUrls: ['https://f/0.jpg'], thumbUrls: ['https://f/t0.jpg'],
        address: 'Av. Arequipa 100', district: 'Lince', type: 'Departamento', currency: 'USD', price: 100000 }];
      const snap = { docs: pubs.map((p) => ({ id: p.id, data: () => p })) };
      db.collection = () => ({ where: () => ({ orderBy: () => ({ get: async () => snap }), get: async () => snap }) });
      closePublish();
      navigateUserSection('publicaciones');
    });
    const sec = page.locator('#userSectionContent');
    await expect(sec).toContainText('Algunas fotos no se subieron');
    await expect(sec.locator('.us-prop-img').first()).toHaveAttribute('style', /t0\.jpg/); // miniatura
    await sec.locator('button', { hasText: '📷 Fotos (1)' }).click();
    await expect(page.locator('#pubPeOverlay')).toContainText('Fotos de la publicación');
  });
});
