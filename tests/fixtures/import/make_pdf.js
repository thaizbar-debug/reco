// Imprime <carpeta temporal>/doc.html (generado por make_fixtures.py) como
// inventario.pdf: 2 páginas con texto y fotos (más un logo chico) y 1 página
// "escaneada" (solo imagen, sin capa de texto).
// Uso: node make_pdf.js <ruta a chrome> <doc.html> <salida.pdf>
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.argv[2] });
  const p = await b.newPage();
  await p.goto('file://' + process.argv[3]);
  await p.pdf({ path: process.argv[4], format: 'A4' });
  await b.close();
})();
