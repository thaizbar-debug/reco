#!/usr/bin/env node
// Genera una página HTML estática e indexable por cada inmueble en venta o
// alquiler (SEO Fase 2, ver docs/SEO-PLAN.md) y reescribe sitemap.xml.
//
// Usage:
//   node scripts/build-seo-pages.js
//
// Fuentes:
//   - data/properties.json → registros Venta/Alquiler. Los Histórico NO se
//     publican: su detalle se desbloquea con llaves en la app.
//   - Firestore /publications con status 'approved' → solo si existe la
//     variable FIREBASE_SERVICE_ACCOUNT (JSON de una cuenta de servicio) y
//     firebase-admin está instalado. Si no, se omiten con un aviso.
//
// Salida (se borra y regenera completa en cada corrida):
//   inmueble/<slug>/index.html
//   sitemap.xml
//
// Las páginas solo muestran lo que la app ya muestra públicamente en la
// ficha de Venta/Alquiler (dirección, precio, áreas, características,
// fotos). Nunca se escriben datos del dueño (nombre, email, teléfono).
// La salida es determinista (sin timestamps) para que el workflow solo
// haga commit cuando un inmueble cambia de verdad.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://recosac.com';
const OUT_DIR = path.join(ROOT, 'inmueble');
const MAX_PHOTOS = 8;
const MAX_RELATED = 6;

// Páginas estáticas que siempre van en el sitemap.
const STATIC_PAGES = ['/', '/landing.html'];

// ── Utilidades ──────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function fmtNum(n) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtArea(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? fmtNum(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

// En properties.json cur es '$' o 'S/'.
function money(cur, n) {
  return (cur === 'S/' ? 'S/ ' : 'US$ ') + fmtNum(n);
}

function isoCurrency(cur) { return cur === 'S/' ? 'PEN' : 'USD'; }

// "Otros" agrupa terrenos, locales, oficinas, etc. Se intenta deducir el
// tipo real de la dirección para que el título sea útil.
function typeLabel(p) {
  if (p.type && p.type !== 'Otros') return p.type;
  const a = slugify(p.address);
  if (/terreno|lote/.test(a)) return 'Terreno';
  if (/oficina/.test(a)) return 'Oficina';
  if (/local/.test(a)) return 'Local comercial';
  if (/almacen|deposito|galpon/.test(a)) return 'Almacén';
  if (/edificio/.test(a)) return 'Edificio';
  return 'Inmueble';
}

function opLabel(op) { return op === 'Alquiler' ? 'alquiler' : 'venta'; }

function isFeminine(label) { return label === 'Casa' || label === 'Oficina'; }

// El piso solo tiene sentido en unidades dentro de un edificio.
function showsFloor(p) {
  const label = typeLabel(p);
  return p.floor > 0 && (label === 'Departamento' || label === 'Oficina' || label === 'Local comercial');
}

function schemaType(label) {
  if (label === 'Departamento') return 'Apartment';
  if (label === 'Casa') return 'SingleFamilyResidence';
  return 'Place';
}

// Mismo esquema de llaves que driveAssets() en index.html.
function drivePhotos(p, drive) {
  const numId = (String(p.id).match(/^(\d+)/) || [])[1] || String(p.id);
  const entry = drive[numId + '-' + (p.op === 'Alquiler' ? 'Alq' : 'Com')] || {};
  return ['foto1', 'foto2', 'foto3', 'foto4', 'foto5', 'foto6', 'foto7', 'foto8']
    .map(k => entry[k]).filter(Boolean)
    .map(id => `https://lh3.googleusercontent.com/d/${id}=w800`);
}

