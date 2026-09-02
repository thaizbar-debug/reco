#!/usr/bin/env node
/**
 * PHASE 2B-0.5: Process manually downloaded shapefiles
 *
 * After downloading shapefiles from GEO GPS Peru (or other sources),
 * place them in data/raw/external/geo_gps_peru/<district>/
 *
 * This script:
 * 1. Detects all downloaded files (ZIP, SHP, GeoJSON)
 * 2. Validates they are real geospatial data
 * 3. Converts shapefiles to GeoJSON using ogr2ogr (if available)
 * 4. Generates manifest.json for each
 * 5. Reports what was found and what's missing
 *
 * Usage: node tools/etl/process_external_shapefiles.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const zlib = require('zlib');

const BASE = path.resolve(__dirname, '../..');
const RAW_EXT = path.join(BASE, 'data/raw/external');
const GEO_GPS_DIR = path.join(RAW_EXT, 'geo_gps_peru');

const PILOT_DISTRICTS = [
  { name: 'MIRAFLORES', ubigeo: '150122', slug: 'miraflores' },
  { name: 'LA VICTORIA', ubigeo: '150115', slug: 'la-victoria' },
  { name: 'SURQUILLO', ubigeo: '150141', slug: 'surquillo' },
  { name: 'CHORRILLOS', ubigeo: '150108', slug: 'chorrillos' },
  { name: 'SAN JUAN DE LURIGANCHO', ubigeo: '150132', slug: 'san-juan-de-lurigancho' }
];

function hasOgr2ogr() {
  try {
    execSync('ogr2ogr --version 2>/dev/null', { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function hasUnzip() {
  try {
    execSync('which unzip 2>/dev/null', { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function findFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith(ext))
    .map(f => path.join(dir, f));
}

function findAllFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('.') && !f.startsWith('_'))
    .map(f => path.join(dir, f));
}

function isValidShapefile(dir) {
  const files = fs.readdirSync(dir).map(f => f.toLowerCase());
  const hasShp = files.some(f => f.endsWith('.shp'));
  const hasDbf = files.some(f => f.endsWith('.dbf'));
  const hasShx = files.some(f => f.endsWith('.shx'));
  return hasShp && hasDbf && hasShx;
}

function getShpFile(dir) {
  return fs.readdirSync(dir).find(f => f.toLowerCase().endsWith('.shp'));
}

function detectCrsFromPrj(dir) {
  const prjFile = fs.readdirSync(dir).find(f => f.toLowerCase().endsWith('.prj'));
  if (!prjFile) return 'UNKNOWN (no .prj file)';
  const prjContent = fs.readFileSync(path.join(dir, prjFile), 'utf8');
  if (prjContent.includes('WGS') && prjContent.includes('84')) return 'EPSG:4326';
  if (prjContent.includes('PSAD') && prjContent.includes('56')) return 'EPSG:24892';
  if (prjContent.includes('UTM') && prjContent.includes('18S')) return 'EPSG:32718';
  return `UNKNOWN (${prjContent.slice(0, 100)})`;
}

function unzipFile(zipPath, destDir) {
  if (!hasUnzip()) {
    console.log(`    WARNING: 'unzip' not found. Please extract manually: ${zipPath}`);
    console.log(`    Extract to: ${destDir}`);
    return false;
  }
  try {
    execSync(`unzip -o "${zipPath}" -d "${destDir}" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.log(`    ERROR extracting ZIP: ${e.message}`);
    return false;
  }
}

function convertShpToGeojson(shpPath, outPath, sourceCrs) {
  if (!hasOgr2ogr()) {
    console.log('    WARNING: ogr2ogr not found. Install GDAL to convert shapefiles.');
    console.log('    On macOS: brew install gdal');
    console.log('    On Ubuntu: sudo apt install gdal-bin');
    console.log(`    Manual command: ogr2ogr -f GeoJSON -t_srs EPSG:4326 "${outPath}" "${shpPath}"`);
    return false;
  }
  try {
    const srsFlag = sourceCrs && sourceCrs !== 'EPSG:4326' && !sourceCrs.startsWith('UNKNOWN')
      ? `-s_srs ${sourceCrs}` : '';
    execSync(`ogr2ogr -f GeoJSON -t_srs EPSG:4326 ${srsFlag} "${outPath}" "${shpPath}" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.log(`    ERROR converting shapefile: ${e.message}`);
    return false;
  }
}

function quickValidateGeojson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const fc = JSON.parse(raw);
    if (!fc.features || !Array.isArray(fc.features)) {
      return { valid: false, error: 'Not a FeatureCollection' };
    }

    const types = {};
    let withGeom = 0, withoutGeom = 0;
    const areas = [];

    fc.features.forEach(f => {
      if (!f.geometry || !f.geometry.type) { withoutGeom++; return; }
      withGeom++;
      types[f.geometry.type] = (types[f.geometry.type] || 0) + 1;

      if (f.geometry.type === 'Polygon' && f.geometry.coordinates[0]) {
        const ring = f.geometry.coordinates[0];
        let area = 0;
        for (let i = 0; i < ring.length - 1; i++) {
          area += (ring[i + 1][0] - ring[i][0]) * (ring[i][1] + ring[i + 1][1]);
        }
        area = Math.abs(area / 2) * 111320 * 111320 * Math.cos(-12.05 * Math.PI / 180);
        areas.push(area);
      }
    });

    areas.sort((a, b) => a - b);
    const median = areas.length > 0 ? areas[Math.floor(areas.length / 2)] : 0;

    let semantic = 'UNKNOWN';
    if (median > 0 && median < 2000) semantic = 'PARCEL';
    else if (median >= 2000 && median < 50000) semantic = 'BLOCK';
    else if (median >= 50000) semantic = 'ZONE';

    const attributes = fc.features.length > 0 && fc.features[0].properties
      ? Object.keys(fc.features[0].properties) : [];

    return {
      valid: true,
      feature_count: fc.features.length,
      with_geometry: withGeom,
      without_geometry: withoutGeom,
      geometry_types: types,
      area_median_m2: Math.round(median),
      semantic_guess: semantic,
      attributes,
      raw_bytes: Buffer.byteLength(raw, 'utf8')
    };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

function writeManifest(dir, data) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(data, null, 2));
}

function writeInstructions(dir, district) {
  const instructions = `GEO GPS PERU — DOWNLOAD INSTRUCTIONS
${'='.repeat(50)}

District: ${district.name}
Ubigeo: ${district.ubigeo}
Target directory: ${dir}

STEP 1: Download from GEO GPS Peru
───────────────────────────────────
Option A (2020 dataset — predios urbanos Lima/Callao):
  URL: https://www.geogpsperu.com/2020/11/lotes-predios-urbano-lima-callao.html
  - Navigate to the interactive map
  - Find and click on "${district.name}"
  - Download the Shapefile ZIP (usually via Google Drive or MediaFire)
  - Save the ZIP file in this directory

Option B (2025 SEDAPAL dataset — potentially more complete):
  URL: https://www.geogpsperu.com/2025/04/mapa-de-lotes-manzanas-y-localidades.html
  - This dataset may cover all Lima Metro with lotes + manzanas
  - Download the ZIP and save in this directory
  - IMPORTANT: This may contain MANZANAS (blocks), not individual PREDIOS (parcels)
  - The analysis pipeline will detect and classify them automatically

STEP 2: Expected files
──────────────────────
After download, this directory should contain ONE of:
  a) A .zip file containing .shp + .dbf + .shx (+ optional .prj, .cpg)
  b) Pre-extracted shapefile set: .shp + .dbf + .shx files
  c) A .geojson file (if already converted)

STEP 3: Expected characteristics
─────────────────────────────────
- CRS: WGS84 (EPSG:4326) or PSAD56 (EPSG:24892) — will be reprojected
- Geometry type: Polygon (predios) or LineString (frontage)
- Feature count: varies (hundreds to tens of thousands)

HOW TO IDENTIFY PREDIOS vs MANZANAS:
- Predios (individual parcels): median area 100-2000 m², count > 1000 per district
- Manzanas (city blocks): median area 3000-20000 m², count 100-500 per district
- The pipeline classifies these automatically, but if you see only ~200-400
  large polygons, they are likely manzanas, not predios

STEP 4: Run processing
──────────────────────
After placing files here, run:
  node tools/etl/process_external_shapefiles.js

This will validate, convert (if shapefile), and generate a manifest.

STEP 5: Run analysis
────────────────────
Then run the full analysis:
  npm run pilot:analyze
  npm run pilot:report
`;

  fs.writeFileSync(path.join(dir, '_download_instructions.txt'), instructions);
}

function main() {
  console.log('PHASE 2B-0.5: Process External Shapefiles');
  console.log('='.repeat(50));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  const canOgr = hasOgr2ogr();
  const canUnzip = hasUnzip();
  console.log(`  ogr2ogr available: ${canOgr ? 'YES' : 'NO — install GDAL for shapefile conversion'}`);
  console.log(`  unzip available: ${canUnzip ? 'YES' : 'NO'}`);
  console.log('');

  const summary = { processed: [], missing: [], errors: [] };

  for (const dist of PILOT_DISTRICTS) {
    console.log(`─── ${dist.name} (${dist.slug}) ───`);
    const dir = path.join(GEO_GPS_DIR, dist.slug);
    fs.mkdirSync(dir, { recursive: true });

    const allFiles = findAllFiles(dir);
    const nonInstructionFiles = allFiles.filter(f =>
      !path.basename(f).startsWith('_') && path.basename(f) !== 'manifest.json'
    );

    if (nonInstructionFiles.length === 0) {
      console.log('  No files found. Writing download instructions.');
      writeInstructions(dir, dist);
      summary.missing.push(dist.slug);
      continue;
    }

    console.log(`  Found ${nonInstructionFiles.length} file(s): ${nonInstructionFiles.map(f => path.basename(f)).join(', ')}`);

    // Check for ZIP files — extract first
    const zips = findFiles(dir, '.zip');
    for (const zipFile of zips) {
      console.log(`  Extracting: ${path.basename(zipFile)}`);
      const extractDir = path.join(dir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      if (unzipFile(zipFile, extractDir)) {
        console.log('  Extracted successfully.');
        // Check for nested directories
        const extracted = fs.readdirSync(extractDir);
        for (const item of extracted) {
          const itemPath = path.join(extractDir, item);
          if (fs.statSync(itemPath).isDirectory()) {
            // Move contents up
            for (const subItem of fs.readdirSync(itemPath)) {
              const src = path.join(itemPath, subItem);
              const dest = path.join(extractDir, subItem);
              if (!fs.existsSync(dest)) fs.renameSync(src, dest);
            }
          }
        }
      }
    }

    // Now check for shapefile components
    const searchDirs = [dir];
    const extractedDir = path.join(dir, 'extracted');
    if (fs.existsSync(extractedDir)) searchDirs.push(extractedDir);
    // Check subdirs of extracted
    if (fs.existsSync(extractedDir)) {
      for (const sub of fs.readdirSync(extractedDir)) {
        const subPath = path.join(extractedDir, sub);
        if (fs.statSync(subPath).isDirectory()) searchDirs.push(subPath);
      }
    }

    let processed = false;

    for (const searchDir of searchDirs) {
      // Try GeoJSON first
      const geojsonFiles = findFiles(searchDir, '.geojson');
      for (const gjFile of geojsonFiles) {
        console.log(`  Validating GeoJSON: ${path.basename(gjFile)}`);
        const validation = quickValidateGeojson(gjFile);
        if (validation.valid) {
          console.log(`    Features: ${validation.feature_count}`);
          console.log(`    Types: ${JSON.stringify(validation.geometry_types)}`);
          console.log(`    Median area: ${validation.area_median_m2} m² → ${validation.semantic_guess}`);
          console.log(`    Attributes: ${validation.attributes.join(', ')}`);

          // Compress
          const raw = fs.readFileSync(gjFile);
          const gzBuf = zlib.gzipSync(raw);
          const outGz = path.join(dir, `raw_geo_gps.geojson.gz`);
          fs.writeFileSync(outGz, gzBuf);

          writeManifest(dir, {
            source: 'GEO_GPS_PERU',
            source_url: 'https://www.geogpsperu.com',
            district: dist.name,
            ubigeo: dist.ubigeo,
            acquired_at: new Date().toISOString(),
            original_format: 'GeoJSON',
            original_filename: path.basename(gjFile),
            original_crs: 'EPSG:4326',
            normalized_crs: 'EPSG:4326',
            feature_count_raw: validation.feature_count,
            feature_count_valid: validation.with_geometry,
            geometry_types: Object.keys(validation.geometry_types),
            attributes: validation.attributes,
            semantic_classification: validation.semantic_guess,
            file_raw: gjFile,
            file_gz: outGz,
            size_bytes_raw: validation.raw_bytes,
            size_bytes_gz: gzBuf.length,
            checksum_sha256: crypto.createHash('sha256').update(gzBuf).digest('hex'),
            verification: 'VERIFIED'
          });

          console.log(`    Compressed: ${(gzBuf.length / 1024).toFixed(1)} KB`);
          processed = true;
          break;
        } else {
          console.log(`    INVALID: ${validation.error}`);
          summary.errors.push({ district: dist.slug, file: gjFile, error: validation.error });
        }
      }

      if (processed) break;

      // Try shapefile
      if (isValidShapefile(searchDir)) {
        const shpFile = getShpFile(searchDir);
        const shpPath = path.join(searchDir, shpFile);
        const crs = detectCrsFromPrj(searchDir);
        console.log(`  Shapefile found: ${shpFile}`);
        console.log(`    CRS: ${crs}`);

        const outGeojson = path.join(dir, 'raw_geo_gps.geojson');
        if (convertShpToGeojson(shpPath, outGeojson, crs)) {
          console.log('    Converted to GeoJSON.');
          const validation = quickValidateGeojson(outGeojson);
          if (validation.valid) {
            console.log(`    Features: ${validation.feature_count}`);
            console.log(`    Types: ${JSON.stringify(validation.geometry_types)}`);
            console.log(`    Median area: ${validation.area_median_m2} m² → ${validation.semantic_guess}`);
            console.log(`    Attributes: ${validation.attributes.join(', ')}`);

            const raw = fs.readFileSync(outGeojson);
            const gzBuf = zlib.gzipSync(raw);
            const outGz = path.join(dir, 'raw_geo_gps.geojson.gz');
            fs.writeFileSync(outGz, gzBuf);

            writeManifest(dir, {
              source: 'GEO_GPS_PERU',
              source_url: 'https://www.geogpsperu.com',
              district: dist.name,
              ubigeo: dist.ubigeo,
              acquired_at: new Date().toISOString(),
              original_format: 'Shapefile',
              original_filename: shpFile,
              original_crs: crs,
              normalized_crs: 'EPSG:4326',
              feature_count_raw: validation.feature_count,
              feature_count_valid: validation.with_geometry,
              geometry_types: Object.keys(validation.geometry_types),
              attributes: validation.attributes,
              semantic_classification: validation.semantic_guess,
              file_raw: outGeojson,
              file_gz: outGz,
              size_bytes_raw: validation.raw_bytes,
              size_bytes_gz: gzBuf.length,
              checksum_sha256: crypto.createHash('sha256').update(gzBuf).digest('hex'),
              verification: 'VERIFIED'
            });

            console.log(`    Compressed: ${(gzBuf.length / 1024).toFixed(1)} KB`);
            processed = true;
            break;
          } else {
            console.log(`    INVALID after conversion: ${validation.error}`);
            summary.errors.push({ district: dist.slug, file: outGeojson, error: validation.error });
          }
        } else {
          summary.errors.push({ district: dist.slug, file: shpPath, error: 'ogr2ogr conversion failed or not available' });
        }
      }
    }

    if (processed) {
      summary.processed.push(dist.slug);
      console.log(`  DONE`);
    } else if (!summary.missing.includes(dist.slug)) {
      console.log(`  WARNING: Files found but no valid geodata detected.`);
      console.log(`  Check that you downloaded the correct shapefile/GeoJSON.`);
      writeInstructions(dir, dist);
      summary.errors.push({ district: dist.slug, error: 'Files found but not valid geodata' });
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(50));
  console.log('SUMMARY');
  console.log(`  Processed: ${summary.processed.length}/5 — ${summary.processed.join(', ') || 'none'}`);
  console.log(`  Missing: ${summary.missing.length}/5 — ${summary.missing.join(', ') || 'none'}`);
  console.log(`  Errors: ${summary.errors.length}`);
  if (summary.errors.length > 0) {
    summary.errors.forEach(e => console.log(`    - ${e.district}: ${e.error}`));
  }
  console.log('');

  if (summary.missing.length > 0) {
    console.log('MANUAL DOWNLOADS NEEDED:');
    for (const slug of summary.missing) {
      const dir = path.join(GEO_GPS_DIR, slug);
      console.log(`  ${slug}: see ${dir}/_download_instructions.txt`);
    }
    console.log('');
  }

  // Write summary
  const summaryFile = path.join(GEO_GPS_DIR, 'processing_summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({
    processed_at: new Date().toISOString(),
    ogr2ogr_available: canOgr,
    processed: summary.processed,
    missing: summary.missing,
    errors: summary.errors
  }, null, 2));
  console.log(`Summary written to: ${summaryFile}`);
}

main();
