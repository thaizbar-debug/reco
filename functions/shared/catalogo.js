// ─────────────────────────────────────────────────────────────────────────────
// ReCo — catálogo de valores estándar y sus sinónimos
//
// Fuente única para los campos de opciones cerradas de una publicación:
// tipo de inmueble, operación, moneda, estado, sí/no y antigüedad. Lo usan:
//   - index.html (carga masiva y formulario) como window.RecoCatalogo, vía
//     <script src="functions/shared/catalogo.js">.
//   - functions/index.js (publishProperty) con require('./shared/catalogo').
//
// Cada match*() devuelve el valor canónico, o '' si no reconoce el texto
// (el llamador decide si eso es error, aviso o valor por defecto).
//
// Regla de negocio: un inmueble "En proyecto" o "En construcción" todavía no
// se terminó de construir, así que su antigüedad es siempre 0
// (resolveEstadoAntiguedad).
// ─────────────────────────────────────────────────────────────────────────────
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RecoCatalogo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = ['Departamento', 'Casa', 'Oficina', 'Local comercial', 'Terreno', 'Otros'];
  const OPS = ['Venta', 'Alquiler'];
  const CURRENCIES = ['USD', 'PEN'];
  const ESTADOS = ['En proyecto', 'En construcción', 'Construido'];
  const ESTADOS_SIN_ANTIGUEDAD = ['En proyecto', 'En construcción'];

  // Minúsculas, sin tildes, solo letras/números/espacios. "S/." y "US$" se
  // reconocen antes de normalizar (ver matchCurrency).
  function norm(v) {
    return String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // Abreviaturas que solo valen si son el valor completo de la celda (una
  // "V" en la columna operación es Venta, pero no dentro de un texto).
  // Se comparan ya normalizadas: "Dpto." → "dpto", "E/C" → "e c".
  function abbr(map) {
    const out = {};
    Object.keys(map).forEach(canon => map[canon].forEach(a => { out[a] = canon; }));
    return out;
  }
  const TYPE_ABBR = abbr({
    'Departamento': ['d', 'dp', 'dpt', 'dto', 'dtos', 'dept', 'apto', 'aptos', 'ap'],
    'Casa': ['c', 'cs', 'csa'],
    'Oficina': ['o', 'of', 'ofi', 'ofic', 'ofc', 'ofs'],
    'Local comercial': ['l', 'lc', 'loc', 'lcl', 'loc com', 'l c', 'lc com', 'loc c'],
    'Terreno': ['t', 'te', 'ter', 'terr', 'tr', 'lt', 'lte'],
    'Otros': ['ot', 'otr'],
  });
  const OP_ABBR = abbr({
    'Venta': ['v', 'vt', 'vtas', 'ven', 'vnt', 'vte'],
    'Alquiler': ['a', 'al', 'alqu', 'alql', 'arr', 'r', 'rta', 'alq v'],
  });
  const ESTADO_ABBR = abbr({
    'En proyecto': ['p', 'pr', 'pry', 'ep', 'e p', 'en p', 'pv', 'prev', 'pvta', 'sp', 's p', 's pl'],
    'En construcción': ['ec', 'e c', 'en c', 'enc', 'e const', 'e constr'],
    'Construido': ['ae', 'a e', 'ei', 'e i', 'term', 'termin', 'est', 'estr'],
  });
  // Primero la abreviatura exacta; si no, el primer patrón que coincide
  // gana: el orden importa ("local en casa" es local).
  function firstMatch(v, table, abbrMap) {
    const s = norm(v);
    if (!s) return '';
    if (abbrMap && abbrMap[s]) return abbrMap[s];
    const hit = table.find(([, re]) => re.test(s));
    return hit ? hit[0] : '';
  }

  const TYPE_SYNONYMS = [
    ['Local comercial', /\blocal(es)?\b|\bloc com\b|\btienda\b|\bcomercial\b|\bstand\b|\bgaleria\b|\bpuesto\b/],
    ['Oficina', /\boficinas?\b|\bofic\b|\boffice\b|\bconsultorios?\b|\bcoworking\b/],
    ['Terreno', /\bterrenos?\b|\bterr\b|\blotes?\b|\bparcelas?\b|\baires\b|\bland\b|\bhectareas?\b/],
    ['Departamento', /\bdep(a|as|to|tos|artamentos?)\b|\bdpto?s?\b|\bdto\b|\bdeptos?\b|\baptos?\b|\bapartamentos?\b|\bflat\b|\bduplex\b|\btriplex\b|\bpent ?house\b|\bph\b|\bloft\b|\bmonoambiente\b|\bminidepa\b|\bmini depa\b|\bstudio\b/],
    ['Casa', /\bcasas?\b|\bchalet\b|\bvilla\b|\btownhouse\b|\bcasona\b|\bquinta\b|\bcasa de (playa|campo)\b/],
    ['Otros', /\botros?\b|\bhabitacion\b|\bcuarto\b|\balmacen\b|\bdeposito\b|\bgalpon\b|\bnave\b|\bcochera\b|\bestacionamiento\b|\bhotel\b|\bedificio\b/],
  ];
  const OP_SYNONYMS = [
    ['Alquiler', /\balquil|\barrend|\barriendo\b|\brenta\b|\brent\b|\brental\b|\blease\b|\balq\b|\barr\b/],
    ['Venta', /\bventa\b|\bvend|\bcompra ?venta\b|\bsale\b|\bsell\b|\bvtas?\b/],
  ];
  const ESTADO_SYNONYMS = [
    ['En proyecto', /\bplanos?\b|\bproyecto\b|\bproy\b|\bpre ?venta\b|\bpre ?vta\b|\bpvta\b|\bpor construir\b|\blanzamiento\b|\bfuturo\b|\bsin construir\b|\boff plan\b/],
    ['En construcción', /\bconstruccion\b|\ben constr?\b|\ben construcc\b|\ben obra\b|\bobra\b|\ben ejecucion\b|\bpor entregar\b|\bentrega (futura|proxima|en)\b|\ben acabados\b|\bcasco\b|\bcasco gris\b/],
    ['Construido', /\bconstruid|\bterminad|\bentrega inmediata\b|\bent inm\b|\bentrega inm\b|\blisto\b|\bestreno\b|\ba estrenar\b|\bnuevo\b|\busado\b|\bremodelad|\bsegunda\b|\bexistente\b/],
  ];

  function matchType(v) { return firstMatch(v, TYPE_SYNONYMS, TYPE_ABBR); }
  function matchOp(v) {
    // "Venta o alquiler": gana la que aparece primero en el texto.
    const s = norm(v);
    if (!s) return '';
    if (OP_ABBR[s]) return OP_ABBR[s];
    const pos = OP_SYNONYMS.map(([val, re]) => [val, s.search(re)]).filter(([, i]) => i !== -1);
    if (!pos.length) return '';
    return pos.sort((a, b) => a[1] - b[1])[0][0];
  }
  function matchEstado(v) { return firstMatch(v, ESTADO_SYNONYMS, ESTADO_ABBR); }
  const CURRENCY_ABBR = abbr({
    'PEN': ['s', 'sl', 'sol', 'pen', 'ns', 'n s', 'mn', 'soles'],
    'USD': ['u', 'us', 'usd', 'd', 'dl', 'dls', 'dlls', 'dol', 'dolar', 'dolares', 'u s', 'u s d'],
  });
  function matchCurrency(v) {
    const raw = String(v == null ? '' : v).toLowerCase();
    if (!raw.trim()) return '';
    if (CURRENCY_ABBR[norm(raw)]) return CURRENCY_ABBR[norm(raw)];
    if (/s\/|\bpen\b|\bsol(es)?\b|\bnuevos soles\b/.test(raw)) return 'PEN';
    if (/u\$s?|us\$|\busd\b|\$|\bd[oó]lar(es)?\b|\bus\b|\bdolares americanos\b/.test(raw)) return 'USD';
    return '';
  }
  // true / false, o null si no se reconoce.
  function matchBool(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    const s = norm(v);
    if (!s) return null;
    if (/^(si|s|yes|y|true|verdadero|1|x|ok|tiene|con)$/.test(s)) return true;
    if (/^(no|n|false|falso|0|sin|no tiene)$/.test(s)) return false;
    return null;
  }

  const WORD_NUMBERS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
    siete: 7, ocho: 8, nueve: 9, diez: 10 };
  // Años de antigüedad: "5", "5 años", "cinco", "2015" (año de construcción),
  // "a estrenar" / "nuevo" / "menos de un año" → 0. null si no hay dato.
  function parseAntiguedad(v, year) {
    if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.floor(v) : null;
    const s = norm(v);
    if (!s) return null;
    // Incluye "A/E", "x estrenar", "p/estrenar".
    if (/estren|\bnuevo\b|menos de (1|un) ano|^0$|^a e$|^ae$/.test(s)) return 0;
    const m = s.match(/\d+/);
    let n = m ? Number(m[0]) : null;
    if (n == null) {
      const w = s.split(' ').find(t => WORD_NUMBERS[t] != null);
      n = w ? WORD_NUMBERS[w] : null;
    }
    if (n == null) return null;
    const now = year || new Date().getFullYear();
    if (n > 1900 && n <= now) return now - n;
    return n;
  }

  // Estado y antigüedad se resuelven juntos:
  //  - El estado se toma del campo estado; si está vacío, se busca en la
  //    antigüedad (es común escribir "en planos" o "a estrenar" ahí).
  //  - En proyecto / En construcción ⇒ antigüedad 0, siempre.
  //  - Sin estado reconocible ⇒ Construido (valor por defecto histórico).
  // `notas` explica cada ajuste para mostrarlo al usuario.
  function resolveEstadoAntiguedad(estadoRaw, antiguedadRaw, opts) {
    const notas = [];
    const estadoTxt = String(estadoRaw == null ? '' : estadoRaw).trim();
    let estado = matchEstado(estadoTxt);
    if (estadoTxt && !estado) notas.push(`Estado no reconocido: "${estadoTxt}". Se usará Construido.`);
    if (!estado && !estadoTxt) {
      const desdeAntiguedad = matchEstado(antiguedadRaw);
      if (desdeAntiguedad && desdeAntiguedad !== 'Construido') {
        estado = desdeAntiguedad;
        notas.push(`Estado tomado de la antigüedad: ${estado}.`);
      }
    }
    estado = estado || 'Construido';
    let antiguedad = parseAntiguedad(antiguedadRaw, opts && opts.year);
    if (ESTADOS_SIN_ANTIGUEDAD.includes(estado)) {
      if (antiguedad) notas.push(`${estado}: la antigüedad se publicará como 0.`);
      antiguedad = 0;
    }
    return { estado, antiguedad: antiguedad == null ? 0 : antiguedad, notas };
  }

  return {
    TYPES, OPS, CURRENCIES, ESTADOS, ESTADOS_SIN_ANTIGUEDAD,
    norm, matchType, matchOp, matchEstado, matchCurrency, matchBool, parseAntiguedad,
    resolveEstadoAntiguedad,
  };
});
