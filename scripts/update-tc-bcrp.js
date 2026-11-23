#!/usr/bin/env node
// Actualiza data/tc_pen_usd_bcrp.json con datos oficiales del BCRP.
//
//   node scripts/update-tc-bcrp.js
//
// - `ultimo`:  TC interbancario venta del último día hábil publicado
//              (serie diaria PD04640PD). Es el que usa la web para
//              convertir montos en soles a dólares.
// - `mensual`: promedios mensuales (serie PN01234PM), completa los meses
//              que falten y corrige los ya publicados.
// - `anual`:   se recalcula como promedio de los meses de cada año.
//
// API pública: https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/api
// Requiere Node 18+ (fetch nativo). No tiene dependencias.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'tc_pen_usd_bcrp.json');
const API = 'https://estadisticas.bcrp.gob.pe/estadisticas/series/api';
const MES = { Ene:'01', Feb:'02', Mar:'03', Abr:'04', May:'05', Jun:'06', Jul:'07', Ago:'08', Sep:'09', Set:'09', Oct:'10', Nov:'11', Dic:'12' };

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function series(code, from, to) {
  const url = `${API}/${code}/json/${from}/${to}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'reco-tc-updater' } });
  if (!res.ok) throw new Error(`${code}: HTTP ${res.status}`);
  const json = JSON.parse((await res.text()).replace(/^﻿/, ''));
  return (json.periods || [])
    .map(p => ({ name: p.name, value: parseFloat(p.values && p.values[0]) }))
    .filter(p => isFinite(p.value) && p.value > 0);
}

// "02.Oct.26" → "2026-10-02"
function parseDay(name) {
  const [d, m, y] = name.split('.');
  return MES[m] ? `20${y}-${MES[m]}-${pad(d)}` : null;
}
// "Ago.2025" → "2025-08"
function parseMonth(name) {
  const [m, y] = name.split('.');
  return MES[m] ? `${y}-${MES[m]}` : null;
}

// Mantiene el formato compacto del archivo (4 valores por línea).
function serialize(d) {
  const block = (obj, decimals) => {
    const items = Object.keys(obj).sort().map(k => `"${k}": ${Number(obj[k]).toFixed(decimals)}`);
    const lines = [];
    for (let i = 0; i < items.length; i += 4) lines.push('    ' + items.slice(i, i + 4).join(', '));
    return '{\n' + lines.join(',\n') + '\n  }';
  };
  const obj = o => JSON.stringify(o, null, 2).replace(/\n/g, '\n  ');
  return '{\n'
    + `  "metadata": ${obj(d.metadata)},\n`
    + `  "ultimo": ${obj(d.ultimo)},\n`
    + `  "mensual": ${block(d.mensual, 3)},\n`
    + `  "anual": ${block(d.anual, 3)}\n`
    + '}\n';
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const today = new Date();

  // Último TC diario (miramos 20 días atrás para cubrir feriados).
  const from = new Date(today); from.setDate(from.getDate() - 20);
  const daily = await series('PD04640PD', ymd(from), ymd(today));
  if (!daily.length) throw new Error('El BCRP no devolvió datos diarios');
  const last = daily[daily.length - 1];
  data.ultimo = {
    fecha: parseDay(last.name),
    valor: Math.round(last.value * 1000) / 1000,
    serie: 'PD04640PD',
    nombre: 'Tipo de cambio interbancario venta, promedio del día (S/ por US$)',
    fuente: 'BCRP - Banco Central de Reserva del Perú',
    actualizado: ymd(today)
  };

  // Promedios mensuales desde el último mes que ya tenemos.
  const months = Object.keys(data.mensual || {}).sort();
  const start = months.length ? months[months.length - 1] : '2010-01';
  const monthly = await series('PN01234PM', start, `${today.getFullYear()}-${pad(today.getMonth() + 1)}`);
  const touched = new Set();
  monthly.forEach(p => {
    const k = parseMonth(p.name);
    if (k) { data.mensual[k] = Math.round(p.value * 1000) / 1000; touched.add(k.slice(0, 4)); }
  });

  // Recalcula el promedio anual solo de los años que acabamos de traer
  // (la serie mensual del archivo tiene huecos en años antiguos).
  touched.forEach(y => {
    const vs = Object.keys(data.mensual).filter(k => k.startsWith(y + '-')).map(k => data.mensual[k]);
    data.anual[y] = Math.round(vs.reduce((a, b) => a + b, 0) / vs.length * 1000) / 1000;
  });

  fs.writeFileSync(FILE, serialize(data));
  console.log(`TC actualizado: S/ ${data.ultimo.valor} al ${data.ultimo.fecha} · mensual hasta ${Object.keys(data.mensual).sort().pop()}`);
}

if (require.main === module) {
  main().catch(e => { console.error('No se pudo actualizar el TC:', e.message); process.exit(1); });
}
module.exports = { serialize, parseDay, parseMonth };
