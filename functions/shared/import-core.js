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
  const IMPORT_SOURCES = ['excel', 'csv', 'text', 'whatsapp', 'url', 'pdf', 'feed'];

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
  // el dato no está en el texto.
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
          required: AI_FIELDS.concat(['campos_inferidos']),
          properties: Object.assign(
            AI_FIELDS.reduce((acc, k) => { acc[k] = { type: ['string', 'null'] }; return acc; }, {}),
            { campos_inferidos: { type: 'array', items: { type: 'string' } } }
          ),
        },
      },
    },
  };

  return {
    COLS, REQUIRED, DISTRICTS, IMPORT_SOURCES, RESO_MAP,
    AI_FIELDS, EXTRACTION_SCHEMA,
    norm, cleanText, parseNumber, parseMoney, detectCurrency, parseCount, matchDistrict,
    stripPII, normalizeRow, fingerprint, numbersIn, guardInvented,
  };
});
