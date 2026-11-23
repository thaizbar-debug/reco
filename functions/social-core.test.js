// Tests de lectura de posts de redes (lógica pura). Sin framework: node functions/social-core.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('./social-core');

const FIX = (f) => fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'redes', f), 'utf8');

console.log('  detect');
const d = (u) => S.detect(u);
assert.deepStrictEqual(d('https://www.facebook.com/share/1Cemg2hZ7V/?mibextid=wwXIfr'), { red: 'facebook', tipo: 'corto' });
assert.deepStrictEqual(d('https://www.facebook.com/share/v/1DX6FZ7h3H/?mibextid=wwXIfr'), { red: 'facebook', tipo: 'corto' });
assert.deepStrictEqual(d('https://fb.watch/abcDEF/'), { red: 'facebook', tipo: 'corto' });
assert.deepStrictEqual(d('https://www.facebook.com/becainmobiliaria/posts/pfbid02abc'), { red: 'facebook', tipo: 'post' });
assert.deepStrictEqual(d('https://m.facebook.com/story.php?story_fbid=1&id=2'), { red: 'facebook', tipo: 'post' });
assert.deepStrictEqual(d('https://www.facebook.com/photo/?fbid=123'), { red: 'facebook', tipo: 'post' });
assert.deepStrictEqual(d('https://www.facebook.com/reel/123456'), { red: 'facebook', tipo: 'video' });
assert.deepStrictEqual(d('https://www.facebook.com/watch/?v=123'), { red: 'facebook', tipo: 'video' });
assert.deepStrictEqual(d('https://www.facebook.com/becainmobiliaria'), { red: 'facebook', tipo: 'perfil' });
assert.deepStrictEqual(d('https://www.instagram.com/p/DAbCdEfGh12/?igsh=x'), { red: 'instagram', tipo: 'post', code: 'DAbCdEfGh12' });
assert.deepStrictEqual(d('https://www.instagram.com/reel/DAbCdEfGh12/'), { red: 'instagram', tipo: 'video', code: 'DAbCdEfGh12' });
assert.deepStrictEqual(d('https://www.instagram.com/inmobiliaria.sol/p/DAbCdEfGh12/'), { red: 'instagram', tipo: 'post', code: 'DAbCdEfGh12' });
assert.deepStrictEqual(d('https://www.instagram.com/inmobiliaria.sol/'), { red: 'instagram', tipo: 'perfil' });
assert.deepStrictEqual(d('https://vm.tiktok.com/ZMabc123/'), { red: 'tiktok', tipo: 'corto' });
assert.deepStrictEqual(d('https://www.tiktok.com/@ana/video/7312345678901234567'), { red: 'tiktok', tipo: 'video' });
assert.deepStrictEqual(d('https://www.tiktok.com/@ana'), { red: 'tiktok', tipo: 'perfil' });
assert.deepStrictEqual(d('https://youtu.be/abc'), { red: 'youtube', tipo: 'video' });
assert.deepStrictEqual(d('https://www.youtube.com/shorts/abc'), { red: 'youtube', tipo: 'video' });
assert.strictEqual(d('https://tucaninversiones.com/balthazar/'), null);
assert.strictEqual(d('https://facebook.com.estafa.pe/x'), null, 'un dominio que solo empieza igual no es Facebook');

console.log('  unwrapLogin / cleanUrl / embedUrl');
assert.strictEqual(S.unwrapLogin('https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Freel%2F99%2F'), 'https://www.facebook.com/reel/99/');
assert.strictEqual(S.unwrapLogin('https://www.facebook.com/reel/99/'), 'https://www.facebook.com/reel/99/');
assert.strictEqual(S.cleanUrl('https://www.instagram.com/p/X/?igsh=abc&utm_source=ig'), 'https://www.instagram.com/p/X/');
assert.strictEqual(S.embedUrl('https://www.facebook.com/reel/99/?mibextid=x', { red: 'facebook', tipo: 'video' }),
  'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Freel%2F99%2F&show_text=true&width=560');
assert.ok(S.embedUrl('https://www.facebook.com/a/posts/1', { red: 'facebook', tipo: 'post' }).startsWith('https://www.facebook.com/plugins/post.php?href='));
assert.strictEqual(S.embedUrl('x', { red: 'instagram', tipo: 'post', code: 'ABC123' }), 'https://www.instagram.com/p/ABC123/embed/captioned/');
assert.ok(S.embedUrl('https://www.tiktok.com/@a/video/1', { red: 'tiktok' }).startsWith('https://www.tiktok.com/oembed?url='));

