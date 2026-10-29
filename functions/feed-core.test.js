// Tests del núcleo de sincronización (lógica pura). Sin framework: node functions/feed-core.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const F = require('./feed-core');
const Catalogo = require('./shared/catalogo');

const fixture = (f) => fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'feeds', f), 'utf8');
const entries = (text) => {
  const p = F.parseFeed(text);
  const map = F.guessMapping(F.pathsOf(p.items), p.items);
  return { formato: p.formato, map, list: p.items.map((it) => F.itemToEntry(it, map)) };
};

console.log('  parseXml / xmlToObj');
const obj = F.xmlToObj(F.parseXml('<?xml version="1.0"?><!-- c --><a x="1"><b>uno &amp; dos</b><b><![CDATA[<i>tres</i>]]></b><g:price>10</g:price><c/></a>'));
assert.deepStrictEqual(obj.a.b, ['uno & dos', '<i>tres</i>']);
assert.strictEqual(obj.a['@x'], '1');
assert.strictEqual(obj.a.price, '10');
// Tolerante: etiquetas sin cerrar no rompen el resto.
const roto = F.xmlToObj(F.parseXml('<r><p><id>1</id><br></p><p><id>2</id></p></r>'));
assert.ok(JSON.stringify(roto).includes('"2"'));
assert.strictEqual(F.decodeEntities('&aacute;rea &#233; &#x41;'), 'área é A');

console.log('  parseCsv / aoaToItems');
assert.deepStrictEqual(F.parseCsv('a;b\n"x;1";"di ""y"""\r\n'), [['a', 'b'], ['x;1', 'di "y"']]);
assert.deepStrictEqual(F.parseCsv('Título\na,b,c\n1,2,3')[1], ['a', 'b', 'c']);
const tabla = F.aoaToItems([['Mi inventario'], ['Precio', 'Distrito', 'Precio', ''], ['100', 'Lince', '200', 'x'], ['Precio', 'Distrito', 'Precio', '']]);
assert.deepStrictEqual(tabla, [{ Precio: '100', Distrito: 'Lince', 'Precio (2)': '200', 'Columna 4': 'x' }]);

console.log('  findItems');
assert.strictEqual(F.findItems([{ a: 1 }, 2]).length, 1);
assert.strictEqual(F.findItems({ pagination: { page: 1 }, content: [{ id: 1, fotos: [{ u: 1 }, { u: 2 }, { u: 3 }] }, { id: 2 }] }).length, 2);
assert.strictEqual(F.findItems({ 0: { id_property: 1 }, 1: { id_property: 2 }, total: 2, status: 'success' }).length, 2);
assert.strictEqual(F.findItems({ root: { property: { id: 'x', price: 1, town: 'Lince' } } }).length, 1, 'un solo inmueble');
assert.deepStrictEqual(F.findItems({ status: 'ok' }), []);

console.log('  Kyero (XML)');
const ky = entries(fixture('kyero.xml'));
assert.strictEqual(ky.formato, 'kyero');
assert.strictEqual(ky.map.area_terreno, 'surface_area.plot');
assert.strictEqual(ky.map.area_techada, 'surface_area.built');
assert.strictEqual(ky.map.descripcion, 'desc.es', 'la descripción en español gana');
assert.deepStrictEqual(ky.list.map((e) => e.extId), ['KY-1001', 'KY-1002']);
const k1 = F.prepareRow(ky.list[0].row).row;
assert.strictEqual(k1.tipo_propiedad, 'Departamento');
assert.strictEqual(k1.tipo_publicacion, 'Venta');
assert.strictEqual(k1.distrito, 'Miraflores');
assert.strictEqual(k1.descripcion, 'Departamento con vista al mar.\nCerca al parque Kennedy.');
assert.strictEqual(k1.etiquetas_generales, 'Terraza propia');
assert.strictEqual(k1.ascensor, 'Sí', '"Ascensor" en características → campo ascensor');
assert.strictEqual(k1.titulo, 'Departamento en venta en Miraflores · 3 dorm. · 90 m²');
assert.deepStrictEqual(ky.list[0].photos, ['https://cdn.example.com/ky/1001-1.jpg', 'https://cdn.example.com/ky/1001-2.jpg']);
const k2 = F.prepareRow(ky.list[1].row).row;
assert.strictEqual(k2.tipo_publicacion, 'Alquiler', 'price_freq month → Alquiler');
assert.strictEqual(k2.tipo_propiedad, 'Terreno');
assert.strictEqual(k2.descripcion, 'Terreno plano & con acceso por pista.');
const pubK2 = F.rowToPub(k2);
assert.deepStrictEqual(Catalogo.verificarPublicacion(pubK2).errores, [], 'Terreno sin área techada se puede publicar');

