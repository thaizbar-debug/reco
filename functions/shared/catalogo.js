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

  // Estandariza los campos de opciones cerradas de una fila con las columnas
  // de la plantilla (tipo_propiedad, tipo_publicacion, tipo_moneda, estado,
  // antiguedad y los sí/no) y deja el resto igual. Lo que no se reconoce se
  // deja tal cual para que la validación lo marque. Idempotente.
  // `notas`: ajustes de estado/antigüedad para mostrar al usuario.
  const BOOL_COLS = ['mostrar_direccion', 'ascensor', 'amoblado', 'pet_friendly'];
  function standardizeRow(r) {
    const src = r || {};
    const txt = (v) => String(v == null ? '' : v).trim();
    const row = Object.assign({}, src);
    row.tipo_propiedad = matchType(src.tipo_propiedad) || txt(src.tipo_propiedad);
    row.tipo_publicacion = matchOp(src.tipo_publicacion) || txt(src.tipo_publicacion);
    row.tipo_moneda = matchCurrency(src.tipo_moneda) || txt(src.tipo_moneda);
    BOOL_COLS.forEach((k) => {
      const b = matchBool(src[k]);
      if (b !== null) row[k] = b ? 'Sí' : 'No';
    });
    const est = resolveEstadoAntiguedad(src.estado, src.antiguedad);
    const estadoTxt = txt(src.estado);
    if (estadoTxt && !matchEstado(estadoTxt)) row.estado = estadoTxt;
    // Vacío y sin pista en la antigüedad: se deja vacío (por defecto Construido).
    else row.estado = (estadoTxt || est.estado !== 'Construido') ? est.estado : '';
    const antTxt = txt(src.antiguedad);
    if (ESTADOS_SIN_ANTIGUEDAD.includes(est.estado)) row.antiguedad = '0';
    else if (antTxt) {
      const n = parseAntiguedad(antTxt);
      row.antiguedad = n == null ? antTxt : String(n);
    }
    return { row, notas: est.notas.filter((n) => n.indexOf('no reconocido') === -1) };
  }

  // ── Verificación previa a publicar ──
  // Qué exige cada tipo de inmueble. `area` (en la publicación y en toda la
  // app: tarjetas, filtros, precio por m²) es el ÁREA PRINCIPAL: la techada,
  // salvo en Terreno, donde es la de terreno (igual que en properties.json).
  //   requiere:   'techada' | 'terreno' | 'alguna'
  //   recomienda: área que conviene indicar (solo aviso)
  //   noAplica:   campos que no tienen sentido para el tipo; se publican en 0
  const NO_APLICA_TERRENO = ['beds', 'baths', 'parking', 'floor', 'floors', 'unitFloors', 'age', 'ascensor', 'amoblado', 'petFriendly'];
  const REGLAS_TIPO = {
    'Departamento': { requiere: 'techada' },
    'Oficina': { requiere: 'techada' },
    'Local comercial': { requiere: 'techada' },
    'Casa': { requiere: 'techada', recomienda: 'terreno' },
    'Terreno': { requiere: 'terreno', noAplica: NO_APLICA_TERRENO },
    'Otros': { requiere: 'alguna' },
  };
  const NOMBRE_CAMPO = { beds: 'dormitorios', baths: 'baños', parking: 'estacionamientos', floor: 'piso',
    floors: 'pisos del edificio', unitFloors: 'niveles', age: 'antigüedad', ascensor: 'ascensor',
    amoblado: 'amoblado', petFriendly: 'pet friendly' };
  const MAX_TITULO = 200;
  const MAX_DESCRIPCION = 5000;

  // Verifica una publicación (forma de publishProperty: type, op, currency,
  // price, area = área techada, areaTerr, beds, …, address, district, title,
  // desc) antes de publicarla. La usan publishProperty (autoridad final), la
  // carga masiva y el formulario individual, así que las reglas son las
  // mismas en todos lados.
  //   opts.soloDatos: omite título y descripción (paso 1 del formulario).
  // Devuelve:
  //   errores: bloquean la publicación. Cada mensaje empieza por el nombre
  //            del campo ("área techada…", "precio…") para poder marcarlo.
  //   avisos:  no bloquean.
  //   datos:   area (principal), areaTech, areaTerr y los campos que no
  //            aplican ya en 0 / false; lo que se debe guardar.
  function verificarPublicacion(d, opts) {
    const p = d || {};
    const errores = [];
    const avisos = [];
    const txt = (v) => String(v == null ? '' : v).trim();
    const num = (v) => (v == null || v === '' ? 0 : Number(v));

    if (!opts || !opts.soloDatos) {
      if (!txt(p.title)) errores.push('título vacío');
      else if (txt(p.title).length > MAX_TITULO) errores.push(`título muy largo (máx. ${MAX_TITULO} caracteres)`);
      if (!txt(p.desc)) errores.push('descripción vacía');
      else if (txt(p.desc).length > MAX_DESCRIPCION) errores.push(`descripción muy larga (máx. ${MAX_DESCRIPCION} caracteres)`);
    }
    if (!txt(p.address)) errores.push('dirección vacía');
    if (!txt(p.district)) errores.push('distrito vacío');

    const type = matchType(p.type);
    if (!type) errores.push('tipo debe ser: ' + TYPES.join(' / '));
    if (!matchOp(p.op)) errores.push('operacion debe ser Venta o Alquiler');
    if (!matchCurrency(p.currency)) errores.push('moneda debe ser USD o PEN');

    const price = num(p.price);
    if (!isFinite(price) || price <= 0) errores.push('precio inválido: debe ser mayor que 0');

    const techada = num(p.area);
    const terreno = num(p.areaTerr);
    if (!isFinite(techada) || techada < 0) errores.push('área techada inválida');
    if (!isFinite(terreno) || terreno < 0) errores.push('área de terreno inválida');
    const tech = isFinite(techada) && techada > 0 ? techada : 0;
    const terr = isFinite(terreno) && terreno > 0 ? terreno : 0;

    const regla = REGLAS_TIPO[type] || REGLAS_TIPO.Otros;
    if (regla.requiere === 'techada' && !tech && isFinite(techada) && techada >= 0) errores.push(`área techada obligatoria para ${type || 'este tipo'}`);
    if (regla.requiere === 'terreno' && !terr && isFinite(terreno) && terreno >= 0) errores.push('área de terreno obligatoria para Terreno');
    if (regla.requiere === 'alguna' && !tech && !terr) errores.push('área techada o de terreno: indica al menos una');
    if (regla.recomienda === 'terreno' && !terr) avisos.push(`${type} sin área de terreno: se recomienda indicarla.`);

    const datos = { area: type === 'Terreno' ? terr : (tech || terr), areaTech: tech, areaTerr: terr };

    // Una casa no puede techar más que su terreno por cada piso.
    const pisos = Math.max(1, num(p.floors) || 0, num(p.unitFloors) || 0);
    if (type === 'Casa' && tech && terr && tech > terr * pisos) {
      avisos.push('El área techada supera el terreno multiplicado por los pisos: revisa las áreas.');
    }
    const floor = num(p.floor) || 0, uF = Math.max(1, num(p.unitFloors) || 1), floors = num(p.floors) || 0;
    if (type !== 'Terreno' && floors > 0 && floor > 0 && floor + uF - 1 > floors) {
      avisos.push('Piso + niveles supera la altura del edificio');
    }

    const ignorados = [];
    (regla.noAplica || []).forEach((k) => {
      const esBool = ['ascensor', 'amoblado', 'petFriendly'].includes(k);
      const tiene = esBool ? p[k] === true : (k === 'unitFloors' ? num(p[k]) > 1 : num(p[k]) > 0);
      if (tiene) ignorados.push(NOMBRE_CAMPO[k]);
      datos[k] = esBool ? false : (k === 'unitFloors' ? 1 : 0);
    });
    if (ignorados.length) avisos.push(`${type}: ${ignorados.join(', ')} no aplica${ignorados.length > 1 ? 'n' : ''} y no se publicará${ignorados.length > 1 ? 'n' : ''}.`);

    return { errores, avisos, datos };
  }

  // ── Etiquetas de características (columnas etiquetas_* de la plantilla) ──
  // Mismas listas que _PUB_FEATS_* en index.html (un test las compara). La
  // IA solo puede elegir de aquí; matchEtiqueta acepta mayúsculas/tildes
  // distintas y los nombres antiguos.
  const ETIQUETAS = {
    etiquetas_generales: ['Baño de servicio', 'Walk-in Closet', 'Armario/Closet', 'Balcón', 'Intercomunicador',
      'Jacuzzi', 'Jardín propio', 'Piscina propia', 'Terraza propia', 'Aire Acondicionado',
      'Propiedad de Lujo o Exclusiva', 'Propiedad de Campo o Rural', 'Propiedad Inteligente',
      'Propiedad Eco-amigable o Sostenible', 'Propiedad de Playa'],
    etiquetas_ambientes: ['Cafetería del edificio', 'Lavandería del edificio', 'Patio común', 'Sala de estar común', 'Recepción', 'Conserje',
      'Salida directa a parque', 'Zona de Parrilla (BBQ)', 'Sala de juegos', 'Depósito', 'Oficinas/Co-work',
      'Piscina del edificio', 'Salón de usos múltiples', 'Sauna/Spa', 'Sótano', 'Áreas verdes',
      'Canchas deportivas', 'Gimnasio', 'Juegos infantiles',
      'Acceso para personas con movilidad reducida', 'Estacionamiento para visitas'],
    etiquetas_vista: ['Vista a parque', 'Vista al mar', 'Vista a calle', 'Vista a área interior', 'Vista a campo', 'Vista a paisaje'],
    etiquetas_acceso: ['Calle', 'Avenida', 'Jirón', 'Pasaje', 'Carretera', 'Alameda', 'Boulevard', 'Vía privada', 'Callejón'],
    etiquetas_zonas: ['Residencial', 'Comercial', 'Industrial', 'Rural', 'Mixta', 'Semi-urbana', 'Conservación'],
  };
  const ETIQUETAS_ANTIGUAS = { 'Jardín': 'Jardín propio', 'Piscina': 'Piscina propia', 'Terraza': 'Terraza propia',
    'Área de cafetería': 'Cafetería del edificio', 'Área de lavandería': 'Lavandería del edificio', 'Patio': 'Patio común',
    'Área común': 'Sala de estar común', 'Acceso a parque': 'Salida directa a parque',
    'Piscina (edificio)': 'Piscina del edificio', 'Vista interior': 'Vista a área interior', 'Privado': 'Vía privada' };
  // Etiqueta canónica de esa columna, o '' si no pertenece a ella.
  function matchEtiqueta(columna, v) {
    const n = norm(v);
    if (!n) return '';
    const lista = ETIQUETAS[columna] || [];
    const directa = lista.find((t) => norm(t) === n);
    if (directa) return directa;
    const antigua = Object.keys(ETIQUETAS_ANTIGUAS).find((t) => norm(t) === n);
    return antigua && lista.includes(ETIQUETAS_ANTIGUAS[antigua]) ? ETIQUETAS_ANTIGUAS[antigua] : '';
  }

  return {
    ETIQUETAS, matchEtiqueta,
    TYPES, OPS, CURRENCIES, ESTADOS, ESTADOS_SIN_ANTIGUEDAD, REGLAS_TIPO,
    norm, matchType, matchOp, matchEstado, matchCurrency, matchBool, parseAntiguedad,
    resolveEstadoAntiguedad, standardizeRow, verificarPublicacion,
  };
});
