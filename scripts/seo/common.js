// Utilidades, textos y plantilla compartidos por las páginas SEO estáticas
// (fichas de inmuebles y Búsqueda especial). Ver scripts/build-seo-pages.js.

const SITE = 'https://recosac.com';
const SEARCH_BASE = '/busqueda-especial/';

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

function median(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

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

const TYPE_PLURALS = {
  Departamento: 'Departamentos', Casa: 'Casas', Terreno: 'Terrenos', Oficina: 'Oficinas',
  'Local comercial': 'Locales comerciales', 'Almacén': 'Almacenes', Edificio: 'Edificios',
  Inmueble: 'Inmuebles',
};

function typePlural(label) { return TYPE_PLURALS[label] || 'Inmuebles'; }

function opLabel(op) { return op === 'Alquiler' ? 'alquiler' : 'venta'; }

function isFeminine(label) { return label === 'Casa' || label === 'Oficina'; }

// El piso solo tiene sentido en unidades dentro de un edificio.
function showsFloor(p) {
  const label = typeLabel(p);
  return p.floor > 0 && (label === 'Departamento' || label === 'Oficina' || label === 'Local comercial');
}

// La URL no incluye datos que cambian (precio, dormitorios) para que se
// mantenga estable aunque se edite el aviso.
function slugFor(p) {
  return slugify(`${typeLabel(p)} ${opLabel(p.op)} ${p.district} ${p.id}`);
}

function listingPath(p) { return `/inmueble/${slugFor(p)}/`; }

function headline(p) {
  return `${typeLabel(p)} en ${opLabel(p.op)} en ${p.district}`;
}

function priceText(p) {
  return money(p.cur, p.price) + (p.op === 'Alquiler' ? ' al mes' : '');
}

function sqmPrice(p) {
  return p.op === 'Venta' && p.area > 0 ? Math.round(p.price / p.area) : 0;
}

// Enlace a la app con el mapa filtrado (lo interpretan applyHashNav y
// _applyLandingHash en index.html).
function appSearchUrl(op, district) {
  const o = op === 'Alquiler' ? 'alquiler' : op === 'Histórico' ? 'historico' : 'venta';
  return district ? `/index.html#q=${encodeURIComponent(district)}&op=${o}` : `/index.html#op=${o}`;
}

// "</" dentro de un <script> cerraría la etiqueta antes de tiempo.
function ldScript(graph) {
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/<\//g, '<\\/')}</script>`;
}

function cardHtml(p) {
  const meta = [typeLabel(p)];
  if (p.area > 0) meta.push(fmtArea(p.area) + ' m²');
  if (p.beds > 0) meta.push(p.beds + ' dorm.');
  return `<li><a href="${listingPath(p)}"><small>${esc(meta.join(' · '))}</small>${esc(p.address)}<br><strong>${esc(priceText(p))}</strong></a></li>`;
}

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
.addr,.lead{color:var(--muted);margin-bottom:16px}
.price{font-size:1.8rem;font-weight:800;color:var(--blue-dark)}
.sqm{display:inline-block;margin-top:4px;font-size:.85rem;background:#ecfeff;color:var(--blue-dark);padding:2px 10px;border-radius:999px}
.specs{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:20px 0}
.spec{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center}
.spec b{display:block;font-size:1.2rem}
.spec span{font-size:.8rem;color:var(--muted)}
h2{font-size:1.15rem;margin:24px 0 10px}
h3{font-size:1rem;margin:16px 0 6px}
.tags{display:flex;flex-wrap:wrap;gap:6px;list-style:none}
.tags li{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:.85rem}
.tags a{text-decoration:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;position:sticky;top:16px}
.cta{display:block;text-align:center;background:var(--blue);color:#fff;text-decoration:none;font-weight:700;padding:14px;border-radius:12px;margin-bottom:10px}
.cta:hover{background:var(--blue-dark)}
.cta.sec{background:#fff;color:var(--blue-dark);border:1px solid var(--blue)}
.cta.inline{display:inline-block;padding:10px 20px}
.note{font-size:.8rem;color:var(--muted);margin-top:10px}
.related{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;list-style:none}
.related a{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;text-decoration:none;color:var(--ink);height:100%}
.related small{display:block;color:var(--muted)}
.related strong{color:var(--blue-dark)}
.links{columns:220px;list-style:none;font-size:.92rem}
.links li{break-inside:avoid;padding:2px 0}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:.92rem}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line)}
th{background:#f1f5f9;font-weight:600}
td.n{text-align:right;white-space:nowrap}
th.n{text-align:right}
@media(max-width:600px){th,td{padding:6px 8px;font-size:.85rem}}
.tbl{overflow-x:auto}
.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:16px 0}
.form label{display:flex;flex-direction:column;font-size:.8rem;color:var(--muted);gap:4px}
.form select,.form input{font:inherit;color:var(--ink);padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:#fff;width:100%}
.form button{font:inherit;font-weight:700;background:var(--blue);color:#fff;border:0;border-radius:10px;padding:10px;cursor:pointer;align-self:end}
.section{padding-bottom:16px}
main{padding-bottom:40px}
footer{background:#0f172a;color:#cbd5e1;font-size:.85rem;padding:24px 0}
.foot-in{display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between}
footer a{color:#cbd5e1}
`;

// Documento completo. `crumbs` = [{name, path}] (el último es la página
// actual); se pinta como migas y se agrega como BreadcrumbList al JSON-LD.
function layout({ title, desc, path, ogTitle, ogImage, graph = [], crumbs, headerLink, body, robots = 'index,follow,max-image-preview:large', script = '' }) {
  const url = SITE + path;
  const crumbLd = {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + c.path })),
  };
  const crumbNav = crumbs.map((c, i) => i === crumbs.length - 1 ? esc(c.name) : `<a href="${c.path}">${esc(c.name)}</a>`).join(' › ');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta name="robots" content="${robots}"/>
<link rel="canonical" href="${url}"/>
<meta name="theme-color" content="#0891b2"/>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png"/>
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Reco"/>
<meta property="og:locale" content="es_PE"/>
<meta property="og:url" content="${url}"/>
<meta property="og:title" content="${esc(ogTitle || title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:image" content="${esc(ogImage || SITE + '/assets/og-image.jpg')}"/>
<meta name="twitter:card" content="summary_large_image"/>
${ldScript(graph.concat([crumbLd]))}
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="top-in">
  <a class="logo" href="/"><img src="/assets/favicon-32.png" alt="" width="28" height="28">reco</a>
  <a class="btn" href="${headerLink.href}">${esc(headerLink.label)}</a>
</div></header>
<main class="wrap">
  <nav class="crumbs" aria-label="Ruta">${crumbNav}</nav>
${body}
</main>
<footer><div class="foot-in">
  <span>© Reco · Lima, Perú · VANET DATA S.A.C.</span>
  <span><a href="${SEARCH_BASE}">Búsqueda especial</a> · <a href="/index.html#terminos">Términos</a> · <a href="/index.html#privacidad">Privacidad</a> · <a href="/index.html#reclamaciones">Libro de Reclamaciones</a></span>
</div></footer>
${script}
</body>
</html>
`;
}

module.exports = {
  SITE, SEARCH_BASE, esc, slugify, fmtNum, fmtArea, money, isoCurrency, median,
  typeLabel, typePlural, opLabel, isFeminine, showsFloor, slugFor, listingPath,
  headline, priceText, sqmPrice, appSearchUrl, ldScript, cardHtml, layout,
};
