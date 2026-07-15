// One-time migration: copy the sensitive histórico fields from
// data/properties.json into /propertiesHistoricoDetail/{id}.
//
// Why this exists
// ───────────────
// The public JSON currently ships price, priceTotal, priceProp,
// areaTech, areaOcup and txKey for every histórico row. `curl` on
// the raw file bypasses every UI login gate and gives a scraper the
// full 1,750-row dataset in one request. This script mirrors those
// six fields into a server-only Firestore collection so the
// getHistoricoDetail callable can serve them behind auth + AppCheck
// + rate limit. The follow-up strip PR then removes them from the
// public JSON, closing the scraping window.
//
// Usage:
//   cd functions && node scripts/migrate-hist-detail-to-firestore.js
//
// Idempotent (uses set()), safe to re-run after data updates.

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const KEY_PATH = path.join(__dirname, 'service-account-key.json');
const JSON_PATH = path.join(REPO_ROOT, 'data', 'properties.json');

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

// Fields moved out of the public JSON. cur is included because a
// price without its currency is ambiguous, and it is cheap enough
// to keep alongside.
const DETAIL_FIELDS = ['price', 'priceTotal', 'priceProp', 'areaTech', 'areaOcup', 'txKey', 'cur'];

(async () => {
  const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const properties = Array.isArray(raw.properties) ? raw.properties : [];
  const hist = properties.filter((p) => p.op === 'Histórico');

  console.log(`Read ${properties.length} properties (${hist.length} histórico).`);

  let batch = db.batch();
  let batchCount = 0;
  let migrated = 0;
  let skipped = 0;

  for (const p of hist) {
    if (!p.id) { skipped++; continue; }

    const detail = { id: String(p.id) };
    for (const f of DETAIL_FIELDS) {
      if (p[f] !== undefined && p[f] !== null) detail[f] = p[f];
    }

    batch.set(db.collection('propertiesHistoricoDetail').doc(String(p.id)), detail);
    batchCount++;
    migrated++;

    // Firestore batch cap is 500 ops. Commit at 400 to leave headroom.
    if (batchCount >= 400) {
      await batch.commit();
      console.log(`  ...committed ${migrated} / ${hist.length}`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`  ...committed ${migrated} / ${hist.length}`);
  }

  console.log(`\n✓ Wrote ${migrated} docs to /propertiesHistoricoDetail.`);
  if (skipped > 0) console.log(`  skipped: ${skipped} (no id)`);
  console.log('\nNext: deploy functions (getHistoricoDetail callable) and then run the frontend + strip PRs.');
  process.exit(0);
})().catch((err) => {
  console.error('✗ Migration failed:', err);
  process.exit(1);
});
