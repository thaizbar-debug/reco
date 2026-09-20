#!/usr/bin/env node
// Phase A: Data Cleanup for Reco Market Intelligence
//
// Applies the following fixes to data/properties.json:
//   1. Normalize district names (15 variant groups → canonical)
//   2. Fix department errors (7 corrections)
//   3. Remove `bank` field (100% false, useless)
//   4. Add `publishedAt` to Venta/Alquiler records (platform launch reference)
//
// Applies the following fixes to data/serie_precios_tasaciones.json:
//   5. Nullify var_pct for entries with n_tasaciones < 20 (unreliable volatility)
//
// Usage:
//   node scripts/data-cleanup.js

const fs = require('node:fs');
const path = require('node:path');

const PROPS_PATH = path.join(__dirname, '..', 'data', 'properties.json');
const TASACIONES_PATH = path.join(__dirname, '..', 'data', 'serie_precios_tasaciones.json');

const TODAY = '2026-08-24';

// ── 1. District name normalization ──────────────────────────────
// Canonical name is the most common / properly accented variant.
const DISTRICT_CANONICAL = {
  'Ancon':              'Ancón',
  'ATE':                'Ate',
  'Brena':              'Breña',
  'Cerro azul':         'Cerro Azul',
  'Jesus Maria':        'Jesús María',
  'Jose Leonardo Ortiz':'José Leonardo Ortiz',
  'La victoria':        'La Victoria',
  'Lurin':              'Lurín',
  'Magdalena Del Mar':  'Magdalena del Mar',
  'Rimac':              'Rímac',
  'San borja':          'San Borja',
  'Santiago De Surco':  'Santiago de Surco',
  'Santiago De surco':  'Santiago de Surco',
  'Veintiseis de Octubre': 'Veintiséis de Octubre',
  'Victor Larco Herrera': 'Víctor Larco Herrera',
  'Villa el Salvador':  'Villa El Salvador',
};

// ── 2. Department fixes ─────────────────────────────────────────
const DEPARTMENT_FIXES = {
  'Trujillo':    'La Libertad',
  'Chiclayo':    'Lambayeque',
  'Cañete':      'Lima',
  'Lim':         'Lima',
  'Areuipa':     'Arequipa',
  'Junin':       'Junín',
  'La libertad': 'La Libertad',
};

// ═══════════════════════════════════════════════════════════════
// PROPERTIES.JSON CLEANUP
// ═══════════════════════════════════════════════════════════════
const raw = JSON.parse(fs.readFileSync(PROPS_PATH, 'utf8'));
const properties = Array.isArray(raw.properties) ? raw.properties : [];

let districtFixed = 0;
let departmentFixed = 0;
let bankRemoved = 0;
let publishedAtAdded = 0;

for (const prop of properties) {
  // 1. District normalization
  const district = (prop.district || '').trim();
  if (DISTRICT_CANONICAL[district]) {
    prop.district = DISTRICT_CANONICAL[district];
    districtFixed++;
  }

  // 2. Department fixes
  const dept = (prop.department || '').trim();
  if (DEPARTMENT_FIXES[dept]) {
    prop.department = DEPARTMENT_FIXES[dept];
    departmentFixed++;
  }

  // 3. Remove bank field
  if ('bank' in prop) {
    delete prop.bank;
    bankRemoved++;
  }

  // 4. Add publishedAt to Venta/Alquiler
  if ((prop.op === 'Venta' || prop.op === 'Alquiler') && !prop.publishedAt) {
    prop.publishedAt = TODAY;
    publishedAtAdded++;
  }
}

fs.writeFileSync(PROPS_PATH, JSON.stringify(raw));

console.log('═══ PROPERTIES.JSON CLEANUP ═══');
console.log(`✓ District names normalized: ${districtFixed} records`);
console.log(`✓ Department names fixed: ${departmentFixed} records`);
console.log(`✓ bank field removed: ${bankRemoved} records`);
console.log(`✓ publishedAt added: ${publishedAtAdded} records (${TODAY})`);

// ═══════════════════════════════════════════════════════════════
// SERIE_PRECIOS_TASACIONES.JSON CLEANUP
// ═══════════════════════════════════════════════════════════════
const tasaciones = JSON.parse(fs.readFileSync(TASACIONES_PATH, 'utf8'));
const distritos = tasaciones.distritos || {};

const MIN_N = 20;
let varPctNullified = 0;
let totalYearEntries = 0;

for (const [distrito, info] of Object.entries(distritos)) {
  const years = info.años || {};
  for (const [y, d] of Object.entries(years)) {
    totalYearEntries++;
    if (d.n_tasaciones < MIN_N && d.var_pct !== undefined) {
      delete d.var_pct;
      varPctNullified++;
    }
  }
}

fs.writeFileSync(TASACIONES_PATH, JSON.stringify(tasaciones));

console.log('\n═══ TASACIONES CLEANUP ═══');
console.log(`✓ var_pct nullified for entries with n<${MIN_N}: ${varPctNullified} of ${totalYearEntries} entries`);
console.log(`✓ Wrote ${TASACIONES_PATH}`);