// ── Carga de datos ──────────────────────────────────────────────────────
function loadStatic() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/properties.json'), 'utf8'));
  const drive = data.drive || {};
  return (data.properties || [])
    .filter(p => (p.op === 'Venta' || p.op === 'Alquiler') && Number(p.price) > 0)
    .map(p => ({
      id: String(p.id), address: p.address, district: p.district, province: p.province,
      type: p.type, op: p.op, price: Number(p.price), cur: p.cur,
      area: Number(p.area) || 0, areaTerr: Number(p.areaTerr) || 0,
      beds: Number(p.beds) || 0, baths: Number(p.baths) || 0, park: Number(p.park) || 0,
      floor: Number(p.floor) || 0, floors: Number(p.floors) || 0, age: Number(p.age) || 0,
      lat: p.lat, lng: p.lng, features: p.features || [],
      desc: p.desc && p.desc !== p.address ? p.desc : '',
      date: p.publishedAt || p.listedAt || null,
      photos: drivePhotos(p, drive),
    }));
}

async function loadPublications() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[seo] FIREBASE_SERVICE_ACCOUNT no está definido: se omiten las publicaciones de usuarios.');
    return [];
  }
  let admin;
  try { admin = require('firebase-admin'); } catch (e) {
    console.warn('[seo] firebase-admin no está instalado: se omiten las publicaciones de usuarios.');
    return [];
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const snap = await admin.firestore().collection('publications').where('status', '==', 'approved').get();
  // Mismo mapeo que _pubDocToProperty() en index.html, sin campos del dueño.
  return snap.docs.map(d => {
    const p = d.data();
    return {
      id: d.id, address: p.address || p.title || '', district: p.district || '', province: 'Lima',
      type: p.type || 'Departamento', op: p.op || 'Venta', price: Number(p.price) || 0,
      cur: p.currency === 'PEN' ? 'S/' : '$',
      area: Number(p.area) || 0, areaTerr: Number(p.areaTerr) || 0,
      beds: Number(p.beds) || 0, baths: Number(p.baths) || 0, park: Number(p.parking) || 0,
      floor: Number(p.floor) || 0, floors: Number(p.floors) || 0, age: Number(p.age) || 0,
      lat: p.lat || null, lng: p.lng || null,
      features: Array.isArray(p.features) ? p.features : [],
      desc: p.desc || '',
      date: p.listedAt ? String(p.listedAt).slice(0, 10) : null,
      photos: Array.isArray(p.photoUrls) ? p.photoUrls.slice(0, MAX_PHOTOS) : [],
    };
  }).filter(p => (p.op === 'Venta' || p.op === 'Alquiler') && p.price > 0 && p.address && p.district);
}

// ── Contenido ───────────────────────────────────────────────────────────
// La URL no incluye datos que cambian (precio, dormitorios) para que se
// mantenga estable aunque se edite el aviso.
function slugFor(p) {
  return slugify(`${typeLabel(p)} ${opLabel(p.op)} ${p.district} ${p.id}`);
}

function headline(p) {
  return `${typeLabel(p)} en ${opLabel(p.op)} en ${p.district}`;
}

function summary(p) {
  const bits = [];
  if (p.area > 0) bits.push(`${fmtArea(p.area)} m²`);
  if (p.beds > 0) bits.push(`${p.beds} dormitorio${p.beds > 1 ? 's' : ''}`);
  if (p.baths > 0) bits.push(`${p.baths} baño${p.baths > 1 ? 's' : ''}`);
  if (p.park > 0) bits.push(`${p.park} cochera${p.park > 1 ? 's' : ''}`);
  return bits;
}

function priceText(p) {
  return money(p.cur, p.price) + (p.op === 'Alquiler' ? ' al mes' : '');
}

function sqmPrice(p) {
  return p.op === 'Venta' && p.area > 0 ? Math.round(p.price / p.area) : 0;
}

function metaDescription(p) {
  const s = summary(p);
  let d = `${headline(p)}: ${p.address}. ${priceText(p)}`;
  if (s.length) d += `, ${s.join(', ')}`;
  d += '. Mira fotos, precio por m² y contacta en Reco.';
  return d.length > 160 ? d.slice(0, 157).replace(/\s+\S*$/, '') + '…' : d;
}

