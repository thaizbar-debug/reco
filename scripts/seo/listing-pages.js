// Ficha estática de un inmueble (SEO Fase 2). Ver scripts/build-seo-pages.js.
const {
  SITE, SEARCH_BASE, esc, fmtArea, money, isoCurrency, typeLabel, opLabel, isFeminine,
  showsFloor, listingPath, headline, priceText, sqmPrice, cardHtml, layout,
} = require('./common');

const MAX_RELATED = 6;

function schemaType(label) {
  if (label === 'Departamento') return 'Apartment';
  if (label === 'Casa') return 'SingleFamilyResidence';
  return 'Place';
}

function summary(p) {
  const bits = [];
  if (p.area > 0) bits.push(`${fmtArea(p.area)} m²`);
  if (p.beds > 0) bits.push(`${p.beds} dormitorio${p.beds > 1 ? 's' : ''}`);
  if (p.baths > 0) bits.push(`${p.baths} baño${p.baths > 1 ? 's' : ''}`);
  if (p.park > 0) bits.push(`${p.park} cochera${p.park > 1 ? 's' : ''}`);
  return bits;
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

function listingLd(p, url) {
  const place = {
    '@type': schemaType(typeLabel(p)),
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
  return listing;
}

// Inmuebles del mismo distrito y operación, los de precio más parecido primero.
function pickRelated(p, sameGroup) {
  return sameGroup.filter(r => r !== p && r.cur === p.cur)
    .sort((a, b) => Math.abs(a.price - p.price) - Math.abs(b.price - p.price) || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_RELATED);
}

// `groupPage` = {name, path} de la página de Búsqueda especial que lista
// este inmueble (p. ej. "Departamentos en venta en Miraflores"), o null.
function renderListing(p, sameGroup, groupPage) {
  const path = listingPath(p);
  const appUrl = `/index.html#prop=${encodeURIComponent(p.id)}`;
  const label = typeLabel(p);
  const sq = sqmPrice(p);
  const related = pickRelated(p, sameGroup);

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
  <section class="section">
    <h2>Más inmuebles en ${opLabel(p.op)} en ${esc(p.district)}</h2>
    <ul class="related">${related.map(cardHtml).join('')}</ul>
    ${groupPage ? `<p class="note"><a href="${groupPage.path}">Ver todos: ${esc(groupPage.name)} →</a></p>` : ''}
  </section>` : '';

  const body = `
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
  ${relatedHtml}`;

  const crumbs = [{ name: 'Inicio', path: '/' }, { name: 'Búsqueda especial', path: SEARCH_BASE }];
  if (groupPage) crumbs.push(groupPage);
  crumbs.push({ name: headline(p), path });

  return layout({
    title: `${headline(p)}${p.area > 0 ? ', ' + fmtArea(p.area) + ' m²' : ''} · ${priceText(p)} | Reco`,
    desc: metaDescription(p),
    path,
    ogTitle: `${headline(p)} · ${priceText(p)}`,
    ogImage: p.photos[0],
    graph: [listingLd(p, SITE + path)],
    crumbs,
    headerLink: { href: appUrl, label: 'Ver en el mapa →' },
    body,
  });
}

module.exports = { renderListing };
