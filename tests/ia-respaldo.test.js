/**
 * IA con respaldo en la misma llamada: cada pedido va primero a Claude Haiku
 * y, si falla por cualquier motivo, se repite con Claude Sonnet sin que el
 * usuario tenga que reintentar. Handlers REALES con la red simulada.
 */
const { test, expect } = require('@playwright/test');
const { loadFunctions, req, mockFetch, claude, CLAUDE_URL } = require('./helpers/mock-functions');

const TEXTO = 'Vendo departamento en Surco, 3 dormitorios, 2 baños, 90 m2, US$ 185 mil. Edificio con ascensor y cochera, cerca al parque. '
  + 'Excelente iluminación, cocina equipada, terma, área de lavandería y depósito. Ideal para familia. Listo para mudarse, papeles en regla.';
function aiItem(over) {
  const R = require('../functions/shared/import-core');
  const it = {};
  R.AI_FIELDS.forEach((k) => { it[k] = null; });
  return Object.assign(it, { campos_inferidos: [], fotos: [], evidencia: null }, over);
}
const DEPA = { inmuebles: [aiItem({ distrito: 'Surco', tipo_publicacion: 'Venta', tipo_propiedad: 'Departamento', precio: 'US$ 185 mil',
  area_techada: '90 m2', nro_dormitorios: '3', titulo: 'Depa en Surco', descripcion: 'Vendo departamento en Surco' })] };

// Red: la IA responde según el modelo pedido.
function ia(porModelo) {
  const pedidos = [];
  mockFetch([[CLAUDE_URL, (u, init) => {
    const body = JSON.parse(init.body);
    pedidos.push(body.model);
    const r = porModelo[body.model];
    return typeof r === 'function' ? r(body) : r;
  }]]);
  return pedidos;
}
const extraer = (F) => F.exports.extractListings.__handler(req('u1', { kind: 'text', text: TEXTO }));
const evento = (F) => Object.values(F.db.store).find((x) => x.kind === 'text' && x.channel);

test.describe('IA: Haiku y, si falla, Sonnet en la misma llamada', () => {
  test('si Haiku responde bien, no se llama a Sonnet', async () => {
    const F = loadFunctions();
    const pedidos = ia({ 'claude-haiku-5-5': claude(DEPA) });
    const res = await extraer(F);
    expect(pedidos).toEqual(['claude-haiku-5-5']);
    expect(res.drafts).toHaveLength(1);
    expect(evento(F)).toMatchObject({ modelo: 'claude-haiku-5-5', respaldo: false });
  });

  for (const [caso, falla] of [
    ['la API de Haiku falla (sobrecarga)', () => claude(null, { status: 529 })],
    ['Haiku rechaza el pedido', () => claude('', { stop_reason: 'refusal' })],
    ['Haiku devuelve JSON inválido', () => claude('{"inmuebles": [')],
    ['Haiku no encuentra ningún inmueble en un texto con contenido', () => claude({ inmuebles: [] })],
  ]) {
    test(`${caso} → Sonnet lo resuelve y el usuario recibe el resultado`, async () => {
      const F = loadFunctions();
      const pedidos = ia({ 'claude-haiku-5-5': falla, 'claude-sonnet-5-5': () => claude(DEPA, { model: 'claude-sonnet-5-5' }) });
      const res = await extraer(F);
      expect(pedidos).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']); // sin reintentos con Haiku: Sonnet de inmediato
      expect(res.drafts[0].row).toMatchObject({ distrito: 'Santiago de Surco', precio: '185000' });
      expect(evento(F)).toMatchObject({ modelo: 'claude-sonnet-5-5', respaldo: true });
      expect(F.db.store['importUsage/u1'].count).toBe(1); // una sola importación para el límite por hora
    });
  }

  test('si ninguno encuentra inmuebles, el resultado vacío es real (sin error)', async () => {
    const F = loadFunctions();
    const pedidos = ia({ 'claude-haiku-5-5': () => claude({ inmuebles: [] }), 'claude-sonnet-5-5': () => claude({ inmuebles: [] }) });
    const res = await extraer(F);
    expect(pedidos).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(res.drafts).toEqual([]);
  });

  test('si los dos fallan, error claro; un texto corto sin inmuebles no gasta el respaldo', async () => {
    const F = loadFunctions();
    ia({ 'claude-haiku-5-5': () => claude(null, { status: 529 }), 'claude-sonnet-5-5': () => claude(null, { status: 529 }) });
    await expect(extraer(F)).rejects.toMatchObject({ code: 'internal', message: 'No pudimos leer el texto. Intenta de nuevo.' });
    const pedidos = ia({ 'claude-haiku-5-5': () => claude({ inmuebles: [] }) });
    const res = await F.exports.extractListings.__handler(req('u2', { kind: 'text', text: 'hola, ¿cómo estás?' }));
    expect(pedidos).toEqual(['claude-haiku-5-5']);
    expect(res.drafts).toEqual([]);
  });

  test('los modelos se cambian con AI_MODEL y AI_FALLBACK_MODEL; también aplica a Redactar con IA y a fotos', async () => {
    const F = loadFunctions({ secrets: { AI_MODEL: 'claude-sonnet-5-5', AI_FALLBACK_MODEL: 'claude-opus-5-5' } });
    const pedidos = ia({ 'claude-sonnet-5-5': () => claude({ titulo: '', descripcion: '' }), 'claude-opus-5-5': () => claude({ titulo: 'Depa en Surco', descripcion: 'Texto' }) });
    const r = await F.exports.generateListingCopy.__handler(req('u1', { district: 'Surco', area: 90 }));
    expect(pedidos).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']); // texto vacío → respaldo
    expect(r).toEqual({ titulo: 'Depa en Surco', descripcion: 'Texto' });

    const G = loadFunctions();
    const foto = 'data:image/jpeg;base64,' + Buffer.alloc(300, 1).toString('base64');
    const f = (i, ambiente) => ({ indice: i, ambiente, calidad: 4, marca_agua: false, texto: false, personas: false });
    const p2 = ia({ 'claude-haiku-5-5': () => claude(null, { status: 500 }), 'claude-sonnet-5-5': () => claude({ portada: 1, fotos: [f(0, 'cocina'), f(1, 'sala')] }) });
    const fotos = await G.exports.analyzePhotos.__handler(req('u1', { photos: [foto, foto] }));
    expect(p2).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(fotos.portada).toBe(1);
  });
});
