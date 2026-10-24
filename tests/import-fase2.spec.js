// Fase 2 de carga inteligente: flyers y capturas, fotos en bloque agrupadas
// por EXIF, importar un perfil de portal y compartir desde el celular. Los
// archivos se leen de verdad (tests/fixtures/import); las Cloud Functions se
// simulan.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { setupImportPage } = require('./helpers/browser-stubs');

const FIX = path.join(__dirname, 'fixtures', 'import');
const FOTOS = ['a1', 'a2', 'b1', 'b2', 'c1'].map((n) => path.join(FIX, 'fotos-bloque', `${n}.jpg`));
const calls = (page, name) => page.evaluate((n) => __calls.filter(c => c.name === n).map(c => c.data), name);

test.describe('Fase 2: flyers y capturas', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  test('varias imágenes van a la IA como páginas escaneadas y quedan como fotos disponibles', async ({ page }) => {
    await page.evaluate(() => {
      __fn.extractListings = () => ({ batchId: 'I1', drafts: [
        __draft('a', { direccion: 'Lurín', distrito: 'Lurín', tipo_propiedad: 'Lote', tipo_publicacion: 'Venta', precio: 'US$ 90,000', area_terreno: '500', titulo: 'Terreno', descripcion: 'x' }),
      ] });
    });
    await page.setInputFiles('#pubBulkInput', FOTOS.slice(0, 3));
    await page.waitForFunction(() => _pubBulkStep === 2, null, { timeout: 30000 });
    const [d] = await calls(page, 'extractListings');
    expect(d).toMatchObject({ kind: 'document', fileType: 'imagenes', sourceName: '3 imágenes' });
    expect(d.images.map(i => i.page)).toEqual(['1', '2', '3']);
    expect(d.images.every(i => i.dataUrl.startsWith('data:image/jpeg;base64,'))).toBe(true);
    expect(d.text).toContain('=== Imagen 1: a1.jpg (ver imagen) ===');
    const r = await page.evaluate(() => ({ pool: _pubDocPhotoPool.length, source: _pubBulkRows[0].source, toasts: __toasts }));
    expect(r).toMatchObject({ pool: 3, source: 'documento' });
    expect(r.toasts.join(' ')).toContain('1 inmueble encontrado');
  });

  test('más de 6 imágenes se envían en varias partes', async ({ page }) => {
    await page.evaluate(() => { __fn.extractListings = () => ({ batchId: 'I2', drafts: [] }); });
    const files = Array.from({ length: 8 }, (_, i) => FOTOS[i % FOTOS.length]);
    await page.setInputFiles('#pubBulkInput', files);
    await page.waitForFunction(() => __calls.filter(c => c.name === 'extractListings').length === 2, null, { timeout: 30000 });
    const ds = await calls(page, 'extractListings');
    expect(ds.map(d => d.images.length)).toEqual([6, 2]);
  });
});

