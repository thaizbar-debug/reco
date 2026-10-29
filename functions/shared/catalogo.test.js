// Tests del catálogo de valores estándar. Sin framework: node functions/shared/catalogo.test.js
'use strict';

const assert = require('assert');
const C = require('./catalogo');

const check = (fn, cases) => cases.forEach(([input, out]) =>
  assert.strictEqual(fn(input), out, `${fn.name}(${JSON.stringify(input)})`));

console.log('  matchType');
check(C.matchType, [
  ['Departamento', 'Departamento'], ['departamento', 'Departamento'], ['Dpto.', 'Departamento'],
  ['Dpto', 'Departamento'], ['depa', 'Departamento'], ['Depto', 'Departamento'], ['Apartamento', 'Departamento'],
  ['Dúplex', 'Departamento'], ['Penthouse', 'Departamento'], ['Flat', 'Departamento'], ['Mini depa', 'Departamento'],
  ['Casa', 'Casa'], ['Casa de playa', 'Casa'], ['Chalet', 'Casa'], ['Casa de campo', 'Casa'], ['Quinta', 'Casa'],
  ['Oficina', 'Oficina'], ['Consultorio', 'Oficina'],
  ['Local comercial', 'Local comercial'], ['Local', 'Local comercial'], ['Tienda', 'Local comercial'],
  ['Terreno', 'Terreno'], ['Lote', 'Terreno'], ['Parcela', 'Terreno'], ['Aires', 'Terreno'],
  ['Otros', 'Otros'], ['Otro', 'Otros'], ['Almacén', 'Otros'], ['Habitación', 'Otros'],
  ['', ''], ['xyz', ''],
]);

console.log('  matchOp');
check(C.matchOp, [
  ['Venta', 'Venta'], ['venta', 'Venta'], ['VENTA', 'Venta'], ['Se vende', 'Venta'], ['Vendo', 'Venta'],
  ['Compra-venta', 'Venta'], ['Sale', 'Venta'],
  ['Alquiler', 'Alquiler'], ['alquiler', 'Alquiler'], ['Se alquila', 'Alquiler'], ['Alquilo', 'Alquiler'],
  ['Arriendo', 'Alquiler'], ['Renta', 'Alquiler'], ['Rent', 'Alquiler'],
  ['Venta o alquiler', 'Venta'], ['Alquiler o venta', 'Alquiler'],
  ['Anticresis', ''], ['', ''],
]);

console.log('  matchCurrency');
check(C.matchCurrency, [
  ['USD', 'USD'], ['usd', 'USD'], ['US$', 'USD'], ['$', 'USD'], ['Dólares', 'USD'], ['dolares', 'USD'], ['US', 'USD'],
  ['PEN', 'PEN'], ['S/', 'PEN'], ['S/.', 'PEN'], ['Soles', 'PEN'], ['sol', 'PEN'], ['Nuevos soles', 'PEN'],
  ['', ''], ['EUR', ''],
]);

console.log('  matchEstado');
check(C.matchEstado, [
  ['En proyecto', 'En proyecto'], ['Proyecto', 'En proyecto'], ['En planos', 'En proyecto'], ['Planos', 'En proyecto'],
  ['Sobre planos', 'En proyecto'], ['Preventa', 'En proyecto'], ['Pre-venta', 'En proyecto'], ['Pre venta', 'En proyecto'],
  ['Por construir', 'En proyecto'], ['Lanzamiento', 'En proyecto'],
  ['En construcción', 'En construcción'], ['en construccion', 'En construcción'], ['Construcción', 'En construcción'],
  ['En obra', 'En construcción'], ['Obra', 'En construcción'], ['En ejecución', 'En construcción'],
  ['Por entregar', 'En construcción'], ['Entrega futura', 'En construcción'], ['Casco gris', 'En construcción'],
  ['Construido', 'Construido'], ['Terminado', 'Construido'], ['Entrega inmediata', 'Construido'],
  ['A estrenar', 'Construido'], ['Estreno', 'Construido'], ['Usado', 'Construido'], ['Remodelado', 'Construido'],
  ['', ''], ['Bueno', ''],
]);

