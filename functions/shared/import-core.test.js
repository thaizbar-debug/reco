// Tests del núcleo de importación. Sin framework: node functions/shared/import-core.test.js
'use strict';

const assert = require('assert');
const R = require('./import-core');

console.log('  COLS: mismo esquema que la plantilla (31 entradas)');
assert.strictEqual(R.COLS.length, 31);
assert.strictEqual(R.COLS[0], 'direccion');
assert.strictEqual(R.COLS[30], 'descripcion');
R.COLS.forEach(k => assert.ok(R.RESO_MAP[k], 'RESO_MAP sin ' + k));

console.log('  parseNumber: separadores y multiplicadores');
const nums = [
  ['185000', 185000], ['185,000', 185000], ['185.000', 185000], ['1.250.000', 1250000],
  ['1,250,000.50', 1250000.5], ['1.250.000,50', 1250000.5], ['185 000', 185000],
  ['85.5', 85.5], ['85,5', 85.5], ['185k', 185000], ['185 mil', 185000],
  ['1.2 millones', 1200000], ['1,2 MM', 1200000], ['US$ 185,000', 185000],
  ['S/ 450 mil', 450000], ['120 m2', 120], ['120m²', 120], ['', null], ['abc', null], [42, 42],
];
nums.forEach(([i, o]) => assert.strictEqual(R.parseNumber(i), o, 'parseNumber(' + JSON.stringify(i) + ')'));

console.log('  detectCurrency');
assert.strictEqual(R.detectCurrency('US$ 185,000'), 'USD');
assert.strictEqual(R.detectCurrency('$185k'), 'USD');
assert.strictEqual(R.detectCurrency('S/. 450 000'), 'PEN');
assert.strictEqual(R.detectCurrency('450 mil soles'), 'PEN');
assert.strictEqual(R.detectCurrency('185000'), '');

console.log('  parseCount');
assert.strictEqual(R.parseCount('3 dorm'), 3);
assert.strictEqual(R.parseCount('tres'), 3);
assert.strictEqual(R.parseCount('2.5'), 2);
assert.strictEqual(R.parseCount(''), null);

console.log('  matchDistrict');
assert.strictEqual(R.matchDistrict('miraflores'), 'Miraflores');
assert.strictEqual(R.matchDistrict('SAN ISIDRO'), 'San Isidro');
assert.strictEqual(R.matchDistrict('Surco'), 'Santiago de Surco');
assert.strictEqual(R.matchDistrict('SJL'), 'San Juan de Lurigancho');
assert.strictEqual(R.matchDistrict('Jesus Maria'), 'Jesús María');
assert.strictEqual(R.matchDistrict('San Juan de Miraflores'), 'San Juan de Miraflores');
assert.strictEqual(R.matchDistrict('Miraflores, Lima'), 'Miraflores');
assert.strictEqual(R.matchDistrict('Arequipa'), 'Arequipa');

console.log('  stripPII');
let p = R.stripPII('Lindo depa. Cel: 987 654 321, escribir a juan@mail.com o wa.me/51987654321');
assert.strictEqual(p.removed, 3);
assert.ok(!/987|@|wa\.me/.test(p.text), p.text);
p = R.stripPII('Llamar al +51 987-654-321');
assert.strictEqual(p.removed, 1);
p = R.stripPII('Precio S/ 950 000 000 negociable');
assert.strictEqual(p.removed, 0, 'no debe tocar montos');
p = R.stripPII('Sin datos personales');
assert.strictEqual(p.removed, 0);
assert.strictEqual(p.text, 'Sin datos personales');

console.log('  normalizeRow: limpia una fila "sucia"');
const dirty = {
  direccion: '  Av. Larco 1150  ', distrito: 'miraflores', tipo_publicacion: 'se vende',
  tipo_propiedad: 'dpto', precio: 'US$ 185,000', tipo_moneda: '', area_techada: '85 m2',
  nro_dormitorios: '3 dorm', nro_banos: 'dos', antiguedad: 'estreno', ascensor: 'si',
  titulo: 'Depa en Miraflores', descripcion: 'Bonito. Llamar al 987654321',
};
const n = R.normalizeRow(dirty);
assert.strictEqual(n.row.direccion, 'Av. Larco 1150');
assert.strictEqual(n.row.distrito, 'Miraflores');
assert.strictEqual(n.row.tipo_publicacion, 'Venta');
assert.strictEqual(n.row.tipo_propiedad, 'Departamento');
assert.strictEqual(n.row.precio, '185000');
assert.strictEqual(n.row.tipo_moneda, 'USD');
assert.strictEqual(n.row.area_techada, '85');
assert.strictEqual(n.row.nro_dormitorios, '3');
assert.strictEqual(n.row.nro_banos, '2');
assert.strictEqual(n.row.antiguedad, '0');
assert.strictEqual(n.row.ascensor, 'Sí');
assert.ok(!/987654321/.test(n.row.descripcion));
assert.ok(n.changes.some(c => c.field === 'descripcion' && c.pii === 1));
assert.strictEqual(Object.keys(n.row).length, 31);

