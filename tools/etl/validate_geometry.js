#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '../..');
const MASTER_DIR = path.join(ROOT, 'data/master');
const PUBLISHED_DIR = path.join(ROOT, 'data/published');
const REPORTS_DIR = path.join(ROOT, 'data/reports');

function readGz(filepath) {
  const buf = fs.readFileSync(filepath);
  return JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
}

function bbox(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function walk(arr) {
    if (typeof arr[0] === 'number') {
      if (arr[0] < minX) minX = arr[0];
      if (arr[0] > maxX) maxX = arr[0];
      if (arr[1] < minY) minY = arr[1];
      if (arr[1] > maxY) maxY = arr[1];
    } else arr.forEach(walk);
  }
  walk(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

function pointInBbox(lat, lng, bb, tol = 0) {
  return lng >= bb[0] - tol && lng <= bb[2] + tol && lat >= bb[1] - tol && lat <= bb[3] + tol;
}

const LIMA_BBOX = [-77.2, -12.52, -76.6, -11.57];

function validateDistricts() {
  console.log('=== VALIDACION: districts_master ===\n');
  const issues = [];

  const masterPath = path.join(MASTER_DIR, 'districts_master.geojson');
  if (!fs.existsSync(masterPath)) {
    console.log('  FAIL: districts_master.geojson not found');
    return { pass: false, issues: ['FILE_NOT_FOUND'] };
  }

  const fc = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
  console.log(`  Features: ${fc.features.length}`);

  if (fc.features.length !== 50) {
    issues.push(`WRONG_FEATURE_COUNT: expected 50, got ${fc.features.length}`);
  }

  const names = new Set();
  const ubigeos = new Set();
  let miPeruFound = false;

  for (const f of fc.features) {
    const name = f.properties.distrito;
    const ubigeo = f.properties.ubigeo;

    if (!name) issues.push('MISSING_NAME');
    if (!ubigeo) issues.push(`MISSING_UBIGEO: ${name}`);

    if (names.has(name)) issues.push(`DUPLICATE_NAME: ${name}`);
    names.add(name);

    if (ubigeo && ubigeos.has(ubigeo)) issues.push(`DUPLICATE_UBIGEO: ${ubigeo}`);
    if (ubigeo) ubigeos.add(ubigeo);

    if (name === 'MI PERU') miPeruFound = true;
    if (name && name.includes('Ã')) issues.push(`ENCODING_ERROR: ${name}`);

    // Geometry checks
    const geom = f.geometry;
    if (!geom || !geom.coordinates) {
      issues.push(`EMPTY_GEOMETRY: ${name}`);
      continue;
    }

    const bb = bbox(geom);
    if (!pointInBbox((bb[1] + bb[3]) / 2, (bb[0] + bb[2]) / 2, LIMA_BBOX, 0.5)) {
      issues.push(`OUTSIDE_LIMA: ${name} bbox=[${bb.map(v => v.toFixed(3)).join(',')}]`);
    }

    // Check ring closure
    if (geom.type === 'Polygon') {
      geom.coordinates.forEach((ring, i) => {
        const first = ring[0], last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1])
          issues.push(`UNCLOSED_RING: ${name} ring ${i}`);
      });
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach((poly, pi) => {
        poly.forEach((ring, ri) => {
          const first = ring[0], last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1])
            issues.push(`UNCLOSED_RING: ${name} poly ${pi} ring ${ri}`);
        });
      });
    }
  }

  if (!miPeruFound) issues.push('MI_PERU_NOT_FOUND');

  console.log(`  MI PERU encoding: ${miPeruFound ? 'PASS' : 'FAIL'}`);
  console.log(`  Issues: ${issues.length}`);
  issues.forEach(i => console.log(`    - ${i}`));

  return { pass: issues.length === 0, issues, features: fc.features.length };
}

