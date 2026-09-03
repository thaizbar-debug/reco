#!/usr/bin/env node
/**
 * PHASE 2B-0.5 REGRESSION TESTS
 *
 * Validates invariants of the acceptance framework.
 * These tests run against the CURRENT analysis results and verify that
 * the hard gate framework correctly prevents false positives.
 *
 * Usage: node tools/etl/pilot_regression_tests.js
 *
 * Tests that fail if:
 *   1. A dataset classified as BLOCK obtains PASS for parcel_master
 *   2. A dataset with coverage < 5% obtains PASS
 *   3. A LineString is automatically converted to Polygon
 *   4. parcel_master files are modified during the pilot
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = path.resolve(__dirname, '../..');
const RESULTS_FILE = path.join(BASE, 'data/reports/pilot_analysis_results.json');
const PUBLISHED_DIR = path.join(BASE, 'data/published/catastro');

const PILOT_SLUGS = ['miraflores', 'la-victoria', 'surquillo', 'chorrillos', 'san-juan-de-lurigancho'];

// Known checksums of parcel_master files at Phase 2B-0.5 baseline
// These are computed on first run and stored; subsequent runs compare.
const CHECKSUM_FILE = path.join(BASE, 'data/reports/parcel_master_checksums.json');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === 'SKIP') {
      skipped++;
      console.log(`  [SKIP] ${name}`);
    } else if (result === true) {
      passed++;
      console.log(`  [PASS] ${name}`);
    } else {
      failed++;
      console.log(`  [FAIL] ${name} — ${result}`);
    }
  } catch (e) {
    failed++;
    console.log(`  [FAIL] ${name} — ${e.message}`);
  }
}

function main() {
  console.log('PHASE 2B-0.5 REGRESSION TESTS');
  console.log('='.repeat(50));

  // Load analysis results
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`No analysis results at ${RESULTS_FILE}. Run pilot:analyze first.`);
    process.exit(1);
  }
  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const districts = results.districts || {};

  console.log('\n1. BLOCK datasets must NOT get PASS for parcel_master');
  console.log('-'.repeat(50));

  for (const slug of PILOT_SLUGS) {
    const d = districts[slug];
    if (!d) { test(`${slug}: has data`, () => 'SKIP'); continue; }

    test(`${slug}: BLOCK → not PASS`, () => {
      if (d.semantic_classification === 'BLOCK') {
        if (d.final_status === 'PASS') {
          return `BLOCK dataset got PASS (score=${d.acceptance_score.total})`;
        }
        if (d.final_status !== 'NOT_USABLE_FOR_PARCEL_MASTER' && d.final_status !== 'REJECT') {
          // CONDITIONAL is OK if it's not claiming parcel_master readiness
          if (d.final_status === 'CONDITIONAL' && d.hard_gates && d.hard_gates.gates.semantic && d.hard_gates.gates.semantic.status === 'FAIL') {
            return true; // Hard gate correctly caught it even if final is CONDITIONAL
          }
        }
        return true;
      }
      return true;
    });
  }

  console.log('\n2. Coverage < 5% must NOT get PASS');
  console.log('-'.repeat(50));

  for (const slug of PILOT_SLUGS) {
    const d = districts[slug];
    if (!d) { test(`${slug}: has data`, () => 'SKIP'); continue; }

    test(`${slug}: low coverage → not PASS`, () => {
      if (!d.coverage_pct && d.coverage_pct !== 0) return 'SKIP';
      if (d.coverage_pct < 5 && d.final_status === 'PASS') {
        return `Coverage ${d.coverage_pct}% got PASS`;
      }
      return true;
    });
  }

  console.log('\n3. Open LineStrings must NOT be auto-converted to Polygon');
  console.log('-'.repeat(50));

  for (const slug of PILOT_SLUGS) {
    const d = districts[slug];
    if (!d) { test(`${slug}: has data`, () => 'SKIP'); continue; }

    test(`${slug}: no auto LS→Polygon conversion`, () => {
      const existing = d.existing && d.existing.published;
      if (!existing || !existing.linestring_analysis) return 'SKIP';

      const lsAnalysis = existing.linestring_analysis;
      if (lsAnalysis.open > 0 && lsAnalysis.conversion_viability === 'NOT_VIABLE') {
        // Verify no open LineStrings were silently counted as parcels
        const analysis = existing.analysis;
        if (analysis && analysis.polygons === analysis.feature_count && lsAnalysis.open > 0) {
          return `${lsAnalysis.open} open LineStrings may have been silently converted`;
        }
      }
      return true;
    });
  }

  console.log('\n4. parcel_master files unchanged during pilot');
  console.log('-'.repeat(50));

  // Compute current checksums of ALL published catastro files
  const currentChecksums = {};
  if (fs.existsSync(PUBLISHED_DIR)) {
    const files = fs.readdirSync(PUBLISHED_DIR).filter(f => f.endsWith('.geojson.gz'));
    for (const file of files) {
      const fp = path.join(PUBLISHED_DIR, file);
      const hash = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
      currentChecksums[file] = hash;
    }
  }

  if (fs.existsSync(CHECKSUM_FILE)) {
    const baseline = JSON.parse(fs.readFileSync(CHECKSUM_FILE, 'utf8'));
    const baselineFiles = Object.keys(baseline.checksums || {});

    for (const file of baselineFiles) {
      test(`parcel_master: ${file}`, () => {
        if (!currentChecksums[file]) {
          return `File missing from published/catastro/`;
        }
        if (currentChecksums[file] !== baseline.checksums[file]) {
          return `Checksum changed! Baseline: ${baseline.checksums[file].slice(0, 12)}... Current: ${currentChecksums[file].slice(0, 12)}...`;
        }
        return true;
      });
    }
  } else {
    // First run — save baseline
    const baseline = {
      created: new Date().toISOString(),
      phase: '2B-0.5',
      file_count: Object.keys(currentChecksums).length,
      checksums: currentChecksums,
    };
    fs.mkdirSync(path.dirname(CHECKSUM_FILE), { recursive: true });
    fs.writeFileSync(CHECKSUM_FILE, JSON.stringify(baseline, null, 2));
    console.log(`  Baseline created: ${Object.keys(currentChecksums).length} files checksummed.`);
    test('parcel_master: baseline saved', () => true);
  }

  console.log('\n5. Hard gate framework consistency');
  console.log('-'.repeat(50));

  for (const slug of PILOT_SLUGS) {
    const d = districts[slug];
    if (!d || d.final_status === 'NO_DATA') { test(`${slug}: has data`, () => 'SKIP'); continue; }

    test(`${slug}: hard gate FAIL → not PASS`, () => {
      if (d.hard_gates && d.hard_gates.overall === 'FAIL' && d.final_status === 'PASS') {
        return `Hard gates FAIL but final_status is PASS`;
      }
      return true;
    });

    test(`${slug}: semantic BLOCK → NOT_USABLE`, () => {
      if (d.hard_gates && d.hard_gates.gates.semantic && d.hard_gates.gates.semantic.dataset_type === 'BLOCK') {
        if (d.final_status !== 'NOT_USABLE_FOR_PARCEL_MASTER') {
          return `Semantic=BLOCK but final_status=${d.final_status}`;
        }
      }
      return true;
    });

    test(`${slug}: score present with data`, () => {
      if (!d.acceptance_score || d.acceptance_score.total === undefined) {
        return 'Missing acceptance score';
      }
      return true;
    });
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    console.log('REGRESSION DETECTED');
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED');
  }
}

main();
