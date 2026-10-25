// ─────────────────────────────────────────────────────────────────────────────
// ReCo — núcleo de sincronización (Fase 3 del roadmap de carga inteligente)
//
// Lógica pura (sin Firebase ni red) que usan las conexiones automáticas, la
// API pública y el correo de ingesta:
//   parseXml / xmlToObj   XML de feeds (Kyero, genéricos de CRMs) sin dependencias
//   parseCsv / aoaToItems CSV y Google Sheets publicados, con fila de títulos
//                         detectada y títulos repetidos
//   findItems / flatten   encuentra la lista de inmuebles en cualquier JSON/XML
//                         y aplana cada uno a rutas ("surface_area.built")
//   guessMapping          ruta del feed → campo de ReCo, por sinónimos (español,
//                         inglés, RESO, Kyero)
//   itemToEntry           un inmueble del feed → { extId, row, photos }
//   easyBrokerToEntry / wasiToEntry   adaptadores de los CRMs
//   rowToPub              fila (esquema de 31 columnas) → datos de publicación
//   contentHash / cambios detectar qué cambió entre una sincronización y otra
//   sheetCsvUrl           enlace de Google Sheets → URL de descarga CSV
//
// Regla de siempre: nada se inventa. Lo que no está en el feed queda vacío y
// la verificación previa a publicar (catalogo.verificarPublicacion) decide si
// se publica o queda como borrador.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const crypto = require('crypto');
const Catalogo = require('./shared/catalogo');
const Imp = require('./shared/import-core');

const MAX_PHOTOS = 12;

// ── XML ──────────────────────────────────────────────────────────────────────
const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', deg: '°', sup2: '²' };
function decodeEntities(s) {
  return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return XML_ENTITIES[e] != null ? XML_ENTITIES[e] : m;
  });
}
// "g:price" → "price" (Google Merchant y otros feeds con espacios de nombres).
const localName = (n) => String(n).replace(/^[^:]*:/, '');
function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s || ''))) {
    const v = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
    if (!/^xmlns/.test(m[1])) attrs[localName(m[1])] = decodeEntities(v);
  }
  return attrs;
}
// Árbol { name, attrs, children, text }. Tolerante: etiquetas sin cerrar o
// cerradas de más no rompen el resto del documento.
function parseXml(xml) {
  const s = String(xml || '').replace(/^﻿/, '');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) {
      const name = localName(m[2]);
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
    } else if (m[3]) {
      const node = { name: localName(m[3]), attrs: parseAttrs(m[4]), children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] != null) top.text += decodeEntities(m[6]);
  }
  return root;
}
// Árbol → objeto: hoja sin atributos = texto; elementos repetidos = array;
// atributos con "@" ("@id"); texto mixto en "#text".
function xmlToObj(node) {
  const text = node.text.trim();
  if (!node.children.length && !Object.keys(node.attrs).length) return text;
  const o = {};
  Object.entries(node.attrs).forEach(([k, v]) => { o['@' + k] = v; });
  node.children.forEach((c) => {
    const v = xmlToObj(c);
    if (o[c.name] === undefined) o[c.name] = v;
    else if (Array.isArray(o[c.name]) && o[c.name]._rep) o[c.name].push(v);
    else { const arr = [o[c.name], v]; Object.defineProperty(arr, '_rep', { value: true }); o[c.name] = arr; }
  });
  if (text) o['#text'] = text;
  return o;
}

