#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '../..');
const SCRATCH = process.env.SCRATCH || '/tmp/etl_scratch';
const RAW_DIR = path.join(ROOT, 'data/raw/distritos');
const MASTER_DIR = path.join(ROOT, 'data/master');
const PUBLISHED_DIR = path.join(ROOT, 'data/published/distritos');
const REPORTS_DIR = path.join(ROOT, 'data/reports');

function readGz(filepath) {
  const buf = fs.readFileSync(filepath);
  const json = zlib.gunzipSync(buf).toString('utf-8');
  return JSON.parse(json);
}

function writeGz(filepath, data, level = 9) {
  const json = JSON.stringify(data);
  const compressed = zlib.gzipSync(Buffer.from(json), { level });
  fs.writeFileSync(filepath, compressed);
  return { raw: json.length, gz: compressed.length };
}

function calcArea(coords) {
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    area += (x2 - x1) * (y2 + y1);
  }
  return Math.abs(area / 2);
}

function polygonArea(rings) {
  let total = calcArea(rings[0]);
  for (let i = 1; i < rings.length; i++) total -= calcArea(rings[i]);
  return Math.abs(total);
}

function featureArea(geom) {
  if (geom.type === 'Polygon') return polygonArea(geom.coordinates);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((s, poly) => s + polygonArea(poly), 0);
  }
  return 0;
}

function countVertices(geom) {
  if (geom.type === 'Polygon') return geom.coordinates.reduce((s, r) => s + r.length, 0);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((s, poly) => s + poly.reduce((s2, r) => s2 + r.length, 0), 0);
  }
  return 0;
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

function isValidGeometry(geom) {
  const issues = [];
  if (!geom || !geom.type || !geom.coordinates) {
    issues.push('MISSING_GEOMETRY');
    return { valid: false, issues };
  }
  if (geom.type === 'Polygon') {
    geom.coordinates.forEach((ring, i) => {
      if (ring.length < 4) issues.push(`RING_${i}_TOO_FEW_VERTICES(${ring.length})`);
      const first = ring[0], last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) issues.push(`RING_${i}_NOT_CLOSED`);
    });
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach((poly, pi) => {
      poly.forEach((ring, ri) => {
        if (ring.length < 4) issues.push(`POLY_${pi}_RING_${ri}_TOO_FEW(${ring.length})`);
        const first = ring[0], last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) issues.push(`POLY_${pi}_RING_${ri}_NOT_CLOSED`);
      });
    });
  }
  if (featureArea(geom) === 0) issues.push('ZERO_AREA');
  return { valid: issues.length === 0, issues };
}

const UBIGEO_MAP = {
  'ANCON': '150102', 'ATE': '150103', 'BARRANCO': '150104', 'BRENA': '150105', 'BREÑA': '150105',
  'CARABAYLLO': '150106', 'CHACLACAYO': '150107', 'CHORRILLOS': '150108',
  'CIENEGUILLA': '150109', 'COMAS': '150110', 'EL AGUSTINO': '150111',
  'INDEPENDENCIA': '150112', 'JESUS MARIA': '150113', 'LA MOLINA': '150114',
  'LA VICTORIA': '150115', 'LIMA': '150101', 'LINCE': '150116',
  'LOS OLIVOS': '150117', 'LURIGANCHO': '150118', 'LURIN': '150119',
  'MAGDALENA DEL MAR': '150120', 'PUEBLO LIBRE': '150121', 'MIRAFLORES': '150122',
  'PACHACAMAC': '150123', 'PUCUSANA': '150124', 'PUENTE PIEDRA': '150125',
  'PUNTA HERMOSA': '150126', 'PUNTA NEGRA': '150127',
  'RIMAC': '150128', 'SAN BARTOLO': '150129',
  'SAN BORJA': '150130', 'SAN ISIDRO': '150131',
  'SAN JUAN DE LURIGANCHO': '150132', 'SAN JUAN DE MIRAFLORES': '150133',
  'SAN LUIS': '150134', 'SAN MARTIN DE PORRES': '150135',
  'SAN MIGUEL': '150136', 'SANTA ANITA': '150137',
  'SANTA MARIA DEL MAR': '150138', 'SANTA ROSA': '150139',
  'SANTIAGO DE SURCO': '150140', 'SURQUILLO': '150141',
  'VILLA EL SALVADOR': '150142', 'VILLA MARIA DEL TRIUNFO': '150143',
  'BELLAVISTA': '070102', 'CALLAO': '070101',
  'CARMEN DE LA LEGUA REYNOSO': '070103', 'LA PERLA': '070104',
  'LA PUNTA': '070105', 'MI PERU': '070107', 'VENTANILLA': '070106'
};