test.describe('Fase 2: fotos en bloque', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  test('EXIF: fecha y GPS de una foto real', async ({ page }) => {
    const info = await page.evaluate(async () => {
      const buf = await (await fetch('/tests/fixtures/import/fotos-bloque/b1.jpg')).arrayBuffer();
      return _pubExifInfo(buf);
    });
    expect(new Date(info.time).getHours()).toBe(10);
    expect(new Date(info.time).getMinutes()).toBe(5);
    expect(info.lat).toBeCloseTo(-12.1390, 3);
    expect(info.lng).toBeCloseTo(-76.9930, 3);
  });

  test('agrupa por tiempo y por distancia', async ({ page }) => {
    const groups = await page.evaluate(() => {
      const t = (h, m) => new Date(2026, 9, 20, h, m).getTime();
      return _pubGroupPhotos([
        { id: 'c1', time: t(11, 30), lat: -12.1391, lng: -76.9931 },
        { id: 'a1', time: t(10, 0), lat: -12.1211, lng: -77.0297 },
        { id: 'b1', time: t(10, 5), lat: -12.1390, lng: -76.9930 }, // 5 min pero a ~4 km: otro inmueble
        { id: 'a2', time: t(10, 2), lat: -12.1212, lng: -77.0298 },
        { id: 'x', time: t(11, 40) }, // sin GPS: solo cuenta el tiempo
      ]).map(g => g.map(x => x.id));
    });
    expect(groups).toEqual([['a1', 'a2'], ['b1'], ['c1', 'x']]);
  });

  test('sube las fotos juntas, propone un grupo por inmueble y asigna', async ({ page }) => {
    await page.evaluate(() => {
      const base = { distrito: 'Lince', tipo_propiedad: 'Casa', tipo_publicacion: 'Venta', precio: '1', area_techada: '90', titulo: 't', descripcion: 'd' };
      _pubBulkFileName = 'x.xlsx';
      _pubBulkLoadRows([{ ...base, direccion: 'Casa A' }, { ...base, direccion: 'Casa B' }]);
      _pubBulkGo(3);
    });
    expect(await page.evaluate(() => document.getElementById('pubBulkStepBody').innerHTML)).toContain('Súbelas de una vez');
    await page.setInputFiles('#pubBatchInput', FOTOS);
    await page.waitForFunction(() => _pubPhotoGroups.length > 0, null, { timeout: 30000 });
    const g = await page.evaluate(() => ({ groups: _pubPhotoGroups.map(x => [x.photos.length, x.row]), html: document.getElementById('pubBulkStepBody').innerHTML }));
    expect(g.groups).toEqual([[2, 0], [2, 1], [1, -1]]); // el tercero no tiene inmueble: queda sin asignar
    expect(g.html).toContain('Fotos agrupadas (3 grupos)');
    const r = await page.evaluate(() => {
      _pubPhotoGroupSet(2, 1); // el tercer grupo también es de la Casa B
      _pubPhotoGroupsApply();
      return { photos: _pubBulkRows.map(a => a.photos.length), groups: _pubPhotoGroups.length, pool: _pubDocPhotoPool.length };
    });
    expect(r).toEqual({ photos: [2, 3], groups: 0, pool: 5 });
  });
});

test.describe('Fase 2: perfil completo de un portal', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  test('lista los avisos del perfil, importa los elegidos al mismo lote y separa sus fotos', async ({ page }) => {
    await page.evaluate(() => {
      const png = (() => { const c = document.createElement('canvas'); c.width = c.height = 300; c.getContext('2d').fillRect(0, 0, 300, 300); return c.toDataURL('image/png'); })();
      __fn.importListingPage = (d) => {
        if (d.modo === 'perfil') return { avisos: [
          { url: 'https://urbania.pe/inmueble/a-1234567', title: 'Dpto A' },
          { url: 'https://urbania.pe/inmueble/b-2345678', title: 'Casa B' },
          { url: 'https://urbania.pe/inmueble/c-3456789', title: 'Local C' },
        ] };
        const n = d.url.includes('/a-') ? 'A' : 'B';
        return { batchId: 'P1', photos: [{ id: 'u-1', dataUrl: png }], drafts: [
          __draft(n, { direccion: 'Calle ' + n, distrito: 'Lince', tipo_propiedad: 'Casa', tipo_publicacion: 'Venta', precio: '1', area_techada: '90', titulo: n, descripcion: 'd' }, ['u-1']),
        ] };
      };
    });
    await page.fill('#pubUrlInput', 'https://urbania.pe/inmobiliarias/demo-1234567');
    await page.check('#pubUrlAuth');
    await page.click('text=Importar todos los de mi perfil');
    await page.waitForFunction(() => document.getElementById('pubBulkPreview').textContent.includes('3 avisos en el perfil'));
    await page.evaluate(() => { _pubProfileAvisos[2].sel = false; _pubProfileRender(); });
    await page.click('text=Importar 2 avisos');
    await page.waitForFunction(() => _pubBulkStep === 2, null, { timeout: 30000 });
    const r = await page.evaluate(() => ({
      calls: __calls.map(c => [c.data.modo || 'aviso', c.data.url, c.data.batchId || null]),
      rows: _pubBulkRows.map(a => [a.row.direccion, a.photos.length, a.source]),
      pool: _pubDocPhotoPool.length, name: _pubBulkFileName,
    }));
    expect(r.calls).toEqual([
      ['perfil', 'https://urbania.pe/inmobiliarias/demo-1234567', null],
      ['aviso', 'https://urbania.pe/inmueble/a-1234567', null],
      ['aviso', 'https://urbania.pe/inmueble/b-2345678', 'P1'],
    ]);
    expect(r.rows).toEqual([['Calle A', 1, 'url'], ['Calle B', 1, 'url']]);
    expect(r.pool).toBe(2); // "u-1" de cada aviso no se pisan
    expect(r.name).toBe('urbania.pe (perfil)');
  });

  test('si se acaba el límite por hora, carga lo importado y avisa cuántos faltan', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let n = 0;
      __fn.importListingPage = () => {
        if (++n > 1) throw Object.assign(new Error('Límite'), { code: 'functions/resource-exhausted' });
        return { batchId: 'P2', photos: [], drafts: [__draft('x', { direccion: 'A', distrito: 'Lince', precio: '1', area_techada: '1', titulo: 't', descripcion: 'd' })] };
      };
      _pubProfileAvisos = [1, 2, 3].map(i => ({ url: `https://urbania.pe/inmueble/x-${i}000000`, title: 'x', sel: true }));
      await _pubProfileImport();
      return { rows: _pubBulkRows.length, toasts: __toasts };
    });
    expect(r.rows).toBe(1);
    expect(r.toasts.join(' ')).toContain('faltan 2');
  });
});

