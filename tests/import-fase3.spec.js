// Fase 3 de carga inteligente en la web: Mi cuenta → Integraciones
// (conexiones automáticas, correo para publicar y API) y el estado "Retirada"
// en Mis publicaciones. Las Cloud Functions se simulan.
const { test, expect } = require('@playwright/test');
const { setupImportPage } = require('./helpers/browser-stubs');

const calls = (page, name) => page.evaluate((n) => __calls.filter(c => c.name === n).map(c => c.data), name);
const SRC = { id: 'S1', kind: 'feed', nombre: 'Mi CRM', url: 'https://crm.example.com/feed.xml', modo: 'borradores', cadaHoras: 6, estado: 'activa',
  total: 2, lastRunAt: Date.now() - 3600e3, lastResult: { total: 2, borradores: 2, nuevos: 0, actualizados: 0, retirados: 0 } };

async function abrirIntegraciones(page, fns) {
  await page.evaluate(([f, src]) => {
    window.__SRC = src;
    __fn.importSources = (d) => {
      if (d.action === 'list') return { sources: window.__sources || [] };
      if (d.action === 'preview') return { formato: 'kyero', total: 2, rutas: ['id', 'price', 'town', 'location_detail', 'type', 'surface_area.built', 'desc.es'],
        mapping: { id: 'id', precio: 'price', distrito: 'town', direccion: 'location_detail', tipo_propiedad: 'type', area_techada: 'surface_area.built', descripcion: 'desc.es' },
        muestra: [
          { extId: 'KY-1', row: { direccion: 'Av. Larco 1234', distrito: 'Miraflores', tipo_propiedad: 'Departamento', tipo_publicacion: 'Venta', tipo_moneda: 'USD', precio: '185000', area_techada: '90' }, fotos: 2, errores: [], avisos: [] },
          { extId: 'KY-2', row: { direccion: 'Km 40', distrito: 'Lurín', tipo_propiedad: 'Terreno', tipo_publicacion: 'Alquiler', tipo_moneda: 'PEN', precio: '1500', area_terreno: '1200' }, fotos: 0, errores: ['descripción vacía'], avisos: [] },
        ] };
      if (d.action === 'create') { window.__sources = [{ ...window.__SRC, nombre: d.nombre || 'el feed' }]; return { id: 'S1' }; }
      if (d.action === 'sync') return { result: { total: 2, borradores: 1, nuevos: 1, actualizados: 0, retirados: 0 } };
      return { ok: true, retiradas: 2 };
    };
    __fn.emailIngest = (d) => ({ disponible: true, address: d.action === 'rotate' ? 'buzon+nuevo12345@inbound.postmarkapp.com' : 'buzon+abc1234567@inbound.postmarkapp.com' });
    __fn.apiAccess = (d) => ({
      keys: d.action === 'createKey' ? [{ prefix: 'reco_live_AbCd', nombre: d.nombre, createdAt: Date.now(), lastUsedAt: null }] : [],
      ...(d.action === 'createKey' && { key: 'reco_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345' }),
      webhook: d.action === 'setWebhook' ? { url: d.url, secret: 'whsec_123', lastWebhook: null } : null,
      eventos: ['property.created', 'property.approved'],
    });
    Object.assign(__fn, f || {});
    closePublish();
    navigateUserSection('integraciones');
  }, [fns || null, SRC]);
  await expect(page.locator('#intSources')).toContainText(/Aún no tienes conexiones|Mi CRM/);
}

