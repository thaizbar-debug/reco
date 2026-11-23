// "Búsqueda especial" (SEO Fase 3): un buscador por distrito/tipo/m²/
// dormitorios/precio en /busqueda-especial/ y páginas estáticas por cada
// combinación con oferta suficiente, más páginas de precio del m² por
// distrito. No se enlazan desde la landing ni el menú: solo desde el footer
// ("Búsqueda especial") y el sitemap. Ver docs/SEO-PLAN.md.
const {
  SEARCH_BASE, SITE, esc, slugify, fmtArea, fmtNum, money, median, typeLabel, typePlural,
  opLabel, listingPath, priceText, appSearchUrl, cardHtml, layout,
} = require('./common');

// Una combinación se publica solo si tiene al menos esta cantidad de avisos
// (evita páginas casi vacías, que Google trata como contenido pobre).
const MIN_LISTINGS = 3;
const MAX_CARDS = 48;
const MAX_OTHER_DISTRICTS = 20;
// Años de la serie de tasaciones con menos casos son demasiado ruidosos.
const MIN_TASACIONES = 30;
const OPS = ['Venta', 'Alquiler'];
const BEDS = [1, 2, 3, 4]; // 4 = "4 o más"
const AREA_RANGES = [
  { slug: 'hasta-60-m2', label: 'hasta 60 m²', min: 0, max: 60 },
  { slug: '60-a-90-m2', label: '60 a 90 m²', min: 60, max: 90 },
  { slug: '90-a-120-m2', label: '90 a 120 m²', min: 90, max: 120 },
  { slug: '120-a-180-m2', label: '120 a 180 m²', min: 120, max: 180 },
  { slug: 'mas-de-180-m2', label: 'más de 180 m²', min: 180, max: Infinity },
];

const lcFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

// Las páginas "en Lima" (sin distrito) cubren Lima Metropolitana y Callao.
const inLima = p => p.province === 'Lima' || p.province === 'Callao';

