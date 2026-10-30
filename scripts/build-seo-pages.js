#!/usr/bin/env node
// Genera las páginas SEO estáticas y reescribe sitemap.xml. Ver docs/SEO-PLAN.md.
//
// Usage:
//   node scripts/build-seo-pages.js
//
// Fuentes (scripts/seo/data.js):
//   - data/properties.json → registros Venta/Alquiler. Los Histórico NO se
//     publican: su detalle se desbloquea con llaves en la app.
//   - Firestore /publications con status 'approved' → solo si existe la
//     variable FIREBASE_SERVICE_ACCOUNT y firebase-admin está instalado.
//   - data/serie_precios_tasaciones_compact.json → páginas de precio del m².
//
// Salida (se borra y regenera completa en cada corrida):
//   inmueble/<slug>/index.html            Fase 2: una ficha por inmueble
//   busqueda-especial/index.html          Fase 3: buscador + directorio
//   busqueda-especial/<slug>/index.html   Fase 3: distrito/tipo/m²/dormitorios y precio del m²
//   busqueda-especial/inmuebles.json      datos del buscador
//   sitemap.xml
//
// Las páginas solo muestran lo que la app ya muestra públicamente en la
// ficha de Venta/Alquiler. Nunca se escriben datos del dueño (nombre,
// email, teléfono). La salida es determinista (sin timestamps) para que el
// workflow solo haga commit cuando algo cambia de verdad.

const fs = require('fs');
const path = require('path');
const { SITE, esc, slugFor, listingPath } = require('./seo/common');
const { ROOT, loadStatic, loadPublications, loadTasaciones } = require('./seo/data');
const { renderListing } = require('./seo/listing-pages');
const { buildSearch } = require('./seo/search-pages');

// Páginas estáticas que siempre van en el sitemap.
const STATIC_PAGES = ['/', '/landing.html'];
const OUT_DIRS = ['inmueble', 'busqueda-especial'];

function writePage(urlPath, html) {
  const dir = path.join(ROOT, urlPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

function renderSitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generado por scripts/build-seo-pages.js — no editar a mano. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <url><loc>${SITE}${e.path}</loc>${e.lastmod ? `<lastmod>${esc(e.lastmod)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

async function main() {
  const listings = loadStatic().concat(await loadPublications());

  const seen = new Set();
  for (const p of listings) {
    const s = slugFor(p);
    if (seen.has(s)) throw new Error(`Slug duplicado: ${s} (id ${p.id})`);
    seen.add(s);
  }
  listings.sort((a, b) => (slugFor(a) < slugFor(b) ? -1 : 1));

  const byGroup = new Map();
  for (const p of listings) {
    const k = p.op + '|' + p.district;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(p);
  }

  const search = buildSearch(listings, loadTasaciones());

  for (const d of OUT_DIRS) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  for (const p of listings) {
    writePage(listingPath(p), renderListing(p, byGroup.get(p.op + '|' + p.district), search.groupFor(p)));
  }
  for (const pg of search.pages) writePage(pg.path, pg.html);
  fs.writeFileSync(path.join(ROOT, 'busqueda-especial', 'inmuebles.json'), search.json);

  const entries = STATIC_PAGES.map(p => ({ path: p }))
    .concat(search.pages.map(pg => ({ path: pg.path })))
    .concat(listings.map(p => ({ path: listingPath(p), lastmod: p.date })));
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), renderSitemap(entries));
  console.log(`[seo] ${listings.length} fichas y ${search.pages.length} páginas de Búsqueda especial generadas; sitemap.xml actualizado.`);
}

main().catch(err => { console.error(err); process.exit(1); });
