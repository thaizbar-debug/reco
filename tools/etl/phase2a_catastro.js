#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '../..');
const CATASTRO_DIR = path.join(ROOT, 'data/catastro');
const RAW_DIR = path.join(ROOT, 'data/raw/catastro');
const MASTER_DIR = path.join(ROOT, 'data/master');
const PUBLISHED_DIR = path.join(ROOT, 'data/published/catastro');
const REPORTS_DIR = path.join(ROOT, 'data/reports');

function readGz(filepath) {
  const buf = fs.readFileSync(filepath);
  return JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
}

function countVertices(geom) {
  if (!geom || !geom.coordinates) return 0;
  if (geom.type === 'Point') return 1;
  if (geom.type === 'LineString') return geom.coordinates.length;
  if (geom.type === 'Polygon') return geom.coordinates.reduce((s, r) => s + r.length, 0);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((s, poly) => s + poly.reduce((s2, r) => s2 + r.length, 0), 0);
  }
  return 0;
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

function polygonAreaDeg(rings) {
  let total = calcArea(rings[0]);
  for (let i = 1; i < rings.length; i++) total -= calcArea(rings[i]);
  return Math.abs(total);
}

function featureAreaDeg(geom) {
  if (geom.type === 'Polygon') return polygonAreaDeg(geom.coordinates);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((s, poly) => s + polygonAreaDeg(poly), 0);
  }
  return 0;
}

function degToM2(areaDeg, lat) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
  return areaDeg * mPerDegLat * mPerDegLon;
}

function perimeter(geom) {
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return 0;
  function ringPerimeter(ring, lat) {
    let p = 0;
    const mLat = 111320;
    const mLon = 111320 * Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < ring.length - 1; i++) {
      const dx = (ring[i + 1][0] - ring[i][0]) * mLon;
      const dy = (ring[i + 1][1] - ring[i][1]) * mLat;
      p += Math.sqrt(dx * dx + dy * dy);
    }
    return p;
  }
  if (geom.type === 'Polygon') {
    const lat = geom.coordinates[0].reduce((s, c) => s + c[1], 0) / geom.coordinates[0].length;
    return ringPerimeter(geom.coordinates[0], lat);
  }
  return geom.coordinates.reduce((s, poly) => {
    const lat = poly[0].reduce((s2, c) => s2 + c[1], 0) / poly[0].length;
    return s + ringPerimeter(poly[0], lat);
  }, 0);
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

function isLineStringClosed(coords) {
  if (coords.length < 4) return false;
  const first = coords[0], last = coords[coords.length - 1];
  return Math.abs(first[0] - last[0]) < 1e-8 && Math.abs(first[1] - last[1]) < 1e-8;
}