function longDescription(p) {
  const s = summary(p);
  const parts = [];
  parts.push(`${typeLabel(p)} en ${opLabel(p.op)} ubicad${isFeminine(typeLabel(p)) ? 'a' : 'o'} en ${p.address}, distrito de ${p.district}${p.province && p.province !== p.district ? ', ' + p.province : ''}.`);
  if (s.length) parts.push(`Cuenta con ${s.join(', ')}.`);
  if (p.age === 0) parts.push('Es un inmueble para estrenar.');
  else if (p.age > 0) parts.push(`Tiene ${p.age} año${p.age > 1 ? 's' : ''} de antigüedad.`);
  if (showsFloor(p)) parts.push(`Se encuentra en el piso ${p.floor}${p.floors ? ' de ' + p.floors : ''}.`);
  const sq = sqmPrice(p);
  parts.push(`Precio ${p.op === 'Alquiler' ? 'mensual' : 'de venta'}: ${priceText(p)}${sq ? ` (aprox. ${money(p.cur, sq)} por m²)` : ''}.`);
  return parts.join(' ');
}

function jsonLd(p, url) {
  const label = typeLabel(p);
  const place = {
    '@type': schemaType(label),
    name: p.address,
    address: {
      '@type': 'PostalAddress', streetAddress: p.address, addressLocality: p.district,
      addressRegion: 'Lima', addressCountry: 'PE',
    },
  };
  if (p.lat != null && p.lng != null) place.geo = { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng };
  if (p.area > 0) place.floorSize = { '@type': 'QuantitativeValue', value: p.area, unitCode: 'MTK' };
  if (p.beds > 0) place.numberOfBedrooms = p.beds;
  if (p.baths > 0) place.numberOfBathroomsTotal = p.baths;

  const listing = {
    '@type': 'RealEstateListing',
    '@id': url + '#listing',
    url,
    name: `${headline(p)} — ${p.address}`,
    description: longDescription(p),
    inLanguage: 'es-PE',
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: isoCurrency(p.cur),
      businessFunction: p.op === 'Alquiler' ? 'http://purl.org/goodrelations/v1#LeaseOut' : 'http://purl.org/goodrelations/v1#Sell',
      availability: 'https://schema.org/InStock',
    },
    about: place,
    provider: { '@id': SITE + '/#organization' },
  };
  if (p.date) listing.datePosted = p.date;
  if (p.photos.length) listing.image = p.photos;

  const crumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: headline(p), item: url },
    ],
  };
  // "</" dentro de un <script> cerraría la etiqueta antes de tiempo.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [listing, crumbs] }).replace(/<\//g, '<\\/');
}