test.describe('Fase 2: compartir con ReCo (app instalada)', () => {
  test('manifiesto con share_target e íconos', async ({ request }) => {
    const m = await (await request.get('http://localhost:3123/manifest.webmanifest')).json();
    expect(m.share_target).toMatchObject({ action: './compartir', method: 'POST', enctype: 'multipart/form-data' });
    expect(m.share_target.params.files[0].name).toBe('archivos');
    for (const icon of m.icons) expect((await request.get('http://localhost:3123/' + icon.src)).ok()).toBe(true);
  });

  test('el service worker recibe lo compartido y la página lo lleva al importador', async ({ page }) => {
    await setupImportPage(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    });
    const r = await page.evaluate(async () => {
      // Lo que haría el sistema al compartir texto + 2 fotos desde WhatsApp.
      const fd = new FormData();
      fd.append('text', 'Vendo depa en Lince 70 m2, US$ 120 mil, 2 dorm');
      const foto = await new Promise(res => { const c = document.createElement('canvas'); c.width = c.height = 300; c.toBlob(res, 'image/jpeg'); });
      fd.append('archivos', new File([foto], 'f1.jpg', { type: 'image/jpeg' }));
      fd.append('archivos', new File([foto], 'f2.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/compartir', { method: 'POST', body: fd });
      __fn.extractListings = () => ({ batchId: 'S1', drafts: [__draft('a', { direccion: 'Lince', distrito: 'Lince', tipo_propiedad: 'depa', tipo_publicacion: 'Vendo', precio: 'US$ 120 mil', area_techada: '70', titulo: 't', descripcion: 'd' })] });
      await _pubReadShared();
      await new Promise(r => setTimeout(r, 300));
      return { redirected: res.redirected, finalUrl: res.url, call: __calls.find(c => c.name === 'extractListings'),
        rows: _pubBulkRows.map(a => [a.row.tipo_propiedad, a.photos.length]), left: await caches.has('reco-compartir') };
    });
    expect(r.redirected).toBe(true);
    expect(r.finalUrl).toBe('http://localhost:3123/'); // fetch quita el "#compartido"; una navegación lo conserva
    expect(r.call.data).toMatchObject({ kind: 'text', text: 'Vendo depa en Lince 70 m2, US$ 120 mil, 2 dorm' });
    expect(r.rows).toEqual([['Departamento', 2]]); // un solo inmueble: las fotos son suyas
    expect(r.left).toBe(false); // lo compartido no queda guardado
  });

  test('navegación real: el POST de compartir termina en ./#compartido con lo compartido guardado', async ({ page }) => {
    await setupImportPage(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      const f = document.createElement('form');
      f.method = 'POST'; f.action = '/compartir'; f.enctype = 'multipart/form-data';
      f.innerHTML = '<input name="title" value="Aviso"><input name="text" value="Casa en Surco 200 m2"><input name="url" value="">';
      document.body.appendChild(f);
      f.submit();
    });
    await page.waitForURL(/#compartido$/);
    const meta = await page.evaluate(async () => (await (await caches.open('reco-compartir')).match('/compartir/meta')).json());
    expect(meta).toEqual({ title: 'Aviso', text: 'Casa en Surco 200 m2', url: '', files: [] });
  });

  test('solo imágenes: pregunta si son fotos o flyers', async ({ page }) => {
    await setupImportPage(page);
    const r = await page.evaluate(async () => {
      const blob = await new Promise(res => { const c = document.createElement('canvas'); c.width = c.height = 300; c.toBlob(res, 'image/jpeg'); });
      _pubShared = { files: [new File([blob], 'a.jpg', { type: 'image/jpeg' })], text: '', url: '', title: '' };
      await _pubUseShared();
      const html = document.getElementById('pubSharedBox').innerHTML;
      await _pubSharedAs('fotos');
      return { html, tab: _pubTab, photos: _pd.photos.length };
    });
    expect(r.html).toContain('Fotos de un inmueble');
    expect(r.html).toContain('Flyers o capturas');
    expect(r).toMatchObject({ tab: 'single', photos: 1 });
  });

  test('un enlace compartido llena "Desde un enlace"', async ({ page }) => {
    await setupImportPage(page);
    const v = await page.evaluate(async () => {
      _pubShared = { files: [], text: 'Mira https://urbania.pe/inmueble/x-1234567', url: '', title: '' };
      await _pubUseShared();
      return document.getElementById('pubUrlInput').value;
    });
    expect(v).toBe('https://urbania.pe/inmueble/x-1234567');
  });
});

