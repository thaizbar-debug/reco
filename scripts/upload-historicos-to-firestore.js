#!/usr/bin/env node
//
// Upload historicos_market.json to Firestore (_marketProtected/historicos)
//
// This script migrates the historical transaction data from the public
// static JSON file to a Firestore document that is admin-only readable
// (see firestore.rules → _marketProtected).
//
// Prerequisites:
//   1. Node.js 18+
//   2. npm install firebase-admin   (in this directory or globally)
//   3. A service account key JSON from Firebase Console:
//      Project Settings → Service accounts → Generate new private key
//      Save as scripts/serviceAccountKey.json (git-ignored)
//
// Usage:
//   node scripts/upload-historicos-to-firestore.js <path-to-historicos_market.json>
//
// Example:
//   node scripts/upload-historicos-to-firestore.js ~/backup/historicos_market.json
//
// After running:
//   1. Deploy Firestore rules: firebase deploy --only firestore:rules
//   2. Verify in admin.html that Data de Mercado loads correctly
//   3. Confirm data/historicos_market.json is removed from the repo
//

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: node upload-historicos-to-firestore.js <path-to-historicos_market.json>');
  process.exit(1);
}

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('Missing service account key at:', keyPath);
  console.error('Download from: Firebase Console → Project Settings → Service accounts → Generate new private key');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(keyPath)),
  projectId: 'reco-5a5dd'
});

const db = admin.firestore();

async function main() {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const historicos = raw.historicos || [];
  const metadata = raw.metadata || {};

  // Strip to only the fields admin.html Data de Mercado needs
  const records = historicos.map(h => ({
    distrito:         h.distrito || '',
    departamento:     h.departamento || '',
    tipo:             h.tipo || '',
    fecha_venta:      h.fecha_venta || '',
    precio_m2_usd:    h.precio_m2_usd || 0,
    precio_prop_usd:  h.precio_prop_usd || 0,
    precio_total_usd: h.precio_total_usd || 0
  }));

  console.log(`Uploading ${records.length} records to _marketProtected/historicos...`);

  await db.collection('_marketProtected').doc('historicos').set({
    records,
    metadata,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log('Done. Verify in admin.html → Data de Mercado.');
  console.log('Then deploy rules: firebase deploy --only firestore:rules');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