console.log('  JSON genérico');
const js = entries(fixture('generico.json'));
assert.strictEqual(js.map.id, 'codigo');
assert.strictEqual(js.map.direccion, 'ubicacion.direccion');
assert.deepStrictEqual(js.map.fotos, ['fotos.url']);
const j1 = F.prepareRow(js.list[0].row).row;
assert.strictEqual(j1.precio, '420000');
assert.strictEqual(j1.tipo_moneda, 'USD', 'moneda tomada del precio');
assert.strictEqual(j1.area_techada, '280');
assert.strictEqual(j1.latitud, '-12.08');
const j2 = F.prepareRow(js.list[1].row).row;
assert.strictEqual(j2.tipo_moneda, 'PEN');
assert.strictEqual(j2.precio, '6500');

console.log('  Google Sheets (CSV con título arriba)');
const sh = entries(fixture('sheet.csv'));
assert.strictEqual(sh.formato, 'csv');
assert.strictEqual(sh.list.length, 2);
assert.strictEqual(sh.list[1].row.direccion, 'Av. Benavides 3400, piso 8');
const s1 = F.prepareRow(sh.list[0].row).row;
assert.strictEqual(s1.tipo_propiedad, 'Departamento');
assert.strictEqual(s1.tipo_publicacion, 'Venta');
assert.deepStrictEqual(sh.list[0].photos, ['https://cdn.example.com/s/1.jpg']);
assert.deepStrictEqual(Catalogo.verificarPublicacion(F.rowToPub(s1)).errores, ['descripción vacía'], 'sin descripción: queda como borrador');

console.log('  sheetCsvUrl');
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
assert.strictEqual(F.sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=42`), `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=42`);
assert.strictEqual(F.sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`), `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`);
assert.strictEqual(F.sheetCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vQabc/pubhtml?gid=7'), 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQabc/pub?output=csv&gid=7');
assert.strictEqual(F.sheetCsvUrl('https://example.com/spreadsheets/d/x'), null);
assert.strictEqual(F.sheetCsvUrl('no es url'), null);

console.log('  EasyBroker');
const eb = F.easyBrokerToEntry({
  public_id: 'EB-AB123', title: 'Departamento en Barranco', property_type: 'Departamento',
  location: { name: 'Barranco, Lima, Lima', street: 'Jr. Domeyer', exterior_number: '210', latitude: -12.15, longitude: -77.02 },
  operations: [{ type: 'rental', amount: 2500, currency: 'PEN' }, { type: 'sale', amount: 250000, currency: 'USD' }],
  bedrooms: 2, bathrooms: 2, parking_spaces: 1, construction_size: 95.5, lot_size: null,
  description: '<p>Vista al mar</p>', features: [{ name: 'Ascensor' }, { name: 'Gimnasio' }],
  property_images: [{ url: 'https://assets.easybroker.com/1.jpg' }, { url: 'https://assets.easybroker.com/2.jpg' }],
});
assert.strictEqual(eb.extId, 'EB-AB123');
const ebRow = F.prepareRow(eb.row).row;
assert.strictEqual(ebRow.tipo_publicacion, 'Venta', 'si tiene venta y alquiler, gana la venta');
assert.strictEqual(ebRow.precio, '250000');
assert.strictEqual(ebRow.direccion, 'Jr. Domeyer 210');
assert.strictEqual(ebRow.distrito, 'Barranco');
assert.strictEqual(ebRow.area_techada, '95.5');
assert.strictEqual(ebRow.etiquetas_ambientes, 'Gimnasio', 'Gimnasio pasa a ambientes');
assert.strictEqual(ebRow.ascensor, 'Sí');
assert.strictEqual(eb.photos.length, 2);
assert.deepStrictEqual(Catalogo.verificarPublicacion(F.rowToPub(ebRow)).errores, []);
const ebLista = F.easyBrokerToEntry({ public_id: 'EB-2', location: 'Miraflores, Lima, Lima', title_image_full: 'https://assets.easybroker.com/t.jpg', operations: [] });
assert.strictEqual(ebLista.row.distrito, 'Miraflores');
assert.deepStrictEqual(ebLista.photos, ['https://assets.easybroker.com/t.jpg']);

