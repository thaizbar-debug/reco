// Embudo de publicación: trackPublish guarda pasos con límite por hora y
// publishStats (solo admin) los resume junto con las importaciones.
const { test, expect } = require('@playwright/test');
const { loadFunctions, req } = require('./helpers/mock-functions');

const admin = (data) => { const r = req('adm', data); r.auth.token.admin = true; return r; };
const hace = (min) => ({ toMillis: () => Date.now() - min * 60e3 });

test.describe('Métricas del embudo de publicación', () => {
  test('trackPublish guarda el paso, limpia los datos y rechaza pasos desconocidos', async () => {
    const F = loadFunctions();
    const h = F.exports.trackPublish.__handler;
    expect(await h(req('u1', { paso: 'importado', canal: 'text<script>', n: 9999, conNota: true, email: 'x@y.z' }))).toEqual({ ok: true });
    const ev = Object.entries(F.db.store).filter(([k]) => k.startsWith('importEvents/')).map(([, v]) => v);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ uid: 'u1', kind: 'embudo', paso: 'importado', channel: 'textscript', listings: 500, conNota: true });
    expect(ev[0].email).toBeUndefined();
    await expect(h(req('u1', { paso: 'hackear' }))).rejects.toThrow('paso inválido');
    await expect(h({ ...req('u1', { paso: 'inicio' }), auth: null })).rejects.toThrow();
  });

  test('trackPublish: más de 120 por hora se ignoran sin error', async () => {
    const F = loadFunctions();
    const h = F.exports.trackPublish.__handler;
    F.db.store['trackLimits/u1'] = { hora: new Date().toISOString().slice(0, 13), n: 120 };
    expect(await h(req('u1', { paso: 'inicio' }))).toEqual({ ok: false });
    expect(Object.keys(F.db.store).filter((k) => k.startsWith('importEvents/'))).toHaveLength(0);
  });

  test('publishStats: embudo por usuarios, canales, respaldo y sitios bloqueados; solo admin', async () => {
    const F = loadFunctions();
    const put = (id, v) => { F.db.store[`importEvents/${id}`] = { createdAt: hace(10), ...v }; };
    put('a', { uid: 'u1', kind: 'embudo', paso: 'inicio' });
    put('b', { uid: 'u2', kind: 'embudo', paso: 'inicio' });
    put('c', { uid: 'u2', kind: 'embudo', paso: 'inicio' });
    put('d', { uid: 'u1', kind: 'embudo', paso: 'publicado' });
    put('e', { uid: 'u1', kind: 'text', channel: 'text', listings: 2, ms: 3000, modelo: 'h', respaldo: false });
    put('f', { uid: 'u2', kind: 'url', channel: 'url', listings: 0, ms: 5000, modelo: 'h', respaldo: true });
    put('g', { uid: 'u2', kind: 'bloqueado', channel: 'url', host: 'portal.pe' });
    F.db.store['importEvents/viejo'] = { uid: 'u3', kind: 'embudo', paso: 'inicio', createdAt: hace(60 * 24 * 40) };

    await expect(F.exports.publishStats.__handler(req('u1', {}))).rejects.toThrow('Solo un admin');
    const r = await F.exports.publishStats.__handler(admin({ dias: 30 }));
    expect(r.total).toBe(7);
    expect(r.embudo.find((x) => x.paso === 'inicio')).toEqual({ paso: 'inicio', eventos: 3, usuarios: 2 });
    expect(r.conversionPct).toBe(50);
    expect(r.respaldoPct).toBe(50);
    expect(r.canales).toEqual(expect.arrayContaining([
      { canal: 'text', veces: 1, inmuebles: 2, vaciasPct: 0, msPromedio: 3000 },
      { canal: 'url', veces: 1, inmuebles: 0, vaciasPct: 100, msPromedio: 5000 },
    ]));
    expect(r.bloqueados).toEqual([{ host: 'portal.pe', veces: 1 }]);
  });
});
