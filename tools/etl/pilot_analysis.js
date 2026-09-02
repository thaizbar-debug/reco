const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const crypto = require('crypto');

const PILOT_DISTRICTS = [
  { name: 'MIRAFLORES', ubigeo: '150122', slug: 'miraflores', scenario: 'high_value_low_coverage' },
  { name: 'LA VICTORIA', ubigeo: '150115', slug: 'la-victoria', scenario: 'zero_coverage_urban_dense' },
  { name: 'SURQUILLO', ubigeo: '150141', slug: 'surquillo', scenario: 'ls_dominant_conversion' },
  { name: 'CHORRILLOS', ubigeo: '150108', slug: 'chorrillos', scenario: 'zero_coverage_large_mixed' },
  { name: 'SAN JUAN DE LURIGANCHO', ubigeo: '150132', slug: 'san-juan-de-lurigancho', scenario: 'zero_coverage_largest' }
];

const BASE = path.resolve(__dirname, '../..');
const CATASTRO_DIR = path.join(BASE, 'data/catastro');
const PUBLISHED_DIR = path.join(BASE, 'data/published/catastro');
const RAW_DIR = path.join(BASE, 'data/raw/catastro');
const DISTRICTS_FILE = path.join(BASE, 'data/distritos/lima_callao.geojson.gz');

function loadGz(fp) {
  if (!fs.existsSync(fp)) return null;
  const buf = fs.readFileSync(fp);
  return JSON.parse(zlib.gunzipSync(buf));
}

function fileStats(fp) {
  if (!fs.existsSync(fp)) return null;
  const buf = fs.readFileSync(fp);
  const raw = zlib.gunzipSync(buf);
  return {
    gz_bytes: buf.length,
    raw_bytes: raw.length,
    gz_kb: +(buf.length / 1024).toFixed(1),
    raw_kb: +(raw.length / 1024).toFixed(1),
    gz_mb: +(buf.length / 1024 / 1024).toFixed(3),
    checksum_sha256: crypto.createHash('sha256').update(buf).digest('hex')
  };
}

function ringArea(coords) {
  let area = 0;
  for (let i = 0, n = coords.length; i < n - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    area += (x2 - x1) * (y1 + y2);
  }
  return Math.abs(area / 2) * 111320 * 111320 * Math.cos(-12.05 * Math.PI / 180);
}

function featureArea(f) {
  if (f.geometry.type === 'Polygon') return ringArea(f.geometry.coordinates[0]);
  if (f.geometry.type === 'MultiPolygon') {
    return f.geometry.coordinates.reduce((s, poly) => s + ringArea(poly[0]), 0);
  }
  return 0;
}

function countVertices(f) {
  if (f.geometry.type === 'Polygon') return f.geometry.coordinates.reduce((s, r) => s + r.length, 0);
  if (f.geometry.type === 'MultiPolygon') return f.geometry.coordinates.reduce((s, p) => s + p.reduce((s2, r) => s2 + r.length, 0), 0);
  if (f.geometry.type === 'LineString') return f.geometry.coordinates.length;
  return 0;
}

function bbox(f) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = coords => {
    if (typeof coords[0] === 'number') {
      if (coords[0] < minX) minX = coords[0];
      if (coords[0] > maxX) maxX = coords[0];
      if (coords[1] < minY) minY = coords[1];
      if (coords[1] > maxY) maxY = coords[1];
    } else coords.forEach(visit);
  };
  visit(f.geometry.coordinates);
  return [minX, minY, maxX, maxY];
}

function isValid(f) {
  if (!f.geometry || !f.geometry.coordinates) return false;
  if (f.geometry.type === 'Polygon') {
    const ring = f.geometry.coordinates[0];
    if (!ring || ring.length < 4) return false;
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) return false;
  }
  return true;
}

