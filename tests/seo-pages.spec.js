// SEO Fase 2: fichas estáticas generadas por scripts/build-seo-pages.js.
// Valida la salida que está en el repo (inmueble/ y sitemap.xml).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'inmueble');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/properties.json'), 'utf8'));
const slugs = fs.readdirSync(OUT);

test.describe('SEO: fichas de inmuebles', () => {
  test('hay una ficha por cada inmueble en venta o alquiler, y ninguna de Histórico', () => {
    const expected = data.properties.filter(p => (p.op === 'Venta' || p.op === 'Alquiler') && p.price > 0);
    expect(slugs.length).toBeGreaterThanOrEqual(expected.length);
    expect(slugs.some(s => /historico/.test(s))).toBe(false);
  });

  test('el sitemap lista todas las fichas', () => {
    const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    for (const s of slugs) expect(sitemap).toContain(`https://recosac.com/inmueble/${s}/`);
  });

  test('cada ficha tiene title, description, canonical propio y JSON-LD válido', () => {
    for (const s of slugs) {
      const html = fs.readFileSync(path.join(OUT, s, 'index.html'), 'utf8');
      expect(html).toMatch(/<title>[^<]{10,}<\/title>/);
      expect(html).toMatch(/<meta name="description" content="[^"]{30,}"/);
      expect(html).toContain(`<link rel="canonical" href="https://recosac.com/inmueble/${s}/"/>`);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
      const listing = ld['@graph'].find(n => n['@type'] === 'RealEstateListing');
      expect(listing.offers.price).toBeGreaterThan(0);
    }
  });

  test('las fichas no exponen datos del dueño ni partidas', () => {
    for (const s of slugs) {
      const html = fs.readFileSync(path.join(OUT, s, 'index.html'), 'utf8');
      expect(html).not.toMatch(/userEmail|userId|@gmail|pdf_main|partida registral/i);
    }
  });

  test('la ficha se ve sin errores y enlaza a la app', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://localhost:3123/inmueble/${slugs[0]}/`);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('a.cta').first()).toHaveAttribute('href', /^\/index\.html#prop=/);
    expect(errors).toEqual([]);
  });
});

const SEARCH = path.join(ROOT, 'busqueda-especial');
const searchSlugs = fs.readdirSync(SEARCH).filter(f => fs.statSync(path.join(SEARCH, f)).isDirectory());

test.describe('SEO: Búsqueda especial', () => {
  test('el enlace "Búsqueda especial" está solo en el footer de index y landing', () => {
    for (const f of ['index.html', 'landing.html']) {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const start = html.indexOf('<footer>');
      const footer = html.slice(start, html.indexOf('</footer>', start));
      expect(footer).toContain('href="/busqueda-especial/"');
      expect(html.split('href="/busqueda-especial/"').length - 1).toBe(1);
    }
  });

  test('cada página de combinación lista al menos 3 avisos y tiene JSON-LD válido', () => {
    for (const s of searchSlugs.filter(x => !x.startsWith('precio-m2-'))) {
      const html = fs.readFileSync(path.join(SEARCH, s, 'index.html'), 'utf8');
      expect(html).toContain(`<link rel="canonical" href="https://recosac.com/busqueda-especial/${s}/"/>`);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
      const page = ld['@graph'].find(n => n['@type'] === 'CollectionPage');
      expect(page.mainEntity.numberOfItems).toBeGreaterThanOrEqual(3);
    }
  });

  test('el sitemap incluye el buscador y todas las páginas de búsqueda', () => {
    const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('https://recosac.com/busqueda-especial/</loc>');
    for (const s of searchSlugs) expect(sitemap).toContain(`https://recosac.com/busqueda-especial/${s}/`);
  });

  test('el buscador filtra por distrito, tipo y m²', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:3123/busqueda-especial/');
    await page.selectOption('select[name="t"]', 'Departamento');
    await page.selectOption('select[name="d"]', 'Miraflores');
    await page.fill('input[name="amin"]', '60');
    await page.fill('input[name="amax"]', '120');
    await page.click('#bsForm button');
    await expect(page.locator('#bsRes h2')).toHaveText(/\d+ resultados?/);
    const metas = await page.locator('#bsRes .related small').allTextContents();
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) {
      expect(m).toContain('Miraflores');
      const area = parseFloat(m.match(/([\d.]+) m²/)[1]);
      expect(area).toBeGreaterThanOrEqual(60);
      expect(area).toBeLessThanOrEqual(120);
    }
    expect(page.url()).toContain('d=Miraflores');
    expect(errors).toEqual([]);
  });
});
