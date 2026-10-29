// ─────────────────────────────────────────────────────────────────────────────
// ReCo — lógica pura del bot de WhatsApp (roadmap 2.1)
//
// Sin Firebase ni red: verificación de firma de Meta, lectura del webhook,
// comandos, armado del texto para la IA y la respuesta al corredor. Lo usan
// whatsappWebhook / whatsappProcessMessage en index.js; se prueba en
// whatsapp-core.test.js.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const crypto = require('crypto');

// X-Hub-Signature-256: "sha256=" + HMAC-SHA256(cuerpo crudo, app secret).
function verifySignature(rawBody, header, appSecret) {
  if (!rawBody || !header || !appSecret || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(header.slice(7).toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Webhook de la Cloud API → mensajes entrantes normalizados. Ignora estados
// (entregado/leído) y tipos que el bot no usa.
function parseWebhook(body) {
  const out = [];
  ((body && body.entry) || []).forEach((entry) => {
    ((entry && entry.changes) || []).forEach((ch) => {
      const v = (ch && ch.value) || {};
      (v.messages || []).forEach((m) => {
        if (!m || !m.id || !m.from) return;
        const base = { id: String(m.id).slice(0, 200), from: String(m.from).replace(/\D/g, '').slice(0, 20), ts: Number(m.timestamp) || 0, type: m.type };
        if (m.type === 'text' && m.text) out.push({ ...base, text: String(m.text.body || '').slice(0, 4000) });
        else if (m.type === 'image' && m.image) out.push({ ...base, mediaId: String(m.image.id), caption: String(m.image.caption || '').slice(0, 1000), mime: m.image.mime_type || '' });
        else if (m.type === 'audio' && m.audio) out.push({ ...base, mediaId: String(m.audio.id), mime: m.audio.mime_type || '' });
        else out.push({ ...base, type: 'other', kind: String(m.type || '').slice(0, 30) });
      });
    });
  });
  return out;
}

// Comandos (ignorando mayúsculas, tildes y signos).
function parseCommand(text) {
  const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/^vincular (\d{6})$/);
  if (m) return { cmd: 'vincular', code: m[1] };
  if (/^(listo|ya|procesar|termine|fin|enviar)$/.test(t)) return { cmd: 'listo' };
  if (/^(cancelar|borrar|empezar de nuevo|reiniciar)$/.test(t)) return { cmd: 'cancelar' };
  if (/^(ayuda|help|hola|menu|info)$/.test(t)) return { cmd: 'ayuda' };
  return null;
}

// Mensajes guardados de la sesión → texto para la IA, con [FOTO w-N] donde
// llegó cada foto y las notas de voz transcritas.
//   items: [{ type: 'text'|'image'|'audio', ts, text?, caption?, photoId? }]
//   transcripts: { [índice del item]: 'texto' }
function sessionToText(items, transcripts) {
  const hora = (ts) => new Date(ts * 1000).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });
  const lines = [];
  const photoIds = [];
  (items || []).forEach((it, i) => {
    let body = '';
    if (it.type === 'text') body = it.text || '';
    else if (it.type === 'image') {
      if (it.photoId) photoIds.push(it.photoId);
      body = [it.caption, it.photoId ? `[FOTO ${it.photoId}]` : '[foto no disponible]'].filter(Boolean).join(' ');
    } else if (it.type === 'audio') body = transcripts && transcripts[i] ? `(nota de voz) ${transcripts[i]}` : '(nota de voz sin transcribir)';
    if (body) lines.push(`[${hora(it.ts)}] Corredor: ${body}`);
  });
  return { text: `=== Mensajes por WhatsApp ===\n${lines.join('\n')}`, photoIds };
}

const fmtPrecio = (row) => {
  const n = Number(row.precio);
  if (!n) return '';
  return `${row.tipo_moneda === 'PEN' ? 'S/' : 'US$'} ${n.toLocaleString('es-PE')}`;
};
// Respuesta al terminar: qué se encontró y dónde revisarlo.
function summarizeDrafts(drafts, link) {
  if (!drafts.length) {
    return 'No encontré inmuebles en lo que me enviaste. 🙁 Incluye al menos el tipo, la ubicación y el precio o el área, y vuelve a escribir LISTO.';
  }
  const lines = drafts.slice(0, 10).map((d, i) => {
    const r = d.row || {};
    const area = r.tipo_propiedad === 'Terreno' ? r.area_terreno : r.area_techada;
    const partes = [[r.tipo_propiedad, r.distrito].filter(Boolean).join(' en '), r.tipo_publicacion, fmtPrecio(r), area ? `${area} m²` : '',
      (d.fotos || []).length ? `${d.fotos.length} foto${d.fotos.length !== 1 ? 's' : ''}` : ''].filter(Boolean);
    return `${i + 1}) ${partes.join(' · ') || 'Inmueble sin datos suficientes'}`;
  });
  const extra = drafts.length > 10 ? `\n… y ${drafts.length - 10} más.` : '';
  return `✅ Encontré ${drafts.length} inmueble${drafts.length !== 1 ? 's' : ''}:\n${lines.join('\n')}${extra}\n\nRevísalos, completa lo que falte y publícalos aquí: ${link}`;
}

const MENSAJES = {
  ayuda: (link) => `Hola 👋 Soy el asistente de ReCo.\n\n1️⃣ Envíame tus inmuebles como quieras: texto, fotos o notas de voz (uno o varios).\n2️⃣ Cuando termines, escribe *LISTO*.\n3️⃣ Te respondo con los inmuebles que encontré y los revisas en ${link}\n\nEscribe *CANCELAR* para empezar de nuevo.`,
  noVinculado: (web) => `Hola 👋 Para cargar inmuebles por WhatsApp, primero conecta este número a tu cuenta de ReCo: entra a ${web}, ve a Publicar → Subir varios → "ReCo en tu WhatsApp" y sigue los pasos.`,
  vinculado: '✅ Listo: este WhatsApp quedó conectado a tu cuenta de ReCo. Envíame tus inmuebles (texto, fotos o notas de voz) y escribe *LISTO* cuando termines.',
  codigoInvalido: 'Ese código no es válido o ya venció. Genera uno nuevo en ReCo (Publicar → Subir varios → "ReCo en tu WhatsApp").',
  recibido: '📥 Recibido. Envíame todo lo que quieras de tus inmuebles y escribe *LISTO* cuando termines.',
  vacio: 'Todavía no me enviaste nada para procesar. Envíame texto, fotos o notas de voz de tus inmuebles y luego escribe *LISTO*.',
  procesando: '⏳ Revisando lo que me enviaste…',
  cancelado: '🗑️ Listo, borré lo que me habías enviado. Puedes empezar de nuevo.',
  otroTipo: 'Por ahora leo texto, fotos y notas de voz. Para PDF, Word, Excel o chats exportados, súbelos en recosac.com → Publicar → Subir varios.',
  limite: 'Llegaste al límite de envíos por ahora. Vuelve a intentarlo en una hora.',
  lleno: 'Ya tengo muchos mensajes guardados. Escribe *LISTO* para procesarlos antes de enviar más.',
  error: 'Tuve un problema al revisar tus mensajes. Escribe LISTO para intentar de nuevo.',
};

module.exports = { verifySignature, parseWebhook, parseCommand, sessionToText, summarizeDrafts, MENSAJES };
