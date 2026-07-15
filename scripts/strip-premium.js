#!/usr/bin/env node
// Strip premium fields from data/properties.json so the public feed no
// longer leaks them. Idempotent: safe to re-run after adding records
// or updating the data file.
//
// Usage:
//   node scripts/strip-premium.js
//
// The companion migration (functions/scripts/migrate-premium-to-firestore.js)
// has to run FIRST — it copies the same fields into /propertiesPremium
// so the unlockProperty callable can serve them. Running this script
// before the migration would delete the fields with no server-side
// backup, breaking histórico unlocks.
//
// Fields stripped from each property doc:
//   - owner              (contact info; never displayed anyway).
//   - phone              (contact info; ditto).
//   - val                (5-year value chart series; premium after unlock).
//   - sun                (histórico transaction details: exact price
//                        breakdown, fechaVenta, valorUnit, individual
//                        parking / deposit values. This is the raw
//                        premium payload the callable returns.)
//
// Before deleting sun we precompute a small set of *derived* public
// fields so cards, hover cards and the area modal can keep rendering
// synchronously without an async fetch per row:
//   - priceTotal   total display price (getHistTotal equivalent)
//   - priceProp    property base price (getHistPropPrice equivalent)
//   - areaTech     built-up area (used by histSqmNet + area modal)
//   - areaOcup     occupied area (used by histSqmNet)
//   - park         parking count (was derived from sun.estacVals)
//   - dep          deposit count (was derived from sun.depositos / depVals)
//   - txKey        opaque month index for chronological sort; hides the
//                  exact fechaVenta while preserving ordering
//
// Fields stripped from each entry of the top-level `drive` map:
//   - anything starting with 'pdf_'
//     (pdf_main, pdf_dep_*, pdf_est_*, pdf_serv_* — partida registral
//     scans. Photos foto1..foto8 stay public — they are what the card
//     carousel displays without unlock.)

const fs = require('node:fs');
const path = require('node:path');

const JSON_PATH = path.join(__dirname, '..', 'data', 'properties.json');

const PREMIUM_PROP_FIELDS = ['owner', 'phone', 'val', 'sun'];
const isPremiumDriveKey = (k) => k.startsWith('pdf_');

// Fields removed from every histórico row after they have been
// mirrored to Firestore /propertiesHistoricoDetail. They used to
// ship in this JSON, which meant `curl` on the raw file gave a
// scraper the full curated dataset. The getHistoricoDetail callable
// now serves them behind auth + AppCheck + rate limit. Non-histórico
// rows keep price / cur because those are the user-published listings
// where the sale price IS the whole product — protecting them behind
// login would break browsing.
// cur (currency symbol $ vs S/) intentionally stays in the public
// JSON: it is not sensitive on its own (the value is just "$" or
// "S/") and dropping it breaks the "🔒 $" placeholder on locked
// cards, since the card would render "undefined 🔒" instead.
const HIST_SENSITIVE_FIELDS = ['price', 'priceTotal', 'priceProp', 'areaTech', 'areaOcup', 'txKey'];

// ── helpers that mirror the ones in index.html; kept in sync so the
// public numbers we bake in match what getHistTotal / parkCount / etc.
// would have computed at render time from sun. ──────────────────────
const sumTruthy = (arr) => (Array.isArray(arr) ? arr.reduce((s, v) => s + (Number(v) || 0), 0) : 0);
const countPositive = (arr) => (Array.isArray(arr) ? arr.filter((v) => Number(v) > 0).length : 0);

function computeHistPriceTotal(p) {
  if (p.op !== 'Histórico') return null;
  const sun = p.sun || {};
  if (Number(sun.precioPropiedad) > 0) return Number(p.price) || 0;
  const extras = sumTruthy(sun.estacVals) + sumTruthy(sun.depVals);
  return (Number(p.price) || 0) + extras;
}

function computeHistPriceProp(p) {
  if (p.op !== 'Histórico') return null;
  const sun = p.sun || {};
  return (Number(sun.precioPropiedad) > 0) ? Number(sun.precioPropiedad) : (Number(p.price) || 0);
}

function computeHistPark(p) {
  const sun = p.sun || {};
  const existing = Number(p.park) || 0;
  if (existing > 0) return existing;
  return countPositive(sun.estacVals);
}

function computeHistDep(p) {
  const sun = p.sun || {};
  const declared = Number(sun.depositos) || 0;
  if (declared > 0) return declared;
  return countPositive(sun.depVals);
}