function tasKey(district) {
  return String(district).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function sqmStats(items) {
  const v = items.filter(p => p.area > 0).map(p => p.price / p.area).sort((a, b) => a - b);
  return v.length ? { n: v.length, med: quantile(v, 0.5), p25: quantile(v, 0.25), p75: quantile(v, 0.75) } : null;
}

// ── Combinaciones ───────────────────────────────────────────────────────
function makeCombo({ op, type = null, district = null, beds = null, range = null }) {
  const place = district || 'Lima';
  let name = `${type ? typePlural(type) : 'Inmuebles'} en ${opLabel(op)} en ${place}`;
  let slug = slugify(name);
  if (beds) {
    name += beds >= 4 ? ' de 4 o más dormitorios' : ` de ${beds} dormitorio${beds > 1 ? 's' : ''}`;
    slug += beds >= 4 ? '-4-o-mas-dormitorios' : `-${beds}-dormitorio${beds > 1 ? 's' : ''}`;
  }
  if (range) { name += ` de ${range.label}`; slug += '-' + range.slug; }
  return { op, type, district, beds, range, name, slug, path: `${SEARCH_BASE}${slug}/`, isBase: !beds && !range };
}

function matches(c, p) {
  return p.op === c.op
    && (!c.type || typeLabel(p) === c.type)
    && (c.district ? p.district === c.district : inLima(p))
    && (!c.beds || (c.beds >= 4 ? p.beds >= 4 : p.beds === c.beds))
    && (!c.range || (p.area > c.range.min && p.area <= c.range.max));
}

function buildCombos(listings) {
  const districts = [...new Set(listings.map(p => p.district))];
  const types = [...new Set(listings.map(typeLabel))].filter(t => t !== 'Inmueble');
  const typed = [], untyped = [], variants = [];
  for (const op of OPS) {
    for (const district of [null, ...districts]) {
      untyped.push(makeCombo({ op, district }));
      for (const type of types) {
        typed.push(makeCombo({ op, type, district }));
        if (type === 'Departamento' || type === 'Casa') {
          for (const beds of BEDS) variants.push(makeCombo({ op, type, district, beds }));
        }
        if (type === 'Departamento') {
          for (const range of AREA_RANGES) variants.push(makeCombo({ op, type, district, range }));
        }
      }
    }
  }
  // Si dos combinaciones listan exactamente los mismos avisos, se publica
  // solo una (contenido duplicado). Prioridad: por tipo > "inmuebles" > variantes.
  const seen = new Set();
  const out = [];
  for (const c of [...typed, ...untyped, ...variants]) {
    c.items = listings.filter(p => matches(c, p)).sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1));
    if (c.items.length < MIN_LISTINGS) continue;
    const key = c.op + '|' + c.items.map(p => p.id).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Cifras de la combinación en su moneda principal (no se mezclan US$ y S/).
function comboStats(c) {
  const counts = {};
  c.items.forEach(p => { counts[p.cur] = (counts[p.cur] || 0) + 1; });
  const cur = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const sub = c.items.filter(p => p.cur === cur);
  const prices = sub.map(p => p.price);
  const sqm = c.type && c.type !== 'Inmueble' && c.op === 'Venta' ? sqmStats(sub) : null;
  return {
    cur, n: c.items.length, nCur: sub.length,
    med: median(prices), min: Math.min(...prices), max: Math.max(...prices),
    area: median(sub.filter(p => p.area > 0).map(p => p.area)),
    sqm: sqm && sqm.n >= MIN_LISTINGS ? sqm.med : 0,
  };
}

// ── Precio del m² por distrito ──────────────────────────────────────────
function buildPricePages(listings, tasaciones) {
  const byDistrict = new Map();
  for (const p of listings) {
    if (p.op !== 'Venta' || p.cur !== '$' || !(p.area > 0)) continue;
    const t = typeLabel(p);
    if (t !== 'Departamento' && t !== 'Casa') continue;
    if (!byDistrict.has(p.district)) byDistrict.set(p.district, { Departamento: [], Casa: [] });
    byDistrict.get(p.district)[t].push(p);
  }
  const pages = [];
  for (const [district, g] of byDistrict) {
    const dep = sqmStats(g.Departamento), casa = sqmStats(g.Casa);
    const rows = [['Departamentos', dep], ['Casas', casa]].filter(([, s]) => s && s.n >= MIN_LISTINGS);
    if (!rows.length) continue;
    const t = tasaciones[tasKey(district)];
    const tasYears = t ? Object.keys(t.y).sort().filter(y => t.y[y].n >= MIN_TASACIONES).map(y => ({ year: y, m: t.y[y].m, n: t.y[y].n })) : [];
    const name = `Precio del m² en ${district}`;
    const slug = slugify(`precio m2 ${district}`);
    pages.push({ district, name, slug, path: `${SEARCH_BASE}${slug}/`, rows, tasYears, main: rows[0] });
  }
  const depMed = pp => (pp.rows.find(([l]) => l === 'Departamentos') || [0, { med: -1 }])[1].med;
  return pages.sort((a, b) => depMed(b) - depMed(a) || b.main[1].med - a.main[1].med || (a.district < b.district ? -1 : 1));
}

// ── Render ──────────────────────────────────────────────────────────────
function linkList(items) {
  return `<ul class="tags">${items.map(x => `<li><a href="${x.path}">${esc(x.label || x.name)}</a></li>`).join('')}</ul>`;
}

// Departamentos y casas en columnas separadas: sus precios por m² no son comparables.
function priceTable(pricePages, current) {
  const cell = (pp, label) => {
    const row = pp.rows.find(([l]) => l === label);
    return row ? `${fmtNum(row[1].med)} <small>(${row[1].n})</small>` : '—';
  };
  return `<div class="tbl"><table>
      <thead><tr><th>Distrito</th><th class="n">Departamentos US$/m²</th><th class="n">Casas US$/m²</th></tr></thead>
      <tbody>${pricePages.map(pp => `
        <tr><td>${pp === current ? `<strong>${esc(pp.district)}</strong>` : `<a href="${pp.path}">${esc(pp.district)}</a>`}</td><td class="n">${cell(pp, 'Departamentos')}</td><td class="n">${cell(pp, 'Casas')}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="note">Mediana del precio de oferta por m² de los avisos en venta en dólares; entre paréntesis, la cantidad de avisos.</p>`;
}

function renderCombo(c, combos, priceByDistrict) {
  const s = comboStats(c);
  const alq = c.op === 'Alquiler';
  const place = c.district || 'Lima';
  const curName = s.cur === 'S/' ? 'soles' : 'dólares';

  let intro = `Encontramos ${s.n} ${lcFirst(c.name)} publicados en Reco. `;
  intro += `El precio mediano es ${money(s.cur, s.med)}${alq ? ' al mes' : ''}, con opciones desde ${money(s.cur, s.min)} hasta ${money(s.cur, s.max)}.`;
  if (s.area) intro += ` El área mediana es de ${fmtArea(Math.round(s.area))} m².`;
  if (s.sqm) intro += ` El precio mediano por m² es de ${money(s.cur, s.sqm)}.`;
  if (s.nCur < s.n) intro += ` (Cifras calculadas sobre los ${s.nCur} avisos en ${curName}.)`;

  const price = c.district ? priceByDistrict.get(c.district) : null;
  const shown = c.items.slice(0, MAX_CARDS);

  const sameDistrict = combos.filter(o => o !== c && o.isBase && o.district === c.district);
  const variants = c.type ? combos.filter(o => o !== c && !o.isBase && o.op === c.op && o.type === c.type && o.district === c.district) : [];
  const parent = !c.isBase ? combos.find(o => o.isBase && o.op === c.op && o.type === c.type && o.district === c.district) : null;
  const otherPlaces = combos.filter(o => o !== c && o.isBase && o.op === c.op && o.type === c.type && o.district !== c.district)
    .sort((a, b) => b.items.length - a.items.length).slice(0, MAX_OTHER_DISTRICTS)
    .map(o => ({ path: o.path, label: `${o.district || 'Toda Lima'} (${o.items.length})` }));

  const body = `
  <h1>${esc(c.name)}</h1>
  <p class="lead">${esc(intro)}</p>
  <p><a class="cta inline" href="${appSearchUrl(c.op, c.district)}">🗺️ Ver en el mapa</a>${price ? ` &nbsp;<a href="${price.path}">Precio del m² en ${esc(price.district)} →</a>` : ''}</p>
  <section class="section">
    <h2>${s.n} aviso${s.n > 1 ? 's' : ''}${shown.length < s.n ? ` (mostrando los ${shown.length} de menor precio)` : ''}</h2>
    <ul class="related">${shown.map(cardHtml).join('')}</ul>
    ${shown.length < s.n ? `<p class="note">Ver los ${s.n} avisos en el <a href="${appSearchUrl(c.op, c.district)}">mapa de Reco</a>.</p>` : ''}
  </section>
  <section class="section">
    <h2>Búsquedas relacionadas</h2>
    ${parent ? `<p><a href="${parent.path}">← ${esc(parent.name)}</a></p>` : ''}
    ${variants.length ? `<h3>Por dormitorios y metraje</h3>${linkList(variants)}` : ''}
    ${sameDistrict.length ? `<h3>Más en ${esc(place)}</h3>${linkList(sameDistrict)}` : ''}
    ${otherPlaces.length ? `<h3>${esc(c.type ? typePlural(c.type) : 'Inmuebles')} en ${opLabel(c.op)} en otros distritos</h3>${linkList(otherPlaces)}` : ''}
  </section>`;

  const desc = `${s.n} ${lcFirst(c.name)}. Precio mediano ${money(s.cur, s.med)}${alq ? ' al mes' : ''}${s.sqm ? `, ${money(s.cur, s.sqm)}/m²` : ''}. Compara precios, mira fotos y ubica cada inmueble en el mapa de Reco.`;
  const crumbs = [{ name: 'Inicio', path: '/' }, { name: 'Búsqueda especial', path: SEARCH_BASE }];
  if (parent) crumbs.push({ name: parent.name, path: parent.path });
  crumbs.push({ name: c.name, path: c.path });

  return layout({
    title: `${c.name}: ${s.n} avisos desde ${money(s.cur, s.min)} | Reco`,
    desc,
    path: c.path,
    graph: [{
      '@type': 'CollectionPage', name: c.name, url: SITE + c.path, description: desc, inLanguage: 'es-PE',
      mainEntity: {
        '@type': 'ItemList', numberOfItems: s.n,
        itemListElement: shown.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + listingPath(p) })),
      },
    }],
    crumbs,
    headerLink: { href: appSearchUrl(c.op, c.district), label: 'Ver en el mapa →' },
    body,
  });
}

function renderPricePage(pp, pricePages, combos) {
  const [mainLabel, main] = pp.main;
  const lead = `Según los ${main.n} ${mainLabel.toLowerCase()} en venta publicados en Reco, el precio mediano de oferta en ${pp.district} es de ${money('$', main.med)} por m². La mitad de los avisos está entre ${money('$', main.p25)} y ${money('$', main.p75)} por m².`;
  const districtCombos = combos.filter(c => c.isBase && c.district === pp.district);

  const body = `
  <h1>${esc(pp.name)}</h1>
  <p class="lead">${esc(lead)}</p>
  <section class="section">
    <h2>Precio de oferta por m² (avisos actuales)</h2>
    <div class="tbl"><table>
      <thead><tr><th>Tipo</th><th class="n">Avisos</th><th class="n">Mediana US$/m²</th><th class="n">Rango central (P25–P75)</th></tr></thead>
      <tbody>${pp.rows.map(([label, st]) => `
        <tr><td>${esc(label)}</td><td class="n">${st.n}</td><td class="n">${fmtNum(st.med)}</td><td class="n">${fmtNum(st.p25)} – ${fmtNum(st.p75)}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="note">Calculado sobre avisos en venta en dólares con área registrada. Es el precio pedido, no el de cierre.</p>
  </section>
  ${pp.tasYears.length ? `<section class="section">
    <h2>Mediana de tasaciones por año</h2>
    <div class="tbl"><table>
      <thead><tr><th>Año</th><th class="n">Mediana US$/m²</th><th class="n">Tasaciones</th></tr></thead>
      <tbody>${pp.tasYears.map(t => `
        <tr><td>${t.year}</td><td class="n">${fmtNum(t.m)}</td><td class="n">${fmtNum(t.n)}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="note">Valores de tasación de la base de Vanet Data. Solo se muestran los años con ${MIN_TASACIONES} o más tasaciones.</p>
  </section>` : ''}
  <p><a class="cta inline" href="${appSearchUrl('Histórico', pp.district)}">📜 Ver compraventas históricas en el mapa</a></p>
  ${districtCombos.length ? `<section class="section"><h2>Avisos en ${esc(pp.district)}</h2>${linkList(districtCombos)}</section>` : ''}
  <section class="section">
    <h2>Precio del m² en otros distritos</h2>
    ${priceTable(pricePages, pp)}
  </section>`;

  return layout({
    title: `${pp.name}: ${money('$', main.med)} (${mainLabel.toLowerCase()} en venta) | Reco`,
    desc: `${lead} Compara con otros distritos y revisa compraventas históricas en Reco.`.slice(0, 300),
    path: pp.path,
    graph: [{ '@type': 'WebPage', name: pp.name, url: SITE + pp.path, inLanguage: 'es-PE' }],
    crumbs: [{ name: 'Inicio', path: '/' }, { name: 'Búsqueda especial', path: SEARCH_BASE }, { name: pp.name, path: pp.path }],
    headerLink: { href: appSearchUrl('Venta', pp.district), label: 'Ver en el mapa →' },
    body,
  });
}

// Buscador: filtra en el navegador /busqueda-especial/inmuebles.json.
const HUB_SCRIPT = `<script>
(function(){
  var f=document.getElementById('bsForm'),out=document.getElementById('bsRes'),data=null;
  function e(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function n(v){v=parseFloat(v);return isFinite(v)?v:null;}
  function fmt(v){return Math.round(v).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');}
  function money(c,v){return (c==='S/'?'S/ ':'US$ ')+fmt(v);}
  function run(){
    var q={op:f.op.value,t:f.t.value,d:f.d.value,amin:n(f.amin.value),amax:n(f.amax.value),b:n(f.b.value),pmax:n(f.pmax.value),c:f.c.value};
    var r=data.filter(function(x){
      return x.o===q.op&&(!q.t||x.t===q.t)&&(!q.d||x.d===q.d)
        &&(q.amin==null||x.a>=q.amin)&&(q.amax==null||(x.a>0&&x.a<=q.amax))
        &&(q.b==null||x.b>=q.b)&&(q.pmax==null||(x.c===q.c&&x.p<=q.pmax));
    }).sort(function(a,b){return a.p-b.p;});
    var map='/index.html#'+(q.d?'q='+encodeURIComponent(q.d)+'&':'')+'op='+(q.op==='Alquiler'?'alquiler':'venta');
    out.innerHTML='<h2>'+r.length+' resultado'+(r.length===1?'':'s')+'</h2>'
      +(r.length?'<ul class="related">'+r.slice(0,60).map(function(x){
        var m=[x.t];if(x.a>0)m.push(x.a+' m²');if(x.b>0)m.push(x.b+' dorm.');
        return '<li><a href="/inmueble/'+e(x.s)+'/"><small>'+e(m.join(' · '))+' · '+e(x.d)+'</small>'+e(x.ad)+'<br><strong>'+e(money(x.c,x.p))+(x.o==='Alquiler'?' al mes':'')+'</strong></a></li>';
      }).join('')+'</ul>':'<p class="lead">No hay inmuebles con esos filtros. Prueba ampliando el rango.</p>')
      +(r.length>60?'<p class="note">Mostrando 60 de '+r.length+'. Afina los filtros o <a href="'+map+'">mira todos en el mapa</a>.</p>':'');
    var ps=new URLSearchParams();['op','t','d','amin','amax','b','pmax','c'].forEach(function(k){if(f[k].value)ps.set(k,f[k].value);});
    try{history.replaceState(null,'','?'+ps.toString());}catch(_){}
  }
  f.addEventListener('submit',function(ev){
    ev.preventDefault();
    if(data){run();return;}
    out.innerHTML='<p class="lead">Buscando…</p>';
    fetch('/busqueda-especial/inmuebles.json').then(function(r){return r.json();}).then(function(j){data=j;run();})
      .catch(function(){out.innerHTML='<p class="lead">No se pudo cargar la búsqueda. Intenta de nuevo.</p>';});
  });
  f.op.addEventListener('change',function(){f.c.value=f.op.value==='Alquiler'?'S/':'$';});
  var ps=new URLSearchParams(location.search),any=false;
  ps.forEach(function(v,k){if(f[k]){f[k].value=v;any=true;}});
  if(any)f.requestSubmit?f.requestSubmit():f.dispatchEvent(new Event('submit'));
})();
</script>`;

function renderHub(listings, combos, pricePages) {
  const types = [...new Set(listings.map(typeLabel))].sort();
  const districtCounts = {};
  listings.forEach(p => { districtCounts[p.district] = (districtCounts[p.district] || 0) + 1; });
  const districts = Object.keys(districtCounts).sort((a, b) => a.localeCompare(b, 'es'));
  const priceByDistrict = new Map(pricePages.map(pp => [pp.district, pp]));

  const wide = combos.filter(c => !c.district);
  const byDistrict = Object.keys(districtCounts)
    .sort((a, b) => districtCounts[b] - districtCounts[a] || a.localeCompare(b, 'es'))
    .map(d => ({ d, links: combos.filter(c => c.isBase && c.district === d).concat(priceByDistrict.has(d) ? [priceByDistrict.get(d)] : []) }))
    .filter(x => x.links.length);

  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  const body = `
  <h1>Búsqueda especial</h1>
  <p class="lead">Busca departamentos, casas, terrenos y locales en venta o alquiler por distrito, metros cuadrados, dormitorios y precio. También puedes explorar los avisos por distrito y comparar el precio del m².</p>
  <form id="bsForm" class="form">
    <label>Operación<select name="op">${opt('Venta', 'Venta')}${opt('Alquiler', 'Alquiler')}</select></label>
    <label>Tipo<select name="t">${opt('', 'Todos')}${types.map(t => opt(t, t)).join('')}</select></label>
    <label>Distrito<select name="d">${opt('', 'Todos')}${districts.map(d => opt(d, d)).join('')}</select></label>
    <label>m² mínimo<input name="amin" type="number" min="0" inputmode="numeric" placeholder="Ej. 60"></label>
    <label>m² máximo<input name="amax" type="number" min="0" inputmode="numeric" placeholder="Ej. 120"></label>
    <label>Dormitorios<select name="b">${opt('', 'Cualquiera')}${opt('1', '1 o más')}${opt('2', '2 o más')}${opt('3', '3 o más')}${opt('4', '4 o más')}</select></label>
    <label>Precio máximo<input name="pmax" type="number" min="0" inputmode="numeric" placeholder="Sin límite"></label>
    <label>Moneda<select name="c">${opt('$', 'US$')}${opt('S/', 'S/')}</select></label>
    <button type="submit">Buscar</button>
  </form>
  <noscript><p class="note">Activa JavaScript para usar el buscador, o navega por las búsquedas de abajo.</p></noscript>
  <div id="bsRes" class="section"></div>

  <section class="section">
    <h2>Precio del m² por distrito</h2>
    ${priceTable(pricePages, null)}
  </section>
  <section class="section">
    <h2>En toda Lima</h2>
    ${linkList(wide.map(c => ({ path: c.path, label: `${c.name.replace(/ en Lima/, '')} (${c.items.length})` })))}
  </section>
  <section class="section">
    <h2>Por distrito</h2>
    ${byDistrict.map(x => `<h3>${esc(x.d)}</h3>${linkList(x.links.map(l => ({ path: l.path, label: l.items ? `${l.name.replace(' en ' + x.d, '')} (${l.items.length})` : 'Precio del m²' })))}`).join('\n    ')}
  </section>`;

  return layout({
    title: 'Búsqueda especial: inmuebles en Lima por distrito, m² y precio | Reco',
    desc: 'Busca departamentos, casas y terrenos en venta o alquiler en Lima por distrito, metros cuadrados, dormitorios y precio. Compara el precio del m² por distrito.',
    path: SEARCH_BASE,
    graph: [{ '@type': 'WebPage', name: 'Búsqueda especial', url: SITE + SEARCH_BASE, inLanguage: 'es-PE' }],
    crumbs: [{ name: 'Inicio', path: '/' }, { name: 'Búsqueda especial', path: SEARCH_BASE }],
    headerLink: { href: '/', label: 'Ir al mapa →' },
    body,
    script: HUB_SCRIPT,
  });
}

// Devuelve las páginas a escribir y, por cada aviso, la página de búsqueda
// que lo agrupa (para las migas de pan de la ficha).
function buildSearch(listings, tasaciones) {
  const combos = buildCombos(listings);
  const pricePages = buildPricePages(listings, tasaciones);
  const priceByDistrict = new Map(pricePages.map(pp => [pp.district, pp]));

  const pages = [{ path: SEARCH_BASE, html: renderHub(listings, combos, pricePages) }];
  for (const c of combos) pages.push({ path: c.path, html: renderCombo(c, combos, priceByDistrict) });
  for (const pp of pricePages) pages.push({ path: pp.path, html: renderPricePage(pp, pricePages, combos) });

  const slugs = new Set();
  for (const pg of pages) {
    if (slugs.has(pg.path)) throw new Error(`Ruta duplicada en Búsqueda especial: ${pg.path}`);
    slugs.add(pg.path);
  }

  const baseIndex = new Map(combos.filter(c => c.isBase).map(c => [`${c.op}|${c.type || ''}|${c.district || ''}`, c]));
  const groupFor = p => {
    const c = baseIndex.get(`${p.op}|${typeLabel(p)}|${p.district}`) || baseIndex.get(`${p.op}||${p.district}`);
    return c ? { name: c.name, path: c.path } : null;
  };

  const json = JSON.stringify(listings.map(p => ({
    s: listingPath(p).split('/')[2], t: typeLabel(p), o: p.op, d: p.district, ad: p.address,
    a: p.area, b: p.beds, p: p.price, c: p.cur,
  })));

  return { pages, groupFor, json };
}

module.exports = { buildSearch };