console.log('  matchBool');
check(C.matchBool, [
  ['Sí', true], ['si', true], ['SI', true], ['x', true], ['Yes', true], ['1', true], [1, true], [true, true], ['Tiene', true],
  ['No', false], ['no', false], ['0', false], [0, false], [false, false], ['Sin', false], ['No tiene', false],
  ['', null], [null, null], ['Depende', null],
]);

console.log('  abreviaturas');
check(C.matchType, [
  ['Dpto.', 'Departamento'], ['DPTO', 'Departamento'], ['Dto.', 'Departamento'], ['Depto.', 'Departamento'],
  ['Apto.', 'Departamento'], ['D', 'Departamento'], ['C', 'Casa'], ['Of.', 'Oficina'], ['Ofic.', 'Oficina'],
  ['Loc.', 'Local comercial'], ['Loc. com.', 'Local comercial'], ['LC', 'Local comercial'],
  ['Terr.', 'Terreno'], ['T', 'Terreno'], ['Lt.', 'Terreno'], ['Dpto. dúplex', 'Departamento'],
]);
check(C.matchOp, [
  ['V', 'Venta'], ['Vta.', 'Venta'], ['VTA', 'Venta'], ['A', 'Alquiler'], ['Alq.', 'Alquiler'], ['ALQ', 'Alquiler'],
  ['Arr.', 'Alquiler'], ['R', 'Alquiler'],
]);
check(C.matchEstado, [
  ['Proy.', 'En proyecto'], ['En proy.', 'En proyecto'], ['P', 'En proyecto'], ['PV', 'En proyecto'],
  ['Pre-vta', 'En proyecto'], ['S/P', 'En proyecto'],
  ['E/C', 'En construcción'], ['En const.', 'En construcción'], ['En constr.', 'En construcción'], ['EC', 'En construcción'],
  ['A/E', 'Construido'], ['E/I', 'Construido'], ['Ent. inm.', 'Construido'], ['Term.', 'Construido'],
  ['Const.', ''], // ambiguo (¿construido o en construcción?): mejor avisar que adivinar
]);
check(C.matchCurrency, [
  ['U$S', 'USD'], ['U$', 'USD'], ['Dls.', 'USD'], ['D', 'USD'], ['S', 'PEN'], ['S/.', 'PEN'], ['N.S.', 'PEN'],
]);
assert.strictEqual(C.parseAntiguedad('A/E'), 0);
assert.strictEqual(C.parseAntiguedad('x estrenar'), 0);
assert.strictEqual(C.parseAntiguedad('5a'), 5);
assert.deepStrictEqual([C.resolveEstadoAntiguedad('E/C', '4').estado, C.resolveEstadoAntiguedad('E/C', '4').antiguedad], ['En construcción', 0]);

console.log('  parseAntiguedad');
assert.strictEqual(C.parseAntiguedad('5'), 5);
assert.strictEqual(C.parseAntiguedad('5 años'), 5);
assert.strictEqual(C.parseAntiguedad('cinco'), 5);
assert.strictEqual(C.parseAntiguedad('A estrenar'), 0);
assert.strictEqual(C.parseAntiguedad('Estreno'), 0);
assert.strictEqual(C.parseAntiguedad('Nuevo'), 0);
assert.strictEqual(C.parseAntiguedad('Menos de un año'), 0);
assert.strictEqual(C.parseAntiguedad('2015', 2026), 11);
assert.strictEqual(C.parseAntiguedad(7), 7);
assert.strictEqual(C.parseAntiguedad(''), null);
assert.strictEqual(C.parseAntiguedad('En planos'), null);