// Parse "Mes Año" in Spanish → year*12 + month. Mirrors the parser at
// index.html:_parseFechaVenta. Supports both "setiembre" and
// "septiembre" spellings. Returns null when the string does not match
// — the client has other tie-breakers (transactedAt, "-NN" suffix on
// the id) that keep chronological ordering usable in that case.
const _MES_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, setiembre: 9, septiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12,
};
function computeTxKey(p) {
  const sun = p.sun || {};
  const fv = sun.fechaVenta;
  if (!fv) return null;
  const m = String(fv).trim().toLowerCase().match(/([a-zñé]+)\s+(\d{4})/);
  if (!m) return null;
  const mes = _MES_ES[m[1]];
  if (!mes) return null;
  return parseInt(m[2], 10) * 12 + mes;
}

// ─────────────────────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const properties = Array.isArray(raw.properties) ? raw.properties : [];
const drive = raw.drive && typeof raw.drive === 'object' ? raw.drive : {};

let strippedProp = 0;
let strippedHistFields = 0;
let hist = 0;
let precomputed = { priceTotal: 0, priceProp: 0, areaTech: 0, areaOcup: 0, park: 0, dep: 0, txKey: 0 };

for (const prop of properties) {
  if (prop.op === 'Histórico') {
    hist++;
    // Precompute the derived public fields BEFORE deleting sun.
    // These land on the property temporarily and then get removed
    // below (they belong to /propertiesHistoricoDetail now, not the
    // public JSON). The precompute still runs because the migration
    // script for /propertiesHistoricoDetail reads the same fields
    // from properties.json; we need them present at that moment.
    // In the current pipeline the migration is a separate step, so
    // this is a no-op unless you re-run it — safe either way.
    const pt = computeHistPriceTotal(prop);
    const pp = computeHistPriceProp(prop);
    if (pt != null) { prop.priceTotal = pt; precomputed.priceTotal++; }
    if (pp != null) { prop.priceProp = pp; precomputed.priceProp++; }
    const sun = prop.sun || {};
    if (Number(sun.areaTech) > 0) { prop.areaTech = Number(sun.areaTech); precomputed.areaTech++; }
    if (Number(sun.areaOcup) > 0) { prop.areaOcup = Number(sun.areaOcup); precomputed.areaOcup++; }
    // park and dep are counts, not monetary values. They stay in the
    // public JSON so the card / list filters keep working without a
    // per-row callable roundtrip.
    const park = computeHistPark(prop);
    if (park > 0) { prop.park = park; precomputed.park++; }
    const dep = computeHistDep(prop);
    if (dep > 0) { prop.dep = dep; precomputed.dep++; }
    const tk = computeTxKey(prop);
    if (tk != null) { prop.txKey = tk; precomputed.txKey++; }

    // Now strip the sensitive fields. price, priceTotal, priceProp,
    // areaTech, areaOcup, txKey and cur are served by the
    // getHistoricoDetail callable behind auth + AppCheck + rate
    // limit. `curl` on this JSON no longer yields the curated
    // dataset for scrapers.
    for (const f of HIST_SENSITIVE_FIELDS) {
      if (f in prop) { delete prop[f]; strippedHistFields++; }
    }
  }

  for (const f of PREMIUM_PROP_FIELDS) {
    if (f in prop) { delete prop[f]; strippedProp++; }
  }
}

let strippedDrive = 0;
for (const key of Object.keys(drive)) {
  const entry = drive[key];
  if (!entry || typeof entry !== 'object') continue;
  for (const k of Object.keys(entry)) {
    if (isPremiumDriveKey(k)) { delete entry[k]; strippedDrive++; }
  }
}

fs.writeFileSync(JSON_PATH, JSON.stringify(raw));
console.log(`✓ Stripped ${strippedProp} premium fields across ${properties.length} properties.`);
console.log(`✓ Stripped ${strippedHistFields} histórico sensitive fields (${HIST_SENSITIVE_FIELDS.join(', ')}) across ${hist} histórico rows.`);
console.log(`✓ Stripped ${strippedDrive} pdf_* keys across ${Object.keys(drive).length} drive entries.`);
console.log(`✓ Precomputed derived fields (out of ${hist} históricos; note: sensitive ones were removed after precompute):`);
for (const k of Object.keys(precomputed)) console.log(`    ${k}: ${precomputed[k]}`);
console.log(`✓ Wrote ${JSON_PATH}`);