test.describe('Fase 3: Integraciones', () => {
  test.beforeEach(async ({ page }) => { await setupImportPage(page); });

  test('la carga masiva ofrece ir a Integraciones y el menú tiene la sección', async ({ page }) => {
    await expect(page.locator('#pubModal')).toContainText('Que se actualice solo');
    await page.evaluate(() => { __fn.importSources = () => ({ sources: [] }); __fn.emailIngest = () => ({ disponible: false }); __fn.apiAccess = () => ({ keys: [] }); });
    await page.locator('#pubModal button', { hasText: 'Ir a Integraciones' }).click();
    await expect(page.locator('#userSectionContent')).toContainText('🔌 Integraciones');
    expect(await page.evaluate(() => location.hash)).toBe('#integraciones');
    await expect(page.locator('#intEmail')).toContainText('Muy pronto');
    expect(await page.evaluate(() => document.documentElement.innerHTML.includes("navigateUserSection('integraciones')\">🔌 Integraciones"))).toBe(true);
  });

  test('conectar un feed: probar muestra la vista previa y el mapeo; conectar exige autorización y sincroniza', async ({ page }) => {
    await abrirIntegraciones(page);
    await page.locator('#intNew summary').click();
    await page.fill('#intUrl', 'https://crm.example.com/feed.xml');
    await page.fill('#intNombre', 'Mi CRM');
    await page.selectOption('#intHoras', '6');
    await page.locator('button', { hasText: 'Probar' }).click();
    await expect(page.locator('#intPreview')).toContainText('Encontramos 2 inmueble(s)');
    await expect(page.locator('#intPreview')).toContainText('Av. Larco 1234');
    await expect(page.locator('#intPreview')).toContainText('descripción vacía');
    const [prev] = await calls(page, 'importSources').then((c) => c.filter((x) => x.action === 'preview'));
    expect(prev).toMatchObject({ kind: 'feed', url: 'https://crm.example.com/feed.xml', cadaHoras: 6 });

    // Cambia una columna del mapeo.
    await page.locator('#intPreview summary').click();
    await page.locator('#intPreview label', { hasText: 'Título' }).locator('select').selectOption('desc.es');

    await page.locator('button', { hasText: 'Conectar y sincronizar' }).click();
    expect((await page.evaluate(() => __toasts)).join(' ')).toContain('autorización');
    await page.check('#intAuth');
    await page.locator('button', { hasText: 'Conectar y sincronizar' }).click();
    await expect(page.locator('#intSources')).toContainText('Mi CRM');
    const cs = await calls(page, 'importSources');
    const create = cs.find((c) => c.action === 'create');
    expect(create).toMatchObject({ kind: 'feed', nombre: 'Mi CRM', cadaHoras: 6, modo: 'borradores' });
    expect(create.mapping).toMatchObject({ precio: 'price', titulo: 'desc.es' });
    expect(cs.some((c) => c.action === 'sync' && c.id === 'S1')).toBe(true);
    expect((await page.evaluate(() => __toasts)).join(' ')).toContain('1 publicada(s) · 1 borrador(es) nuevo(s)');
  });

  test('EasyBroker y Wasi piden sus credenciales', async ({ page }) => {
    await abrirIntegraciones(page);
    await page.locator('#intNew summary').click();
    await page.locator('#intNew button', { hasText: 'EasyBroker' }).click();
    await page.fill('#intApiKey', 'eb_clave_123456');
    await page.locator('button', { hasText: 'Probar' }).click();
    await page.locator('#intNew button', { hasText: 'Wasi' }).click();
    await page.fill('#intIdCompany', '123');
    await page.fill('#intWasiToken', 'tok_abcdef');
    await page.locator('button', { hasText: 'Probar' }).click();
    const prev = (await calls(page, 'importSources')).filter((c) => c.action === 'preview');
    expect(prev[0]).toMatchObject({ kind: 'easybroker', credenciales: { apiKey: 'eb_clave_123456' } });
    expect(prev[1]).toMatchObject({ kind: 'wasi', credenciales: { idCompany: '123', wasiToken: 'tok_abcdef' } });
  });

  test('una conexión existente: sincronizar, pausar, frecuencia y eliminar retirando', async ({ page }) => {
    await page.evaluate((s) => { window.__sources = [{ ...s, ultimoError: null, lastResult: { ...s.lastResult, aviso: 'El feed llegó vacío: no retiramos nada.' } }]; }, SRC);
    await abrirIntegraciones(page);
    await expect(page.locator('#intSources')).toContainText('2 inmueble(s) · 2 borrador(es) nuevo(s)');
    await expect(page.locator('#intSources')).toContainText('llegó vacío');
    await page.locator('#intSources button', { hasText: 'Sincronizar ahora' }).click();
    await page.locator('#intSources button', { hasText: 'Pausar' }).click();
    await page.locator('#intSources select').first().selectOption('12');
    page.on('dialog', (d) => d.accept());
    await page.locator('#intSources button', { hasText: 'Eliminar' }).click();
    await expect.poll(async () => (await calls(page, 'importSources')).map((c) => c.action).join(',')).toContain('delete');
    const cs = await calls(page, 'importSources');
    expect(cs.find((c) => c.action === 'update' && c.estado)).toMatchObject({ id: 'S1', estado: 'pausada' });
    expect(cs.find((c) => c.action === 'update' && c.cadaHoras)).toMatchObject({ cadaHoras: 12 });
    expect(cs.find((c) => c.action === 'delete')).toMatchObject({ id: 'S1', retirar: true });
  });

  test('correo para publicar y API: dirección, clave mostrada una vez y webhook', async ({ page }) => {
    await abrirIntegraciones(page);
    await expect(page.locator('#intEmailAddr')).toHaveText('buzon+abc1234567@inbound.postmarkapp.com');
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Mi CRM' : undefined));
    await page.locator('#intEmail button', { hasText: 'Cambiar dirección' }).click();
    await expect(page.locator('#intEmailAddr')).toHaveText('buzon+nuevo12345@inbound.postmarkapp.com');

    await expect(page.locator('#intApi')).toContainText('cloudfunctions.net/api');
    await page.locator('#intApi button', { hasText: 'Crear clave' }).click();
    await expect(page.locator('#intKeyVal')).toHaveText('reco_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    await page.fill('#intWh', 'https://crm.example.com/hook');
    await page.locator('#intApi button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#intWhSecret')).toHaveText('whsec_123');
    const acc = await calls(page, 'apiAccess');
    expect(acc.find((c) => c.action === 'createKey')).toMatchObject({ nombre: 'Mi CRM' });
    expect(acc.find((c) => c.action === 'setWebhook')).toMatchObject({ url: 'https://crm.example.com/hook' });
  });

  test('Mis publicaciones: retirada por la sincronización y origen de la conexión', async ({ page }) => {
    const html = await page.evaluate(() => ({
      badge: _pubStatusBadge('withdrawn'),
      detail: _pubStatusDetail({ status: 'withdrawn', withdrawnBy: 'sync', withdrawnReason: 'Ya no está en Mi CRM.', syncSourceId: 'S1', syncSourceName: 'Mi CRM' }),
      aprobada: _pubStatusDetail({ status: 'approved', syncSourceId: 'S1', syncSourceName: 'Mi CRM', syncError: 'descripción vacía' }),
      api: _pubStatusDetail({ status: 'pending', source: 'api' }),
    }));
    expect(html.badge).toContain('Retirada');
    expect(html.detail).toContain('Ya no está en Mi CRM.');
    expect(html.detail).toContain('la restauramos sola');
    expect(html.aprobada).toContain('Se actualiza sola desde Mi CRM');
    expect(html.aprobada).toContain('Último cambio no aplicado: descripción vacía');
    expect(html.api).toContain('Publicada con la API');
    expect(html.aprobada.endsWith('</div>')).toBe(true);
  });
});
