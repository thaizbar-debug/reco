// ReCo — service worker mínimo (roadmap 2.5, "Compartir con ReCo").
//
// Solo existe para recibir lo que el usuario comparte desde otra app del
// celular (galería, WhatsApp, archivos) cuando ReCo está instalada como app:
// el sistema hace POST multipart a ./compartir (manifest.webmanifest →
// share_target). Se guarda en la Cache API y se redirige a ./#compartido,
// donde index.html (_pubReadShared) lo lleva al importador.
//
// No cachea nada más: cualquier otra petición sigue a la red como siempre.
const SHARE_CACHE = 'reco-compartir';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/compartir')) return;
  event.respondWith((async () => {
    const form = await event.request.formData();
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    const base = url.pathname.replace(/compartir$/, '');
    const files = [];
    const list = form.getAll('archivos').filter((f) => f && typeof f === 'object' && f.size).slice(0, 20);
    for (let i = 0; i < list.length; i++) {
      const key = `${base}compartir/archivo-${i}`;
      await cache.put(key, new Response(list[i], { headers: { 'content-type': list[i].type || 'application/octet-stream' } }));
      files.push({ key, name: list[i].name || `archivo-${i}`, type: list[i].type || '' });
    }
    const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files };
    await cache.put(`${base}compartir/meta`, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
    return Response.redirect(`${base}#compartido`, 303);
  })());
});
