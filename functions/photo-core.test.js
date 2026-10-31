// Tests de fotos con IA (lógica pura). Sin framework: node functions/photo-core.test.js
'use strict';

const assert = require('assert');
const P = require('./photo-core');

const f = (indice, ambiente, calidad, extra) => ({ indice, ambiente, calidad, marca_agua: false, texto: false, personas: false, ...(extra || {}) });

console.log('  content');
const c = P.content(['data:image/jpeg;base64,AA', 'data:image/jpeg;base64,BB']);
assert.strictEqual(c.filter((x) => x.type === 'image_url').length, 2);
assert.ok(c.every((x) => x.type !== 'image_url' || x.image_url.detail === 'low'));
assert.strictEqual(c[3].text, 'Foto 1:');

console.log('  normalizar: portada de la IA y orden por ambientes');
let r = P.normalizar({ portada: 3, fotos: [f(0, 'bano', 4), f(1, 'plano', 5), f(2, 'cocina', 4), f(3, 'sala', 5), f(4, 'dormitorio', 4)] }, 5);
assert.strictEqual(r.portada, 3);
assert.deepStrictEqual(r.orden, [3, 2, 4, 0, 1]); // sala · cocina · dormitorio · baño · plano
assert.deepStrictEqual(r.fotos[1], { ambiente: 'plano', calidad: 5, marcaAgua: false, texto: false, personas: false });

console.log('  normalizar: una portada con marca de agua, texto o plano se cambia');
r = P.normalizar({ portada: 0, fotos: [f(0, 'fachada', 5, { marca_agua: true }), f(1, 'cocina', 4), f(2, 'vista', 4), f(3, 'sala', 2)] }, 4);
assert.strictEqual(r.portada, 2); // vista (4) gana a cocina (4) por preferencia; la sala es de calidad 2
assert.deepStrictEqual(r.orden, [2, 1, 0, 3]); // las que tienen problemas, después
r = P.normalizar({ portada: 1, fotos: [f(0, 'dormitorio', 3), f(1, 'plano', 5)] }, 2);
assert.strictEqual(r.portada, 0);
r = P.normalizar({ portada: 0, fotos: [f(0, 'sala', 5, { texto: true }), f(1, 'cocina', 5, { personas: true })] }, 2);
assert.strictEqual(r.portada, 0); // ninguna sin problemas: la primera

console.log('  normalizar: respuesta incompleta o inválida');
r = P.normalizar({ portada: 9, fotos: [{ indice: 1, ambiente: 'sotano', calidad: 12, marca_agua: 'si' }] }, 3);
assert.deepStrictEqual(r.fotos.map((x) => [x.ambiente, x.calidad, x.marcaAgua]), [['otro', 3, false], ['otro', 3, false], ['otro', 3, false]]);
assert.strictEqual(r.portada, 0);
assert.deepStrictEqual(r.orden, [0, 1, 2]);
r = P.normalizar(null, 2);
assert.deepStrictEqual(r.orden, [0, 1]);
// Índices repetidos o fuera de rango: cuenta la posición.
r = P.normalizar({ portada: 0, fotos: [f(7, 'cocina', 4), f(7, 'sala', 4)] }, 2);
assert.deepStrictEqual(r.fotos.map((x) => x.ambiente), ['cocina', 'sala']);

console.log('photo-core: OK');
