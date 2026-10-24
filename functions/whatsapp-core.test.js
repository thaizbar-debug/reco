// Tests del bot de WhatsApp (lógica pura). Sin framework: node functions/whatsapp-core.test.js
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const W = require('./whatsapp-core');

console.log('  verifySignature');
const raw = Buffer.from('{"entry":[]}');
const sig = 'sha256=' + crypto.createHmac('sha256', 's3cr3t').update(raw).digest('hex');
assert.strictEqual(W.verifySignature(raw, sig, 's3cr3t'), true);
assert.strictEqual(W.verifySignature(raw, sig.toUpperCase().replace('SHA256=', 'sha256='), 's3cr3t'), true);
assert.strictEqual(W.verifySignature(raw, sig, 'otro'), false);
assert.strictEqual(W.verifySignature(Buffer.from('{"entry":[1]}'), sig, 's3cr3t'), false);
assert.strictEqual(W.verifySignature(raw, 'sha256=abc', 's3cr3t'), false);
assert.strictEqual(W.verifySignature(raw, undefined, 's3cr3t'), false);
assert.strictEqual(W.verifySignature(raw, sig, ''), false);

console.log('  parseWebhook');
const msgs = W.parseWebhook({ entry: [{ changes: [{ value: {
  statuses: [{ id: 'x', status: 'read' }],
  messages: [
    { id: 'wamid.1', from: '51987654321', timestamp: '1761300000', type: 'text', text: { body: 'Vendo depa' } },
    { id: 'wamid.2', from: '51987654321', timestamp: '1761300010', type: 'image', image: { id: 'MEDIA1', caption: 'Sala', mime_type: 'image/jpeg' } },
    { id: 'wamid.3', from: '51987654321', timestamp: '1761300020', type: 'audio', audio: { id: 'MEDIA2', mime_type: 'audio/ogg; codecs=opus' } },
    { id: 'wamid.4', from: '51987654321', timestamp: '1761300030', type: 'sticker', sticker: { id: 'S' } },
    { from: 'sin-id' },
  ] } }] }] });
assert.deepStrictEqual(msgs.map((m) => [m.id, m.type]), [['wamid.1', 'text'], ['wamid.2', 'image'], ['wamid.3', 'audio'], ['wamid.4', 'other']]);
assert.strictEqual(msgs[0].text, 'Vendo depa');
assert.deepStrictEqual([msgs[1].mediaId, msgs[1].caption], ['MEDIA1', 'Sala']);
assert.strictEqual(msgs[3].kind, 'sticker');
assert.deepStrictEqual(W.parseWebhook({}), []);

console.log('  parseCommand');
assert.deepStrictEqual(W.parseCommand('VINCULAR 123456'), { cmd: 'vincular', code: '123456' });
assert.deepStrictEqual(W.parseCommand(' vincular  654321 '), { cmd: 'vincular', code: '654321' });
['LISTO', 'listo!', 'Listo.', 'ya', 'Terminé'].forEach((t) => assert.deepStrictEqual(W.parseCommand(t), { cmd: 'listo' }, t));
['Cancelar', 'BORRAR'].forEach((t) => assert.deepStrictEqual(W.parseCommand(t), { cmd: 'cancelar' }, t));
['ayuda', 'Hola'].forEach((t) => assert.deepStrictEqual(W.parseCommand(t), { cmd: 'ayuda' }, t));
['Vendo depa listo para entrar', 'vincular 12345', ''].forEach((t) => assert.strictEqual(W.parseCommand(t), null, t));

console.log('  sessionToText');
const ts = Date.UTC(2026, 9, 24, 19, 5) / 1000; // 14:05 en Lima
const s = W.sessionToText([
  { type: 'text', ts, text: 'Vendo depa en Lince 70 m2 US$ 120 mil' },
  { type: 'image', ts: ts + 60, caption: 'Sala', photoId: 'w-1' },
  { type: 'image', ts: ts + 70 },
  { type: 'audio', ts: ts + 120 },
  { type: 'audio', ts: ts + 130 },
], { 3: 'tiene dos dormitorios' });
assert.ok(s.text.startsWith('=== Mensajes por WhatsApp ===\n[14:05] Corredor: Vendo depa'));
assert.ok(s.text.includes('[14:06] Corredor: Sala [FOTO w-1]'));
assert.ok(s.text.includes('[foto no disponible]'));
assert.ok(s.text.includes('(nota de voz) tiene dos dormitorios'));
assert.ok(s.text.includes('(nota de voz sin transcribir)'));
assert.deepStrictEqual(s.photoIds, ['w-1']);

console.log('  summarizeDrafts');
const sum = W.summarizeDrafts([
  { row: { tipo_propiedad: 'Departamento', distrito: 'Lince', tipo_publicacion: 'Venta', precio: '120000', tipo_moneda: 'USD', area_techada: '70' }, fotos: ['w-1', 'w-2'] },
  { row: { tipo_propiedad: 'Terreno', distrito: 'Lurín', tipo_publicacion: 'Venta', precio: '90000', tipo_moneda: 'PEN', area_terreno: '500' }, fotos: [] },
], 'https://recosac.com/#borradores');
assert.ok(sum.startsWith('✅ Encontré 2 inmuebles:'));
assert.ok(/1\) Departamento en Lince · Venta · US\$ 120[.,]000 · 70 m² · 2 fotos/.test(sum), sum);
assert.ok(/2\) Terreno en Lurín · Venta · S\/ 90[.,]000 · 500 m²/.test(sum), sum);
assert.ok(sum.endsWith('https://recosac.com/#borradores'));
assert.ok(W.summarizeDrafts([], 'x').includes('No encontré inmuebles'));

console.log('\n  ✓ whatsapp-core: todos los tests pasaron');