test.describe('Fase 2: bot de WhatsApp (web)', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  test('sin número configurado no se muestra la tarjeta', async ({ page }) => {
    const html = await page.evaluate(() => document.getElementById('pubBulkStepBody').innerHTML);
    expect(html).not.toContain('ReCo en tu WhatsApp');
  });

  test('con número: genera el código y el enlace wa.me con VINCULAR', async ({ page }) => {
    const box = await page.evaluate(async () => {
      // La constante se lee al pintar: se simula con un número configurado.
      const html = _pubBulkUploadHTML.toString();
      window._pubBulkUploadHTML = new Function(`const _PUB_WA_BOT_NUMBER='51999888777'; return (${html})`)();
      renderPublish();
      __fn.whatsappLink = () => ({ code: '482913', minutes: 15, linked: ['+•••••••4321'] });
      const card = document.getElementById('pubBulkStepBody').innerHTML;
      return { card };
    });
    expect(box.card).toContain('ReCo en tu WhatsApp');
    // _pubWaBotConnect usa la constante real (vacía): el enlace se arma con ella.
    const r = await page.evaluate(async () => {
      await _pubWaBotConnect();
      return { html: document.getElementById('pubWaBotBox').innerHTML, call: __calls.find(c => c.name === 'whatsappLink').data };
    });
    expect(r.call).toEqual({ action: 'code' });
    expect(r.html).toContain('VINCULAR 482913');
    expect(r.html).toContain('?text=VINCULAR%20482913');
    expect(r.html).toContain('Ya conectado: <strong>+•••••••4321</strong>');
  });

  test('borradores del bot: fotos guardadas; al publicar, el servidor las copia y las demás van después', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const botUrl = 'https://firebasestorage.googleapis.com/v0/b/reco.appspot.com/o/imports%2Fu1%2FB1%2F1.jpg?alt=media&token=t';
      _pubBulkLoadDrafts([{ id: 'd1', source: 'whatsapp', aiFields: [], notes: [], photoUrls: [botUrl],
        row: RecoImport.normalizeRow({ direccion: 'Av. 1', distrito: 'Lince', tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta', precio: '120000', area_techada: '70', titulo: 't', descripcion: 'd' }).row }],
        { batchId: 'B1', source: 'whatsapp' });
      const c = document.createElement('canvas'); c.width = c.height = 200;
      _pubBulkRows[0].photos.push(c.toDataURL('image/jpeg'));
      __fn.publishProperty = () => ({ publicationId: 'P1', photoUrls: ['https://s/0.jpg'] });
      const uploads = [];
      window._uploadPublicationPhotos = async (pubId, photos, start) => { uploads.push({ pubId, n: photos.length, start }); return ['https://s/1.jpg']; };
      window.closePublish = () => {};
      _pubBulkGo(4);
      await _pubBulkSubmit();
      return { path: _pubImportPhotoPath(botUrl), other: _pubImportPhotoPath('data:image/jpeg;base64,xx'),
        call: __calls.find(c => c.name === 'publishProperty').data, uploads };
    });
    expect(r.path).toBe('imports/u1/B1/1.jpg');
    expect(r.other).toBe('');
    expect(r.call.importPhotos).toEqual(['imports/u1/B1/1.jpg']);
    expect(r.call.source).toBe('whatsapp');
    expect(r.uploads).toEqual([{ pubId: 'P1', n: 1, start: 1 }]); // después de la copiada por el servidor
  });
});
