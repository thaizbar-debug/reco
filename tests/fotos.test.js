/**
 * Fotos de publicaciones — handlers REALES (functions/index.js) con Firebase
 * en memoria: borrar las fotos al eliminar una publicación y editar las fotos
 * de una publicación ya enviada.
 */
const { test, expect } = require('@playwright/test');
const { loadFunctions, req, mockFetch } = require('./helpers/mock-functions');

const BUCKET = 'reco-test.appspot.com';
const url = (path) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=t`;
const pubWith = (F, id, data) => { F.db.store[`publications/${id}`] = { userId: 'u1', status: 'approved', ...data }; };
const archivos = (F, paths) => paths.forEach((p) => { F.bucket.files[p] = { buf: Buffer.from('x') }; });

test.describe('Fotos de publicaciones (servidor)', () => {
  test('al eliminar una publicación se borran todas sus fotos (y solo las suyas)', async () => {
    const F = loadFunctions();
    archivos(F, ['publications/P1/u1/0.jpg', 'publications/P1/u1/t0.jpg', 'publications/P1/0.jpg', 'publications/P10/u1/0.jpg', 'imports/u1/x/1.jpg']);
    await F.exports.cleanupPublicationPhotos.__handler({ params: { pubId: 'P1' } });
    expect(Object.keys(F.bucket.files).sort()).toEqual(['imports/u1/x/1.jpg', 'publications/P10/u1/0.jpg']);
    await F.exports.cleanupPublicationPhotos.__handler({ params: { pubId: '../imports' } }); // id inválido: nada
    expect(Object.keys(F.bucket.files)).toHaveLength(2);
  });

  test('editar fotos: ordenar o quitar mantiene la aprobación; agregar vuelve a revisión; se borran las quitadas', async () => {
    const F = loadFunctions();
    const up = F.exports.updatePublicationPhotos.__handler;
    const f = (n) => url(`publications/P1/u1/${n}.jpg`);
    const t = (n) => url(`publications/P1/u1/t${n}.jpg`);
    pubWith(F, 'P1', { photoUrls: [f(0), f(1), f(2)], thumbUrls: [t(0), t(1), t(2)] });
    archivos(F, ['publications/P1/u1/0.jpg', 'publications/P1/u1/1.jpg', 'publications/P1/u1/2.jpg', 'publications/P1/u1/t0.jpg', 'publications/P1/u1/t1.jpg', 'publications/P1/u1/t2.jpg']);

    // Otra persona no puede.
    await expect(up(req('u2', { pubId: 'P1', photoUrls: [] }))).rejects.toMatchObject({ code: 'not-found' });
    // URLs de otra publicación u otra carpeta: rechazadas.
    await expect(up(req('u1', { pubId: 'P1', photoUrls: [url('publications/P2/u1/0.jpg')] }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(up(req('u1', { pubId: 'P1', photoUrls: [url('publications/P1/u2/0.jpg')] }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(up(req('u1', { pubId: 'P1', photoUrls: ['https://otro.com/a.jpg'] }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(up(req('u1', { pubId: 'P1', photoUrls: [f(0), f(0)] }))).rejects.toMatchObject({ code: 'invalid-argument' });

    // Portada = la 3, se quita la 2: sigue aprobada y se borra la quitada.
    const r1 = await up(req('u1', { pubId: 'P1', photoUrls: [f(2), f(0)], thumbUrls: [t(2), t(0)] }));
    expect(r1).toMatchObject({ status: 'approved', removed: 2 });
    expect(F.db.store['publications/P1']).toMatchObject({ photoUrls: [f(2), f(0)], thumbUrls: [t(2), t(0)], status: 'approved', photosPending: false });
    expect(F.bucket.files['publications/P1/u1/1.jpg']).toBeUndefined();
    expect(F.bucket.files['publications/P1/u1/t1.jpg']).toBeUndefined();
    expect(F.bucket.files['publications/P1/u1/0.jpg']).toBeTruthy();

    // Foto nueva (subida por el dueño a su carpeta): vuelve a revisión.
    const r2 = await up(req('u1', { pubId: 'P1', photoUrls: [f(2), f(0), f(3)], thumbUrls: [t(2), t(0), t(3)] }));
    expect(r2.status).toBe('pending');
    expect(F.db.store['publications/P1'].status).toBe('pending');

    // Miniaturas que no corresponden: se ignoran (las tarjetas usan la foto).
    const r3 = await up(req('u1', { pubId: 'P1', photoUrls: [f(2), f(0), f(3)], thumbUrls: [t(2)] }));
    expect(r3.thumbUrls).toEqual([]);
    // Máximo 20.
    await expect(up(req('u1', { pubId: 'P1', photoUrls: Array.from({ length: 21 }, (_, i) => f(i)) }))).rejects.toThrow(/Máximo 20/);
  });

  test('las fotos que copió el servidor (p. ej. del bot) se pueden mantener y reordenar', async () => {
    const F = loadFunctions();
    const bot = url('publications/P3/u1/0.jpg');
    pubWith(F, 'P3', { status: 'pending', photoUrls: [bot], photosPending: true, photoError: '2 foto(s) no se subieron' });
    const r = await F.exports.updatePublicationPhotos.__handler(req('u1', { pubId: 'P3', photoUrls: [url('publications/P3/u1/1.jpg'), bot], thumbUrls: ['', ''] }));
    expect(r.status).toBe('pending');
    expect(F.db.store['publications/P3']).toMatchObject({ photosPending: false, photoError: null });
  });
});

test.describe('Fotos con IA (analyzePhotos)', () => {
  const foto = 'data:image/jpeg;base64,' + Buffer.alloc(300, 1).toString('base64');
  const respuesta = (fotos, portada) => ({ choices: [{ message: { content: JSON.stringify({ portada, fotos }) } }] });
  const f = (indice, ambiente, extra) => ({ indice, ambiente, calidad: 4, marca_agua: false, texto: false, personas: false, ...(extra || {}) });

  test('propone portada y orden, marca las fotos con marca de agua y cuenta en el límite por hora', async () => {
    const F = loadFunctions();
    const chats = [];
    mockFetch([['https://api.openai.com/v1/chat/completions', (u, init) => {
      chats.push(JSON.parse(init.body));
      return respuesta([f(0, 'bano'), f(1, 'fachada', { marca_agua: true }), f(2, 'sala'), f(3, 'plano')], 1);
    }]]);
    const r = await F.exports.analyzePhotos.__handler(req('u1', { photos: [foto, foto, foto, foto] }));
    expect(r.portada).toBe(2); // la fachada tiene marca de agua: la sala
    expect(r.orden).toEqual([2, 0, 1, 3]);
    expect(r.fotos[1]).toMatchObject({ ambiente: 'fachada', marcaAgua: true });
    const imgs = chats[0].messages[1].content.filter((x) => x.type === 'image_url');
    expect(imgs).toHaveLength(4);
    expect(imgs[0].image_url.detail).toBe('low');
    expect(chats[0].response_format.json_schema.name).toBe('fotos');
    expect(F.db.store['importUsage/u1'].count).toBe(1);
    expect(Object.values(F.db.store).some((x) => x.kind === 'fotos' && x.marcaAgua === 1)).toBe(true);
  });

  test('valida las fotos: tamaño, formato, mínimo 2 y solo fotos de publicaciones propias', async () => {
    const F = loadFunctions();
    mockFetch([['https://api.openai.com/', () => respuesta([f(0, 'sala'), f(1, 'cocina')], 0)]]);
    const an = F.exports.analyzePhotos.__handler;
    await expect(an(req('u1', { photos: [foto] }))).rejects.toThrow(/al menos 2/);
    await expect(an(req('u1', { photos: [foto, 'data:image/gif;base64,AAAA'] }))).rejects.toThrow(/no válida/);
    await expect(an(req('u1', { photos: [foto, 'data:image/jpeg;base64,' + 'A'.repeat(500 * 1024)] }))).rejects.toThrow(/no válida/);
    // Fotos ya subidas: se leen de Storage, solo si son de la publicación del usuario.
    const u0 = url('publications/P1/u1/0.jpg'), t1 = url('publications/P1/u1/t1.jpg');
    pubWith(F, 'P1', { photoUrls: [u0, url('publications/P1/u1/1.jpg')], thumbUrls: ['', t1] });
    archivos(F, ['publications/P1/u1/0.jpg', 'publications/P1/u1/t1.jpg']);
    await expect(an(req('u2', { pubId: 'P1', photos: [{ url: u0 }, { url: t1 }] }))).rejects.toMatchObject({ code: 'not-found' });
    await expect(an(req('u1', { pubId: 'P1', photos: [{ url: u0 }, { url: url('publications/P2/u1/0.jpg') }] }))).rejects.toThrow(/no válida/);
    const r = await an(req('u1', { pubId: 'P1', photos: [{ url: u0 }, { url: t1 }] }));
    expect(r.orden).toEqual([0, 1]);
  });
});