console.log('  resolveEstadoAntiguedad: proyecto y construcción ⇒ antigüedad 0 siempre');
const R = (e, a) => C.resolveEstadoAntiguedad(e, a, { year: 2026 });
assert.deepStrictEqual([R('En planos', '').estado, R('En planos', '').antiguedad], ['En proyecto', 0]);
assert.deepStrictEqual([R('Preventa', '7').estado, R('Preventa', '7').antiguedad], ['En proyecto', 0]);
assert.ok(R('Preventa', '7').notas.join(' ').includes('se publicará como 0'));
assert.deepStrictEqual([R('En obra', '').estado, R('En obra', '').antiguedad], ['En construcción', 0]);
assert.deepStrictEqual([R('En construcción', 3).estado, R('En construcción', 3).antiguedad], ['En construcción', 0]);
assert.deepStrictEqual([R('Construido', '5').estado, R('Construido', '5').antiguedad], ['Construido', 5]);
assert.deepStrictEqual(R('Construido', '5').notas, []);

console.log('  resolveEstadoAntiguedad: estado escrito en la columna de antigüedad');
assert.deepStrictEqual([R('', 'En planos').estado, R('', 'En planos').antiguedad], ['En proyecto', 0]);
assert.deepStrictEqual([R('', 'en construcción').estado, R('', 'en construcción').antiguedad], ['En construcción', 0]);
assert.deepStrictEqual([R('', 'A estrenar').estado, R('', 'A estrenar').antiguedad], ['Construido', 0]);
assert.deepStrictEqual([R('', '').estado, R('', '').antiguedad], ['Construido', 0]);

console.log('  resolveEstadoAntiguedad: estado no reconocido ⇒ Construido con aviso');
const bad = R('Bueno', '4');
assert.deepStrictEqual([bad.estado, bad.antiguedad], ['Construido', 4]);
assert.ok(bad.notas[0].includes('no reconocido'));

console.log('  standardizeRow');
const sr = C.standardizeRow({ tipo_propiedad: 'Dpto.', tipo_publicacion: 'Alq.', tipo_moneda: 'S/.', estado: 'Preventa',
  antiguedad: '5', ascensor: 'x', mostrar_direccion: 'Depende', direccion: 'Av. X 1' });
assert.deepStrictEqual(
  [sr.row.tipo_propiedad, sr.row.tipo_publicacion, sr.row.tipo_moneda, sr.row.estado, sr.row.antiguedad, sr.row.ascensor, sr.row.mostrar_direccion, sr.row.direccion],
  ['Departamento', 'Alquiler', 'PEN', 'En proyecto', '0', 'Sí', 'Depende', 'Av. X 1']);
assert.ok(sr.notas.join(' ').includes('se publicará como 0'));
assert.deepStrictEqual(C.standardizeRow(sr.row).row, sr.row, 'idempotente');
const unk = C.standardizeRow({ estado: 'Bueno', tipo_propiedad: 'Planeta', antiguedad: 'viejo' }).row;
assert.deepStrictEqual([unk.estado, unk.tipo_propiedad, unk.antiguedad], ['Bueno', 'Planeta', 'viejo']);
const empty = C.standardizeRow({}).row;
assert.deepStrictEqual([empty.estado, empty.tipo_moneda, empty.antiguedad], ['', '', undefined]);

console.log('  verificarPublicacion: área obligatoria según el tipo');
const V = (o, opts) => C.verificarPublicacion(Object.assign(
  { title: 't', desc: 'd', address: 'Av. 1', district: 'Lince', op: 'Venta', currency: 'USD', price: 100000 }, o), opts);