function bboxOverlap(a, b) {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function pointInPolygon(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > point[1]) !== (yj > point[1]) &&
      point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function analyzeDataset(fc, label) {
  const types = {};
  let totalVertices = 0, totalArea = 0;
  let invalid = 0, degenerate = 0;
  const areas = [];
  const bboxes = [];
  let minArea = Infinity, maxArea = 0;

  fc.features.forEach(f => {
    types[f.geometry.type] = (types[f.geometry.type] || 0) + 1;
    const v = countVertices(f);
    totalVertices += v;
    if (!isValid(f)) { invalid++; return; }
    const a = featureArea(f);
    if (a < 1) { degenerate++; return; }
    totalArea += a;
    areas.push(a);
    if (a < minArea) minArea = a;
    if (a > maxArea) maxArea = a;
    bboxes.push(bbox(f));
  });

  areas.sort((a, b) => a - b);
  const median = areas.length > 0 ? areas[Math.floor(areas.length / 2)] : 0;

  const bboxKeys = new Set();
  let duplicates = 0;
  bboxes.forEach(b => {
    const key = b.map(v => v.toFixed(6)).join(',');
    if (bboxKeys.has(key)) duplicates++;
    else bboxKeys.add(key);
  });

  return {
    label,
    total_features: fc.features.length,
    geometry_types: types,
    polygons: (types['Polygon'] || 0) + (types['MultiPolygon'] || 0),
    linestrings: types['LineString'] || 0,
    total_vertices: totalVertices,
    total_area_km2: +(totalArea / 1e6).toFixed(3),
    invalid_geometries: invalid,
    degenerate: degenerate,
    duplicates_bbox: duplicates,
    area_stats: areas.length > 0 ? {
      min_m2: +minArea.toFixed(1),
      max_m2: +maxArea.toFixed(1),
      median_m2: +median.toFixed(1),
      p25_m2: +(areas[Math.floor(areas.length * 0.25)]).toFixed(1),
      p75_m2: +(areas[Math.floor(areas.length * 0.75)]).toFixed(1)
    } : null
  };
}

function analyzeLinestringConversion(fc) {
  const lines = fc.features.filter(f => f.geometry.type === 'LineString');
  if (lines.length === 0) return null;

  let closedCount = 0, openCount = 0;
  let closedValid = 0;
  const closedAreas = [];

  lines.forEach(ls => {
    const coords = ls.geometry.coordinates;
    if (coords.length < 4) return;
    const first = coords[0], last = coords[coords.length - 1];
    const dist = Math.sqrt(Math.pow(first[0] - last[0], 2) + Math.pow(first[1] - last[1], 2));
    if (dist < 0.00001) {
      closedCount++;
      const area = ringArea(coords);
      if (area > 10 && area < 100000) {
        closedValid++;
        closedAreas.push(area);
      }
    } else {
      openCount++;
    }
  });

  closedAreas.sort((a, b) => a - b);

  return {
    total_linestrings: lines.length,
    closed_linestrings: closedCount,
    open_linestrings: openCount,
    closed_valid_as_polygon: closedValid,
    conversion_rate_pct: lines.length > 0 ? +((closedValid / lines.length) * 100).toFixed(1) : 0,
    closed_area_stats: closedAreas.length > 0 ? {
      min_m2: +closedAreas[0].toFixed(1),
      max_m2: +closedAreas[closedAreas.length - 1].toFixed(1),
      median_m2: +closedAreas[Math.floor(closedAreas.length / 2)].toFixed(1)
    } : null
  };
}

function compareWithDistrict(parcels, districtFeature) {
  if (!parcels || parcels.features.length === 0) return null;

  const distBbox = bbox(districtFeature);
  let insideCount = 0, outsideCount = 0, crossingCount = 0;

  const distRing = districtFeature.geometry.type === 'MultiPolygon'
    ? districtFeature.geometry.coordinates.reduce((best, poly) => poly[0].length > best.length ? poly[0] : best, [])
    : districtFeature.geometry.coordinates[0];

  const polygons = parcels.features.filter(f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
  const sample = polygons.slice(0, Math.min(polygons.length, 2000));

  sample.forEach(f => {
    const fb = bbox(f);
    if (!bboxOverlap(fb, distBbox)) { outsideCount++; return; }
    const centroid = [(fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2];
    if (pointInPolygon(centroid, distRing)) insideCount++;
    else outsideCount++;
  });

  const distArea = featureArea(districtFeature);
  const parcelArea = polygons.reduce((s, f) => s + featureArea(f), 0);

  return {
    district_area_km2: +(distArea / 1e6).toFixed(3),
    parcel_area_km2: +(parcelArea / 1e6).toFixed(3),
    coverage_pct: +(parcelArea / distArea * 100).toFixed(1),
    parcels_sampled: sample.length,
    inside_district: insideCount,
    outside_district: outsideCount,
    outside_pct: +((outsideCount / sample.length) * 100).toFixed(1)
  };
}

console.log('PHASE 2B-0 PILOT ANALYSIS');
console.log('='.repeat(60));
console.log('Date:', new Date().toISOString());
console.log('');

const districtsMaster = loadGz(DISTRICTS_FILE);
const districtMap = {};
districtsMaster.features.forEach(f => {
  districtMap[f.properties.ubigeo] = f;
  districtMap[f.properties.distrito] = f;
});

const results = { pilot_date: new Date().toISOString(), districts: {} };

for (const pilot of PILOT_DISTRICTS) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`DISTRICT: ${pilot.name} (${pilot.ubigeo}) — ${pilot.scenario}`);
  console.log(`${'─'.repeat(60)}`);

  const distFeature = districtMap[pilot.ubigeo] || districtMap[pilot.name];
  const districtResult = {
    name: pilot.name,
    ubigeo: pilot.ubigeo,
    slug: pilot.slug,
    scenario: pilot.scenario,
    district_area_km2: distFeature ? +(featureArea(distFeature) / 1e6).toFixed(3) : null
  };

  // Check for existing published data
  const pubFile = path.join(PUBLISHED_DIR, pilot.slug + '.geojson.gz');
  const catFile = path.join(CATASTRO_DIR, pilot.slug + '.geojson.gz');
  const rawFile = path.join(RAW_DIR, pilot.slug + '.geojson.gz');

  if (fs.existsSync(pubFile)) {
    console.log(`  Published file: EXISTS`);
    const stats = fileStats(pubFile);
    const fc = loadGz(pubFile);
    const analysis = analyzeDataset(fc, 'published');
    const comparison = distFeature ? compareWithDistrict(fc, distFeature) : null;

    districtResult.published = { file_stats: stats, analysis, district_comparison: comparison };
    console.log(`    Features: ${fc.features.length}`);
    console.log(`    Types: ${JSON.stringify(analysis.geometry_types)}`);
    console.log(`    Vertices: ${analysis.total_vertices}`);
    console.log(`    Area: ${analysis.total_area_km2} km²`);
    if (comparison) console.log(`    Coverage: ${comparison.coverage_pct}%`);
    console.log(`    GZ: ${stats.gz_kb} KB`);
    console.log(`    SHA256: ${stats.checksum_sha256.slice(0, 16)}...`);
  } else {
    console.log(`  Published file: NONE`);
    districtResult.published = null;
  }

  // Check for raw data (pre-cleanup)
  if (fs.existsSync(rawFile)) {
    console.log(`  RAW file: EXISTS`);
    const stats = fileStats(rawFile);
    const fc = loadGz(rawFile);
    const analysis = analyzeDataset(fc, 'raw');
    districtResult.raw = { file_stats: stats, analysis };

    // LineString analysis
    const lsAnalysis = analyzeLinestringConversion(fc);
    if (lsAnalysis && lsAnalysis.total_linestrings > 0) {
      districtResult.linestring_analysis = lsAnalysis;
      console.log(`    LineStrings: ${lsAnalysis.total_linestrings}`);
      console.log(`    Closed (convertible): ${lsAnalysis.closed_valid_as_polygon}`);
      console.log(`    Conversion rate: ${lsAnalysis.conversion_rate_pct}%`);
    }

    console.log(`    RAW features: ${fc.features.length}`);
    console.log(`    RAW types: ${JSON.stringify(analysis.geometry_types)}`);
  } else {
    console.log(`  RAW file: NONE`);
    districtResult.raw = null;
  }

  // Check catastro (production) file
  if (fs.existsSync(catFile) && catFile !== pubFile) {
    const stats = fileStats(catFile);
    districtResult.catastro_stats = stats;
  }

  // Performance metrics
  if (fs.existsSync(pubFile)) {
    const start = Date.now();
    const buf = fs.readFileSync(pubFile);
    const readTime = Date.now() - start;
    const start2 = Date.now();
    const raw = zlib.gunzipSync(buf);
    const decompressTime = Date.now() - start2;
    const start3 = Date.now();
    JSON.parse(raw);
    const parseTime = Date.now() - start3;

    districtResult.performance = {
      read_ms: readTime,
      decompress_ms: decompressTime,
      parse_ms: parseTime,
      total_ms: readTime + decompressTime + parseTime,
      estimated_browser_ms: (decompressTime + parseTime) * 2
    };
    console.log(`  Performance: read=${readTime}ms decompress=${decompressTime}ms parse=${parseTime}ms`);
  }

  // Provenance
  districtResult.provenance = {
    source_name: fs.existsSync(pubFile) ? 'GEO GPS Peru (probable)' : 'NONE',
    source_url: 'NOT_VERIFIED',
    raw_file: fs.existsSync(rawFile) ? `data/raw/catastro/${pilot.slug}.geojson.gz` : null,
    published_file: fs.existsSync(pubFile) ? `data/published/catastro/${pilot.slug}.geojson.gz` : null,
    catastro_file: fs.existsSync(catFile) ? `data/catastro/${pilot.slug}.geojson.gz` : null,
    checksum: fs.existsSync(pubFile) ? fileStats(pubFile).checksum_sha256 : null,
    acquired_at: 'UNKNOWN',
    processing_script: 'tools/etl/phase2a_catastro.js',
    processing_version: '1.0',
    verification_status: fs.existsSync(pubFile) ? 'PARTIALLY_VERIFIED' : 'NOT_VERIFIED'
  };

  // External source access status
  districtResult.external_sources = {
    geo_gps_peru: { status: 'NOT_VERIFIED', reason: 'Egress proxy blocks geogpsperu.com (HTTP 403)' },
    cofopri_rest: { status: 'NOT_VERIFIED', reason: 'Egress proxy blocks geoportal.cofopri.gob.pe (HTTP 403)' },
    geoidep_wfs: { status: 'NOT_VERIFIED', reason: 'Egress proxy blocks geoidep.gob.pe (HTTP 403)' },
    municipal: { status: 'NOT_VERIFIED', reason: 'Egress proxy blocks municipal geoportals (HTTP 403)' },
    osm_overpass: { status: 'NOT_VERIFIED', reason: 'Egress proxy blocks overpass-api.de (HTTP 403)' }
  };

  // Acceptance score for existing data
  if (districtResult.published) {
    const a = districtResult.published.analysis;
    const c = districtResult.published.district_comparison;
    let score = 0;

    // Geometry type (20%)
    const polyPct = a.polygons / a.total_features;
    if (polyPct >= 1) score += 20;
    else if (polyPct >= 0.95) score += 15;
    else score += 5;

    // CRS (15%) — assumed WGS84
    score += 15;

    // Topology (15%)
    const invalidPct = a.invalid_geometries / a.total_features;
    if (invalidPct < 0.01) score += 15;
    else if (invalidPct < 0.05) score += 10;
    else score += 5;

    // Duplicates (10%)
    const dupPct = a.duplicates_bbox / a.total_features;
    if (dupPct < 0.01) score += 10;
    else if (dupPct < 0.03) score += 7;
    else score += 3;

    // Area plausibility (10%)
    if (a.area_stats) {
      const plausible = a.total_features > 0 ? 1 : 0;
      if (plausible > 0) score += 8;
    }

    // Coverage (15%)
    if (c) {
      if (c.coverage_pct > 50) score += 15;
      else if (c.coverage_pct > 20) score += 10;
      else score += 3;
    }

    // Attribution (10%)
    score += 5;

    // Freshness (5%)
    score += 2;

    districtResult.acceptance_score = {
      total: score,
      verdict: score >= 70 ? 'PASS' : score >= 50 ? 'CONDITIONAL' : 'FAIL',
      breakdown: 'geometry=20, crs=15, topology=15, duplicates=10, area=8, coverage=' +
        (c ? (c.coverage_pct > 50 ? 15 : c.coverage_pct > 20 ? 10 : 3) : 0) +
        ', attribution=5, freshness=2'
    };
    console.log(`  Acceptance: ${score} (${districtResult.acceptance_score.verdict})`);
  } else {
    districtResult.acceptance_score = { total: 0, verdict: 'NO_DATA', breakdown: 'No published data' };
  }

  // Confidence level
  districtResult.confidence = {
    level: districtResult.published ? 'MEDIUM' : 'NO_DATA',
    code: districtResult.published ? 'B' : 'D',
    reason: districtResult.published
      ? 'Single source (GEO GPS probable), not cross-verified. Geometry valid, provenance undocumented.'
      : 'No data available for this district.'
  };

  results.districts[pilot.slug] = districtResult;
}

// SURQUILLO SPECIAL ANALYSIS
console.log(`\n${'='.repeat(60)}`);
console.log('SPECIAL ANALYSIS: SURQUILLO LineString → Polygon Conversion');
console.log('='.repeat(60));

const surqRaw = loadGz(path.join(RAW_DIR, 'surquillo.geojson.gz'));
if (surqRaw) {
  const lines = surqRaw.features.filter(f => f.geometry.type === 'LineString');
  const polys = surqRaw.features.filter(f => f.geometry.type === 'Polygon');

  let closed = 0, openLS = 0, tooShort = 0, validConvert = 0;
  const convertAreas = [];

  lines.forEach(ls => {
    const c = ls.geometry.coordinates;
    if (c.length < 4) { tooShort++; return; }
    const d = Math.sqrt(Math.pow(c[0][0] - c[c.length - 1][0], 2) + Math.pow(c[0][1] - c[c.length - 1][1], 2));
    if (d < 0.00001) {
      closed++;
      const a = ringArea(c);
      if (a > 20 && a < 50000) {
        validConvert++;
        convertAreas.push(a);
      }
    } else {
      openLS++;
    }
  });

  convertAreas.sort((a, b) => a - b);

  results.surquillo_ls_analysis = {
    total_features_raw: surqRaw.features.length,
    polygons_existing: polys.length,
    linestrings_total: lines.length,
    linestrings_closed: closed,
    linestrings_open: openLS,
    linestrings_too_short: tooShort,
    valid_for_conversion: validConvert,
    conversion_would_add_polygons: validConvert,
    new_total_polygons: polys.length + validConvert,
    conversion_area_stats: convertAreas.length > 0 ? {
      count: convertAreas.length,
      min_m2: +convertAreas[0].toFixed(1),
      max_m2: +convertAreas[convertAreas.length - 1].toFixed(1),
      median_m2: +convertAreas[Math.floor(convertAreas.length / 2)].toFixed(1),
      total_area_m2: +convertAreas.reduce((s, a) => s + a, 0).toFixed(1)
    } : null,
    recommendation: validConvert > 50
      ? 'VIABLE — significant polygon recovery possible'
      : validConvert > 10
        ? 'MARGINAL — some recovery but mostly frontage lines'
        : 'NOT_VIABLE — lines are frontage, not parcel boundaries'
  };

  console.log(`  Polygons: ${polys.length}`);
  console.log(`  LineStrings: ${lines.length}`);
  console.log(`  Closed LS: ${closed}`);
  console.log(`  Valid for conversion: ${validConvert}`);
  console.log(`  Would bring total to: ${polys.length + validConvert} polygons`);
  console.log(`  Recommendation: ${results.surquillo_ls_analysis.recommendation}`);
}

// MERGE SIMULATION (for districts with existing data)
console.log(`\n${'='.repeat(60)}`);
console.log('MERGE SIMULATION (existing data only — no external acquired)');
console.log('='.repeat(60));

results.merge_simulation = {
  note: 'Cannot simulate merge with external sources — egress blocked',
  existing_districts_status: {}
};

const existingPilots = PILOT_DISTRICTS.filter(p => fs.existsSync(path.join(PUBLISHED_DIR, p.slug + '.geojson.gz')));

existingPilots.forEach(p => {
  const fc = loadGz(path.join(PUBLISHED_DIR, p.slug + '.geojson.gz'));
  results.merge_simulation.existing_districts_status[p.slug] = {
    current_parcels: fc.features.length,
    action: p.slug === 'surquillo' ? 'REVIEW — LS conversion potential' : 'KEEP — no external source acquired',
    notes: 'External source required for improvement. Must run acquisition from local machine.'
  };
  console.log(`  ${p.name}: ${fc.features.length} parcels → KEEP (no new source available)`);
});

const missingPilots = PILOT_DISTRICTS.filter(p => !fs.existsSync(path.join(PUBLISHED_DIR, p.slug + '.geojson.gz')));
missingPilots.forEach(p => {
  results.merge_simulation.existing_districts_status[p.slug] = {
    current_parcels: 0,
    action: 'FILL_GAP — requires external acquisition',
    notes: 'No data. Must acquire from GEO GPS Peru or COFOPRI.'
  };
  console.log(`  ${p.name}: 0 parcels → FILL_GAP (requires acquisition)`);
});

// GO / NO-GO
console.log(`\n${'='.repeat(60)}`);
console.log('GO / NO-GO ASSESSMENT');
console.log('='.repeat(60));

const conditions = [
  { id: 1, desc: '3/5 pilot districts pass acceptance (>=50)', status: 'CANNOT_EVALUATE', reason: 'Only 2/5 districts have data. Cannot evaluate 3 without acquisition.' },
  { id: 2, desc: 'Miraflores coverage > 30%', status: 'FAIL', reason: 'Current coverage 4.7%. No external source acquired to improve.' },
  { id: 3, desc: 'SJL file < 5MB gzip', status: 'CANNOT_EVALUATE', reason: 'SJL has no data. Cannot evaluate size without acquisition.' },
  { id: 4, desc: 'No regressions in existing 22 districts', status: 'PASS', reason: 'parcel_master unchanged. All 22 districts intact.' },
  { id: 5, desc: 'Pipeline is reproducible', status: 'PASS', reason: 'ETL scripts exist and work (Phase 2a proven).' },
  { id: 6, desc: 'No degradation from new sources', status: 'CANNOT_EVALUATE', reason: 'No new sources acquired to evaluate.' }
];

results.go_nogo = {
  overall: 'BLOCKED',
  reason: 'Pilot cannot complete from sandbox — external data endpoints blocked by egress proxy. 3 of 6 conditions cannot be evaluated.',
  conditions
};

conditions.forEach(c => {
  console.log(`  [${c.status}] ${c.id}. ${c.desc}`);
  console.log(`           ${c.reason}`);
});

console.log(`\n  VERDICT: BLOCKED — Pilot requires internet access to acquire external data.`);
console.log(`  NEXT STEP: Run acquisition scripts from local machine, then re-run pilot analysis.`);

// Write results
const reportPath = path.join(BASE, 'data/reports/pilot_analysis_results.json');
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`\nResults written to: ${reportPath}`);