// ── Plantilla ───────────────────────────────────────────────────────────
const CSS = `
:root{--blue:#0891b2;--blue-dark:#0e7490;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--bg);line-height:1.55}
a{color:var(--blue-dark)}
.top{background:#fff;border-bottom:1px solid var(--line)}
.top-in,.wrap,.foot-in{max-width:1080px;margin:0 auto;padding:0 16px}
.top-in{display:flex;align-items:center;justify-content:space-between;height:60px}
.logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:1.4rem;color:var(--blue);text-decoration:none}
.logo img{width:28px;height:28px}
.top a.btn{font-size:.9rem}
.crumbs{font-size:.85rem;color:var(--muted);padding:16px 0 8px}
.crumbs a{color:var(--muted)}
.gallery{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;border-radius:14px}
.gallery img{flex:0 0 auto;width:min(100%,640px);aspect-ratio:4/3;object-fit:cover;scroll-snap-align:start;border-radius:14px;background:#e2e8f0}
.noimg{aspect-ratio:16/6;border-radius:14px;background:linear-gradient(135deg,#0891b2,#06b6d4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;font-weight:600}
.grid{display:grid;grid-template-columns:1fr;gap:24px;padding:20px 0 8px}
@media(min-width:880px){.grid{grid-template-columns:1fr 320px}}
h1{font-size:1.6rem;line-height:1.25;margin-bottom:4px}
@media(min-width:600px){h1{font-size:2rem}}
.addr{color:var(--muted);margin-bottom:16px}
.price{font-size:1.8rem;font-weight:800;color:var(--blue-dark)}
.sqm{display:inline-block;margin-top:4px;font-size:.85rem;background:#ecfeff;color:var(--blue-dark);padding:2px 10px;border-radius:999px}
.specs{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:20px 0}
.spec{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center}
.spec b{display:block;font-size:1.2rem}
.spec span{font-size:.8rem;color:var(--muted)}
h2{font-size:1.15rem;margin:24px 0 10px}
.tags{display:flex;flex-wrap:wrap;gap:6px;list-style:none}
.tags li{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:.85rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;position:sticky;top:16px}
.cta{display:block;text-align:center;background:var(--blue);color:#fff;text-decoration:none;font-weight:700;padding:14px;border-radius:12px;margin-bottom:10px}
.cta:hover{background:var(--blue-dark)}
.cta.sec{background:#fff;color:var(--blue-dark);border:1px solid var(--blue)}
.note{font-size:.8rem;color:var(--muted);margin-top:10px}
.related{padding-bottom:40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;list-style:none}
.related a{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;text-decoration:none;color:var(--ink);height:100%}
.related small{display:block;color:var(--muted)}
.related strong{color:var(--blue-dark)}
footer{background:#0f172a;color:#cbd5e1;font-size:.85rem;padding:24px 0}
.foot-in{display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between}
footer a{color:#cbd5e1}
`;