// Terreno: no exige área techada, sí de terreno; área principal = terreno
let v = V({ type: 'Terreno', area: 0, areaTerr: 300 });
assert.deepStrictEqual(v.errores, []);
assert.deepStrictEqual([v.datos.area, v.datos.areaTech, v.datos.areaTerr], [300, 0, 300]);
assert.deepStrictEqual(V({ type: 'Terreno', area: 50 }).errores, ['área de terreno obligatoria para Terreno']);
// Departamento / Oficina / Local: solo área techada
['Departamento', 'Oficina', 'Local comercial'].forEach(t => {
  assert.deepStrictEqual(V({ type: t, area: 80 }).errores, [], t);
  assert.deepStrictEqual(V({ type: t, area: 80 }).avisos, [], t + ' no pide terreno');
  assert.deepStrictEqual(V({ type: t, area: 0, areaTerr: 100 }).errores, [`área techada obligatoria para ${t}`]);
});
// Casa: techada obligatoria, terreno recomendado
assert.deepStrictEqual(V({ type: 'Casa', area: 200, areaTerr: 150 }).errores, []);
assert.ok(V({ type: 'Casa', area: 200 }).avisos[0].includes('se recomienda'));
assert.ok(V({ type: 'Casa', area: 400, areaTerr: 100, floors: 2 }).avisos.some(a => a.includes('supera el terreno')));
assert.deepStrictEqual(V({ type: 'Casa', area: 200, areaTerr: 100, floors: 2 }).avisos, []);
// Otros: basta una de las dos
assert.deepStrictEqual(V({ type: 'Otros', areaTerr: 500 }).errores, []);
assert.strictEqual(V({ type: 'Otros', areaTerr: 500 }).datos.area, 500);
assert.deepStrictEqual(V({ type: 'Otros' }).errores, ['área techada o de terreno: indica al menos una']);
// Valores inválidos
assert.ok(V({ type: 'Departamento', area: -5 }).errores.includes('área techada inválida'));
assert.ok(V({ type: 'Departamento', area: 'abc' }).errores.includes('área techada inválida'));

console.log('  verificarPublicacion: campos que no aplican a Terreno');
v = V({ type: 'Terreno', areaTerr: 300, beds: 3, baths: 2, floor: 4, unitFloors: 2, ascensor: true, age: 5 });
assert.deepStrictEqual([v.datos.beds, v.datos.baths, v.datos.floor, v.datos.unitFloors, v.datos.ascensor, v.datos.age], [0, 0, 0, 1, false, 0]);
assert.strictEqual(v.avisos.length, 1);
assert.ok(v.avisos[0].includes('dormitorios, baños, piso, niveles, antigüedad, ascensor no aplican'));
assert.deepStrictEqual(V({ type: 'Terreno', areaTerr: 300 }).avisos, []);

console.log('  verificarPublicacion: obligatorios y coherencia');
v = C.verificarPublicacion({ type: 'Departamento', area: 80 });
['título vacío', 'descripción vacía', 'dirección vacía', 'distrito vacío', 'operacion debe ser Venta o Alquiler',
  'moneda debe ser USD o PEN', 'precio inválido: debe ser mayor que 0'].forEach(e => assert.ok(v.errores.includes(e), e));
assert.ok(!C.verificarPublicacion({ type: 'Departamento' }, { soloDatos: true }).errores.includes('título vacío'));
assert.ok(V({ type: 'Planeta', area: 1 }).errores[0].startsWith('tipo debe ser'));
assert.ok(V({ type: 'dpto', area: 80 }).errores.length === 0, 'acepta sinónimos');
assert.ok(V({ type: 'Departamento', area: 80, title: 'x'.repeat(201) }).errores[0].startsWith('título muy largo'));
assert.ok(V({ type: 'Departamento', area: 80, floor: 9, unitFloors: 2, floors: 9 }).avisos.includes('Piso + niveles supera la altura del edificio'));
// Cada error empieza por el nombre del campo (la carga masiva lo usa para marcar la celda)
const prefijos = ['título', 'descripción', 'dirección', 'distrito', 'tipo', 'operacion', 'moneda', 'precio', 'área techada', 'área de terreno'];
C.verificarPublicacion({}).errores.forEach(e => assert.ok(prefijos.some(p => e.startsWith(p)), e));

console.log('  listas canónicas coherentes');
C.TYPES.forEach(t => assert.strictEqual(C.matchType(t), t));
C.OPS.forEach(o => assert.strictEqual(C.matchOp(o), o));
C.CURRENCIES.forEach(c => assert.strictEqual(C.matchCurrency(c), c));
C.ESTADOS.forEach(e => assert.strictEqual(C.matchEstado(e), e));

console.log('\n  ✓ catalogo: todos los tests pasaron');
