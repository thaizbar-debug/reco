// ─────────────────────────────────────────────────────────────────────────────
// ReCo — núcleo de importación (Fase 0 del roadmap de carga inteligente)
//
// Módulo puro (sin Firebase, sin DOM) que comparten el navegador y las
// Cloud Functions, para que "S/ 450 mil" o "3 dorm" se interpreten igual en
// los dos lados:
//   - index.html lo carga con <script src="functions/shared/import-core.js">
//     y lo usa como window.RecoImport.
//   - functions/index.js lo usa con require('./shared/import-core').
//
// Contiene:
//   COLS              esquema canónico (las 31 columnas de la plantilla)
//   normalizeRow()    normalizadores deterministas, idempotentes
//   stripPII()        quita teléfonos, correos y enlaces de WhatsApp
//   fingerprint()     huella para detectar inmuebles duplicados
//   guardInvented()   descarta números que la IA no tomó del texto fuente
//   EXTRACTION_SCHEMA JSON Schema de salida estructurada para la IA
//   RESO_MAP          equivalencia con RESO Data Dictionary 2.0
//
// Reglas: nunca inventar un valor; ante la duda, devolver '' y dejar que el
// usuario lo complete en la bandeja de revisión.
// ─────────────────────────────────────────────────────────────────────────────
// Tipo, operación, moneda, estado, antigüedad y sí/no se delegan en
// catalogo.js (RecoCatalogo), que también usa la carga masiva y el servidor.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalogo'));
  else if (root.RecoCatalogo) root.RecoImport = factory(root.RecoCatalogo);
})(typeof self !== 'undefined' ? self : this, function (Catalogo) {
  'use strict';

  // Mismo orden que _PUB_TPL_COLS en index.html.
  const COLS = ['direccion', 'departamento', 'provincia', 'distrito', 'latitud', 'longitud',
    'mostrar_direccion', 'tipo_publicacion', 'tipo_propiedad', 'nro_dormitorios', 'nro_banos',
    'nro_estacionamientos', 'nro_pisos', 'piso', 'niveles', 'antiguedad', 'estado', 'ascensor',
    'amoblado', 'pet_friendly', 'tipo_moneda', 'precio', 'area_terreno', 'area_techada',
    'etiquetas_generales', 'etiquetas_ambientes', 'etiquetas_vista', 'etiquetas_acceso',
    'etiquetas_zonas', 'titulo', 'descripcion'];
  // Obligatorios para cualquier tipo. El área exigida depende del tipo
  // (techada; de terreno en un Terreno): ver Catalogo.verificarPublicacion.
  const REQUIRED = ['direccion', 'distrito', 'precio', 'titulo', 'descripcion'];
  const COUNT_COLS = ['nro_dormitorios', 'nro_banos', 'nro_estacionamientos', 'nro_pisos', 'piso', 'niveles'];
  const BOOL_COLS = ['mostrar_direccion', 'ascensor', 'amoblado', 'pet_friendly'];
  const IMPORT_SOURCES = ['excel', 'csv', 'text', 'whatsapp', 'documento', 'url', 'pdf', 'feed'];

  // Lima Metropolitana + Callao (mismos nombres que ZONIF_DATA en index.html).
  const DISTRICTS = ['Ancón', 'Ate', 'Barranco', 'Breña', 'Carabayllo', 'Cercado de Lima',
    'Chaclacayo', 'Chorrillos', 'Cieneguilla', 'Comas', 'El Agustino', 'Independencia',
    'Jesús María', 'La Molina', 'La Victoria', 'Lince', 'Los Olivos', 'Lurigancho', 'Lurín',
    'Magdalena del Mar', 'Miraflores', 'Pachacámac', 'Pucusana', 'Pueblo Libre', 'Puente Piedra',
    'Punta Hermosa', 'Punta Negra', 'Rímac', 'San Bartolo', 'San Borja', 'San Isidro',
    'San Juan de Lurigancho', 'San Juan de Miraflores', 'San Luis', 'San Martín de Porres',
    'San Miguel', 'Santa Anita', 'Santa María del Mar', 'Santa Rosa', 'Santiago de Surco',
    'Surquillo', 'Villa El Salvador', 'Villa María del Triunfo',
    'Callao', 'Bellavista', 'Carmen de la Legua Reynoso', 'La Perla', 'La Punta', 'Mi Perú', 'Ventanilla'];
  const DISTRICT_ALIASES = {
    'sjl': 'San Juan de Lurigancho', 'sjm': 'San Juan de Miraflores', 'smp': 'San Martín de Porres',
    'vmt': 'Villa María del Triunfo', 'ves': 'Villa El Salvador', 'surco': 'Santiago de Surco',
    'magdalena': 'Magdalena del Mar', 'cercado': 'Cercado de Lima', 'lima cercado': 'Cercado de Lima',
    'centro de lima': 'Cercado de Lima', 'chosica': 'Lurigancho', 'huachipa': 'Lurigancho',
    'carmen de la legua': 'Carmen de la Legua Reynoso',
  };

  // Equivalencia orientativa con RESO Data Dictionary 2.0, para futuros
  // feeds y la API pública. "ReCo_*" = extensión local sin campo estándar.
  const RESO_MAP = {
    direccion: 'UnparsedAddress', departamento: 'StateOrProvince', provincia: 'CountyOrParish',
    distrito: 'City', latitud: 'Latitude', longitud: 'Longitude',
    mostrar_direccion: 'InternetAddressDisplayYN', tipo_publicacion: 'PropertyType',
    tipo_propiedad: 'PropertySubType', nro_dormitorios: 'BedroomsTotal',
    nro_banos: 'BathroomsTotalInteger', nro_estacionamientos: 'ParkingTotal',
    nro_pisos: 'StoriesTotal', piso: 'EntryLevel', niveles: 'Stories', antiguedad: 'YearBuilt',
    estado: 'DevelopmentStatus', ascensor: 'AssociationAmenities', amoblado: 'Furnished',
    pet_friendly: 'PetsAllowed', tipo_moneda: 'ReCo_ListPriceCurrency', precio: 'ListPrice',
    area_terreno: 'LotSizeArea', area_techada: 'LivingArea',
    etiquetas_generales: 'InteriorFeatures', etiquetas_ambientes: 'CommunityFeatures',
    etiquetas_vista: 'View', etiquetas_acceso: 'RoadFrontageType',
    etiquetas_zonas: 'ReCo_ZoneFeatures', titulo: 'ReCo_Title', descripcion: 'PublicRemarks',
  };

  const WORD_NUMBERS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
    siete: 7, ocho: 8, nueve: 9, diez: 10 };

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9$/]+/g, ' ').trim();
  }
  function cleanText(v) {
    return String(v == null ? '' : v).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*\n\s*/g, '\n\n').trim();
  }

  // "185,000" · "185.000" · "1.250.000" · "185 000" · "1,5" · "185k" · "185 mil"
  // · "1.2 millones" · "1,2 MM" → número; null si no hay número.
  function parseNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v == null ? '' : v).toLowerCase();
    const m = s.match(/-?\d[\d.,\s]*\d|-?\d/);
    if (!m) return null;
    let tok = m[0].trim();
    // Espacios como separador de miles solo si separan grupos de 3.
    tok = /^-?\d{1,3}( \d{3})+$/.test(tok) ? tok.replace(/ /g, '') : tok.split(' ')[0];
    const lastDot = tok.lastIndexOf('.'), lastComma = tok.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) {
      const dec = lastDot > lastComma ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      tok = tok.split(thou).join('').replace(dec, '.');
    } else if (lastDot !== -1 || lastComma !== -1) {
      const sep = lastDot !== -1 ? '.' : ',';
      const parts = tok.split(sep);
      const thousands = parts.length > 2 || (parts[1].length === 3 && parts[0].replace('-', '').length <= 3);
      tok = thousands ? parts.join('') : parts.join('.');
    }
    let n = Number(tok);
    if (!isFinite(n)) return null;
    const rest = s.slice(m.index + m[0].length).trim();
    if (/^(millon|millones|mm\b|mill\b)/.test(rest)) n *= 1e6;
    else if (/^(k\b|mil\b|lucas\b)/.test(rest)) n *= 1e3;
    return n;
  }
  function detectCurrency(v) {
    const s = String(v == null ? '' : v).toLowerCase();
    if (/s\/|\bpen\b|\bsoles?\b|\bnuevos soles\b/.test(s)) return 'PEN';
    if (/us\$|\busd\b|\$|d[oó]lar/.test(s)) return 'USD';
    return '';
  }
  function parseMoney(v) {
    return { amount: parseNumber(v), currency: detectCurrency(v) };
  }
  function parseCount(v) {
    const s = norm(v);
    if (!s) return null;
    const n = parseNumber(s);
    if (n != null) return Math.max(0, Math.floor(n));
    const w = s.split(' ').find(t => WORD_NUMBERS[t] != null);
    return w ? WORD_NUMBERS[w] : null;
  }
  const _DISTRICTS_BY_LEN = DISTRICTS.slice().sort((a, b) => b.length - a.length);
  // Devuelve el nombre canónico del distrito, o el texto original si no se
  // reconoce (puede ser un distrito fuera de Lima).
  function matchDistrict(v) {
    const raw = String(v == null ? '' : v).trim();
    const s = norm(raw);
    if (!s) return '';
    if (DISTRICT_ALIASES[s]) return DISTRICT_ALIASES[s];
    const exact = DISTRICTS.find(d => norm(d) === s);
    if (exact) return exact;
    const padded = ' ' + s + ' ';
    const inside = _DISTRICTS_BY_LEN.find(d => padded.indexOf(' ' + norm(d) + ' ') !== -1);
    if (inside) return inside;
    const alias = Object.keys(DISTRICT_ALIASES).find(a => padded.indexOf(' ' + a + ' ') !== -1);
    return alias ? DISTRICT_ALIASES[alias] : raw;
  }
  function parseCoord(v) {
    const s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!s) return '';
    const n = Number(s);
    return isFinite(n) ? String(n) : '';
  }
  function numStr(n) {
    if (n == null || !isFinite(n)) return '';
    return String(Math.round(n * 100) / 100);
  }

  // Teléfonos peruanos (móvil y +51), correos y enlaces wa.me. No toca
  // montos: si justo antes hay un símbolo de moneda, se deja tal cual.
  const PHONE_RE = /(\+?\s?51[\s.-]?)?\(?\b9\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{3}\b/g;
  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const WA_RE = /(https?:\/\/)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/\S*/gi;
  function stripPII(text) {
    let removed = 0;
    let out = String(text == null ? '' : text);
    out = out.replace(WA_RE, () => { removed++; return ''; });
    out = out.replace(EMAIL_RE, () => { removed++; return ''; });
    out = out.replace(PHONE_RE, (m, _p, offset, whole) => {
      const before = whole.slice(Math.max(0, offset - 6), offset).toLowerCase();
      if (/(\$|s\/|usd|pen)\s*\.?\s*$/.test(before)) return m;
      removed++;
      return '';
    });
    if (removed) {
      out = out.replace(/\b(cel(ular)?|tel(e|é)fono|tlf|whatsapp|wsp|wasap|contacto|llamar( al)?|escribir( al)?|correo|email)\s*[:.]?\s*(?=[\s,;.)]|$)/gi, '')
        .replace(/[ \t]{2,}/g, ' ').replace(/\(\s*\)/g, '').replace(/[ \t]+\n/g, '\n').trim();
    }
    return { text: out, removed };
  }

  // Normaliza una fila (claves del esquema canónico) a strings limpios.
  // Los campos de opciones cerradas pasan por Catalogo.standardizeRow.
  // Idempotente: normalizeRow(normalizeRow(r).row).row === normalizeRow(r).row.
  // `changes` lista lo que se modificó, para mostrarlo en la revisión.
  function normalizeRow(raw) {
    const src = raw || {};
    const std = Catalogo.standardizeRow(src);
    const row = {};
    const changes = [];
    const set = (k, v) => {
      const before = String(src[k] == null ? '' : src[k]).trim();
      row[k] = v;
      if (before !== v) changes.push({ field: k, from: before, to: v });
    };
    COLS.forEach(k => { row[k] = cleanText(src[k]); });

    const money = parseMoney(src.precio);
    set('precio', numStr(money.amount));
    set('tipo_moneda', std.row.tipo_moneda || money.currency);
    ['area_techada', 'area_terreno'].forEach(k => { set(k, numStr(parseNumber(src[k]))); });
    COUNT_COLS.forEach(k => {
      const n = parseCount(src[k]);
      set(k, n == null ? '' : String(n));
    });
    ['tipo_publicacion', 'tipo_propiedad', 'estado', 'antiguedad'].concat(BOOL_COLS)
      .forEach(k => { set(k, cleanText(std.row[k])); });
    set('distrito', matchDistrict(src.distrito));
    set('latitud', parseCoord(src.latitud));
    set('longitud', parseCoord(src.longitud));
    // Etiquetas: cada una a su nombre canónico; las no reconocidas se dejan
    // (la validación de la bandeja avisa). Separador estándar: ";".
    Object.keys(Catalogo.ETIQUETAS).forEach(k => {
      const tags = cleanText(src[k]).split(/\s*[;,]\s*/).filter(Boolean);
      const out = [];
      tags.forEach(t => { const c = Catalogo.matchEtiqueta(k, t) || t; if (!out.includes(c)) out.push(c); });
      set(k, out.join(';'));
    });
    ['titulo', 'descripcion'].forEach(k => {
      const p = stripPII(cleanText(src[k]));
      if (p.removed) changes.push({ field: k, pii: p.removed });
      set(k, p.text);
    });
    // notas: ajustes de estado/antigüedad (p. ej. "En construcción: la
    // antigüedad se publicará como 0").
    return { row, changes: changes.filter(c => c.pii || c.from !== c.to), notas: std.notas };
  }

  // Huella para duplicados: mismo distrito, operación, tipo, área principal,
  // precio y dormitorios ⇒ casi seguro el mismo inmueble. Acepta una fila
  // (area_techada / area_terreno) o una publicación (area = área principal).
  function fingerprint(r) {
    const p = r || {};
    const pick = (a, b) => (p[a] != null && p[a] !== '' ? p[a] : p[b]);
    const esFila = 'area_techada' in p || 'area_terreno' in p;
    const area = esFila
      ? Catalogo.verificarPublicacion({ type: pick('tipo_propiedad', 'type'),
        area: parseNumber(p.area_techada) || 0, areaTerr: parseNumber(p.area_terreno) || 0 }, { soloDatos: true }).datos.area
      : parseNumber(p.area);
    const price = parseNumber(pick('precio', 'price'));
    const beds = parseNumber(pick('nro_dormitorios', 'beds')) || 0;
    if (!area || !price) return '';
    return [norm(pick('distrito', 'district')), norm(pick('tipo_publicacion', 'op')),
      norm(pick('tipo_propiedad', 'type')), Math.round(area), Math.round(price), beds].join('|');
  }

  // Números presentes en un texto, con y sin multiplicadores ("185 mil" →
  // 185 y 185000; "tres" → 3).
  function numbersIn(text) {
    const out = [];
    const s = String(text || '').toLowerCase();
    // El lookbehind evita contar el "2" de "m2" o dígitos sueltos dentro de una palabra.
    const re = /(?<![a-z\d])\d[\d.,]*(\s?\d{3})*(\s*(millones|millon|mm|mil|k)\b)?/g;
    let m;
    while ((m = re.exec(s))) {
      const n = parseNumber(m[0]);
      if (n != null) out.push(n);
      const bare = parseNumber(m[0].replace(/[a-z\s]+$/, ''));
      if (bare != null) out.push(bare);
    }
    norm(s).split(' ').forEach(t => { if (WORD_NUMBERS[t] != null) out.push(WORD_NUMBERS[t]); });
    return out;
  }
  // Antialucinación: un número que la IA devuelve para estos campos tiene
  // que aparecer en el texto fuente; si no, se vacía. 0 se acepta siempre.
  const GUARDED = ['precio', 'area_techada', 'area_terreno', 'nro_dormitorios', 'nro_banos', 'nro_estacionamientos'];
  function guardInvented(row, sourceText) {
    const nums = numbersIn(sourceText);
    const dropped = [];
    const out = Object.assign({}, row);
    GUARDED.forEach(k => {
      const n = parseNumber(out[k]);
      if (n == null || n === 0) return;
      const ok = nums.some(x => Math.abs(x - n) <= Math.max(0.5, Math.abs(n) * 0.005));
      if (!ok) { out[k] = ''; dropped.push(k); }
    });
    return { row: out, dropped };
  }

  // Salida estructurada (modo strict): todas las claves requeridas, null si
  // el dato no está en el texto. Además de las columnas:
  //   campos_inferidos  columnas deducidas, no escritas literalmente
  //   fotos             ids de las fotos del documento que son de ese
  //                     inmueble (marcadores [FOTO …] del texto)
  //   evidencia         fragmento literal de donde salen los datos; en
  //                     páginas escaneadas, lo que se lee en la imagen
  const AI_FIELDS = COLS.filter(k => k !== 'latitud' && k !== 'longitud');
  const EXTRACTION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['inmuebles'],
    properties: {
      inmuebles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: AI_FIELDS.concat(['campos_inferidos', 'fotos', 'evidencia']),
          properties: Object.assign(
            AI_FIELDS.reduce((acc, k) => { acc[k] = { type: ['string', 'null'] }; return acc; }, {}),
            {
              campos_inferidos: { type: 'array', items: { type: 'string' } },
              fotos: { type: 'array', items: { type: 'string' } },
              evidencia: { type: ['string', 'null'] },
            }
          ),
        },
      },
    },
  };

  // ── Páginas de avisos (importar desde enlace, roadmap 1.4) ──
  // Extrae de un HTML lo útil para la IA, sin dependencias: título, meta
  // (og:*, description), JSON-LD, los datos de __NEXT_DATA__ con nombres de
  // campos inmobiliarios, el texto visible y las URLs de fotos (primero las
  // declaradas por la página: og:image, JSON-LD; después las del contenido).
  const PAGE_KEY_RE = /price|precio|amount|monto|currency|moneda|area|surface|superficie|metr|m2|room|dorm|habita|bath|bano|toilet|parking|estacion|cochera|garage|floor|piso|planta|age|antig|year|construc|address|direcc|street|calle|district|distrit|barrio|neighbo|city|ciudad|title|titulo|descrip|operation|operaci|transaction|type|tipo|propert|inmueble|amenit|feature|caracter|lat|lng|lon|status|estado/i;
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    sup2: '²', deg: '°', middot: '·', laquo: '«', raquo: '»', iquest: '¿', iexcl: '¡', ordm: 'º', ordf: 'ª', euro: '€',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü' };
  function decodeEntities(s) {
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e] || ENTITIES[e.toLowerCase()] || m;
    });
  }
  function absUrl(u, base) {
    try { const x = new URL(decodeEntities(String(u).trim()), base); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (_) { return ''; }
  }
  const IMG_URL_RE = /\.(jpe?g|png|webp)(\?|#|$)/i;
  function parseListingHtml(html, baseUrl) {
    const h = String(html || '');
    const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')); return m ? decodeEntities(m[2] != null ? m[2] : m[3]) : ''; };
    const titleM = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const meta = {};
    (h.match(/<meta\b[^>]*>/gi) || []).forEach((tag) => {
      const k = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
      const v = attr(tag, 'content');
      if (k && v && /^(og:|twitter:|description$|keywords$|product:)/.test(k) && !meta[k]) meta[k] = v.slice(0, 1000);
    });
    const jsonld = [];
    const images = [];
    const addImg = (u) => { const a = absUrl(u, baseUrl); if (a && !images.includes(a)) images.push(a); };
    ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image'].forEach((k) => { if (meta[k]) addImg(meta[k]); });
    const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    // Fotos del JSON-LD: valores bajo image / photo / thumbnail (también
    // { image: { url } }) y cualquier URL con extensión de imagen.
    const collectImages = (v, key, depth) => {
      if (v == null || depth > 8) return;
      if (typeof v === 'string') {
        if (/^(https?:|\/)/.test(v) && (/^(image|photo|thumbnail)/i.test(key) || IMG_URL_RE.test(v))) addImg(v);
        return;
      }
      if (Array.isArray(v)) { v.forEach((x) => collectImages(x, key, depth + 1)); return; }
      if (typeof v === 'object') Object.keys(v).forEach((k) => collectImages(v[k], /^(url|contenturl)$/i.test(k) ? key : k, depth + 1));
    };
    let m;
    let nextData = '';
    while ((m = scriptRe.exec(h))) {
      const attrs = m[1];
      if (/application\/ld\+json/i.test(attrs)) {
        const raw = m[2].trim();
        jsonld.push(raw.slice(0, 8000));
        try { collectImages(JSON.parse(raw), '', 0); } catch (_) { /* JSON-LD inválido: se usa como texto */ }
      } else if (/id\s*=\s*["']__NEXT_DATA__["']/i.test(attrs)) {
        nextData = m[2];
      }
    }
    // __NEXT_DATA__ (Next.js) trae el aviso completo, pero también mucho
    // ruido: solo se guardan los valores cuyo nombre suena a dato inmobiliario.
    const datos = [];
    if (nextData) {
      try {
        const seen = new Set();
        const walk = (v, key, depth) => {
          if (depth > 12 || datos.join('\n').length > 6000) return;
          if (v == null) return;
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            const sv = String(v);
            if (typeof v === 'string' && /^https?:\/\//.test(sv)) { if (IMG_URL_RE.test(sv)) addImg(sv); return; }
            if (key && PAGE_KEY_RE.test(key) && sv.length <= 400) {
              const line = `${key}: ${sv}`;
              if (!seen.has(line)) { seen.add(line); datos.push(line); }
            }
            return;
          }
          if (Array.isArray(v)) { v.slice(0, 60).forEach((x) => walk(x, key, depth + 1)); return; }
          if (typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k], k, depth + 1));
        };
        walk(JSON.parse(nextData), '', 0);
      } catch (_) { /* no es JSON */ }
    }
    (h.match(/<img\b[^>]*>/gi) || []).forEach((tag) => {
      const u = attr(tag, 'data-src') || attr(tag, 'data-lazy') || attr(tag, 'src');
      if (u && IMG_URL_RE.test(u) && !/logo|icon|sprite|avatar|placeholder|pixel/i.test(u)) addImg(u);
    });
    const text = decodeEntities(h
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '))
      .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
    return {
      title: titleM ? decodeEntities(titleM[1]).replace(/\s+/g, ' ').trim().slice(0, 300) : '',
      meta, jsonld: jsonld.slice(0, 5), datos, text: text.slice(0, 30000), images: images.slice(0, 60),
    };
  }
  // Enlaces a avisos dentro de una página de perfil o de resultados del
  // mismo portal (roadmap 2.3): <a href>, JSON-LD ItemList y URLs de
  // __NEXT_DATA__. Un aviso es una URL del mismo dominio con un id numérico
  // largo (o tipo "MPE-123…") y que no es una página de navegación.
  const LISTING_NAV_RE = /\/(buscar|busqueda|search|login|ingresar|registro|signup|ayuda|help|blog|noticias|contacto|nosotros|terminos|privacidad|publicar|favoritos|mi-cuenta)(\/|$)/i;
  function extractListingLinks(html, baseUrl, max) {
    const h = String(html || '');
    let base;
    try { base = new URL(baseUrl); } catch (_) { return []; }
    const site = base.hostname.replace(/^www\./, '');
    const out = [];
    const seen = new Set([base.origin + base.pathname]);
    const add = (u, title) => {
      const a = absUrl(u, base.href);
      if (!a) return;
      const x = new URL(a);
      const host = x.hostname.replace(/^www\./, '');
      if (host !== site && !host.endsWith('.' + site)) return;
      if (LISTING_NAV_RE.test(x.pathname) || !/\d{5,}|[A-Z]{3}-?\d{5,}/i.test(x.pathname)) return;
      const key = x.origin + x.pathname;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ url: key, title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120) });
    };
    const aRe = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = aRe.exec(h))) add(m[2] != null ? m[2] : m[3], decodeEntities(m[4].replace(/<[^>]+>/g, ' ')));
    const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    while ((m = scriptRe.exec(h))) {
      if (!/application\/ld\+json|__NEXT_DATA__/i.test(m[1])) continue;
      try {
        const walk = (v, depth) => {
          if (v == null || depth > 14) return;
          if (typeof v === 'string') { if (/^https?:\/\//.test(v)) add(v, ''); return; }
          if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
          if (typeof v === 'object') {
            if (typeof v.url === 'string') add(v.url, v.name || v.title || '');
            Object.keys(v).forEach((k) => walk(v[k], depth + 1));
          }
        };
        walk(JSON.parse(m[2]), 0);
      } catch (_) { /* no es JSON */ }
    }
    return out.slice(0, max || 60);
  }

  // Texto que ve la IA para una página (también la que manda el marcador del
  // navegador), dentro de `max` caracteres; las fotos van como [FOTO id].
  function pageToText(p, url, photoIds, max) {
    const lim = max || 18000;
    const parts = [`URL: ${url}`];
    if (p.title) parts.push(`Título: ${p.title}`);
    const metaLines = Object.entries(p.meta || {}).filter(([k]) => !/image/.test(k)).map(([k, v]) => `${k}: ${v}`);
    if (metaLines.length) parts.push(`Metadatos:\n${metaLines.join('\n')}`);
    if ((p.jsonld || []).length) parts.push(`Datos estructurados (JSON-LD):\n${p.jsonld.join('\n').slice(0, 6000)}`);
    if ((p.datos || []).length) parts.push(`Datos de la página:\n${p.datos.join('\n').slice(0, 5000)}`);
    const fotos = (photoIds || []).length ? `\n${photoIds.map((id) => `[FOTO ${id}]`).join(' ')}` : '';
    const head = parts.join('\n\n');
    const room = Math.max(0, lim - head.length - fotos.length - 40);
    return `${head}\n\nTexto de la página:\n${String(p.text || '').slice(0, room)}${fotos}`;
  }

  return {
    parseListingHtml, pageToText, extractListingLinks,
    COLS, REQUIRED, DISTRICTS, IMPORT_SOURCES, RESO_MAP,
    AI_FIELDS, EXTRACTION_SCHEMA,
    norm, cleanText, parseNumber, parseMoney, detectCurrency, parseCount, matchDistrict,
    stripPII, normalizeRow, fingerprint, numbersIn, guardInvented,
  };
});
