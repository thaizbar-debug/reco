// ─────────────────────────────────────────────────────────────────────────────
// Tipo de cambio S/ por US$ desde la API pública del BCRP.
//
// Lógica pura (sin Firebase) para que se pueda probar en
// functions/index.test.js. La usa la función programada updateTipoCambio.
//
// Serie PD04640PD: tipo de cambio interbancario venta, promedio del día.
// API: https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/api
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const BCRP_API = 'https://estadisticas.bcrp.gob.pe/estadisticas/series/api';
const TC_SERIE = 'PD04640PD';
// Rango de cordura: si el BCRP devuelve algo fuera de esto (o un salto
// diario mayor al 10%) no lo guardamos y dejamos el último valor bueno.
const TC_MIN = 2.5;
const TC_MAX = 6;
const TC_MAX_JUMP = 0.10;

const MES = { Ene:'01', Feb:'02', Mar:'03', Abr:'04', May:'05', Jun:'06', Jul:'07', Ago:'08', Sep:'09', Set:'09', Oct:'10', Nov:'11', Dic:'12' };
const pad = n => String(n).padStart(2, '0');

// "02.Oct.26" → "2026-10-02"
function parseBcrpDay(name) {
  const parts = String(name || '').split('.');
  if (parts.length !== 3 || !MES[parts[1]]) return null;
  return `20${parts[2]}-${MES[parts[1]]}-${pad(parts[0])}`;
}

// Fecha YYYY-MM-DD en hora de Lima (UTC-5, sin horario de verano).
function limaDate(d) {
  const lima = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return lima.toISOString().slice(0, 10);
}

// Respuesta JSON del BCRP → último día con valor válido, o null.
// Los feriados vienen como "n.d."; el texto puede traer BOM.
function latestFromBcrp(text) {
  const json = JSON.parse(String(text).replace(/^﻿/, ''));
  const rows = (json.periods || [])
    .map(p => ({ fecha: parseBcrpDay(p.name), valor: parseFloat(p.values && p.values[0]) }))
    .filter(r => r.fecha && isFinite(r.valor) && r.valor > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return { fecha: last.fecha, valor: Math.round(last.valor * 1000) / 1000 };
}

// ¿Es razonable guardar `nuevo` dado el último valor guardado `previo`?
function isSaneRate(nuevo, previo) {
  if (!nuevo || !(nuevo.valor >= TC_MIN && nuevo.valor <= TC_MAX)) return false;
  if (previo && previo.valor > 0 && Math.abs(nuevo.valor - previo.valor) / previo.valor > TC_MAX_JUMP) return false;
  return true;
}

function bcrpUrl(now) {
  const from = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // cubre feriados largos
  return `${BCRP_API}/${TC_SERIE}/json/${limaDate(from)}/${limaDate(now)}`;
}

module.exports = { TC_SERIE, parseBcrpDay, limaDate, latestFromBcrp, isSaneRate, bcrpUrl };
