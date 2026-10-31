// ─────────────────────────────────────────────────────────────────────────────
// ReCo — fotos con IA (lógica pura, sin red).
//
// analyzePhotos (functions/index.js) manda las fotos de un inmueble, en baja
// resolución, a la IA, que dice de cada una qué ambiente muestra, qué tan
// buena es y si tiene marca de agua, texto encima o personas. Este módulo arma
// el pedido, valida la respuesta y propone la portada y el orden:
//   portada  una foto buena y sin problemas (preferible fachada, sala o vista)
//   orden    portada · ambientes en el orden en que se recorre un inmueble ·
//            fotos con problemas · planos al final
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const AMBIENTES = ['fachada', 'sala', 'comedor', 'cocina', 'dormitorio', 'bano', 'terraza', 'vista',
  'area_comun', 'estacionamiento', 'exterior', 'otro', 'plano'];
// Preferencia para la portada (menor = mejor).
const PORTADA_PREF = { fachada: 0, sala: 1, vista: 2, terraza: 3, area_comun: 4, exterior: 5, comedor: 6, cocina: 7, dormitorio: 8 };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fotos', 'portada'],
  properties: {
    portada: { type: 'integer' },
    fotos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['indice', 'ambiente', 'calidad', 'marca_agua', 'texto', 'personas'],
        properties: {
          indice: { type: 'integer' },
          ambiente: { type: 'string', enum: AMBIENTES },
          calidad: { type: 'integer' },
          marca_agua: { type: 'boolean' },
          texto: { type: 'boolean' },
          personas: { type: 'boolean' },
        },
      },
    },
  },
};

const PROMPT = `Eres un fotógrafo inmobiliario. Recibes las fotos de UN inmueble en venta o alquiler, numeradas desde 0.
Para cada foto devuelve:
- indice: su número.
- ambiente: fachada (frente del edificio o la casa), sala, comedor, cocina, dormitorio, bano, terraza (balcón, azotea o jardín propio), vista (lo que se ve desde el inmueble), area_comun (piscina, gimnasio, lobby, parrilla, juegos), estacionamiento, exterior (calle, entorno o parque), plano (plano, croquis o render de distribución) u otro.
- calidad: de 1 a 5 como foto de un aviso (5: nítida, iluminada, ordenada y bien encuadrada; 1: borrosa, oscura, torcida o que no muestra el inmueble).
- marca_agua: true si tiene logo, marca de agua o nombre de otro portal o inmobiliaria sobre la foto.
- texto: true si tiene texto, precio, teléfono o diseño de afiche encima (un flyer).
- personas: true si se ve a una persona reconocible.
portada: el índice de la mejor foto para portada: buena calidad, sin marca de agua, sin texto y sin personas; mejor la fachada, la sala o la vista. Nunca un plano.
Devuelve una entrada por foto, en el mismo orden.`;

// Contenido para la IA: un texto y cada foto con su número.
function content(dataUrls) {
  const out = [{ type: 'text', text: `${dataUrls.length} foto(s) del mismo inmueble:` }];
  dataUrls.forEach((u, i) => {
    out.push({ type: 'text', text: `Foto ${i}:` });
    out.push({ type: 'image_url', image_url: { url: u, detail: 'low' } });
  });
  return out;
}

const _problema = (f) => f.marcaAgua || f.texto || f.personas || f.calidad <= 2;

// Respuesta de la IA → { fotos:[{ ambiente, calidad, marcaAgua, texto, personas }], portada, orden }.
// Una foto que la IA no describió queda como 'otro' de calidad 3.
function normalizar(parsed, n) {
  const porIndice = new Map();
  (parsed && Array.isArray(parsed.fotos) ? parsed.fotos : []).forEach((f, pos) => {
    const i = Number.isInteger(f && f.indice) && f.indice >= 0 && f.indice < n ? f.indice : pos;
    if (i < n && !porIndice.has(i)) porIndice.set(i, f);
  });
  const fotos = [];
  for (let i = 0; i < n; i++) {
    const f = porIndice.get(i) || {};
    const c = Math.round(Number(f.calidad));
    fotos.push({
      ambiente: AMBIENTES.includes(f.ambiente) ? f.ambiente : 'otro',
      calidad: c >= 1 && c <= 5 ? c : 3,
      marcaAgua: f.marca_agua === true,
      texto: f.texto === true,
      personas: f.personas === true,
    });
  }
  let portada = Number.isInteger(parsed && parsed.portada) ? parsed.portada : -1;
  if (!(portada >= 0 && portada < n) || fotos[portada].ambiente === 'plano' || _problema(fotos[portada])) {
    // La de la IA no sirve: la mejor sin problemas (calidad, luego ambiente).
    const cand = fotos.map((f, i) => i).filter((i) => fotos[i].ambiente !== 'plano' && !_problema(fotos[i]));
    const pref = (i) => (PORTADA_PREF[fotos[i].ambiente] != null ? PORTADA_PREF[fotos[i].ambiente] : 9);
    cand.sort((a, b) => fotos[b].calidad - fotos[a].calidad || pref(a) - pref(b) || a - b);
    portada = cand.length ? cand[0] : 0;
  }
  return { fotos, portada, orden: ordenar(fotos, portada) };
}

// Orden propuesto (índices). Estable: dentro de un mismo grupo y ambiente se
// respeta el orden en que el corredor subió las fotos.
function ordenar(fotos, portada) {
  const rango = (i) => {
    const f = fotos[i];
    if (i === portada) return [0, 0];
    if (f.ambiente === 'plano') return [3, 0];
    return [_problema(f) ? 2 : 1, AMBIENTES.indexOf(f.ambiente)];
  };
  return fotos.map((f, i) => i).sort((a, b) => {
    const ra = rango(a), rb = rango(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || a - b;
  });
}

module.exports = { AMBIENTES, SCHEMA, PROMPT, content, normalizar, ordenar };
