/**
 * Portales con protección anti-bots (Urbania, Adondevivir…): handler REAL de
 * importListingPage con la red simulada. Se reintenta con encabezados de
 * navegador y, si sigue bloqueado y hay un servicio de lectura configurado
 * (SCRAPER_API_KEY / SCRAPER_PROVIDER), se lee a través de él.
 */
const { test, expect } = require('@playwright/test');
const dns = require('dns');
const { loadFunctions, req, mockFetch, claude, CLAUDE_URL } = require('./helpers/mock-functions');

const html = (s, status) => new Response(s, { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const ok = { declaraAutorizacion: true };
const URL_AVISO = 'https://urbania.pe/inmueble/proyecto/nomad-living-4618731';
const CLOUDFLARE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser cf-chl</body></html>';
const AVISO = `<html><head><title>Nomad Living - San Isidro</title>
  <meta property="og:title" content="Nomad Living, departamentos en San Isidro">
  <script type="application/ld+json">{"@type":"Apartment","name":"Nomad Living","address":{"addressLocality":"San Isidro"}}</script>
  </head><body><h1>Nomad Living</h1><p>Departamentos de 1 y 2 dormitorios desde US$ 150,000 en San Isidro, 45 m².</p></body></html>`;
const ia = (calls) => [CLAUDE_URL, (u, init) => {
  calls.push(JSON.parse(init.body));
  return claude({ inmuebles: [] });
}];

let origFetch, origLookup;
test.beforeEach(() => {
  origFetch = global.fetch;
  origLookup = dns.promises.lookup;
  dns.promises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
});
test.afterEach(() => { global.fetch = origFetch; dns.promises.lookup = origLookup; });

test.describe('Portales que bloquean a los servidores', () => {
  test('sin servicio configurado: reintenta como navegador y, si sigue bloqueado, avisa qué hacer y lo registra', async () => {
    const F = loadFunctions({ secrets: { SCRAPER_API_KEY: '' } });
    const net = mockFetch([['https://urbania.pe/', () => html(CLOUDFLARE, 403)]]);
    await expect(F.exports.importListingPage.__handler(req('u1', { ...ok, url: URL_AVISO })))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'blocked' }, message: expect.stringContaining('urbania.pe no dejó') });
    const pedidos = net.filter((c) => c.url.startsWith('https://urbania.pe/'));
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1].init.headers['User-Agent']).toContain('Chrome/');
    expect(pedidos[1].init.headers['Sec-Fetch-Mode']).toBe('navigate');
    expect(Object.values(F.db.store).some((x) => x.kind === 'bloqueado' && x.host === 'urbania.pe')).toBe(true);
    expect(F.db.store['importUsage/u1']).toBeUndefined(); // no gasta el límite de la IA
  });

  test('si con encabezados de navegador se puede leer, no usa el servicio', async () => {
    const F = loadFunctions({ secrets: { SCRAPER_API_KEY: 'k' } });
    const chats = [];
    const net = mockFetch([
      ['https://urbania.pe/', (u, init) => (init.headers['Sec-Fetch-Mode'] ? html(AVISO) : html(CLOUDFLARE, 403))],
      ia(chats),
    ]);
    await F.exports.importListingPage.__handler(req('u1', { ...ok, url: URL_AVISO }));
    expect(net.some((c) => /scrapingbee/.test(c.url))).toBe(false);
    expect(chats[0].messages[0].content).toContain('desde US$ 150,000');
    expect(Object.values(F.db.store).some((x) => x.channel === 'url' && x.via === 'navegador')).toBe(true);
  });

  test('ScrapingBee (por defecto): primero proxy premium de Perú; si también lo bloquean, modo sigiloso', async () => {
    const F = loadFunctions({ secrets: { SCRAPER_API_KEY: 'clave-sb' } });
    const chats = [];
    const net = mockFetch([
      ['https://urbania.pe/', () => html(CLOUDFLARE, 403)],
      ['https://app.scrapingbee.com/api/v1/', (u) => (new URL(u).searchParams.get('stealth_proxy') ? html(AVISO) : html(CLOUDFLARE, 200))],
      ia(chats),
    ]);
    await F.exports.importListingPage.__handler(req('u1', { ...ok, url: URL_AVISO }));
    const sb = net.filter((c) => c.url.startsWith('https://app.scrapingbee.com/')).map((c) => Object.fromEntries(new URL(c.url).searchParams));
    expect(sb).toHaveLength(2);
    expect(sb[0]).toMatchObject({ api_key: 'clave-sb', url: URL_AVISO, premium_proxy: 'true', country_code: 'pe' });
    expect(sb[1]).toMatchObject({ stealth_proxy: 'true' });
    expect(chats[0].messages[0].content).toContain('Nomad Living');
    expect(Object.values(F.db.store).some((x) => x.channel === 'url' && x.via === 'servicio')).toBe(true);
  });

  test('fotos que el portal arma con JavaScript (URLs dentro de scripts) y que también bloquea: se piden por el servicio', async () => {
    const F = loadFunctions({ secrets: { SCRAPER_API_KEY: 'k' } });
    const GALERIA = AVISO.replace('</body>', `<script>window.__PRELOADED_STATE__={"pictures":[{"url":"https:\\/\\/imgar.zonapropcdn.com\\/avisos\\/1\\/a.jpg"},{"url":"https:\\u002F\\u002Fimgar.zonapropcdn.com\\u002Favisos\\u002F1\\u002Fb.webp"}],"logo":"https://static.urbania.pe/logo.png"}</script></body>`);
    const chats = [];
    const net = mockFetch([
      ['https://urbania.pe/', () => html(CLOUDFLARE, 403)],
      ['https://imgar.zonapropcdn.com/', () => new Response('Forbidden', { status: 403 })],
      ['https://app.scrapingbee.com/api/v1/', (u) => {
        const target = new URL(u).searchParams.get('url');
        if (/zonapropcdn/.test(target)) return new Response(Buffer.alloc(12000, 3), { status: 200, headers: { 'content-type': /webp/.test(target) ? 'image/webp' : 'image/jpeg' } });
        return html(GALERIA);
      }],
      ia(chats),
    ]);
    const res = await F.exports.importListingPage.__handler(req('u1', { ...ok, url: URL_AVISO }));
    expect(chats[0].messages[0].content).toContain('[FOTO u-1] [FOTO u-2]');
    expect(net.some((c) => c.url.includes('logo.png'))).toBe(false);
    const viaServicio = net.filter((c) => c.url.startsWith('https://app.scrapingbee.com/') && /zonapropcdn/.test(c.url));
    expect(viaServicio).toHaveLength(2);
    expect(res.drafts).toEqual([]);
  });

  test('si la respuesta se corta por larga (proyecto con muchas unidades): Sonnet y, si también, Sonnet con respuesta más corta', async () => {
    const F = loadFunctions({ secrets: { SCRAPER_API_KEY: '' } });
    const chats = [];
    mockFetch([
      ['https://urbania.pe/', () => html(AVISO)],
      [CLAUDE_URL, (u, init) => {
        chats.push(JSON.parse(init.body));
        if (chats.length <= 2) return claude('{"inmuebles":[{"titulo":"Nomad', { stop_reason: 'max_tokens' });
        return claude({ inmuebles: [] });
      }],
    ]);
    await F.exports.importListingPage.__handler(req('u1', { ...ok, url: URL_AVISO }));
    expect(chats.map((c) => c.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
    expect(chats[0].max_tokens).toBe(16000);
    expect(chats[1].system).not.toContain('como máximo 12 inmuebles');
    expect(chats[2].system).toContain('como máximo 12 inmuebles');
  });

  test('ZenRows y ScraperAPI con SCRAPER_PROVIDER; la lista de un perfil también usa el servicio', async () => {
    const LISTA = '<html><body><a href="/inmueble/proyecto/uno-1111111">Uno</a><a href="/inmueble/proyecto/dos-2222222">Dos</a></body></html>';
    for (const [provider, host, param] of [['zenrows', 'https://api.zenrows.com/v1/', 'apikey'], ['scraperapi', 'https://api.scraperapi.com/', 'api_key']]) {
      const F = loadFunctions({ secrets: { SCRAPER_API_KEY: 'k-' + provider, SCRAPER_PROVIDER: provider } });
      const net = mockFetch([['https://urbania.pe/', () => html(CLOUDFLARE, 403)], [host, () => html(LISTA)]]);
      const res = await F.exports.importListingPage.__handler(req('u1', { ...ok, url: 'https://urbania.pe/inmobiliarias/mi-empresa', modo: 'perfil' }));
      expect(res.avisos.map((a) => a.url)).toEqual(['https://urbania.pe/inmueble/proyecto/uno-1111111', 'https://urbania.pe/inmueble/proyecto/dos-2222222']);
      const p = net.find((c) => c.url.startsWith(host));
      expect(new URL(p.url).searchParams.get(param)).toBe('k-' + provider);
    }
  });
});
