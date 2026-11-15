// Fotos desde la computadora: ZIP, carpetas arrastradas o elegidas y, en la
// carga masiva, una subcarpeta por inmueble. Las fotos se generan con canvas
// y los ZIP con JSZip en el navegador.
const { test, expect } = require('@playwright/test');
const { setupImportPage } = require('./helpers/browser-stubs');

const GEN = `
window.__foto = async (seed) => {
  const cv = document.createElement('canvas'); cv.width = 900; cv.height = 675;
  const cx = cv.getContext('2d');
  let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  cx.fillStyle = '#ddd'; cx.fillRect(0, 0, 900, 675);
  for (let i = 0; i < 500; i++) { cx.fillStyle = 'hsl(' + Math.floor(rnd() * 360) + ',60%,50%)'; cx.fillRect(rnd() * 900, rnd() * 675, 10 + rnd() * 60, 10 + rnd() * 60); }
  return new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.9));
};
window.__zip = async (nombre, archivos) => {
  const JSZip = await _pubLoadScript(_PUB_JSZIP_URL, 'JSZip');
  const z = new JSZip();
  for (const [ruta, seed] of archivos) z.file(ruta, seed === 'txt' ? 'hola' : await __foto(seed));
  return new File([await z.generateAsync({ type: 'blob' })], nombre, { type: 'application/zip' });
};
window.__filas = (n) => {
  const base = { distrito: 'Lince', tipo_propiedad: 'Casa', tipo_publicacion: 'Venta', precio: '1', area_techada: '90', titulo: 't', descripcion: 'd' };
  _pubBulkFileName = 'x.xlsx';
  _pubBulkLoadRows(['Av. Pardo 340', 'Jr. Huiracocha 1200', 'Calle Las Flores 55'].slice(0, n).map((direccion) => ({ ...base, direccion })));
  _pubBulkGo(3);
};`;

test.describe('Fotos desde la computadora', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); await page.evaluate(GEN); });

  test('un ZIP se abre: entran sus fotos (también en subcarpetas), sin archivos ocultos ni otros formatos', async ({ page }) => {
    const r = await page.evaluate(async () => {
      __filas(1);
      const zip = await __zip('fotos.zip', [['sala.jpg', 3], ['interior/cocina.jpg', 5], ['__MACOSX/._sala.jpg', 7], ['.oculta.jpg', 9], ['leeme.txt', 'txt']]);
      await _pubBulkPhotoFiles([zip]);
      return { n: _pubBulkCurrentRow().photos.length, html: document.getElementById('pubBulkStepBody').innerHTML };
    });
    expect(r.n).toBe(2);
    expect(r.html).toContain('Arrastra fotos, una carpeta o un ZIP');
    expect(r.html).toContain('📂 Carpeta');
    expect(r.html).not.toContain('Agrega las fotos, inmueble por inmueble');
  });

  test('una carpeta arrastrada se lee completa, con sus subcarpetas', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const blob = await __foto(11);
      // Entradas como las que da el navegador al soltar una carpeta.
      const archivo = (ruta) => ({ isFile: true, isDirectory: false, fullPath: '/' + ruta, file: (ok) => ok(new File([blob], ruta.split('/').pop(), { type: 'image/jpeg' })) });
      const carpeta = (ruta, hijos) => ({ isFile: false, isDirectory: true, fullPath: '/' + ruta,
        createReader: () => { let dado = false; return { readEntries: (ok) => { ok(dado ? [] : hijos); dado = true; } }; } });
      const raiz = carpeta('Depa Lince', [archivo('Depa Lince/1.jpg'), carpeta('Depa Lince/dormitorio', [archivo('Depa Lince/dormitorio/2.jpg')])]);
      const files = await _pubDroppedFiles({ items: [{ webkitGetAsEntry: () => raiz }], files: [] });
      return files.map((f) => f._ruta);
    });
    expect(r).toEqual(['Depa Lince/1.jpg', 'Depa Lince/dormitorio/2.jpg']);
  });

  test('carga masiva: un ZIP con una subcarpeta por inmueble arma un grupo por carpeta, asignado por nombre', async ({ page }) => {
    const r = await page.evaluate(async () => {
      __filas(3);
      const html = document.getElementById('pubBulkStepBody').innerHTML;
      const zip = await __zip('inventario.zip', [['Huiracocha 1200/a.jpg', 3], ['Huiracocha 1200/b.jpg', 5], ['Pardo 340 Miraflores/c.jpg', 7], ['portada.jpg', 9]]);
      await _pubPhotoBatchFiles([zip]);
      return { html, grupos: _pubPhotoGroups.map((g) => ({ nombre: g.nombre, n: g.photos.length, row: g.row })) };
    });
    expect(r.html).toContain('¿Fotos de varios inmuebles juntas?');
    expect(r.grupos).toEqual([
      { nombre: 'Huiracocha 1200', n: 2, row: 1 },
      { nombre: 'Pardo 340 Miraflores', n: 1, row: 0 },
      { nombre: 'Fotos sueltas', n: 1, row: -1 }, // la foto suelta queda sin asignar
    ]);
  });

  test('con un solo inmueble no aparece la opción de varios inmuebles; las fotos de los archivos se muestran para asignar', async ({ page }) => {
    const r = await page.evaluate(() => {
      __filas(1);
      _pubDocPhotoPool = ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'];
      _pubBulkRefresh();
      return document.getElementById('pubBulkStepBody').innerHTML;
    });
    expect(r).not.toContain('¿Fotos de varios inmuebles juntas?');
    expect(r).toContain('📎 Fotos de tus archivos y enlaces (2)');
  });
});
