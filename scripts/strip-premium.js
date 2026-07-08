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
//   - owner              (contact info; never displayed in the UI anyway,
//                        so removing it is a pure privacy win)
//   - phone              (contact info; ditto)
//   - val                (historical value series used by the val chart;
//                        the chart re-reads it from premium at render
//                        time after unlock)
//
// Fields stripped from each entry of the top-level `drive` map:
//   - anything starting with 'pdf_'
//     (pdf_main, pdf_dep_*, pdf_est_*, pdf_serv_* — partida registral
//     scans. Photos foto1..foto8 stay public — they are what the card
//     carousel displays without unlock.)
//
// Sun (histórico transaction details) is intentionally NOT stripped in
// this pass. It is used in the card / hover / area-modal price display
// which would need a bigger refactor. Removing it is a separate PR.

const fs = require('node:fs');
const path = require('node:path');

const JSON_PATH = path.join(__dirname, '..', 'data', 'properties.json');

const PREMIUM_PROP_FIELDS = ['owner', 'phone', 'val'];
const isPremiumDriveKey = (k) => k.startsWith('pdf_');

const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const properties = Array.isArray(raw.properties) ? raw.properties : [];
const drive = raw.drive && typeof raw.drive === 'object' ? raw.drive : {};

let strippedProp = 0;
for (const prop of properties) {
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
console.log(`✓ Stripped ${strippedDrive} pdf_* keys across ${Object.keys(drive).length} drive entries.`);
console.log(`✓ Wrote ${JSON_PATH}`);