console.log('  normalizeRow: año de construcción → antigüedad');
assert.strictEqual(R.normalizeRow({ antiguedad: '2015' }).row.antiguedad, String(new Date().getFullYear() - 2015));

console.log('  normalizeRow: usa el catálogo (abreviaturas, estado y antigüedad 0)');
const cat = R.normalizeRow({ tipo_propiedad: 'Of.', tipo_publicacion: 'Alq.', tipo_moneda: 'U$S', estado: 'E/C', antiguedad: '4', amoblado: 'x' });
assert.deepStrictEqual(
  [cat.row.tipo_propiedad, cat.row.tipo_publicacion, cat.row.tipo_moneda, cat.row.estado, cat.row.antiguedad, cat.row.amoblado],
  ['Oficina', 'Alquiler', 'USD', 'En construcción', '0', 'Sí']);
assert.ok(cat.notas.join(' ').includes('se publicará como 0'));
const fromAge = R.normalizeRow({ antiguedad: 'en planos' }).row;
assert.deepStrictEqual([fromAge.estado, fromAge.antiguedad], ['En proyecto', '0']);

console.log('  normalizeRow: idempotente y sin cambios sobre la fila de ejemplo de la plantilla');
const tpl = {
  direccion: 'Av. Larco 1150 Dpto 801', departamento: 'Lima', provincia: 'Lima', distrito: 'Miraflores',
  latitud: '-12.1195', longitud: '-77.0305', mostrar_direccion: 'Sí', tipo_publicacion: 'Venta',
  tipo_propiedad: 'Departamento', nro_dormitorios: '3', nro_banos: '2', nro_estacionamientos: '1',
  nro_pisos: '15', piso: '8', niveles: '2', antiguedad: '5', estado: 'Construido', ascensor: 'No',
  amoblado: 'No', pet_friendly: 'Sí', tipo_moneda: 'USD', precio: '185000', area_terreno: '0',
  area_techada: '85', etiquetas_generales: 'Piscina propia;Terraza propia',
  etiquetas_ambientes: 'Piscina del edificio;Gimnasio', etiquetas_vista: 'Vista a parque',
  etiquetas_acceso: 'Avenida', etiquetas_zonas: 'Residencial',
  titulo: 'Dúplex moderno con vista al parque', descripcion: 'Ubicado en el corazón de Miraflores.',
};
const t1 = R.normalizeRow(tpl);
assert.deepStrictEqual(t1.changes, [], JSON.stringify(t1.changes));
assert.deepStrictEqual(R.normalizeRow(t1.row).row, t1.row);
assert.deepStrictEqual(R.normalizeRow(n.row).row, n.row);

console.log('  fingerprint: fila y publicación coinciden');
const fpRow = R.fingerprint(n.row);
const fpPub = R.fingerprint({ district: 'Miraflores', op: 'Venta', type: 'Departamento', area: 85, price: 185000, beds: 3 });
assert.ok(fpRow);
assert.strictEqual(fpRow, fpPub);
assert.strictEqual(R.fingerprint({ distrito: 'Miraflores' }), '');
// Terreno: la huella usa el área de terreno (área principal), igual que la publicación
const fpTerr = R.fingerprint(R.normalizeRow({ distrito: 'Lurín', tipo_publicacion: 'Venta', tipo_propiedad: 'Lote', precio: '90000', area_terreno: '500' }).row);
assert.ok(fpTerr);
assert.strictEqual(fpTerr, R.fingerprint({ district: 'Lurín', op: 'Venta', type: 'Terreno', area: 500, price: 90000, beds: 0 }));

console.log('  guardInvented: vacía números que no están en el texto');
const src = 'Vendo depa en Surco, 3 dormitorios, 90 m2, precio 185 mil dólares';
const g = R.guardInvented({ precio: '185000', area_techada: '90', nro_dormitorios: '3', nro_banos: '2' }, src);
assert.strictEqual(g.row.precio, '185000');
assert.strictEqual(g.row.area_techada, '90');
assert.strictEqual(g.row.nro_dormitorios, '3');
assert.strictEqual(g.row.nro_banos, '');
assert.deepStrictEqual(g.dropped, ['nro_banos']);
assert.strictEqual(R.guardInvented({ nro_banos: 'dos' }, 'dos baños').row.nro_banos, 'dos');

console.log('  EXTRACTION_SCHEMA: válido para modo strict');
const item = R.EXTRACTION_SCHEMA.properties.inmuebles.items;
assert.strictEqual(item.additionalProperties, false);
assert.deepStrictEqual(item.required.slice().sort(), Object.keys(item.properties).sort());
assert.ok(!item.properties.latitud);

console.log('\n  ✓ import-core: todos los tests pasaron');
