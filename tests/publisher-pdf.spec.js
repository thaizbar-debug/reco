const { test, expect } = require('@playwright/test');

// Perfil del anunciante + Exportar PDF desde el detalle completo.
test.describe('Perfil del anunciante y ficha PDF', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
    // Espera la carga completa (incluye Firestore en CI), no solo el JSON.
    await page.waitForFunction(() => window.__recoDataReady === true, null, { timeout: 20000 });
  });

  test('GEO existe desde el inicio (no falla si se filtra mientras Firestore carga)', async ({ page }) => {
    await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => typeof GEO)).toBe('object');
  });

  test('_publisherOf: comunidad usa userId y nunca el email; inventario propio es Equipo Reco', async ({ page }) => {
    const r = await page.evaluate(() => [
      _publisherOf({ userId: 'u1', userName: 'Ana Pérez', userEmail: 'ana@x.com' }),
      _publisherOf({ userId: 'u2', userName: '', userEmail: 'secreto@x.com' }),
      _publisherOf({ id: '1-A' })
    ]);
    expect(r[0]).toEqual({ key: 'u1', name: 'Ana Pérez', isReco: false });
    expect(r[1].name).toBe('Anunciante');
    expect(JSON.stringify(r[1])).not.toContain('secreto');
    expect(r[2]).toEqual({ key: 'reco', name: 'Equipo Reco', isReco: true });
  });

  test('_agTrim descarta el 10% extremo con 10+ datos', async ({ page }) => {
    const v = await page.evaluate(() => _agTrim([1, 100, 100, 100, 100, 100, 100, 100, 100, 1e9]));
    expect(v).toBe(100);
  });

  test('el perfil lista solo Comprar/Alquilar y los filtros funcionan', async ({ page }) => {
    await page.evaluate(() => openPublisherProfile('reco'));
    await expect(page.locator('#agOverlay')).toHaveClass(/open/);
    await expect(page.locator('.ag-name')).toHaveText('Equipo Reco');
    // Misma regla que el buscador/portada: solo Comprar/Alquilar con fotos.
    const expected = await page.evaluate(() => properties.filter(p => p.op !== 'Histórico' && !p.userId && driveAssets(p).photos.length > 0).length);
    await expect(page.locator('#agCount')).toHaveText(`${expected} propiedades`);
    await page.click('#agOpSeg button[data-op="Alquiler"]');
    const nAlq = await page.evaluate(() => properties.filter(p => p.op === 'Alquiler' && !p.userId && driveAssets(p).photos.length > 0).length);
    await expect(page.locator('#agCount')).toContainText(`${nAlq} propiedades de ${expected}`);
    const ops = await page.$$eval('.ag-row .ag-op', els => [...new Set(els.map(e => e.textContent))]);
    expect(ops).toEqual(['Alquiler']);
  });

  test('el nombre del anunciante en el detalle abre su perfil', async ({ page }) => {
    const id = await page.evaluate(() => properties.find(p => p.op === 'Venta').id);
    await page.evaluate(id => openFullReport(id), id);
    await page.click('.fr-agent-link');
    await expect(page.locator('#agOverlay')).toHaveClass(/open/);
    expect(await page.evaluate(() => location.hash)).toBe('#anunciante=reco');
  });

  test('el tipo de cambio se carga del JSON del BCRP y convierte soles a dólares', async ({ page }) => {
    await page.waitForFunction(() => _TC.fecha === '2026-10-02' || _TC.fecha > '2026-10-02');
    const r = await page.evaluate(() => ({ tc: _TC.valor, usd: _agUsd({ cur: 'S/', price: _TC.valor * 1000 }) }));
    expect(r.tc).toBeGreaterThan(3);
    expect(r.tc).toBeLessThan(4.5);
    expect(Math.round(r.usd)).toBe(1000);
  });

  test('_tcApply: gana el TC con fecha más reciente y descarta valores absurdos', async ({ page }) => {
    const r = await page.evaluate(() => {
      _TC.valor = 3.437; _TC.fecha = '2026-10-02';
      _tcApply(3.70, '2025-08');           // más antiguo → se ignora
      const a = _TC.valor;
      _tcApply(34.5, '2026-10-05');        // fuera de rango → se ignora
      const b = _TC.valor;
      _tcApply(3.452, '2026-10-05');       // Firestore más reciente → gana
      return [a, b, _TC.valor, _TC.fecha];
    });
    expect(r).toEqual([3.437, 3.437, 3.452, '2026-10-05']);
  });

  test('los totales del perfil cuadran con los contadores de la portada', async ({ page }) => {
    const r = await page.evaluate(() => {
      const hasPhoto = p => driveAssets(p).photos.length > 0;
      const I = _agInsights(_publisherListings('reco'));
      return { nV: I.nV, nA: I.nA,
        landingV: properties.filter(p => p.op === 'Venta' && !p.userId && hasPhoto(p) && p.price > 0).length,
        landingA: properties.filter(p => p.op === 'Alquiler' && !p.userId && hasPhoto(p) && p.price > 0).length };
    });
    expect(r.nV).toBe(r.landingV);
    expect(r.nA).toBe(r.landingA);
  });

  test('Exportar PDF abre una ficha imprimible en una pestaña nueva', async ({ page, context }) => {
    const id = await page.evaluate(() => properties.find(p => p.op === 'Venta').id);
    await page.evaluate(id => openFullReport(id), id);
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.click('text=↗ Exportar PDF')
    ]);
    await popup.waitForLoadState('domcontentloaded');
    expect(await popup.title()).toMatch(/^Reco - /);
    await expect(popup.locator('h1')).toBeVisible();
    await expect(popup.getByRole('heading', { name: 'Características' })).toBeVisible();
  });
});

test.describe('Modo demo', () => {
  test('?demo=1 suma propiedades de prueba y muestra el aviso', async ({ page }) => {
    await page.goto('http://localhost:3123/?demo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__recoDataReady === true, null, { timeout: 20000 });
    await expect(page.locator('#demoBanner')).toBeVisible();
    await page.click('#demoBanner button[data-pub="demo-inmobiliaria-andina"]');
    await expect(page.locator('.ag-name')).toHaveText('Inmobiliaria Andina (demo)');
    await expect(page.locator('.ag-av')).toHaveText('IA');
    await expect(page.locator('#agCount')).toHaveText('12 propiedades');
  });

  test('una visita normal no carga datos de prueba', async ({ page }) => {
    await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
    // Espera la carga completa (incluye Firestore en CI), no solo el JSON.
    await page.waitForFunction(() => window.__recoDataReady === true, null, { timeout: 20000 });
    expect(await page.evaluate(() => properties.filter(p => p.id.startsWith('DEMO-')).length)).toBe(0);
    expect(await page.locator('#demoBanner').count()).toBe(0);
  });
});
