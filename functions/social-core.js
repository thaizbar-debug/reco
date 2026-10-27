// ─────────────────────────────────────────────────────────────────────────────
// ReCo — leer posts de redes sociales desde su enlace (lógica pura, sin red).
//
// Lo más común para captar inventario: el corredor pega el enlace de su post
// de Facebook, Instagram, TikTok o YouTube. Ninguna de esas redes deja leer
// la página normal sin iniciar sesión, así que se usan sus vías PÚBLICAS de
// inserción, las mismas que usan los sitios web para mostrar un post:
//   Facebook   plugins/post.php · plugins/video.php (posts y videos públicos)
//   Instagram  /p/{código}/embed/captioned/ (texto, fotos y video del post)
//   TikTok     oEmbed público (texto del video y miniatura)
//   YouTube    oEmbed público + descripción de la página
// functions/index.js hace las descargas (con la protección SSRF) y este
// módulo solo interpreta las respuestas → { title, meta, text, images, video }.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const Imp = require('./shared/import-core');

const host = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^(www|m|mobile|web|mbasic|vm|vt)\./, ''); } catch (_) { return ''; } };
const is = (h, d) => h === d || h.endsWith('.' + d);

// Red y tipo de enlace. tipo: 'post' | 'video' | 'perfil' | 'corto' (hay que
// seguir la redirección para saber qué es).
function detect(url) {
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  const h = host(url);
  const p = u.pathname.replace(/\/+$/, '') || '/';
  if (is(h, 'facebook.com') || is(h, 'fb.com') || is(h, 'fb.watch') || is(h, 'fb.me')) {
    if (is(h, 'fb.watch') || is(h, 'fb.me') || /^\/share\//.test(p)) return { red: 'facebook', tipo: 'corto' };
    if (/^\/(reel|watch|videos)\b|\/videos\//.test(p) || u.searchParams.has('v')) return { red: 'facebook', tipo: 'video' };
    if (/\/(posts|permalink|photos|photo|story\.php|permalink\.php|groups\/[^/]+\/(posts|permalink))\b/.test(p) || u.searchParams.has('story_fbid') || u.searchParams.has('fbid')) {
      return { red: 'facebook', tipo: 'post' };
    }
    if (/^\/(login|checkpoint)/.test(p)) return { red: 'facebook', tipo: 'login' };
    return { red: 'facebook', tipo: 'perfil' };
  }
  if (is(h, 'instagram.com') || is(h, 'instagr.am')) {
    const m = p.match(/^\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
    if (m) return { red: 'instagram', tipo: m[1] === 'p' ? 'post' : 'video', code: m[2] };
    if (/^\/share\//.test(p)) return { red: 'instagram', tipo: 'corto' };
    if (/^\/accounts\/login/.test(p)) return { red: 'instagram', tipo: 'login' };
    return { red: 'instagram', tipo: 'perfil' };
  }
  if (is(h, 'tiktok.com')) {
    if (/^\/@[^/]+\/(video|photo)\/\d+/.test(p)) return { red: 'tiktok', tipo: 'video' };
    if (/^\/t\/|^\/[A-Za-z0-9]{6,}$/.test(p) || /^(vm|vt)\./.test(new URL(url).hostname)) return { red: 'tiktok', tipo: 'corto' };
    if (/^\/@[^/]+$/.test(p)) return { red: 'tiktok', tipo: 'perfil' };
    return { red: 'tiktok', tipo: 'corto' };
  }
  if (is(h, 'youtube.com') || is(h, 'youtu.be')) {
    if (is(h, 'youtu.be') || /^\/(watch|shorts|live)\b/.test(p)) return { red: 'youtube', tipo: 'video' };
    return { red: 'youtube', tipo: 'perfil' };
  }
  return null;
}

// Facebook manda a /login/?next=… cuando no hay sesión: el destino real va en next.
function unwrapLogin(url) {
  try {
    const u = new URL(url);
    const next = u.searchParams.get('next') || u.searchParams.get('u');
    if (next && /^\/(login|checkpoint|accounts\/login)|^\/l\.php/.test(u.pathname)) return new URL(next, u.origin).href;
  } catch (_) { /* no es URL */ }
  return url;
}
// Quita parámetros de seguimiento (mibextid, igsh, utm_…).
function cleanUrl(url) {
  try {
    const u = new URL(url);
    ['mibextid', 'igsh', 'igshid', 'rdid', 'share_url', 'sfnsn', 'ref', 'fbclid', 'is_from_webapp', 'sender_device', '_r', '_t']
      .forEach((k) => u.searchParams.delete(k));
    [...u.searchParams.keys()].filter((k) => /^utm_/.test(k)).forEach((k) => u.searchParams.delete(k));
    u.hash = '';
    return u.href;
  } catch (_) { return url; }
}

// URL pública de inserción de cada red.
function embedUrl(url, d) {
  const enc = encodeURIComponent(cleanUrl(url));
  if (d.red === 'facebook') {
    return d.tipo === 'video'
      ? `https://www.facebook.com/plugins/video.php?href=${enc}&show_text=true&width=560`
      : `https://www.facebook.com/plugins/post.php?href=${enc}&show_text=true&width=500`;
  }
  if (d.red === 'instagram') return `https://www.instagram.com/p/${d.code}/embed/captioned/`;
  if (d.red === 'tiktok') return `https://www.tiktok.com/oembed?url=${enc}`;
  if (d.red === 'youtube') return `https://www.youtube.com/oembed?url=${enc}&format=json`;
  return null;
}

// Textos de la interfaz que no son parte del post.
const UI_RE = /^(facebook|instagram|tiktok|me gusta|like|likes|comentar|comment|comments|compartir|share|ver más|see more|ver traducción|see translation|seguir|follow|log in|iniciar sesión|regístrate|sign up|ver en instagram|view on instagram|view this post on instagram|ver esta publicación en instagram|more|más|reply|responder|enviar|send|watch on facebook|ver en facebook|\d+\s*(likes?|me gusta|comentarios?|comments?|reacciones|veces compartido|shares?)|·)$/i;
function cleanLines(text) {
  const out = [];
  String(text || '').split(/\n+/).map((l) => l.replace(/[⁣⠀​]/g, '').trim()).forEach((l) => {
    if (!l || UI_RE.test(l) || /^\d+\s*(h|d|min|sem|w|s)$/i.test(l)) return;
    if (out[out.length - 1] !== l) out.push(l);
  });
  return out.join('\n');
}
// Fotos de los CDN de Meta: fuera fotos de perfil, emojis e íconos.
function metaPhotos(images) {
  return (images || []).filter((u) => /(fbcdn\.net|cdninstagram\.com|fbsbx\.com)/.test(u)
    && !/\/(rsrc|emoji|static)\.|\/images\/emoji|p\d{2,3}x\d{2,3}|s\d{2,3}x\d{2,3}|\/t1\.\d+-1\//.test(u));
}

// plugins/post.php o video.php de Facebook.
function parseFacebookEmbed(html, baseUrl) {
  const p = Imp.parseListingHtml(html, baseUrl);
  // El texto del post suele estar en data-testid="post_message" / userContent.
  const m = String(html).match(/<div[^>]+(?:data-testid="post_message"|class="[^"]*userContent[^"]*")[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  const principal = m ? Imp.parseListingHtml(`<div>${m[1]}</div>`, baseUrl).text : '';
  const text = cleanLines(principal || p.text);
  const video = (String(html).match(/"(?:hd_src|sd_src|playable_url(?:_quality_hd)?|browser_native_(?:hd|sd)_url)"\s*:\s*"([^"]+)"/) || [])[1];
  return {
    title: p.title, meta: p.meta, jsonld: [], datos: [], text,
    images: metaPhotos(p.images).slice(0, 20),
    video: video ? JSON.parse(`"${video}"`) : (p.meta['og:video:secure_url'] || p.meta['og:video'] || null),
    login: /id="login_form"|name="login"|Log in to Facebook|Inicia sesión en Facebook/i.test(html) && text.length < 40,
  };
}

// /p/{código}/embed/captioned/ de Instagram: el JSON de la página trae el
// texto, todas las fotos del carrusel y, en videos, la URL del video.
function parseInstagramEmbed(html, baseUrl) {
  const h = String(html || '');
  let media = null;
  const ctx = h.match(/"contextJSON"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (ctx) {
    try {
      const data = JSON.parse(JSON.parse(ctx[1]));
      media = (data.gql_data && (data.gql_data.shortcode_media || data.gql_data.xdt_shortcode_media)) || data.context && data.context.media || null;
    } catch (_) { media = null; }
  }
  if (media) {
    const caption = ((media.edge_media_to_caption && media.edge_media_to_caption.edges) || [])
      .map((e) => e && e.node && e.node.text).filter(Boolean).join('\n');
    const kids = ((media.edge_sidecar_to_children && media.edge_sidecar_to_children.edges) || []).map((e) => e && e.node).filter(Boolean);
    const fotos = (kids.length ? kids : [media]).map((n) => n.display_url || (n.display_resources || []).slice(-1).map((r) => r.src)[0]).filter(Boolean);
    const video = media.is_video ? media.video_url || null : (kids.find((k) => k.is_video && k.video_url) || {}).video_url || null;
    return {
      title: (media.owner && media.owner.username) ? `Post de @${media.owner.username}` : 'Post de Instagram', meta: {}, jsonld: [], datos: [],
      text: cleanLines(caption), images: [...new Set(fotos)].slice(0, 20), video,
      login: false,
    };
  }
  // Sin JSON: el texto del bloque .Caption y la imagen principal.
  const p = Imp.parseListingHtml(h, baseUrl);
  const cap = h.match(/<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/i);
  let text = cap ? Imp.parseListingHtml(`<div>${cap[1].replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, '')}</div>`, baseUrl).text : '';
  const img = (h.match(/<img[^>]+class="EmbeddedMediaImage"[^>]+src="([^"]+)"/i) || [])[1];
  if (!text) text = p.meta['og:description'] || '';
  return {
    title: p.title, meta: p.meta, jsonld: [], datos: [], text: cleanLines(text),
    images: [...new Set([img ? img.replace(/&amp;/g, '&') : null, ...metaPhotos(p.images)].filter(Boolean))].slice(0, 20),
    video: null, login: /accounts\/login|Login • Instagram/i.test(h) && !text,
  };
}

// oEmbed (TikTok, YouTube): título = texto del post.
function parseOembed(json, red) {
  const j = json && typeof json === 'object' ? json : {};
  return {
    title: j.author_name ? `${red === 'tiktok' ? 'TikTok' : 'YouTube'} de ${j.author_name}` : '',
    meta: {}, jsonld: [], datos: [], text: cleanLines(j.title || ''),
    images: j.thumbnail_url ? [j.thumbnail_url] : [], video: null, login: false,
  };
}

// Mensaje para el corredor cuando una red no deja leer el enlace.
const AYUDA = {
  privado: 'No pudimos leer ese post: puede ser privado o la red no lo muestra sin iniciar sesión. Sube una captura de pantalla del post (con su texto) o copia el texto y usa "Pegar texto".',
  perfil: 'Ese enlace es de un perfil, no de un post. Para traer todos tus posts, conecta tu página de Facebook o tu cuenta de Instagram en Integraciones; o pega el enlace de cada post.',
  videoSinAudio: 'Leímos el texto del post. Si el video explica precio o áreas que no están en el texto, sube el video como archivo para transcribirlo.',
};

module.exports = { detect, unwrapLogin, cleanUrl, embedUrl, cleanLines, metaPhotos, parseFacebookEmbed, parseInstagramEmbed, parseOembed, AYUDA };
