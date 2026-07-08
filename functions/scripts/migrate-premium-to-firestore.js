// One-time migration: extract premium fields from data/properties.json
// and write them to /propertiesPremium/{id} in Firestore.
//
// Why this exists
// ───────────────
// data/properties.json ships publicly with every page load. Every field
// in it is therefore world-readable, including owner name / phone /
// email, exact sale prices, historical transaction data and partida
// registral PDF links. The "unlock" gate that costs 1 key is theater —
// the browser already had all of it.
//
// This script moves those fields out of the JSON and into a Firestore
// collection (/propertiesPremium) that the client cannot read directly.
// The unlockProperty callable Cloud Function is the only way to get
// them, and it verifies the caller spent a key before returning.
//
// This PR only writes to Firestore. Stripping the same fields from the
// public JSON — and pointing the frontend at the callable — happens in
// the follow-up PR so behavior doesn't degrade between the two.
//
// Usage
// ─────
// 1. Firebase Console → Project settings → Service accounts →
//    "Generate new private key". Save the file as
//    functions/scripts/service-account-key.json. .gitignore covers it,
//    so it will not be committed by accident.
// 2. cd functions && node scripts/migrate-premium-to-firestore.js
//
// Idempotent: uses set() rather than add(), so re-running overwrites
// existing docs instead of duplicating them.
// Runtime: ~15–30 s for 2,663 properties on a decent connection.

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const KEY_PATH = path.join(__dirname, 'service-account-key.json');

if (!fs.existsSync(KEY_PATH)) {
  console.error('✗ Missing service account key at:', KEY_PATH);
  console.error('  Firebase Console → Project settings → Service accounts →');
  console.error('  "Generate new private key" → save the JSON as');
  console.error('  functions/scripts/service-account-key.json (gitignored).');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY_PATH)),
  projectId: 'reco-5a5dd',
});
const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────
// What we consider premium
// ─────────────────────────────────────────────────────────────────────
// Anything that (a) lets someone contact the owner without paying a
// key, or (b) lets a competitor bootstrap a rival dataset from our
// static feed without doing the price research themselves.
const PREMIUM_PROP_FIELDS = ['owner', 'phone', 'sun', 'val'];

// The `drive` top-level map has entries per property with foto1..foto8
// (public — shown in the card carousel) and pdf_* keys (partidas
// registrales, premium).
function isPremiumDriveKey(key) {
  return key.startsWith('pdf_');
}

// Property IDs like "885-RP4625-25" resolve to a `drive` key of
// "885-Alq" / "885-Com" / "885-His" depending on op.
function driveKeyFor(prop) {
  const numMatch = String(prop.id || '').match(/^(\d+)/);
  if (!numMatch) return null;
  const suffix =
    prop.op === 'Histórico' ? 'His' :
    prop.op === 'Alquiler' ? 'Alq' :
    prop.op === 'Venta' ? 'Com' : null;
  return suffix ? `${numMatch[1]}-${suffix}` : null;
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
(async () => {
  const jsonPath = path.join(REPO_ROOT, 'data', 'properties.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const properties = Array.isArray(raw.properties) ? raw.properties : [];
  const drive = raw.drive && typeof raw.drive === 'object' ? raw.drive : {};

  console.log(`Read ${properties.length} properties, ${Object.keys(drive).length} drive entries.`);

  let batch = db.batch();
  let batchCount = 0;
  let migrated = 0;
  let withPremiumCount = { owner: 0, phone: 0, sun: 0, val: 0, pdfs: 0 };
  let skipped = 0;

  for (const prop of properties) {
    const id = prop.id;
    if (!id) { skipped++; continue; }

    // address / district / op are duplicated from the public JSON into
    // the premium doc so unlockProperty can build a readable
    // "propLabel" for the keyHistory receipt without a second lookup.
    const premium = {
      id: String(id),
      address: prop.address || null,
      district: prop.district || null,
      op: prop.op || null,
    };
    for (const field of PREMIUM_PROP_FIELDS) {
      if (prop[field] !== undefined && prop[field] !== null) {
        premium[field] = prop[field];
        withPremiumCount[field]++;
      }
    }

    const dk = driveKeyFor(prop);
    if (dk && drive[dk]) {
      const pdfs = {};
      for (const [k, v] of Object.entries(drive[dk])) {
        if (isPremiumDriveKey(k)) pdfs[k] = v;
      }
      if (Object.keys(pdfs).length) {
        premium.pdfs = pdfs;
        withPremiumCount.pdfs++;
      }
    }

    batch.set(db.collection('propertiesPremium').doc(String(id)), premium);
    batchCount++;
    migrated++;

    // Firestore batch cap is 500 ops. Commit at 400 to leave headroom
    // and give clearer progress output.
    if (batchCount >= 400) {
      await batch.commit();
      console.log(`  ...committed ${migrated} / ${properties.length}`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`  ...committed ${migrated} / ${properties.length}`);
  }

  console.log(`\n✓ Wrote ${migrated} docs to /propertiesPremium.`);
  console.log(`  with owner: ${withPremiumCount.owner}`);
  console.log(`  with phone: ${withPremiumCount.phone}`);
  console.log(`  with sun (histórico data): ${withPremiumCount.sun}`);
  console.log(`  with val (historical values): ${withPremiumCount.val}`);
  console.log(`  with pdfs (partidas): ${withPremiumCount.pdfs}`);
  if (skipped > 0) console.log(`  skipped: ${skipped} (no id)`);
  console.log('\nNext step: run the follow-up PR that strips the same fields from the public JSON and points the frontend at the unlockProperty callable.');

  process.exit(0);
})().catch((err) => {
  console.error('✗ Migration failed:', err);
  process.exit(1);
});