// ── CSV / tablas ─────────────────────────────────────────────────────────────
function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  // Separador: el más frecuente en las primeras líneas (arriba puede haber
  // un título sin separadores).
  const head = s.split(/\r?\n/, 10).join('\n').replace(/"[^"]*"/g, '');
  const count = (ch) => head.split(ch).length - 1;
  const delim = [',', ';', '\t', '|'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((v) => v.trim()));
}
// Fila de títulos entre las primeras 20 (igual que el Excel de cualquier
// formato en la web): la que más columnas reconoce por sinónimos.
function detectHeaderRow(aoa) {
  const lim = Math.min(aoa.length, 20);
  let best = -1, bestScore = 1;
  for (let i = 0; i < lim; i++) {
    const cells = (aoa[i] || []).map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const score = Object.keys(guessMapping(cells)).filter((k) => !SPECIAL.includes(k)).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best >= 0) return best;
  for (let i = 0; i < lim; i++) {
    if ((aoa[i] || []).filter((v) => typeof v === 'string' && v.trim() && !/^[\d.,\s$/-]+$/.test(v)).length >= 3) return i;
  }
  return 0;
}
// Filas → objetos por título. Sin título: "Columna N"; repetidos: "Precio (2)".
function aoaToItems(aoa) {
  if (!aoa || aoa.length < 2) return [];
  const hi = detectHeaderRow(aoa);
  const head = (aoa[hi] || []).map((v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim());
  const data = aoa.slice(hi + 1).filter((r) => (r || []).some((v) => String(v == null ? '' : v).trim()))
    .filter((r) => r.map((v) => String(v == null ? '' : v).trim()).join('|') !== head.join('|'));
  const width = Math.max(head.length, ...data.map((r) => r.length));
  const seen = {}, cols = [];
  for (let i = 0; i < width; i++) {
    if (!head[i] && !data.some((r) => String(r[i] == null ? '' : r[i]).trim())) continue;
    let h = head[i] || `Columna ${i + 1}`;
    if (seen[h]) h = `${h} (${++seen[h]})`; else seen[h] = 1;
    cols.push([i, h]);
  }
  return data.map((r) => { const o = {}; cols.forEach(([i, h]) => { o[h] = r[i] == null ? '' : String(r[i]); }); return o; });
}

// ── Lista de inmuebles y aplanado ────────────────────────────────────────────
const ITEM_KEY_RE = /^(propert(y|ies)|listings?|inmuebles?|items?|ads?|anuncios?|avisos?|offers?|propiedad(es)?|content|data|results|value|records|rows|entries|entry|row)$/i;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
// {"0": {...}, "1": {...}, "total": 2} (Wasi) → array.
function numericKeysToArray(o) {
  if (!isObj(o)) return null;
  const keys = Object.keys(o).filter((k) => /^\d+$/.test(k) && isObj(o[k]));
  return keys.length ? keys.sort((a, b) => a - b).map((k) => o[k]) : null;
}
// Busca por niveles (la lista de inmuebles está más arriba que la de fotos de
// cada uno); en un mismo nivel gana el nombre típico y la lista más larga.
function findItems(data) {
  if (Array.isArray(data)) {
    const objs = data.filter(isObj);
    if (objs.length) return objs;
  }
  let level = [{ key: '', v: data }];
  for (let depth = 0; depth < 6 && level.length; depth++) {
    let best = null, bestScore = 0;
    const next = [];
    level.forEach(({ v }) => {
      if (!isObj(v)) return;
      const num = numericKeysToArray(v);
      if (num && num.length) {
        const sc = num.length * 5;
        if (sc > bestScore) { best = num; bestScore = sc; }
      }
      Object.entries(v).forEach(([k, val]) => {
        const named = ITEM_KEY_RE.test(k) ? 10 : 1;
        if (Array.isArray(val)) {
          const objs = val.filter(isObj);
          const sc = objs.length * named;
          if (objs.length && sc > bestScore) { best = objs; bestScore = sc; }
        } else if (isObj(val)) {
          // Un solo inmueble en el feed: <property> aparece una vez.
          const prims = Object.values(val).filter((x) => !isObj(x) && !Array.isArray(x)).length;
          if (named === 10 && /^(propert(y|ies)|listing|inmueble|item|ad|anuncio|aviso|offer|propiedad)$/i.test(k) && prims >= 3 && 0.5 > bestScore) {
            best = [val]; bestScore = 0.5;
          }
          next.push({ key: k, v: val });
        }
      });
    });
    if (best) return best;
    level = next;
  }
  return [];
}
// Inmueble → { 'ruta.del.campo': [valores] }. Los índices de array no
// forman parte de la ruta ("images.image.url" junta todas las fotos).
function flatten(item) {
  const out = {};
  const walk = (v, path) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, path)); return; }
    if (isObj(v)) {
      Object.entries(v).forEach(([k, x]) => {
        const seg = k === '#text' ? '' : k;
        walk(x, seg ? (path ? `${path}.${seg}` : seg) : path);
      });
      return;
    }
    const s = String(v).trim();
    if (!s || !path) return;
    (out[path] = out[path] || []).push(s);
  };
  walk(item, '');
  return out;
}