console.log('  Wasi');
const wa = F.wasiToEntry({
  id_property: 998877, title: 'Casa en Chorrillos', id_property_type: 1, for_sale: 'true', for_rent: 'false',
  sale_price: '310000', rent_price: '0', iso_currency: 'USD', address: 'Calle Los Cedros 456', zone_label: 'Chorrillos',
  city_label: 'Lima', region_label: 'Lima', area: '200', built_area: '180', bedrooms: '4', bathrooms: '3', garages: '2',
  observations: 'Casa con jardín', building_date: '2010',
  main_image: { url_big: 'https://images.wasi.co/1.jpg' }, galleries: [{ 0: { url_big: 'https://images.wasi.co/2.jpg' }, id: 5 }],
});
assert.strictEqual(wa.extId, '998877');
const waRow = F.prepareRow(wa.row).row;
assert.strictEqual(waRow.tipo_propiedad, 'Casa');
assert.strictEqual(waRow.tipo_publicacion, 'Venta');
assert.strictEqual(waRow.precio, '310000');
assert.strictEqual(waRow.area_techada, '180');
assert.strictEqual(waRow.area_terreno, '200');
assert.strictEqual(waRow.distrito, 'Chorrillos');
assert.deepStrictEqual(wa.photos, ['https://images.wasi.co/1.jpg', 'https://images.wasi.co/2.jpg']);
const waLote = F.prepareRow(F.wasiToEntry({ id_property: 1, id_property_type: 5, for_rent: true, rent_price: 900, area: 500, built_area: 0 }).row).row;
assert.strictEqual(waLote.tipo_propiedad, 'Terreno');
assert.strictEqual(waLote.tipo_publicacion, 'Alquiler');
assert.strictEqual(waLote.area_terreno, '500');

console.log('  rowToPub / contentHash / cambios');
const pub = F.rowToPub({ ...F.prepareRow({ tipo_propiedad: 'Dpto', tipo_publicacion: 'Vta', niveles: '2', mostrar_direccion: 'No',
  etiquetas_generales: 'ascensor; terraza; nave espacial', estado: 'En planos', antiguedad: '5' }).row });
assert.strictEqual(pub.type, 'Departamento');
assert.strictEqual(pub.unitFloors, 2);
assert.ok(pub.features.includes('Dúplex') && pub.features.includes('Terraza propia'));
assert.strictEqual(pub.ascensor, true);
assert.ok(!pub.features.some((f) => /nave/i.test(f)), 'etiquetas no reconocidas no se publican');
assert.strictEqual(pub.hideExact, true);
assert.strictEqual(pub.estado, 'En proyecto');
assert.strictEqual(pub.age, 0, 'En proyecto → antigüedad 0');
const base = { title: 'Depa', desc: 'x', price: 100000, beds: 2, address: 'A 1', district: 'Lince', type: 'Departamento', op: 'Venta', currency: 'USD' };
assert.strictEqual(F.contentHash(base, ['a']), F.contentHash({ ...base }, ['a']));
assert.notStrictEqual(F.contentHash(base, ['a']), F.contentHash(base, ['b']));
assert.deepStrictEqual(F.cambios(base, { ...base, price: 95000 }), { changed: ['price'], revisar: false });
assert.strictEqual(F.cambios(base, { ...base, price: 30000 }).revisar, true, 'precio -70 % vuelve a revisión');
assert.strictEqual(F.cambios(base, { ...base, desc: 'otra' }).revisar, true);
assert.strictEqual(F.cambios(base, { ...base, beds: 3 }).revisar, false);
assert.ok(/^k-[0-9a-f]{16}$/.test(F.syntheticId({ direccion: 'Av. Arequipa 100', distrito: 'Lince' })));
assert.strictEqual(F.syntheticId({ direccion: 'Av. Arequipa 100', distrito: 'Lince', precio: '1' }), F.syntheticId({ direccion: 'av arequipa 100', distrito: 'LINCE', precio: '2' }));

console.log('  sinónimos en inglés del catálogo');
assert.strictEqual(Catalogo.matchType('apartment'), 'Departamento');
assert.strictEqual(Catalogo.matchType('House'), 'Casa');
assert.strictEqual(Catalogo.matchType('plot'), 'Terreno');
assert.strictEqual(Catalogo.matchType('Commercial'), 'Local comercial');
assert.strictEqual(Catalogo.matchType('Warehouse'), 'Otros');

console.log('\n  ✓ feed-core: todos los tests pasaron');
