/**
 * Importar desde el enlace de un post (Facebook, Instagram, TikTok) o de
 * cualquier web — handler REAL de importListingPage con Firebase en memoria
 * (tests/helpers/mock-functions.js) y la red simulada.
 */
const { test, expect } = require('@playwright/test');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { loadFunctions, req, mockFetch, jpeg } = require('./helpers/mock-functions');

const FIX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'redes', f), 'utf8');
const html = (s, status) => new Response(s, { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const json = (o) => new Response(typeof o === 'string' ? o : JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const redirect = (to) => new Response(null, { status: 302, headers: { location: to } });
const ok = { declaraAutorizacion: true };

function aiItem(over) {
  const R = require('../functions/shared/import-core');
  const it = {};
  R.AI_FIELDS.forEach((k) => { it[k] = null; });
  return Object.assign(it, { campos_inferidos: [], fotos: [], evidencia: '' }, over);
}
// OpenAI simulado: chat (extracción) y Whisper (transcripción).
const ai = (calls, item, transcript) => [
  ['https://api.openai.com/v1/chat/completions', (u, init) => { calls.chat.push(JSON.parse(init.body)); return json({ choices: [{ message: { content: JSON.stringify({ inmuebles: item ? [aiItem(item)] : [] }) } }] }); }],
  ['https://api.openai.com/v1/audio/transcriptions', (u, init) => { calls.whisper.push(init.body); return json({ text: transcript || '' }); }],
];

let origFetch, origLookup;
test.beforeEach(() => {
  origFetch = global.fetch;
  origLookup = dns.promises.lookup;
  dns.promises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
});
test.afterEach(() => { global.fetch = origFetch; dns.promises.lookup = origLookup; });

test.describe('Importar desde el enlace de un post o de cualquier web', () => {
  test('Facebook: enlace para compartir → login → post insertado; texto completo, fotos sin la de perfil, sin teléfono', async () => {
    const F = loadFunctions();
    const calls = { chat: [], whisper: [] };
    const POST = 'https://www.facebook.com/becainmobiliaria/posts/pfbid02abc';
    const net = mockFetch([
      ['https://www.facebook.com/share/1Cemg2hZ7V/', () => redirect(`https://www.facebook.com/login/?next=${encodeURIComponent(POST + '?mibextid=wwXIfr')}`)],
      ['https://www.facebook.com/plugins/post.php', () => html(FIX('fb-post-embed.html'))],
      [/fbcdn\.net/, () => jpeg(20000)],
      ...ai(calls, { tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta', distrito: 'San Isidro', direccion: 'C. Barcelona',
        area_techada: '147.78 m²', nro_dormitorios: '3', nro_banos: '4', precio: 'US$ 389,000', estado: 'En lanzamiento',
        titulo: 'Mansart San Isidro', descripcion: 'Departamento con 68.59 m² de área libre. Escríbenos al 932 559 809', fotos: [] }),
    ]);
    const res = await F.exports.importListingPage.__handler(req('u1', { ...ok, url: 'https://www.facebook.com/share/1Cemg2hZ7V/?mibextid=wwXIfr' }));
    const embed = net.find((c) => c.url.startsWith('https://www.facebook.com/plugins/post.php'));
    expect(decodeURIComponent(embed.url)).toContain(`href=${POST}&`); // sin mibextid
    const sent = calls.chat[0].messages[1].content;
    expect(sent).toContain('147.78 m² techados + 68.59 m² de área libre');
    expect(sent).toContain('[FOTO u-1]');
    expect(sent).not.toContain('Me gusta');
    expect(res.red).toBe('facebook');
    expect(res.drafts).toHaveLength(1);
    expect(res.drafts[0].row).toMatchObject({ tipo_propiedad: 'Departamento', distrito: 'San Isidro', precio: '389000', area_techada: '147.78',
      estado: 'En proyecto', antiguedad: '0', area_terreno: '' });
    expect(res.drafts[0].row.descripcion).not.toContain('932 559 809');
    expect(res.photos.map((p) => p.id)).toEqual(['u-1', 'u-2']);
    // El sistema de la IA trae las reglas nuevas.
    const sys = calls.chat[0].messages[0].content;
    expect(sys).toContain('"área libre", terraza, balcón, patio o jardín NO es area_terreno');
    expect(sys).toContain('Otros proyectos');
    expect(sys).toContain('baño de visita');
  });

  test('Instagram: carrusel completo y el audio del reel transcrito como fuente', async () => {
    const F = loadFunctions();
    const calls = { chat: [], whisper: [] };
    mockFetch([
      ['https://www.instagram.com/p/DAbCdEfGh12/embed/captioned/', () => html(FIX('ig-embed.html'))],
      [/video\.mp4/, () => new Response(Buffer.alloc(50000, 1), { status: 200, headers: { 'content-type': 'video/mp4' } })],
      [/cdninstagram\.com/, () => jpeg(15000)],
      ...ai(calls, { tipo_propiedad: 'depa', tipo_publicacion: 'Venta', distrito: 'Miraflores', direccion: 'Calle Alcanfores 455',
        area_techada: '95 m2', nro_dormitorios: '3', nro_banos: '2', precio: 'US$ 245,000', piso: '7', antiguedad: '5 años', titulo: 'Depa en Miraflores', descripcion: 'x' },
      'Este departamento tiene cinco años de antigüedad y cochera.'),
    ]);
    const res = await F.exports.importListingPage.__handler(req('u1', { ...ok, url: 'https://www.instagram.com/p/DAbCdEfGh12/?igsh=abc' }));
    expect(calls.whisper).toHaveLength(1);
    const sent = calls.chat[0].messages[1].content;
    expect(sent).toContain('VENDO DEPA EN MIRAFLORES');
    expect(sent).toContain('Lo que se dice en el video:\nEste departamento tiene cinco años');
    expect(sent).toContain('[FOTO u-3]');
    // "5 años" sale del audio: la transcripción cuenta como fuente.
    expect(res.drafts[0].row).toMatchObject({ antiguedad: '5', piso: '7', precio: '245000' });
    expect(res).toMatchObject({ red: 'instagram', video: true });
    expect(Object.values(F.db.store).find((v) => v.kind === 'url')).toMatchObject({ red: 'instagram', video: true, photos: 3 });
  });

  test('TikTok: enlace corto → oEmbed (texto y miniatura)', async () => {
    const F = loadFunctions();
    const calls = { chat: [], whisper: [] };
    mockFetch([
      ['https://vm.tiktok.com/ZMabc123/', () => redirect('https://www.tiktok.com/@corredora.ana/video/7312345678901234567?_r=1&_t=x')],
      ['https://www.tiktok.com/oembed', () => json(FIX('tiktok-oembed.json'))],
      [/tiktokcdn/, () => jpeg(30000)],
      ...ai(calls, { tipo_propiedad: 'Casa', tipo_publicacion: 'Venta', distrito: 'La Molina', direccion: 'Calle Los Fresnos 210',
        area_techada: '250 m2', area_terreno: '300 m2', nro_dormitorios: '4', precio: 'US$ 520,000', titulo: 'Casa en La Molina', descripcion: 'x' }),
    ]);
    const res = await F.exports.importListingPage.__handler(req('u1', { ...ok, url: 'https://vm.tiktok.com/ZMabc123/' }));
    expect(calls.chat[0].messages[1].content).toContain('Casa en La Molina 🏡 4 dorm');
    expect(res.drafts[0].row).toMatchObject({ area_terreno: '300', area_techada: '250', precio: '520000' });
    expect(res.photos).toHaveLength(1);
  });

  test('post privado o página de login → social-private sin gastar el límite; perfil → social-profile', async () => {
    const F = loadFunctions();
    const calls = { chat: [], whisper: [] };
    mockFetch([
      ['https://www.facebook.com/plugins/post.php', () => html(FIX('fb-login.html'))],
      ['https://www.facebook.com/share/privado/', () => redirect('https://www.facebook.com/login/')],
      ...ai(calls, null),
    ]);
    const imp = F.exports.importListingPage.__handler;
    await expect(imp(req('u1', { ...ok, url: 'https://www.facebook.com/x/posts/1' }))).rejects.toMatchObject({ details: { reason: 'social-private' } });
    await expect(imp(req('u1', { ...ok, url: 'https://www.facebook.com/share/privado/' }))).rejects.toMatchObject({ details: { reason: 'social-private' } });
    const perfil = imp(req('u1', { ...ok, url: 'https://www.instagram.com/inmobiliaria.sol/' }));
    await expect(perfil).rejects.toMatchObject({ details: { reason: 'social-profile' } });
    await expect(imp(req('u1', { ...ok, url: 'https://www.instagram.com/inmobiliaria.sol/' }))).rejects.toThrow(/conecta tu página de Facebook o tu cuenta de Instagram/);
    expect(F.db.store['importUsage/u1']).toBeUndefined(); // no gasta importaciones con IA
    expect(F.db.store['importUsage/u1_lecturas'].count).toBe(4);
    expect(calls.chat).toHaveLength(0);
    // Tope de lecturas de páginas por hora.
    F.db.store['importUsage/u1_lecturas'] = { hour: new Date().toISOString().slice(0, 13), count: 120 };
    await expect(imp(req('u1', { ...ok, url: 'https://www.facebook.com/x/posts/1' }))).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  test('cualquier web (página de un proyecto) y su lista de proyectos', async () => {
    const F = loadFunctions();
    const calls = { chat: [], whisper: [] };
    mockFetch([
      ['https://tucaninversiones.com/balthazar/', () => html(`<html><head><title>Balthazar | Tucán Inversiones</title>
        <meta property="og:image" content="https://tucaninversiones.com/wp-content/uploads/balthazar-fachada.jpg"></head>
        <body><h1>Balthazar</h1><p>Departamentos de 2 y 3 dormitorios en Jesús María. Flats desde 65 m2. Precio desde S/ 389,000. En preventa.</p>
        <img src="/wp-content/uploads/balthazar-sala.jpg"><img src="/wp-content/uploads/logo-tucan.png"></body></html>`)],
      ['https://tucaninversiones.com/proyectos/', () => html(`<a href="/balthazar/">Balthazar</a><a href="/contacto/">Contacto</a>
        <a href="/proyectos/torre-alba">Torre Alba</a><a href="https://www.facebook.com/tucan">fb</a><a href="/blog/noticia">Blog</a>`)],
      [/wp-content\/uploads\/balthazar/, () => jpeg(25000)],
      ...ai(calls, { tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta', distrito: 'Jesús María', area_techada: '65 m2',
        precio: 'S/ 389,000', estado: 'Preventa', titulo: 'Balthazar', descripcion: 'x' }),
    ]);
    const imp = F.exports.importListingPage.__handler;
    const res = await imp(req('u1', { ...ok, url: 'https://tucaninversiones.com/balthazar/' }));
    expect(calls.chat[0].messages[1].content).toContain('Departamentos de 2 y 3 dormitorios en Jesús María');
    expect(res.drafts[0].row).toMatchObject({ estado: 'En proyecto', tipo_moneda: 'PEN', precio: '389000' });
    expect(res.photos).toHaveLength(2); // fachada y sala; el logo no
    const lista = await imp(req('u1', { ...ok, url: 'https://tucaninversiones.com/proyectos/', modo: 'perfil' }));
    expect(lista.avisos.map((a) => a.url)).toEqual(['https://tucaninversiones.com/balthazar/', 'https://tucaninversiones.com/proyectos/torre-alba']);
  });
});

// ── Video subido (reel o TikTok descargado) ──
test.describe('Video subido: imágenes del video + audio transcrito', () => {
  test('extractListings fileType video: transcribe el audio y lo usa como fuente', async () => {
    const F = loadFunctions();
    const calls = { chat: [], whisper: [] };
    mockFetch(ai(calls, { tipo_propiedad: 'Departamento', tipo_publicacion: 'Alquiler', distrito: 'Lince', area_techada: '70 m2',
      precio: 'dos mil trescientos soles', nro_dormitorios: '2', titulo: 'Depa en Lince', descripcion: 'x' },
    'Hola, alquilo este departamento en Lince de 70 metros, dos dormitorios, a 2,300 soles.'));
    const wav = 'data:audio/wav;base64,' + Buffer.alloc(3000, 1).toString('base64');
    const res = await F.exports.extractListings.__handler(req('u1', { kind: 'document', fileType: 'video', sourceName: 'reel.mp4',
      text: '=== Video: reel.mp4 (2 imágenes del video; el audio se transcribe) ===',
      images: [{ page: '1', dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(200) }], photoIds: [], audio: { dataUrl: wav } }));
    expect(calls.whisper).toHaveLength(1);
    expect(calls.whisper[0].get('file').name).toBe('audio.wav');
    const content = calls.chat[0].messages[1].content;
    expect(content[0].text).toContain('Lo que se dice en el video:\nHola, alquilo este departamento en Lince de 70 metros');
    expect(content.some((c) => c.type === 'image_url')).toBe(true);
    expect(res.drafts[0].row).toMatchObject({ distrito: 'Lince', area_techada: '70' });
    const draft = Object.values(F.db.store).find((v) => v.batchId === res.batchId);
    expect(draft.source).toBe('video');
    expect(Object.values(F.db.store).find((v) => v.kind === 'document')).toMatchObject({ fileType: 'video', audio: true });
    await expect(F.exports.extractListings.__handler(req('u1', { kind: 'document', fileType: 'video', text: 'x',
      images: [], photoIds: [], audio: { dataUrl: 'data:text/html;base64,AAAA' } }))).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

// ── Conectar Facebook / Instagram ──
const META = { META_APP_ID: '123456', META_APP_SECRET: 'meta-secret' };
const graph = (routes) => [[/graph\.facebook\.com\/v21\.0\//, (u) => {
  const url = new URL(u);
  for (const [pat, fn] of routes) if (pat.test(url.pathname)) return json(fn(url));
  return json({ error: { message: 'no simulado ' + url.pathname } });
}]];

test.describe('Conectar Facebook / Instagram y traer posts', () => {
  test('sin configurar: no disponible', async () => {
    const F = loadFunctions();
    expect(await F.exports.metaConnect.__handler(req('u1', {}))).toEqual({ disponible: false });
  });

  test('conectar (OAuth), listar posts de la página y de Instagram, importar con fotos y marcar importados', async () => {
    const F = loadFunctions({ secrets: META });
    const mc = F.exports.metaConnect.__handler;
    const { url } = await mc(req('u1', { action: 'authUrl' }));
    const auth = new URL(url);
    expect(auth.origin + auth.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(auth.searchParams.get('scope')).toBe('pages_show_list,pages_read_engagement,instagram_basic,business_management');
    expect(auth.searchParams.get('redirect_uri')).toMatch(/cloudfunctions\.net\/metaOAuth$/);
    const state = auth.searchParams.get('state');
    expect(F.db.store[`metaOAuthStates/${state}`].uid).toBe('u1');

    const calls = { chat: [], whisper: [] };
    const FB_POST = { id: '111_222', message: 'VENDO casa en Surco 4 dorm, 180 m2 construidos, 200 m2 de terreno. US$ 350,000. Jr. Las Gaviotas 120',
      created_time: '2026-10-20T10:00:00+0000', permalink_url: 'https://www.facebook.com/111/posts/222', full_picture: 'https://scontent.xx.fbcdn.net/v/t39.30808-6/a_n.jpg',
      attachments: { data: [{ media_type: 'album', subattachments: { data: [
        { media_type: 'photo', media: { image: { src: 'https://scontent.xx.fbcdn.net/v/t39.30808-6/a_n.jpg' } } },
        { media_type: 'photo', media: { image: { src: 'https://scontent.xx.fbcdn.net/v/t39.30808-6/b_n.jpg' } } }] } }] } };
    const IG_POST = { id: '17900000000000001', caption: 'Alquilo depa en Barranco 2 dorm 80 m2 S/ 3,200', media_type: 'CAROUSEL_ALBUM',
      permalink: 'https://www.instagram.com/p/XYZ/', timestamp: '2026-10-21T10:00:00+0000',
      children: { data: [{ media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/v/1.jpg' }, { media_type: 'VIDEO', media_url: 'https://scontent.cdninstagram.com/v/2.mp4', thumbnail_url: 'https://scontent.cdninstagram.com/v/2t.jpg' }] } };
    const net = mockFetch([
      ...graph([
        [/oauth\/access_token$/, (u) => ({ access_token: u.searchParams.get('grant_type') ? 'LONG_USER' : 'SHORT_USER' })],
        [/me\/accounts$/, () => ({ data: [{ id: '111', name: 'Inmobiliaria Sol', access_token: 'PAGE_TOKEN', instagram_business_account: { id: '178', username: 'inmobiliaria.sol' } }] })],
        [/111\/posts$/, () => ({ data: [FB_POST, { id: '111_333', message: '¡Feliz día de la madre!', full_picture: null }], paging: { cursors: { after: 'CUR' }, next: 'x' } })],
        [/178\/media$/, () => ({ data: [IG_POST] })],
        [/111_222$/, () => FB_POST],
        [/17900000000000001$/, () => IG_POST],
      ]),
      [/\.mp4/, () => new Response(Buffer.alloc(40000, 1), { status: 200, headers: { 'content-type': 'video/mp4' } })],
      [/fbcdn\.net|cdninstagram\.com/, () => jpeg(12000)],
      ...ai(calls, { tipo_propiedad: 'Casa', tipo_publicacion: 'Venta', distrito: 'Surco', direccion: 'Jr. Las Gaviotas 120', area_techada: '180 m2',
        area_terreno: '200 m2', nro_dormitorios: '4', precio: 'US$ 350,000', titulo: 'Casa en Surco', descripcion: 'x', fotos: [] }, 'La casa tiene jardín.'),
    ]);
    const res = { statusCode: 0, location: '', redirect(c, u) { this.statusCode = c; this.location = u; } };
    await F.exports.metaOAuth.__handler({ query: { state, code: 'CODE' } }, res);
    expect(res.location).toBe('https://recosac.com/#integraciones-meta-ok');
    expect(F.db.store['metaTokens/u1'].pages).toEqual({ 111: 'PAGE_TOKEN' });
    expect(JSON.stringify(F.db.store['metaAccounts/u1'])).not.toContain('PAGE_TOKEN');
    expect(F.db.store[`metaOAuthStates/${state}`]).toBeUndefined();
    // El estado es de un solo uso.
    const res2 = { redirect(c, u) { this.location = u; } };
    await F.exports.metaOAuth.__handler({ query: { state, code: 'CODE' } }, res2);
    expect(res2.location).toBe('https://recosac.com/#integraciones-meta-vencido');

    const st = await mc(req('u1', {}));
    expect(st.cuentas).toEqual([{ red: 'facebook', id: '111', nombre: 'Inmobiliaria Sol' }, { red: 'instagram', id: '178', nombre: '@inmobiliaria.sol', pageId: '111' }]);
    const fb = await mc(req('u1', { action: 'posts', red: 'facebook', id: '111' }));
    expect(fb.posts.map((p) => [p.id, p.fotos, p.importado])).toEqual([['111_222', 2, false], ['111_333', 0, false]]);
    expect(fb.after).toBe('CUR');
    const graphCall = net.find((c) => /111\/posts/.test(c.url));
    expect(new URL(graphCall.url).searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
    const ig = await mc(req('u1', { action: 'posts', red: 'instagram', id: '178' }));
    expect(ig.posts[0]).toMatchObject({ id: '17900000000000001', fotos: 2, video: true });
    // Otra cuenta no puede usar esta conexión.
    await expect(mc(req('u2', { action: 'posts', red: 'facebook', id: '111' }))).rejects.toMatchObject({ code: 'not-found' });

    const imp = await mc(req('u1', { action: 'import', red: 'facebook', id: '111', postIds: ['111_222'] }));
    expect(imp).toMatchObject({ creados: 1, importados: ['111_222'], limite: false });
    const draft = Object.entries(F.db.store).find(([k, v]) => k.startsWith('importDrafts/') && v.batchId === imp.batchId);
    expect(draft[1]).toMatchObject({ source: 'redes', sourceName: 'Facebook · Inmobiliaria Sol', sourceUrl: 'https://www.facebook.com/111/posts/222', metaPostId: '111_222' });
    expect(draft[1].photoUrls).toHaveLength(2);
    expect(Object.keys(F.bucket.files).filter((p) => p.startsWith(`imports/u1/${draft[0].slice(13)}/`))).toHaveLength(2);
    expect(calls.chat[0].messages[1].content).toContain('VENDO casa en Surco');
    expect((await mc(req('u1', { action: 'posts', red: 'facebook', id: '111' }))).posts[0].importado).toBe(true);

    // Instagram: el video del carrusel se transcribe.
    await mc(req('u1', { action: 'import', red: 'instagram', id: '178', postIds: ['17900000000000001'] }));
    expect(calls.whisper).toHaveLength(1);
    expect(calls.chat[1].messages[1].content).toContain('Lo que se dice en el video:\nLa casa tiene jardín.');

    // Límite por hora: se detiene y lo informa.
    F.db.store['importUsage/u1'] = { hour: new Date().toISOString().slice(0, 13), count: 30 };
    expect(await mc(req('u1', { action: 'import', red: 'facebook', id: '111', postIds: ['111_222'] }))).toMatchObject({ creados: 0, limite: true });

    await mc(req('u1', { action: 'disconnect' }));
    expect(F.db.store['metaTokens/u1']).toBeUndefined();
  });
});