// ── Mapeo por sinónimos ──────────────────────────────────────────────────────
const norm = (s) => String(s == null ? '' : s).replace(/@/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Campos especiales además de las 31 columnas: id externo y fotos.
const SPECIAL = ['id', 'fotos'];
// En orden de prioridad: el primer sinónimo que aparece en el feed gana. Los
// campos se recorren en FIELD_ORDER para que los específicos (área de terreno)
// no pierdan su columna frente a los genéricos ("area").
const SYNONYMS = {
  id: ['listing key', 'listingkey', 'public id', 'id property', 'external id', 'id externo', 'property id', 'listing id',
    'id', 'ref', 'reference', 'referencia', 'codigo', 'cod', 'code', 'sku'],
  direccion: ['direccion', 'direccion completa', 'unparsed address', 'street address', 'address', 'street', 'location street',
    'location address', 'domicilio', 'calle', 'ubicacion', 'dir', 'location detail'],
  departamento: ['departamento', 'state or province', 'region', 'state', 'department'],
  provincia: ['provincia', 'county or parish', 'county', 'province', 'ciudad'],
  distrito: ['distrito', 'district', 'barrio', 'neighborhood', 'neighbourhood', 'urbanizacion', 'zona', 'zone', 'zone label',
    'town', 'location name', 'city', 'city label', 'sector'],
  latitud: ['latitud', 'latitude', 'lat', 'location latitude', 'geo lat', 'location lat'],
  longitud: ['longitud', 'longitude', 'lng', 'lon', 'long', 'location longitude', 'geo lng', 'location lng'],
  mostrar_direccion: ['mostrar direccion', 'internet address display yn', 'show address'],
  tipo_publicacion: ['tipo publicacion', 'operacion', 'operation', 'tipo operacion', 'tipo de operacion', 'transaction type',
    'transaction', 'operations type', 'price freq', 'listing type', 'modalidad', 'op'],
  tipo_propiedad: ['tipo propiedad', 'tipo de inmueble', 'tipo inmueble', 'property sub type', 'property type', 'tipo',
    'type', 'categoria', 'category', 'property type label'],
  tipo_moneda: ['tipo moneda', 'moneda', 'currency code', 'currency', 'iso currency', 'operations currency', 'price currency', 'divisa'],
  precio: ['precio', 'list price', 'price', 'operations amount', 'valor', 'monto', 'amount', 'sale price', 'precio venta', 'importe'],
  area_terreno: ['area terreno', 'lot size area', 'lot size', 'surface area plot', 'plot', 'superficie terreno', 'superficie total',
    'land area', 'area total', 'terreno', 'area lote'],
  area_techada: ['area techada', 'area construida', 'living area', 'construction size', 'surface area built', 'built area', 'built',
    'superficie construida', 'superficie cubierta', 'covered area', 'area util', 'm2 construidos', 'area', 'superficie', 'size',
    'surface', 'metraje', 'm2'],
  nro_dormitorios: ['nro dormitorios', 'dormitorios', 'bedrooms total', 'bedrooms', 'beds', 'habitaciones', 'recamaras', 'cuartos', 'dorm'],
  nro_banos: ['nro banos', 'banos', 'bathrooms total integer', 'bathrooms', 'baths', 'bano', 'ss hh', 'sshh'],
  nro_estacionamientos: ['nro estacionamientos', 'estacionamientos', 'parking total', 'parking spaces', 'parking', 'cocheras',
    'cochera', 'garages', 'garajes', 'garage'],
  nro_pisos: ['nro pisos', 'pisos edificio', 'total pisos', 'stories total', 'floors total', 'building floors'],
  piso: ['piso', 'entry level', 'floor', 'floor number'],
  niveles: ['niveles', 'stories', 'levels', 'niveles ocupa'],
  antiguedad: ['antiguedad', 'year built', 'building date', 'ano construccion', 'anio construccion', 'age', 'edad'],
  estado: ['estado', 'estado construccion', 'development status', 'construction status', 'condicion'],
  ascensor: ['ascensor', 'elevator', 'lift', 'elevador'],
  amoblado: ['amoblado', 'amueblado', 'furnished'],
  pet_friendly: ['pet friendly', 'pets allowed', 'mascotas', 'pets'],
  etiquetas_generales: ['etiquetas generales', 'caracteristicas', 'features feature', 'features', 'amenities', 'interior features', 'extras'],
  etiquetas_ambientes: ['etiquetas ambientes', 'community features', 'areas comunes'],
  etiquetas_vista: ['etiquetas vista', 'view', 'vista'],
  etiquetas_acceso: ['etiquetas acceso'],
  etiquetas_zonas: ['etiquetas zonas', 'zonificacion'],
  titulo: ['titulo', 'title', 'headline', 'heading', 'encabezado', 'nombre del anuncio', 'nombre'],
  descripcion: ['descripcion', 'desc es', 'description es', 'public remarks', 'description', 'desc', 'observaciones', 'observations',
    'detalle', 'comentarios', 'remarks', 'comments'],
};
const FIELD_ORDER = ['id', 'latitud', 'longitud', 'area_terreno', 'area_techada', 'nro_pisos', 'piso', 'niveles', 'tipo_moneda',
  'precio', 'tipo_publicacion', 'tipo_propiedad', 'nro_dormitorios', 'nro_banos', 'nro_estacionamientos', 'antiguedad', 'estado',
  'ascensor', 'amoblado', 'pet_friendly', 'etiquetas_generales', 'etiquetas_ambientes', 'etiquetas_vista', 'etiquetas_acceso',
  'etiquetas_zonas', 'titulo', 'descripcion', 'mostrar_direccion', 'distrito', 'provincia', 'departamento', 'direccion'];
const PHOTO_PATH_RE = /(image|imagen|img|photo|foto|picture|gallery|galeria|media|url big)/;
const IMG_URL_RE = /^https?:\/\/\S+$/i;
// Rutas (o títulos de columna) → { campo: ruta }, y "fotos": [rutas].
// samples (opcional): inmuebles aplanados para reconocer las rutas de fotos
// por su contenido.
function guessMapping(paths, samples) {
  const used = new Set();
  const map = {};
  const normed = paths.map((p) => ({ p, full: norm(p), last: norm(String(p).split('.').pop()) }));
  FIELD_ORDER.forEach((field) => {
    const cands = SYNONYMS[field].map(norm);
    for (const c of cands) {
      // El id externo solo en el primer nivel (no el "@id" de cada foto).
      const pool = normed.filter((x) => !used.has(x.p) && (field !== 'id' || !String(x.p).includes('.')));
      // Por la ruta completa o por su último tramo ("location.latitude"),
      // salvo dentro de bloques que no describen el inmueble.
      const hit = pool.find((x) => x.full === c)
        || pool.find((x) => x.last === c && !/^(agent|agency|operations|images|photos|media|user)\b/.test(x.full));
      if (hit) { map[field] = hit.p; used.add(hit.p); return; }
    }
    // Contiene el sinónimo (títulos largos de Excel: "Precio de venta US$").
    if (field === 'id') return;
    for (const c of cands) {
      if (c.length < 4) continue;
      const hit = normed.find((x) => !used.has(x.p) && (` ${x.full} `).includes(` ${c} `));
      if (hit) { map[field] = hit.p; used.add(hit.p); return; }
    }
  });
  const fotos = paths.filter((p) => PHOTO_PATH_RE.test(norm(p)) && !used.has(p)
    && (!samples || samples.some((s) => (s[p] || []).some((v) => IMG_URL_RE.test(v)))));
  if (fotos.length) map.fotos = fotos;
  return map;
}
// Todas las rutas que aparecen en los inmuebles (para el mapeo y la vista previa).
function pathsOf(flats) {
  const set = new Set();
  flats.forEach((f) => Object.keys(f).forEach((k) => set.add(k)));
  return [...set];
}

// ── Inmueble del feed → fila ─────────────────────────────────────────────────
function htmlToText(s) {
  return decodeEntities(String(s == null ? '' : s)
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|h\d)\s*>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/ +([.,;:!?])/g, '$1').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const RENT_RE = /\b(month|monthly|week|weekly|mensual|mes|semanal|rent|renta|alquiler|lease|arriendo)\b/i;
function valuesAt(flat, path) {
  return path ? (flat[path] || []) : [];
}
// Feed aplanado + mapeo → { extId, row, photos }. row usa las 31 columnas y
// pasa después por Imp.normalizeRow.
function itemToEntry(flat, mapping) {
  const m = mapping || {};
  const row = {};
  Imp.COLS.forEach((k) => {
    const vals = valuesAt(flat, m[k]);
    if (/^etiquetas_/.test(k)) row[k] = vals.join(';');
    else if (k === 'descripcion' || k === 'titulo') row[k] = htmlToText(vals[0] || '');
    else row[k] = vals[0] || '';
  });
  // Kyero: price_freq "sale" | "month" | "week".
  if (row.tipo_publicacion && !Catalogo.matchOp(row.tipo_publicacion) && RENT_RE.test(row.tipo_publicacion)) row.tipo_publicacion = 'Alquiler';
  // Moneda dentro del precio ("US$ 185,000") si no hay columna de moneda.
  if (!row.tipo_moneda) row.tipo_moneda = Imp.parseMoney(row.precio).currency;
  const extId = String(valuesAt(flat, m.id)[0] || '').trim().slice(0, 120);
  const photoPaths = Array.isArray(m.fotos) ? m.fotos : [];
  const photos = [...new Set(photoPaths.flatMap((p) => valuesAt(flat, p)).filter((v) => IMG_URL_RE.test(v)))].slice(0, MAX_PHOTOS);
  return { extId, row, photos };
}

// Título automático cuando el feed no trae uno (Kyero no tiene título): solo
// con datos de la fila. "Departamento en venta en Miraflores · 3 dorm. · 90 m²"
function tituloAuto(row) {
  const tipo = Catalogo.matchType(row.tipo_propiedad) || '';
  const op = Catalogo.matchOp(row.tipo_publicacion);
  if (!tipo || !row.distrito) return '';
  const area = Number(row.area_techada) || Number(row.area_terreno) || 0;
  const partes = [`${tipo}${op ? ` en ${op.toLowerCase()}` : ''} en ${row.distrito}`];
  if (Number(row.nro_dormitorios) > 0 && tipo !== 'Terreno') partes.push(`${row.nro_dormitorios} dorm.`);
  if (area) partes.push(`${area} m²`);
  return partes.join(' · ').slice(0, 120);
}

// Los feeds traen una sola lista de características ("Ascensor", "Gimnasio",
// "Vista al mar"): cada una va a su campo de ReCo. Ascensor, amoblado y
// mascotas son campos sí/no; ambientes y vista, sus propias etiquetas.
const BOOL_TAGS = [['ascensor', /\b(ascensor|elevador|elevator|lift)\b/], ['amoblado', /\b(amoblado|amueblado|furnished)\b/],
  ['pet_friendly', /\b(mascotas?|pet friendly|pets? allowed|pets)\b/]];
function repartirEtiquetas(raw) {
  const r = { ...raw };
  const quedan = [];
  String(r.etiquetas_generales || '').split(/\s*[;,]\s*/).filter(Boolean).forEach((t) => {
    const n = norm(t);
    const b = BOOL_TAGS.find(([, re]) => re.test(n));
    if (b) { if (!String(r[b[0]] || '').trim()) r[b[0]] = 'Sí'; return; }
    if (Catalogo.matchEtiqueta('etiquetas_generales', t)) { quedan.push(t); return; }
    const otra = ['etiquetas_ambientes', 'etiquetas_vista'].find((k) => Catalogo.matchEtiqueta(k, t));
    if (otra) r[otra] = [r[otra], t].filter(Boolean).join(';');
    else quedan.push(t);
  });
  r.etiquetas_generales = quedan.join(';');
  return r;
}

// Normaliza y completa: fila lista para borrador o publicación + notas.
function prepareRow(rawRow) {
  const { row, notas } = Imp.normalizeRow(repartirEtiquetas(rawRow || {}));
  const notes = notas.slice();
  if (!row.titulo) {
    const t = tituloAuto(row);
    if (t) { row.titulo = t; notes.push('El feed no trae título: lo armamos con el tipo, la operación y el distrito.'); }
  }
  return { row, notes };
}

// Clave estable de un inmueble sin id en el feed (Google Sheets sin columna
// de código): dirección + distrito + tipo + operación.
function syntheticId(row) {
  const base = [row.direccion, row.distrito, Catalogo.matchType(row.tipo_propiedad), Catalogo.matchOp(row.tipo_publicacion)].map(norm).join('|');
  return 'k-' + crypto.createHash('sha1').update(base).digest('hex').slice(0, 16);
}

// ── Adaptadores de CRMs ──────────────────────────────────────────────────────
// EasyBroker (api.easybroker.com/v1): GET /properties (lista) y
// /properties/{public_id} (detalle con descripción y fotos).
function easyBrokerToEntry(p) {
  const x = p || {};
  const loc = isObj(x.location) ? x.location : { name: String(x.location || '') };
  const partes = String(loc.name || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ops = (Array.isArray(x.operations) ? x.operations : []);
  const op = ops.find((o) => o && o.type === 'sale') || ops.find((o) => o && /rental/.test(o.type)) || ops[0] || {};
  const features = (Array.isArray(x.features) ? x.features : []).map((f) => (isObj(f) ? f.name : f)).filter(Boolean);
  const photos = (Array.isArray(x.property_images) ? x.property_images : []).map((im) => im && im.url).filter(Boolean);
  if (!photos.length && x.title_image_full) photos.push(x.title_image_full);
  const row = {
    direccion: [loc.street, loc.exterior_number].filter(Boolean).join(' ') || partes[0] || '',
    distrito: partes[0] || '', provincia: partes[1] || '', departamento: partes[2] || '',
    latitud: loc.latitude != null ? String(loc.latitude) : '', longitud: loc.longitude != null ? String(loc.longitude) : '',
    mostrar_direccion: loc.show_exact_location === false ? 'No' : '',
    tipo_publicacion: op.type === 'sale' ? 'Venta' : op.type ? 'Alquiler' : '',
    tipo_propiedad: String(x.property_type || ''),
    tipo_moneda: String(op.currency || ''), precio: op.amount != null ? String(op.amount) : '',
    nro_dormitorios: x.bedrooms != null ? String(x.bedrooms) : '', nro_banos: x.bathrooms != null ? String(x.bathrooms) : '',
    nro_estacionamientos: x.parking_spaces != null ? String(x.parking_spaces) : '',
    area_techada: x.construction_size != null ? String(x.construction_size) : '',
    area_terreno: x.lot_size != null ? String(x.lot_size) : '',
    piso: x.floor != null ? String(x.floor) : '', nro_pisos: x.floors != null ? String(x.floors) : '',
    antiguedad: x.age != null ? String(x.age) : '',
    etiquetas_generales: features.join(';'),
    titulo: htmlToText(x.title || ''), descripcion: htmlToText(x.description || ''),
  };
  return { extId: String(x.public_id || '').slice(0, 120), row, photos: [...new Set(photos)].slice(0, MAX_PHOTOS) };
}
// Wasi (api.wasi.co/v1/property/search): ids de tipo frecuentes. Lo que no
// está aquí se reconoce por la etiqueta, si viene.
const WASI_TYPES = { 1: 'Casa', 2: 'Departamento', 3: 'Local comercial', 4: 'Oficina', 5: 'Terreno', 6: 'Terreno',
  7: 'Otros', 8: 'Otros', 10: 'Casa', 11: 'Casa', 14: 'Departamento', 15: 'Oficina', 16: 'Otros', 17: 'Terreno',
  20: 'Departamento', 21: 'Departamento', 22: 'Casa', 24: 'Casa', 32: 'Terreno' };
const isTrue = (v) => v === true || v === 1 || /^(true|1|si|sí|yes)$/i.test(String(v == null ? '' : v).trim());
function wasiToEntry(p) {
  const x = p || {};
  const venta = isTrue(x.for_sale), alquiler = isTrue(x.for_rent);
  const precio = venta ? x.sale_price : alquiler ? x.rent_price : '';
  const fotos = [];
  if (isObj(x.main_image)) fotos.push(x.main_image.url_big || x.main_image.url);
  (Array.isArray(x.galleries) ? x.galleries : []).forEach((g) => {
    Object.values(isObj(g) ? g : {}).forEach((im) => { if (isObj(im)) fotos.push(im.url_big || im.url); });
  });
  const features = [];
  if (isObj(x.features)) Object.values(x.features).forEach((lst) => (Array.isArray(lst) ? lst : []).forEach((f) => { if (f && (f.nombre || f.name)) features.push(f.nombre || f.name); }));
  const tipoLabel = String(x.property_type_label || x.type_label || '');
  const row = {
    direccion: String(x.address || ''),
    distrito: String(x.zone_label || x.location_label || x.city_label || ''),
    provincia: String(x.city_label || ''), departamento: String(x.region_label || ''),
    latitud: x.latitude ? String(x.latitude) : '', longitud: x.longitude ? String(x.longitude) : '',
    tipo_publicacion: venta ? 'Venta' : alquiler ? 'Alquiler' : '',
    tipo_propiedad: (tipoLabel && Catalogo.matchType(tipoLabel)) || WASI_TYPES[Number(x.id_property_type)] || tipoLabel,
    tipo_moneda: String(x.iso_currency || ''), precio: precio != null ? String(precio) : '',
    nro_dormitorios: x.bedrooms != null ? String(x.bedrooms) : '', nro_banos: x.bathrooms != null ? String(x.bathrooms) : '',
    nro_estacionamientos: x.garages != null ? String(x.garages) : '',
    area_techada: String(Number(x.built_area) || Number(x.private_area) || ''),
    area_terreno: String(Number(x.area) && Number(x.area) !== Number(x.built_area) ? Number(x.area) : (/terreno|lote/i.test(tipoLabel) ? Number(x.area) || '' : '')),
    piso: x.floor ? String(x.floor) : '',
    antiguedad: x.building_date ? String(x.building_date) : '',
    etiquetas_generales: features.join(';'),
    titulo: htmlToText(x.title || ''), descripcion: htmlToText(x.observations || ''),
  };
  return { extId: String(x.id_property || '').slice(0, 120), row, photos: [...new Set(fotos.filter(Boolean))].slice(0, MAX_PHOTOS) };
}

// ── Fila → publicación ───────────────────────────────────────────────────────
// Igual que _pubBulkRowToPubData en index.html (carga masiva): la fila ya
// normalizada se convierte en los datos que valida verificarPublicacion.
function rowToPub(r) {
  const uF = Math.max(1, Number(r.niveles) || 1);
  const { estado, antiguedad } = Catalogo.resolveEstadoAntiguedad(r.estado, r.antiguedad);
  const feats = [];
  Object.keys(Catalogo.ETIQUETAS).forEach((k) => {
    String(r[k] || '').split(/\s*[;,]\s*/).filter(Boolean).forEach((t) => {
      const c = Catalogo.matchEtiqueta(k, t);
      if (c && !feats.includes(c)) feats.push(c);
    });
  });
  const lvlTag = uF === 2 ? 'Dúplex' : uF === 3 ? 'Tríplex' : uF > 3 ? `${uF} niveles` : '';
  if (lvlTag && !feats.includes(lvlTag)) feats.push(lvlTag);
  const lat = r.latitud !== '' && r.latitud != null ? Number(r.latitud) : null;
  const lng = r.longitud !== '' && r.longitud != null ? Number(r.longitud) : null;
  return {
    address: String(r.direccion || '').trim(),
    district: String(r.distrito || '').trim(),
    lat: lat != null && isFinite(lat) && lat !== 0 ? lat : null,
    lng: lng != null && isFinite(lng) && lng !== 0 ? lng : null,
    hideExact: Catalogo.matchBool(r.mostrar_direccion) === false,
    type: Catalogo.matchType(r.tipo_propiedad) || '',
    op: Catalogo.matchOp(r.tipo_publicacion) || '',
    currency: Catalogo.matchCurrency(r.tipo_moneda) || '',
    price: Number(r.precio) || 0,
    area: Number(r.area_techada) || 0,
    areaTerr: Number(r.area_terreno) || 0,
    beds: Number(r.nro_dormitorios) || 0,
    baths: Number(r.nro_banos) || 0,
    parking: Number(r.nro_estacionamientos) || 0,
    floor: Number(r.piso) || 0,
    unitFloors: uF,
    floors: Number(r.nro_pisos) || 0,
    age: antiguedad,
    estado,
    ascensor: Catalogo.matchBool(r.ascensor) === true,
    amoblado: Catalogo.matchBool(r.amoblado) === true,
    petFriendly: Catalogo.matchBool(r.pet_friendly) === true,
    features: feats.slice(0, 30),
    title: String(r.titulo || '').trim(),
    desc: String(r.descripcion || '').trim(),
  };
}

// Publicación → fila (para editar una publicación con la API: la fila
// modificada vuelve a pasar por prepareRow y rowToPub). Cada característica
// vuelve a su lista de etiquetas.
function pubToRow(p) {
  const x = p || {};
  const bool = (v) => (v ? 'Sí' : 'No');
  const row = {
    direccion: x.address || '', distrito: x.district || '',
    latitud: x.lat != null ? String(x.lat) : '', longitud: x.lng != null ? String(x.lng) : '',
    tipo_publicacion: x.op || '', tipo_propiedad: x.type || '', tipo_moneda: x.currency || '',
    precio: x.price ? String(x.price) : '',
    area_techada: String(x.areaTech != null ? x.areaTech : (x.type === 'Terreno' ? '' : x.area || '')),
    area_terreno: x.areaTerr ? String(x.areaTerr) : '',
    nro_dormitorios: String(x.beds || ''), nro_banos: String(x.baths || ''), nro_estacionamientos: String(x.parking || ''),
    nro_pisos: String(x.floors || ''), piso: String(x.floor || ''), niveles: String(x.unitFloors || ''),
    antiguedad: x.age != null ? String(x.age) : '', estado: x.estado || '',
    ascensor: bool(x.ascensor), amoblado: bool(x.amoblado), pet_friendly: bool(x.petFriendly),
    titulo: x.title || '', descripcion: x.desc || '',
  };
  Object.keys(Catalogo.ETIQUETAS).forEach((k) => { row[k] = ''; });
  (Array.isArray(x.features) ? x.features : []).forEach((f) => {
    const k = Object.keys(Catalogo.ETIQUETAS).find((c) => Catalogo.matchEtiqueta(c, f));
    if (k) row[k] = row[k] ? `${row[k]};${f}` : f;
  });
  if (row.area_techada === '0') row.area_techada = '';
  return row;
}

// Nombres que acepta la API pública (además de las 31 columnas de la
// plantilla): en inglés y del RESO Data Dictionary.
const API_FIELDS = (() => {
  const m = {
    address: 'direccion', district: 'distrito', province: 'provincia', region: 'departamento',
    lat: 'latitud', latitude: 'latitud', lng: 'longitud', longitude: 'longitud', show_address: 'mostrar_direccion',
    operation: 'tipo_publicacion', op: 'tipo_publicacion', type: 'tipo_propiedad', property_type: 'tipo_propiedad',
    bedrooms: 'nro_dormitorios', bathrooms: 'nro_banos', parking: 'nro_estacionamientos', building_floors: 'nro_pisos',
    floor: 'piso', unit_floors: 'niveles', levels: 'niveles', age: 'antiguedad', year_built: 'antiguedad',
    construction_status: 'estado', elevator: 'ascensor', furnished: 'amoblado', pet_friendly: 'pet_friendly',
    currency: 'tipo_moneda', price: 'precio', area_built: 'area_techada', area_land: 'area_terreno',
    title: 'titulo', description: 'descripcion', features: 'etiquetas_generales',
    CurrencyCode: 'tipo_moneda', PropertySubType: 'tipo_propiedad', PropertyType: 'tipo_propiedad',
  };
  Object.entries(Imp.RESO_MAP).forEach(([col, reso]) => { if (!m[reso]) m[reso] = col; });
  m.PropertyType = 'tipo_propiedad'; // en RESO_MAP es la operación; en la API, el tipo
  Imp.COLS.forEach((c) => { m[c] = c; });
  return m;
})();
// Cuerpo de la API → { row (parcial, solo lo enviado), extId, photos, desconocidos }.
function apiBodyToRow(body) {
  const b = isObj(body) ? body : {};
  const row = {};
  const desconocidos = [];
  Object.entries(b).forEach(([k, v]) => {
    if (['external_id', 'ListingKey', 'ListingId', 'photos', 'Media', 'id'].includes(k)) return;
    const col = API_FIELDS[k];
    if (!col) { desconocidos.push(k); return; }
    let val;
    if (v == null) val = '';
    else if (typeof v === 'boolean') val = v ? 'Sí' : 'No';
    else if (Array.isArray(v)) val = v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String).join(';');
    else if (typeof v === 'object') { desconocidos.push(k); return; }
    else val = String(v);
    row[col] = col === 'descripcion' ? val.slice(0, 6000) : val.slice(0, 500);
  });
  const extRaw = b.external_id != null ? b.external_id : b.ListingKey != null ? b.ListingKey : b.ListingId;
  const extId = extRaw != null ? String(extRaw).trim().slice(0, 120) : '';
  const media = Array.isArray(b.photos) ? b.photos : Array.isArray(b.Media) ? b.Media.map((m) => m && (m.MediaURL || m.url)) : null;
  const photos = media ? [...new Set(media.filter((u) => typeof u === 'string' && IMG_URL_RE.test(u)))].slice(0, MAX_PHOTOS) : null;
  return { row, extId, photos, desconocidos };
}
// Publicación → respuesta de la API (nombres en inglés + bloque RESO).
function pubToApi(id, p) {
  const x = p || {};
  const ts = (t) => (t && t.toMillis ? new Date(t.toMillis()).toISOString() : (typeof t === 'string' ? t : null));
  return {
    id, external_id: x.apiExternalId || (x.syncKey ? String(x.syncKey).split(':').slice(1).join(':') : null),
    status: x.status || 'pending', rejection_reason: x.rejectionReason || null, withdrawn_reason: x.withdrawnReason || null,
    source: x.source || null, created_at: ts(x.createdAt) || x.listedAt || null, updated_at: ts(x.apiUpdatedAt || x.syncedAt),
    address: x.address || '', district: x.district || '', lat: x.lat != null ? x.lat : null, lng: x.lng != null ? x.lng : null,
    type: x.type || '', operation: x.op || '', currency: x.currency || '', price: Number(x.price) || 0,
    area: Number(x.area) || 0, area_built: Number(x.areaTech) || 0, area_land: Number(x.areaTerr) || 0,
    bedrooms: Number(x.beds) || 0, bathrooms: Number(x.baths) || 0, parking: Number(x.parking) || 0,
    floor: Number(x.floor) || 0, unit_floors: Number(x.unitFloors) || 1, building_floors: Number(x.floors) || 0,
    age: Number(x.age) || 0, construction_status: x.estado || '', elevator: !!x.ascensor, furnished: !!x.amoblado,
    pet_friendly: !!x.petFriendly, features: Array.isArray(x.features) ? x.features : [],
    title: x.title || '', description: x.desc || '', photos: Array.isArray(x.photoUrls) ? x.photoUrls : [],
    reso: {
      ListingKey: id, UnparsedAddress: x.address || '', City: x.district || '', Latitude: x.lat != null ? x.lat : null,
      Longitude: x.lng != null ? x.lng : null, PropertyType: x.type || '', ListPrice: Number(x.price) || 0,
      ReCo_ListPriceCurrency: x.currency || '', LivingArea: Number(x.areaTech) || 0, LotSizeArea: Number(x.areaTerr) || 0,
      BedroomsTotal: Number(x.beds) || 0, BathroomsTotalInteger: Number(x.baths) || 0, ParkingTotal: Number(x.parking) || 0,
      PublicRemarks: x.desc || '', StandardStatus: ({ approved: 'Active', pending: 'Coming Soon', rejected: 'Canceled', withdrawn: 'Withdrawn' })[x.status] || 'Coming Soon',
    },
  };
}

// ── Cambios entre sincronizaciones ───────────────────────────────────────────
// Campos de la publicación que mantiene la sincronización.
const SYNC_FIELDS = ['address', 'district', 'lat', 'lng', 'type', 'op', 'currency', 'price', 'area', 'areaTech', 'areaTerr',
  'beds', 'baths', 'parking', 'floor', 'unitFloors', 'floors', 'age', 'estado', 'ascensor', 'amoblado', 'petFriendly',
  'features', 'title', 'desc'];
// Un cambio en estos campos (o en las fotos) vuelve a pasar por moderación;
// el precio, solo si cambia más de 50 %. El resto se actualiza y la
// publicación sigue aprobada.
const SENSITIVE_FIELDS = ['address', 'district', 'type', 'op', 'currency', 'title', 'desc'];
const stable = (v) => JSON.stringify(v == null ? null : v);
function contentHash(pubFields, photos) {
  const base = SYNC_FIELDS.map((k) => stable(pubFields[k])).join('|') + '#' + (photos || []).join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}
function photosHash(photos) {
  return crypto.createHash('sha1').update((photos || []).join('|')).digest('hex').slice(0, 16);
}
function cambios(before, after) {
  const changed = SYNC_FIELDS.filter((k) => stable(before[k]) !== stable(after[k]));
  const p0 = Number(before.price) || 0, p1 = Number(after.price) || 0;
  const precioFuerte = p0 > 0 && Math.abs(p1 - p0) / p0 > 0.5;
  const revisar = changed.some((k) => SENSITIVE_FIELDS.includes(k)) || precioFuerte;
  return { changed, revisar };
}

// ── Google Sheets ────────────────────────────────────────────────────────────
// Enlace de la hoja → URL de descarga CSV. Sirve con "Cualquier persona con
// el enlace puede ver" o con "Archivo → Compartir → Publicar en la web".
function sheetCsvUrl(u) {
  let url;
  try { url = new URL(String(u || '').trim()); } catch (_) { return null; }
  if (url.hostname !== 'docs.google.com' || !/^\/spreadsheets\/d\//.test(url.pathname)) return null;
  const gid = (url.hash.match(/gid=(\d+)/) || url.search.match(/[?&]gid=(\d+)/) || [])[1];
  const pub = url.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/);
  if (pub) return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ''}`;
  const id = (url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/) || [])[1];
  if (!id) return null;
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

// Contenido descargado → inmuebles aplanados (+ formato detectado).
function parseFeed(text, contentType) {
  const s = String(text || '').replace(/^﻿/, '').trim();
  const t = String(contentType || '').toLowerCase();
  if (/json/.test(t) || /^[[{]/.test(s)) {
    let data;
    try { data = JSON.parse(s); } catch (_) { data = null; }
    if (data != null) return { formato: 'json', items: findItems(data).map(flatten) };
  }
  if (/xml/.test(t) || /^</.test(s)) {
    if (/^<!doctype html|^<html/i.test(s)) return { formato: 'html', items: [] };
    const obj = xmlToObj(parseXml(s));
    const kyero = /<kyero\b/i.test(s.slice(0, 2000));
    return { formato: kyero ? 'kyero' : 'xml', items: findItems(obj).map(flatten) };
  }
  const items = aoaToItems(parseCsv(s)).map((o) => {
    const f = {};
    Object.entries(o).forEach(([k, v]) => { const x = String(v).trim(); if (x) f[k] = [x]; });
    return f;
  });
  return { formato: 'csv', items };
}

module.exports = {
  MAX_PHOTOS, SYNC_FIELDS, SENSITIVE_FIELDS, SPECIAL,
  decodeEntities, parseXml, xmlToObj, parseCsv, detectHeaderRow, aoaToItems,
  findItems, flatten, pathsOf, guessMapping, htmlToText, itemToEntry, tituloAuto, prepareRow, syntheticId,
  easyBrokerToEntry, wasiToEntry, rowToPub, pubToRow, apiBodyToRow, pubToApi, API_FIELDS,
  contentHash, photosHash, cambios, sheetCsvUrl, parseFeed,
};