function renderPage(p, related) {
  const slug = slugFor(p);
  const url = `${SITE}/inmueble/${slug}/`;
  const appUrl = `/index.html#prop=${encodeURIComponent(p.id)}`;
  const label = typeLabel(p);
  const title = `${headline(p)}${p.area > 0 ? ', ' + fmtArea(p.area) + ' m²' : ''} · ${priceText(p)} | Reco`;
  const desc = metaDescription(p);
  const ogImage = p.photos[0] || `${SITE}/assets/og-image.jpg`;
  const sq = sqmPrice(p);

  const gallery = p.photos.length
    ? `<div class="gallery">${p.photos.map((u, i) =>
        `<img src="${esc(u)}" alt="${esc(`${label} en ${opLabel(p.op)} en ${p.district} — foto ${i + 1}`)}" width="640" height="480"${i ? ' loading="lazy"' : ''} referrerpolicy="no-referrer">`).join('')}</div>`
    : `<div class="noimg">${esc(label)} en ${esc(p.district)}</div>`;

  const specs = [];
  if (p.area > 0) specs.push([fmtArea(p.area), 'm² ' + (label === 'Terreno' ? 'de terreno' : 'de área')]);
  if (p.areaTerr > 0) specs.push([fmtArea(p.areaTerr), 'm² de terreno']);
  if (p.beds > 0) specs.push([p.beds, 'Dormitorios']);
  if (p.baths > 0) specs.push([p.baths, 'Baños']);
  if (p.park > 0) specs.push([p.park, p.park > 1 ? 'Cocheras' : 'Cochera']);
  if (showsFloor(p)) specs.push([p.floor + (p.floors ? '/' + p.floors : ''), 'Piso']);
  specs.push(p.age === 0 ? ['Estreno', 'Antigüedad'] : [p.age, 'Años']);

  const relatedHtml = related.length ? `
      <h2>Más inmuebles en ${opLabel(p.op)} en ${esc(p.district)}</h2>
      <ul class="related">${related.map(r => `
        <li><a href="/inmueble/${slugFor(r)}/"><small>${esc(typeLabel(r))}${r.area > 0 ? ' · ' + fmtArea(r.area) + ' m²' : ''}${r.beds > 0 ? ' · ' + r.beds + ' dorm.' : ''}</small>${esc(r.address)}<br><strong>${esc(priceText(r))}</strong></a></li>`).join('')}
      </ul>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta name="robots" content="index,follow,max-image-preview:large"/>
<link rel="canonical" href="${url}"/>
<meta name="theme-color" content="#0891b2"/>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png"/>
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Reco"/>
<meta property="og:locale" content="es_PE"/>
<meta property="og:url" content="${url}"/>
<meta property="og:title" content="${esc(`${headline(p)} · ${priceText(p)}`)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:image" content="${esc(ogImage)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<script type="application/ld+json">${jsonLd(p, url)}</script>
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="top-in">
  <a class="logo" href="/"><img src="/assets/favicon-32.png" alt="" width="28" height="28">reco</a>
  <a class="btn" href="${appUrl}">Ver en el mapa →</a>
</div></header>
<main class="wrap">
  <nav class="crumbs" aria-label="Ruta"><a href="/">Inicio</a> › ${esc(headline(p))}</nav>
  ${gallery}
  <div class="grid">
    <article>
      <h1>${esc(headline(p))}</h1>
      <p class="addr">📍 ${esc(p.address)} · ${esc(p.district)}${p.province && p.province !== p.district ? ', ' + esc(p.province) : ''}</p>
      <div class="price">${esc(priceText(p))}</div>
      ${sq ? `<span class="sqm">${esc(money(p.cur, sq))} / m²</span>` : ''}
      <div class="specs">${specs.map(([v, l]) => `<div class="spec"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
      <h2>Descripción</h2>
      <p>${esc(longDescription(p))}</p>
      ${p.desc ? `<p style="margin-top:10px">${esc(p.desc)}</p>` : ''}
      ${p.features.length ? `<h2>Características</h2>
      <ul class="tags">${p.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    </article>
    <aside><div class="card">
      <a class="cta" href="${appUrl}">📞 Contactar ${p.op === 'Alquiler' ? 'arrendador' : 'vendedor'}</a>
      <a class="cta sec" href="${appUrl}">🗺️ Ver ubicación en el mapa</a>
      <p class="note">Compara este precio con el mercado: en Reco tienes precios por m² del distrito e históricos de compraventa de Registros Públicos.</p>
    </div></aside>
  </div>
  ${relatedHtml}
</main>
<footer><div class="foot-in">
  <span>© Reco · Lima, Perú · VANET DATA S.A.C.</span>
  <span><a href="/index.html#terminos">Términos</a> · <a href="/index.html#privacidad">Privacidad</a> · <a href="/index.html#reclamaciones">Libro de Reclamaciones</a></span>
</div></footer>
</body>
</html>
`;
}

function renderSitemap(listings) {
  const urls = STATIC_PAGES.map(p => `  <url><loc>${SITE}${p}</loc></url>`);
  for (const p of listings) {
    urls.push(`  <url><loc>${SITE}/inmueble/${slugFor(p)}/</loc>${p.date ? `<lastmod>${esc(p.date)}</lastmod>` : ''}</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generado por scripts/build-seo-pages.js — no editar a mano. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

// Inmuebles del mismo distrito y operación, los de precio más parecido primero.
function pickRelated(p, byGroup) {
  const group = byGroup.get(p.op + '|' + p.district) || [];
  return group.filter(r => r !== p && r.cur === p.cur)
    .sort((a, b) => Math.abs(a.price - p.price) - Math.abs(b.price - p.price) || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_RELATED);
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

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  for (const p of listings) {
    const dir = path.join(OUT_DIR, slugFor(p));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPage(p, pickRelated(p, byGroup)));
  }
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), renderSitemap(listings));
  console.log(`[seo] ${listings.length} fichas generadas en inmueble/ y sitemap.xml actualizado.`);
}

main().catch(err => { console.error(err); process.exit(1); });
