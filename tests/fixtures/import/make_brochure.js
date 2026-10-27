// Genera brochure-proyecto.pdf: brochure de proyecto de prueba (sin datos
// reales) con una página de solo fotos (renders, sin texto), una página de
// plano dibujado (sin imágenes) y una de "Otros proyectos".
// Uso: node make_brochure.js <ruta a chrome> <salida.pdf>
const { chromium } = require('playwright');
const html = `<!doctype html><html><head><style>
  @page { size: A4; margin: 0 } body { margin: 0; font-family: Arial, sans-serif }
  .pag { width: 210mm; height: 297mm; page-break-after: always; position: relative; box-sizing: border-box; padding: 20mm }
  .pag img { width: 80mm; height: 60mm; object-fit: cover; margin: 4mm }
  .plano { border: 3px solid #333; width: 120mm; height: 150mm; position: relative; margin-top: 10mm }
  .plano div { position: absolute; border: 2px solid #555 }
</style></head><body>
<div class="pag" style="background:#eee"><img class="foto"><img class="foto"><img class="foto"></div>
<div class="pag"><h2>Depa A01 — Piso 2 al 6</h2><p>Área techada: 98.50 m2<br>Área libre: 12.00 m2<br>Dormitorio principal 3.20m x 3.00m<br>Dormitorio 02 2.60m x 2.70m</p>
  <div class="plano"><div style="left:0;top:0;width:60mm;height:70mm"></div><div style="left:60mm;top:0;width:56mm;height:70mm"></div><div style="left:0;top:70mm;width:116mm;height:76mm"></div></div></div>
<div class="pag"><h2>Otros proyectos</h2><p>Residencial Los Olivos — Surco | Entrega inmediata. Depas de 3 dorm. desde 120 m2.</p></div>
</body></html>`;
(async () => {
  const b = await chromium.launch({ executablePath: process.argv[2] });
  const p = await b.newPage();
  await p.setContent(html);
  // "Renders" con textura (una imagen lisa se descarta como fondo).
  await p.evaluate(() => document.querySelectorAll('img.foto').forEach((img, k) => {
    const cv = document.createElement('canvas'); cv.width = 480; cv.height = 360;
    const cx = cv.getContext('2d');
    const g = cx.createLinearGradient(0, 0, 480, 360);
    g.addColorStop(0, ['#4a6fa5', '#8c5e3c', '#3d7a4f'][k]); g.addColorStop(1, '#f2e8d5');
    cx.fillStyle = g; cx.fillRect(0, 0, 480, 360);
    for (let i = 0; i < 40; i++) { cx.fillStyle = `rgba(0,0,0,${(i % 5) / 10})`; cx.fillRect((i * 37) % 480, (i * 53) % 360, 30, 20); }
    img.src = cv.toDataURL('image/jpeg', 0.9);
  }));
  await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true });
  await b.close();
})();