function lineStringToPolygon(coords) {
  const ring = [...coords];
  const first = ring[0], last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) > 1e-8 || Math.abs(first[1] - last[1]) > 1e-8) {
    ring.push([...first]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function isDuplicate(f1, f2) {
  const b1 = bbox(f1.geometry), b2 = bbox(f2.geometry);
  return Math.abs(b1[0] - b2[0]) < 1e-8 && Math.abs(b1[1] - b2[1]) < 1e-8 &&
    Math.abs(b1[2] - b2[2]) < 1e-8 && Math.abs(b1[3] - b2[3]) < 1e-8;
}

function isInsideBbox(innerBbox, outerBbox, toleranceDeg = 0.002) {
  return innerBbox[0] >= outerBbox[0] - toleranceDeg &&
    innerBbox[1] >= outerBbox[1] - toleranceDeg &&
    innerBbox[2] <= outerBbox[2] + toleranceDeg &&
    innerBbox[3] <= outerBbox[3] + toleranceDeg;
}

// Lima/Callao approximate bounding box
const LIMA_BBOX = [-77.2, -12.52, -76.6, -11.57];

function processCatastro(districtsMaster) {
  console.log('\n=== FASE 2A: CATASTRO CLEANUP ===\n');

  const files = fs.readdirSync(CATASTRO_DIR)
    .filter(f => f.endsWith('.geojson.gz'))
    .sort();

  console.log(`Archivos encontrados: ${files.length}\n`);

  // Step 5: Inventory
  console.log('5. INVENTARIO DEFINITIVO\n');
  const inventory = [];
  const allParcels = [];
  const allFrontageLines = [];
  const conversionLog = [];
  const discardLog = [];
  const districtReports = [];

  // Build district bbox lookup from master
  const districtBboxes = {};
  if (districtsMaster) {
    districtsMaster.features.forEach(f => {
      const name = (f.properties.distrito || '').toUpperCase();
      districtBboxes[name] = bbox(f.geometry);
    });
  }

  for (const file of files) {
    const slug = file.replace('.geojson.gz', '');
    const filepath = path.join(CATASTRO_DIR, file);
    const fileSize = fs.statSync(filepath).size;

    // Backup to RAW
    const rawBackup = path.join(RAW_DIR, file);
    if (!fs.existsSync(rawBackup)) {
      fs.copyFileSync(filepath, rawBackup);
    }

    const fc = readGz(filepath);
    const features = fc.features || [];

    const stats = {
      slug,
      file,
      file_size_bytes: fileSize,
      total_features: features.length,
      polygon: 0, multipolygon: 0, linestring: 0, other: 0,
      invalid: 0, empty: 0, duplicates: 0,
      ls_closed: 0, ls_open: 0, ls_converted: 0,
      vertices_total: 0,
      crs: 'EPSG:4326',
      bbox: null,
      has_properties: false
    };

    const polygons = [];
    const linestrings = [];
    const invalid = [];
    const seenBboxKeys = new Set();

    for (const f of features) {
      if (!f.geometry || !f.geometry.coordinates) {
        stats.empty++;
        stats.invalid++;
        discardLog.push({ slug, reason: 'EMPTY_GEOMETRY', feature_index: features.indexOf(f) });
        continue;
      }

      stats.vertices_total += countVertices(f.geometry);

      if (Object.keys(f.properties || {}).length > 0) stats.has_properties = true;

      const type = f.geometry.type;
      if (type === 'Polygon') {
        stats.polygon++;
        const ring = f.geometry.coordinates[0];
        if (ring.length < 4) {
          stats.invalid++;
          discardLog.push({ slug, reason: 'POLYGON_TOO_FEW_VERTICES', vertices: ring.length });
          continue;
        }
        const fb = bbox(f.geometry);
        const key = fb.map(v => v.toFixed(9)).join(',');
        if (seenBboxKeys.has(key)) {
          stats.duplicates++;
        } else {
          seenBboxKeys.add(key);
          polygons.push(f);
        }
      } else if (type === 'MultiPolygon') {
        stats.multipolygon++;
        polygons.push(f);
      } else if (type === 'LineString') {
        stats.linestring++;
        const closed = isLineStringClosed(f.geometry.coordinates);
        if (closed) stats.ls_closed++;
        else stats.ls_open++;
        linestrings.push({ feature: f, closed });
      } else {
        stats.other++;
        discardLog.push({ slug, reason: `UNSUPPORTED_TYPE_${type}` });
      }
    }

    // Determine district name from slug
    const districtName = slug.replace(/-/g, ' ').toUpperCase()
      .replace('CERCADO DE LIMA', 'LIMA');

    // Compute overall bbox
    if (features.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      features.forEach(f => {
        if (!f.geometry || !f.geometry.coordinates) return;
        const b = bbox(f.geometry);
        if (b[0] < minX) minX = b[0];
        if (b[1] < minY) minY = b[1];
        if (b[2] > maxX) maxX = b[2];
        if (b[3] > maxY) maxY = b[3];
      });
      stats.bbox = [minX, minY, maxX, maxY];
    }

    // Handle LineString conversions for special cases
    const CONVERTIBLE_SLUGS = ['lince', 'punta-negra', 'san-miguel'];
    let convertedPolygons = [];
    let frontageLinesForDistrict = [];

    if (CONVERTIBLE_SLUGS.includes(slug)) {
      for (const ls of linestrings) {
        if (ls.closed && ls.feature.geometry.coordinates.length >= 4) {
          const polyGeom = lineStringToPolygon(ls.feature.geometry.coordinates);
          const areaDeg = featureAreaDeg(polyGeom);
          const areaM2 = degToM2(areaDeg, -12.0);
          if (areaM2 > 1) {
            convertedPolygons.push({
              type: 'Feature',
              properties: { ...ls.feature.properties, _converted_from: 'LineString', _original_vertices: ls.feature.geometry.coordinates.length },
              geometry: polyGeom
            });
            stats.ls_converted++;
            conversionLog.push({
              slug, vertices: ls.feature.geometry.coordinates.length,
              area_m2: parseFloat(areaM2.toFixed(2)), status: 'CONVERTED'
            });
          } else {
            frontageLinesForDistrict.push(ls.feature);
            discardLog.push({ slug, reason: 'CLOSED_LS_ZERO_AREA', vertices: ls.feature.geometry.coordinates.length });
          }
        } else {
          frontageLinesForDistrict.push(ls.feature);
        }
      }
    } else {
      frontageLinesForDistrict = linestrings.map(ls => ls.feature);
    }

    // Build parcel_master entries for this district
    const districtParcels = [];
    const allValidPolygons = [...polygons, ...convertedPolygons];

    allValidPolygons.forEach((f, idx) => {
      const areaDeg = featureAreaDeg(f.geometry);
      const centroidLat = stats.bbox ? (stats.bbox[1] + stats.bbox[3]) / 2 : -12.0;
      const areaM2 = degToM2(areaDeg, centroidLat);
      const perim = perimeter(f.geometry);
      const fb = bbox(f.geometry);

      // Validate against Lima bbox
      const insideLima = isInsideBbox(fb, LIMA_BBOX);

      // Validate against district bbox
      const distBbox = districtBboxes[districtName];
      const insideDistrict = distBbox ? isInsideBbox(fb, distBbox, 0.005) : null;

      let status = 'valid';
      let confidenceLevel = 'high';

      if (!insideLima) {
        status = 'outside_lima';
        confidenceLevel = 'low';
      } else if (insideDistrict === false) {
        status = 'outside_district';
        confidenceLevel = 'medium';
      }

      if (areaM2 < 1) {
        status = 'invalid_area';
        confidenceLevel = 'low';
      }

      const parcel = {
        type: 'Feature',
        properties: {
          parcel_id: `${slug.toUpperCase().replace(/-/g, '_')}_P${String(idx + 1).padStart(5, '0')}`,
          district_id: `DIST_${UBIGEO_MAP[districtName] || 'UNKNOWN'}`,
          district_name: districtName,
          geometry_type: f.geometry.type,
          source_id: slug,
          source_name: 'catastro_kml',
          source_version: 'v2026_09_02',
          acquired_at: '2026-09-01',
          confidence_level: confidenceLevel,
          area_m2: parseFloat(areaM2.toFixed(2)),
          perimeter_m: parseFloat(perim.toFixed(2)),
          status,
          _converted_from: f.properties?._converted_from || null,
          _original_vertices: f.properties?._original_vertices || null
        },
        geometry: f.geometry
      };

      districtParcels.push(parcel);
    });

    allParcels.push(...districtParcels);
    allFrontageLines.push(...frontageLinesForDistrict.map(f => ({
      type: 'Feature',
      properties: {
        district_id: `DIST_${UBIGEO_MAP[districtName] || 'UNKNOWN'}`,
        district_name: districtName,
        source_id: slug,
        vertices: f.geometry.coordinates.length,
        closed: isLineStringClosed(f.geometry.coordinates)
      },
      geometry: f.geometry
    })));

    // Validation QA
    const validParcels = districtParcels.filter(p => p.properties.status === 'valid');
    const outsideDistrict = districtParcels.filter(p => p.properties.status === 'outside_district');
    const outsideLima = districtParcels.filter(p => p.properties.status === 'outside_lima');
    const invalidArea = districtParcels.filter(p => p.properties.status === 'invalid_area');

    let quality = 'READY';
    let action = 'none';
    if (stats.invalid > 0 || outsideDistrict.length > 0) {
      quality = 'NEEDS_REVIEW';
      action = 'review_outliers';
    }
    if (validParcels.length === 0 && frontageLinesForDistrict.length > 0) {
      quality = 'INCOMPLETE';
      action = 'ls_only_no_parcels';
    }
    if (stats.total_features === 0) {
      quality = 'INCOMPLETE';
      action = 'empty_file';
    }

    const distReport = {
      distrito: districtName,
      slug,
      parcels_valid: validParcels.length,
      lines: frontageLinesForDistrict.length,
      invalid: stats.invalid + invalidArea.length,
      duplicates: stats.duplicates,
      converted: stats.ls_converted,
      outside_district: outsideDistrict.length,
      outside_lima: outsideLima.length,
      coverage_pct: stats.total_features > 0 ?
        parseFloat(((validParcels.length / stats.total_features) * 100).toFixed(1)) : 0,
      quality,
      action,
      file_size_before: fileSize
    };

    districtReports.push(distReport);
    inventory.push(stats);

    console.log(`   ${slug}: ${stats.polygon}P + ${stats.multipolygon}MP + ${stats.linestring}LS | ` +
      `valid=${validParcels.length} lines=${frontageLinesForDistrict.length} conv=${stats.ls_converted} ` +
      `dup=${stats.duplicates} inv=${stats.invalid} | ${quality}`);
  }

  // Step 6: Write parcel_master
  console.log(`\n6. PARCEL_MASTER: ${allParcels.length} features total\n`);
  const validParcels = allParcels.filter(p => p.properties.status === 'valid');
  const flaggedParcels = allParcels.filter(p => p.properties.status !== 'valid');
  console.log(`   Valid: ${validParcels.length}, Flagged: ${flaggedParcels.length}`);

  // Write per-district published files (only valid parcels, gz compressed)
  const publishedStats = [];
  const districtGroups = {};
  validParcels.forEach(p => {
    const sid = p.properties.source_id;
    if (!districtGroups[sid]) districtGroups[sid] = [];
    districtGroups[sid].push(p);
  });

  for (const [sid, parcels] of Object.entries(districtGroups)) {
    const fc = { type: 'FeatureCollection', features: parcels };
    const json = JSON.stringify(fc);
    const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
    const outPath = path.join(PUBLISHED_DIR, `${sid}.geojson.gz`);
    fs.writeFileSync(outPath, gz);

    // Also overwrite the current catastro file for frontend consumption
    const currentPath = path.join(CATASTRO_DIR, `${sid}.geojson.gz`);
    fs.writeFileSync(currentPath, gz);

    publishedStats.push({
      slug: sid,
      parcels: parcels.length,
      raw_bytes: json.length,
      gz_bytes: gz.length,
      gz_kb: parseFloat((gz.length / 1024).toFixed(1))
    });
  }

  console.log(`   Published: ${publishedStats.length} district files to ${PUBLISHED_DIR}`);

  // Write frontage lines if any
  if (allFrontageLines.length > 0) {
    const flFC = { type: 'FeatureCollection', features: allFrontageLines };
    const flJson = JSON.stringify(flFC);
    const flGz = zlib.gzipSync(Buffer.from(flJson), { level: 9 });
    fs.writeFileSync(path.join(MASTER_DIR, 'parcel_frontage_lines.geojson.gz'), flGz);
    console.log(`   Frontage lines: ${allFrontageLines.length} features → parcel_frontage_lines.geojson.gz`);
  }

  // Write flagged parcels for review
  if (flaggedParcels.length > 0) {
    const flagFC = { type: 'FeatureCollection', features: flaggedParcels };
    fs.writeFileSync(path.join(REPORTS_DIR, 'flagged_parcels.json'),
      JSON.stringify(flagFC, null, 2));
    console.log(`   Flagged parcels: ${flaggedParcels.length} → flagged_parcels.json`);
  }

  // Write provenance
  const catastroMeta = {
    name: 'parcel_master',
    version: 'v2026_09_02',
    source: {
      name: 'catastro_kml',
      origin: 'Municipal KML files converted via tools/kml_to_geojson.js',
      acquired_at: '2026-09-01',
      districts_covered: files.length
    },
    processing: {
      script: 'tools/etl/phase2a_catastro.js',
      date: new Date().toISOString(),
      rules: [
        'LineString open (2 vertices, not closed) → excluded from parcel_master, kept in parcel_frontage_lines',
        'LineString closed (Lince, Punta Negra, San Miguel) → converted to Polygon if area > 1m²',
        'Polygon with < 4 vertices → discarded as invalid',
        'Duplicate polygons (same bbox) → deduplicated',
        'Outside Lima/Callao bbox → flagged status=outside_lima',
        'Outside district bbox (>500m tolerance) → flagged status=outside_district',
        'Area < 1m² → flagged status=invalid_area'
      ],
      crs: 'EPSG:4326'
    },
    stats: {
      total_input_features: inventory.reduce((s, i) => s + i.total_features, 0),
      valid_parcels: validParcels.length,
      frontage_lines: allFrontageLines.length,
      flagged_parcels: flaggedParcels.length,
      conversions: conversionLog.length,
      discards: discardLog.length,
      districts_processed: files.length
    },
    conversion_log: conversionLog,
    discard_summary: {
      total: discardLog.length,
      by_reason: discardLog.reduce((acc, d) => { acc[d.reason] = (acc[d.reason] || 0) + 1; return acc; }, {})
    },
    published_files: publishedStats
  };

  fs.writeFileSync(path.join(MASTER_DIR, 'parcel_master.meta.json'),
    JSON.stringify(catastroMeta, null, 2));

  // Step 11: Quality report
  console.log('\n11. QUALITY REPORT\n');
  const readyCount = districtReports.filter(d => d.quality === 'READY').length;
  const reviewCount = districtReports.filter(d => d.quality === 'NEEDS_REVIEW').length;
  const incompleteCount = districtReports.filter(d => d.quality === 'INCOMPLETE').length;

  console.log(`   READY: ${readyCount}, NEEDS_REVIEW: ${reviewCount}, INCOMPLETE: ${incompleteCount}\n`);

  districtReports.sort((a, b) => {
    const order = { READY: 0, NEEDS_REVIEW: 1, INCOMPLETE: 2 };
    return (order[a.quality] || 3) - (order[b.quality] || 3);
  });

  console.log('   Distrito              | Predios | Lineas | Inv | Dup | Conv | %Cob  | Calidad');
  console.log('   ' + '-'.repeat(95));
  for (const d of districtReports) {
    console.log(`   ${d.distrito.padEnd(22)} | ${String(d.parcels_valid).padStart(7)} | ${String(d.lines).padStart(6)} | ${String(d.invalid).padStart(3)} | ${String(d.duplicates).padStart(3)} | ${String(d.converted).padStart(4)} | ${String(d.coverage_pct + '%').padStart(5)} | ${d.quality}`);
  }

  // Save full report
  const fullReport = {
    timestamp: new Date().toISOString(),
    summary: {
      districts_processed: files.length,
      total_input_features: inventory.reduce((s, i) => s + i.total_features, 0),
      valid_parcels: validParcels.length,
      frontage_lines: allFrontageLines.length,
      flagged: flaggedParcels.length,
      conversions: conversionLog.length,
      quality: { ready: readyCount, needs_review: reviewCount, incomplete: incompleteCount }
    },
    inventory,
    district_reports: districtReports,
    conversion_log: conversionLog,
    discard_log: discardLog.slice(0, 200),
    published_files: publishedStats
  };

  fs.writeFileSync(path.join(REPORTS_DIR, 'phase2a_catastro_report.json'),
    JSON.stringify(fullReport, null, 2));

  console.log(`\n   Report: ${path.join(REPORTS_DIR, 'phase2a_catastro_report.json')}`);

  return fullReport;
}

const UBIGEO_MAP = {
  'ANCON': '150102', 'ATE': '150103', 'BARRANCO': '150104', 'BRENA': '150105',
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

if (require.main === module) {
  [RAW_DIR, MASTER_DIR, PUBLISHED_DIR, REPORTS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // Load districts master if available
  let districtsMaster = null;
  const masterPath = path.join(MASTER_DIR, 'districts_master.geojson');
  if (fs.existsSync(masterPath)) {
    districtsMaster = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
    console.log(`Loaded districts_master: ${districtsMaster.features.length} features\n`);
  }

  processCatastro(districtsMaster);
  console.log('\n=== FASE 2A COMPLETADA ===');
}

module.exports = { processCatastro };