const NAME_CORRECTIONS = {
  'MI PERÃz': 'MI PERU',
  'MI PERÃO': 'MI PERU',
  'MI PERÚ': 'MI PERU'
};

function normalizeName(name) {
  if (!name) return name;
  for (const [bad, good] of Object.entries(NAME_CORRECTIONS)) {
    if (name.includes(bad)) return good;
  }
  return name;
}

function processDistricts() {
  console.log('=== FASE 1: MIGRACION DISTRITAL ===\n');

  // Step 1: Backup
  console.log('1. BACKUP');
  const currentFile = path.join(ROOT, 'data/distritos/lima_callao.geojson.gz');
  const backupFile = path.join(RAW_DIR, 'lima_callao_v0_simple.geojson.gz');
  fs.copyFileSync(currentFile, backupFile);
  console.log(`   Backup: ${backupFile}`);

  // Read both versions
  const simple = readGz(currentFile);
  console.log(`   Simple: ${simple.features.length} features, Polygon type`);

  // Read the full version
  const fullPath = process.env.FULL_GEOJSON || path.join(SCRATCH, 'lima_distritos_full.geojson');
  if (!fs.existsSync(fullPath)) {
    console.error(`   ERROR: Full GeoJSON not found at ${fullPath}`);
    process.exit(1);
  }
  const full = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  console.log(`   Full: ${full.features.length} features, MultiPolygon type\n`);

  // Step 2: Create districts_master
  console.log('2. CREATE districts_master');
  const report = {
    timestamp: new Date().toISOString(),
    source: 'IGN/INEI via juaneladio/peru-geojson',
    version: 'v2026_09_02',
    features: [],
    corrections: [],
    validation: { valid: 0, invalid: 0, issues: [] }
  };

  const masterFC = {
    type: 'FeatureCollection',
    metadata: {
      name: 'districts_master',
      version: 'v2026_09_02',
      source: 'IGN/INEI',
      source_url: 'github.com/juaneladio/peru-geojson',
      crs: 'EPSG:4326',
      region: 'Lima Metropolitana + Callao',
      feature_count: full.features.length,
      processed_at: new Date().toISOString(),
      processed_by: 'tools/etl/phase1_districts.js'
    },
    features: []
  };

  full.features.forEach((f, idx) => {
    let name = f.properties.distrito || f.properties.NOMBDIST || '';
    const originalName = name;
    name = normalizeName(name);

    if (name !== originalName) {
      report.corrections.push({ original: originalName, corrected: name, feature_index: idx });
      console.log(`   CORRECCION: "${originalName}" → "${name}"`);
    }

    const ubigeo = UBIGEO_MAP[name] || null;
    const verts = countVertices(f.geometry);
    const area = featureArea(f.geometry);
    const bb = bbox(f.geometry);
    const validation = isValidGeometry(f.geometry);

    if (validation.valid) report.validation.valid++;
    else {
      report.validation.invalid++;
      report.validation.issues.push({ district: name, issues: validation.issues });
    }

    const province = name === 'CALLAO' || name === 'BELLAVISTA' || name === 'LA PERLA' ||
      name === 'LA PUNTA' || name === 'MI PERU' || name === 'VENTANILLA' ||
      name === 'CARMEN DE LA LEGUA REYNOSO' ? 'CALLAO' : 'LIMA';

    const masterFeature = {
      type: 'Feature',
      properties: {
        reco_id: `DIST_${(ubigeo || String(idx + 1).padStart(6, '0'))}`,
        distrito: name,
        ubigeo: ubigeo,
        provincia: province,
        departamento: province === 'CALLAO' ? 'CALLAO' : 'LIMA',
        geometry_type: f.geometry.type,
        vertices: verts,
        area_deg2: parseFloat(area.toFixed(8)),
        bbox: bb
      },
      geometry: f.geometry
    };
    masterFC.features.push(masterFeature);

    report.features.push({
      distrito: name, ubigeo, provincia: province,
      geometry_type: f.geometry.type, vertices: verts,
      area_deg2: parseFloat(area.toFixed(8)), bbox: bb,
      valid: validation.valid, issues: validation.issues
    });
  });

  masterFC.metadata.feature_count = masterFC.features.length;
  console.log(`   Total features: ${masterFC.features.length}`);
  console.log(`   Valid: ${report.validation.valid}, Invalid: ${report.validation.invalid}`);
  console.log(`   Corrections: ${report.corrections.length}\n`);

  // Step 3: Optimization comparison
  console.log('3. OPTIMIZACION');
  const jsonStr = JSON.stringify(masterFC);
  const jsonSize = jsonStr.length;

  // Simplified version (reduce coordinate precision to 5 decimals ~1.1m)
  const simplifiedFC = JSON.parse(JSON.stringify(masterFC));
  simplifiedFC.features.forEach(f => {
    function roundCoords(arr) {
      if (typeof arr[0] === 'number') {
        arr[0] = parseFloat(arr[0].toFixed(5));
        arr[1] = parseFloat(arr[1].toFixed(5));
      } else arr.forEach(roundCoords);
    }
    roundCoords(f.geometry.coordinates);
  });
  const simpJsonStr = JSON.stringify(simplifiedFC);
  const simpSize = simpJsonStr.length;

  const gzFull = zlib.gzipSync(Buffer.from(jsonStr), { level: 9 });
  const gzSimp = zlib.gzipSync(Buffer.from(simpJsonStr), { level: 9 });

  const simpVerts = simplifiedFC.features.reduce((s, f) => s + countVertices(f.geometry), 0);
  const fullVerts = masterFC.features.reduce((s, f) => s + countVertices(f.geometry), 0);

  const comparison = {
    original_simple: {
      file: 'lima_callao.geojson.gz (current)',
      raw_bytes: fs.readFileSync(path.join(SCRATCH, 'lima_distritos_simple.geojson'), 'utf-8').length,
      gz_bytes: fs.statSync(currentFile).size,
      vertices: simple.features.reduce((s, f) => s + countVertices(f.geometry), 0),
      features: simple.features.length,
      geometry_type: 'Polygon'
    },
    master_full_precision: {
      file: 'districts_master.geojson.gz (full precision)',
      raw_bytes: jsonSize,
      gz_bytes: gzFull.length,
      vertices: fullVerts,
      features: masterFC.features.length,
      geometry_type: 'MultiPolygon',
      coordinate_precision: 'original (~14 decimals)'
    },
    master_5dec: {
      file: 'districts_master.geojson.gz (5 decimals ~1.1m)',
      raw_bytes: simpSize,
      gz_bytes: gzSimp.length,
      vertices: simpVerts,
      features: simplifiedFC.features.length,
      geometry_type: 'MultiPolygon',
      coordinate_precision: '5 decimals (~1.1m accuracy)'
    }
  };

  console.log('   Comparacion de formatos:');
  console.log(`   Current simple   : ${(comparison.original_simple.gz_bytes / 1024).toFixed(1)} KB gz, ${comparison.original_simple.vertices} vertices`);
  console.log(`   Master full prec : ${(comparison.master_full_precision.gz_bytes / 1024).toFixed(1)} KB gz, ${comparison.master_full_precision.vertices} vertices`);
  console.log(`   Master 5-dec     : ${(comparison.master_5dec.gz_bytes / 1024).toFixed(1)} KB gz, ${comparison.master_5dec.vertices} vertices`);
  console.log(`   Reduction 5-dec  : ${((1 - gzSimp.length / gzFull.length) * 100).toFixed(1)}% gz savings vs full precision`);

  // Choose: 5-decimal precision is more than enough for district display (1.1m accuracy)
  // and significantly reduces file size
  const chosen = gzSimp.length < gzFull.length * 0.85 ? 'master_5dec' : 'master_full_precision';
  const chosenFC = chosen === 'master_5dec' ? simplifiedFC : masterFC;
  const chosenGz = chosen === 'master_5dec' ? gzSimp : gzFull;
  console.log(`   Chosen: ${chosen}\n`);

  // Write master
  const masterJsonPath = path.join(MASTER_DIR, 'districts_master.geojson');
  fs.writeFileSync(masterJsonPath, JSON.stringify(chosenFC, null, 2));

  // Write published (gz for production)
  const publishedPath = path.join(PUBLISHED_DIR, 'districts_master.geojson.gz');
  fs.writeFileSync(publishedPath, chosenGz);
  console.log(`   Master: ${masterJsonPath}`);
  console.log(`   Published: ${publishedPath} (${(chosenGz.length / 1024).toFixed(1)} KB)\n`);

  // Also overwrite the current production file for frontend integration
  fs.writeFileSync(currentFile, chosenGz);
  console.log(`   Production: ${currentFile} (overwritten with districts_master)\n`);

  // Write provenance metadata
  const provenance = {
    name: 'districts_master',
    version: 'v2026_09_02',
    source: {
      name: 'IGN/INEI',
      repository: 'github.com/juaneladio/peru-geojson',
      file: 'departamentos/lima_callao_distritos.geojson',
      acquired_at: '2026-09-01',
      license: 'Public domain (government data)'
    },
    processing: {
      script: 'tools/etl/phase1_districts.js',
      date: new Date().toISOString(),
      coordinate_precision: chosen === 'master_5dec' ? 5 : 'original',
      corrections: report.corrections,
      crs: 'EPSG:4326'
    },
    stats: {
      features: chosenFC.features.length,
      vertices: chosenFC.features.reduce((s, f) => s + countVertices(f.geometry), 0),
      raw_bytes: JSON.stringify(chosenFC).length,
      gz_bytes: chosenGz.length,
      geometry_types: [...new Set(chosenFC.features.map(f => f.geometry.type))]
    },
    backup: {
      file: 'data/raw/distritos/lima_callao_v0_simple.geojson.gz',
      checksum_note: 'Original simple version before migration'
    },
    comparison
  };

  fs.writeFileSync(path.join(MASTER_DIR, 'districts_master.meta.json'), JSON.stringify(provenance, null, 2));
  console.log(`   Metadata: ${path.join(MASTER_DIR, 'districts_master.meta.json')}\n`);

  // Write report
  report.comparison = comparison;
  report.chosen_format = chosen;
  fs.writeFileSync(path.join(REPORTS_DIR, 'phase1_districts_report.json'), JSON.stringify(report, null, 2));
  console.log(`   Report: ${path.join(REPORTS_DIR, 'phase1_districts_report.json')}\n`);

  return { masterFC: chosenFC, report, comparison, publishedPath };
}

if (require.main === module) {
  [RAW_DIR, MASTER_DIR, PUBLISHED_DIR, REPORTS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const result = processDistricts();
  console.log('=== FASE 1 COMPLETADA ===');
}

module.exports = { processDistricts, readGz, writeGz, countVertices, featureArea, bbox, isValidGeometry, UBIGEO_MAP };