console.log('  Facebook (post insertado)');
const fb = S.parseFacebookEmbed(FIX('fb-post-embed.html'), 'https://www.facebook.com/plugins/post.php');
assert.ok(fb.text.startsWith('147.78 m² techados + 68.59 m² de área libre'));
assert.ok(fb.text.includes('US$ 389,000'));
assert.ok(!/Me gusta|Comentar|Compartir|128 me gusta|2 h/.test(fb.text), 'sin textos de la interfaz');
assert.deepStrictEqual(fb.images, ['https://scontent.flim1-1.fna.fbcdn.net/v/t39.30808-6/465_n.jpg?stp=dst-jpg&_nc_cat=1',
  'https://scontent.flim1-1.fna.fbcdn.net/v/t39.30808-6/466_n.jpg?_nc_cat=1'], 'sin foto de perfil ni emojis');
assert.strictEqual(fb.login, false);
assert.strictEqual(S.parseFacebookEmbed(FIX('fb-login.html'), 'https://www.facebook.com/').login, true);
const fbVideo = S.parseFacebookEmbed('<div data-testid="post_message"><div>Alquilo depa en Lince, 70 m2</div></div></div><script>{"hd_src":"https:\\/\\/video.flim1-1.fna.fbcdn.net\\/v\\/t42\\/v.mp4?x=1"}</script>', 'https://www.facebook.com/plugins/video.php');
assert.strictEqual(fbVideo.video, 'https://video.flim1-1.fna.fbcdn.net/v/t42/v.mp4?x=1');

console.log('  Instagram (embed)');
const ig = S.parseInstagramEmbed(FIX('ig-embed.html'), 'https://www.instagram.com/p/DAbCdEfGh12/embed/captioned/');
assert.strictEqual(ig.text, '🏢 VENDO DEPA EN MIRAFLORES\n3 dorm. | 2 baños | 95 m2\nPiso 7 con vista al mar\nPrecio: US$ 245,000\nCalle Alcanfores 455\n#departamento #miraflores');
assert.strictEqual(ig.images.length, 3, 'todas las fotos del carrusel');
assert.strictEqual(ig.video, 'https://scontent.cdninstagram.com/o1/v/t16/f2/m86/video.mp4?efg=x');
assert.strictEqual(ig.title, 'Post de @inmobiliaria.sol');
const igOld = S.parseInstagramEmbed(FIX('ig-embed-sinjson.html'), 'https://www.instagram.com/p/X/embed/captioned/');
assert.strictEqual(igOld.text, 'Alquilo depa en Lince, 2 dorm, 70 m2, S/ 2,300 mensual. Av. Arequipa 2450', 'sin el usuario ni "Ver todos los comentarios"');
assert.deepStrictEqual(igOld.images, ['https://scontent.cdninstagram.com/v/t51.29350-15/9_n.jpg?stp=dst&x=1']);

console.log('  TikTok / YouTube (oEmbed)');
const tt = S.parseOembed(JSON.parse(FIX('tiktok-oembed.json')), 'tiktok');
assert.ok(tt.text.includes('US$ 520,000'));
assert.strictEqual(tt.title, 'TikTok de Ana Corredora');
assert.deepStrictEqual(tt.images, ['https://p16-sign.tiktokcdn-us.com/obj/tos/abc.jpeg?x-expires=1']);
assert.strictEqual(S.parseOembed({ title: 'x', author_name: 'Canal' }, 'youtube').title, 'YouTube de Canal');

console.log('  cleanLines / metaPhotos');
assert.strictEqual(S.cleanLines('Precio\n185000\nMe gusta\n3 d\n·\nPrecio'), 'Precio\n185000\nPrecio', 'los números sueltos (precio) se quedan');
assert.deepStrictEqual(S.metaPhotos(['https://x.com/a.jpg', 'https://scontent.xx.fbcdn.net/v/t39.30808-1/p50x50/a.jpg', 'https://scontent.xx.fbcdn.net/v/t39.30808-6/b.jpg']),
  ['https://scontent.xx.fbcdn.net/v/t39.30808-6/b.jpg']);

console.log('\n  ✓ social-core: todos los tests pasaron');