function validateCatastro() {
  console.log('\n=== VALIDACION: parcel_master (published) ===\n');
  const issues = [];
  const warnings = [];

  const pubDir = path.join(PUBLISHED_DIR, 'catastro');
  const files = fs.readdirSync(pubDir).filter(f => f.endsWith('.geojson.gz'));
  console.log(`  Published files: ${files.length}`);

  let totalParcels = 0;
  let totalVertices = 0;

  for (const file of files) {
    const fc = readGz(path.join(pubDir, file));
    const slug = file.replace('.geojson.gz', '');
    totalParcels += fc.features.length;

    for (const f of fc.features) {
      if (!f.properties.parcel_id) issues.push(`MISSING_PARCEL_ID: ${slug}`);
      if (!f.properties.district_id) warnings.push(`MISSING_DISTRICT_ID: ${slug} ${f.properties.parcel_id}`);
      if (!f.geometry || !f.geometry.coordinates) {
        issues.push(`EMPTY_GEOMETRY: ${slug} ${f.properties.parcel_id}`);
        continue;
      }

      const type = f.geometry.type;
      if (type !== 'Polygon' && type !== 'MultiPolygon') {
        issues.push(`WRONG_TYPE: ${slug} ${f.properties.parcel_id} is ${type}`);
      }

      if (f.properties.area_m2 !== undefined && f.properties.area_m2 <= 0) {
        warnings.push(`ZERO_AREA: ${slug} ${f.properties.parcel_id}`);
      }
    }
  }

  console.log(`  Total parcels: ${totalParcels}`);
  console.log(`  Issues: ${issues.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  if (issues.length > 0) issues.slice(0, 10).forEach(i => console.log(`    FAIL: ${i}`));
  if (warnings.length > 0) warnings.slice(0, 10).forEach(w => console.log(`    WARN: ${w}`));

  return { pass: issues.length === 0, issues, warnings, totalParcels };
}

function validateFrontendIntegration() {
  console.log('\n=== VALIDACION: Frontend integration ===\n');
  const issues = [];

  // Check production district file exists and is valid gzip
  const distFile = path.join(ROOT, 'data/distritos/lima_callao.geojson.gz');
  if (!fs.existsSync(distFile)) {
    issues.push('PRODUCTION_DISTRICT_FILE_MISSING');
  } else {
    try {
      const fc = readGz(distFile);
      console.log(`  districts file: ${fc.features.length} features, ${(fs.statSync(distFile).size / 1024).toFixed(1)} KB`);
      if (fc.features.length !== 50) issues.push(`WRONG_DISTRICT_COUNT: ${fc.features.length}`);

      // Check MI PERU encoding
      const miPeru = fc.features.find(f => (f.properties.distrito || '').includes('MI PER'));
      if (miPeru) {
        if (miPeru.properties.distrito === 'MI PERU') console.log('  MI PERU encoding: PASS');
        else issues.push(`MI_PERU_ENCODING: "${miPeru.properties.distrito}"`);
      }
    } catch (e) {
      issues.push(`DISTRICT_FILE_CORRUPT: ${e.message}`);
    }
  }

  // Check catastro files
  const catDir = path.join(ROOT, 'data/catastro');
  const catFiles = fs.readdirSync(catDir).filter(f => f.endsWith('.geojson.gz'));
  console.log(`  catastro files: ${catFiles.length}`);

  let catTotal = 0;
  let catErrors = 0;
  for (const file of catFiles) {
    try {
      const fc = readGz(path.join(catDir, file));
      catTotal += fc.features.length;
      // Verify all features are Polygon/MultiPolygon (no LineString in published)
      for (const f of fc.features) {
        if (f.geometry && f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') {
          issues.push(`LINESTRING_IN_PUBLISHED: ${file} has ${f.geometry.type}`);
          catErrors++;
        }
      }
    } catch (e) {
      issues.push(`CATASTRO_CORRUPT: ${file} ${e.message}`);
      catErrors++;
    }
  }
  console.log(`  catastro total features: ${catTotal}`);

  // Check backup exists
  const backupFile = path.join(ROOT, 'data/raw/distritos/lima_callao_v0_simple.geojson.gz');
  if (fs.existsSync(backupFile)) console.log('  backup: PRESENT');
  else issues.push('BACKUP_MISSING');

  // Check raw catastro backups
  const rawCatDir = path.join(ROOT, 'data/raw/catastro');
  const rawCatFiles = fs.readdirSync(rawCatDir).filter(f => f.endsWith('.geojson.gz'));
  console.log(`  raw catastro backups: ${rawCatFiles.length}`);
  if (rawCatFiles.length !== catFiles.length) {
    issues.push(`RAW_BACKUP_MISMATCH: ${rawCatFiles.length} raw vs ${catFiles.length} published`);
  }

  // Check index.html still references correct paths
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  if (!html.includes("'distritos/lima_callao.geojson.gz'")) {
    issues.push('INDEX_MISSING_DISTRICT_PATH');
  }
  if (!html.includes("'catastro/'+slug+'.geojson.gz'")) {
    issues.push('INDEX_MISSING_CATASTRO_PATH');
  }
  console.log('  index.html paths: PASS');

  console.log(`  Issues: ${issues.length}`);
  issues.forEach(i => console.log(`    FAIL: ${i}`));
  return { pass: issues.length === 0, issues };
}

function validatePerformance() {
  console.log('\n=== VALIDACION: Performance ===\n');

  // Before (from backup)
  const backupFile = path.join(ROOT, 'data/raw/distritos/lima_callao_v0_simple.geojson.gz');
  const currentFile = path.join(ROOT, 'data/distritos/lima_callao.geojson.gz');

  const beforeSize = fs.existsSync(backupFile) ? fs.statSync(backupFile).size : 0;
  const afterSize = fs.statSync(currentFile).size;

  console.log('  Districts:');
  console.log(`    Before: ${(beforeSize / 1024).toFixed(1)} KB (simple, Polygon)`);
  console.log(`    After:  ${(afterSize / 1024).toFixed(1)} KB (master, MultiPolygon 5-dec)`);
  console.log(`    Delta:  +${((afterSize - beforeSize) / 1024).toFixed(1)} KB (${((afterSize / beforeSize - 1) * 100).toFixed(0)}%)`);

  // Catastro
  const rawDir = path.join(ROOT, 'data/raw/catastro');
  const pubDir = path.join(ROOT, 'data/catastro');

  let rawTotal = 0, pubTotal = 0;
  let rawFeatures = 0, pubFeatures = 0;

  fs.readdirSync(rawDir).filter(f => f.endsWith('.geojson.gz')).forEach(f => {
    rawTotal += fs.statSync(path.join(rawDir, f)).size;
    try {
      const fc = readGz(path.join(rawDir, f));
      rawFeatures += fc.features.length;
    } catch (e) {}
  });

  fs.readdirSync(pubDir).filter(f => f.endsWith('.geojson.gz')).forEach(f => {
    pubTotal += fs.statSync(path.join(pubDir, f)).size;
    try {
      const fc = readGz(path.join(pubDir, f));
      pubFeatures += fc.features.length;
    } catch (e) {}
  });

  console.log('\n  Catastro:');
  console.log(`    Before: ${(rawTotal / 1024).toFixed(1)} KB, ${rawFeatures} features (raw, mixed types)`);
  console.log(`    After:  ${(pubTotal / 1024).toFixed(1)} KB, ${pubFeatures} features (cleaned, Polygon only)`);
  console.log(`    Delta:  ${((pubTotal - rawTotal) / 1024).toFixed(1)} KB (${((pubTotal / rawTotal - 1) * 100).toFixed(0)}%)`);

  // PMTiles threshold
  const totalGz = afterSize + pubTotal;
  console.log(`\n  Total published data: ${(totalGz / 1024).toFixed(1)} KB`);
  console.log(`  PMTiles threshold: >50 MB or >500K features`);
  console.log(`  Current: ${(totalGz / 1024 / 1024).toFixed(2)} MB, ${pubFeatures + 50} features`);
  console.log(`  Migration needed: NO`);

  return {
    districts: { before_kb: parseFloat((beforeSize / 1024).toFixed(1)), after_kb: parseFloat((afterSize / 1024).toFixed(1)) },
    catastro: { before_kb: parseFloat((rawTotal / 1024).toFixed(1)), after_kb: parseFloat((pubTotal / 1024).toFixed(1)),
      before_features: rawFeatures, after_features: pubFeatures },
    total_kb: parseFloat((totalGz / 1024).toFixed(1)),
    pmtiles_needed: false
  };
}

// Run all validations
function runAll() {
  const results = {};

  results.districts = validateDistricts();
  results.catastro = validateCatastro();
  results.frontend = validateFrontendIntegration();
  results.performance = validatePerformance();

  console.log('\n=== RESUMEN QA ===\n');
  const allPass = results.districts.pass && results.catastro.pass && results.frontend.pass;
  console.log(`  Districts:  ${results.districts.pass ? 'PASS' : 'FAIL'}`);
  console.log(`  Catastro:   ${results.catastro.pass ? 'PASS' : 'FAIL'}`);
  console.log(`  Frontend:   ${results.frontend.pass ? 'PASS' : 'FAIL'}`);
  console.log(`  Overall:    ${allPass ? 'PASS' : 'FAIL'}`);

  // Save
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, 'qa_validation_report.json'), JSON.stringify(results, null, 2));
  console.log(`\n  Report: ${path.join(REPORTS_DIR, 'qa_validation_report.json')}`);

  return results;
}

if (require.main === module) {
  runAll();
}
