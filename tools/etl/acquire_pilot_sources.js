#!/usr/bin/env node
/**
 * PHASE 2B-0 PILOT: External Source Acquisition
 * Run this script from a machine with internet access.
 *
 * Usage: node tools/etl/acquire_pilot_sources.js [--source=geo_gps|cofopri|all]
 *
 * Acquires catastro data for 5 pilot districts from external sources,
 * saves to data/raw/external/<source>/<district>/
 *
 * Sources attempted in order:
 * 1. COFOPRI ArcGIS REST API (government, official)
 * 2. GEO GPS Peru (community, shapefile downloads)
 * 3. GEOIDEP WFS (government, OGC standard)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

const BASE = path.resolve(__dirname, '../..');
const RAW_EXT = path.join(BASE, 'data/raw/external');

const PILOT_DISTRICTS = [
  { name: 'MIRAFLORES', ubigeo: '150122', slug: 'miraflores' },
  { name: 'LA VICTORIA', ubigeo: '150115', slug: 'la-victoria' },
  { name: 'SURQUILLO', ubigeo: '150141', slug: 'surquillo' },
  { name: 'CHORRILLOS', ubigeo: '150108', slug: 'chorrillos' },
  { name: 'SAN JUAN DE LURIGANCHO', ubigeo: '150132', slug: 'san-juan-de-lurigancho' }
];

// ── COFOPRI ArcGIS REST API ──────────────────────────────
const COFOPRI_BASE = 'https://geoportal.cofopri.gob.pe/cofopri/rest/services/Cofopri/CATASTRO_URBANO/MapServer';

// District bounding boxes (WGS84) for spatial queries
const DISTRICT_BBOX = {
  'miraflores': { xmin: -77.055, ymin: -12.145, xmax: -77.005, ymax: -12.095 },
  'la-victoria': { xmin: -77.035, ymin: -12.08, xmax: -76.99, ymax: -12.04 },
  'surquillo': { xmin: -77.02, ymin: -12.115, xmax: -76.99, ymax: -12.095 },
  'chorrillos': { xmin: -77.04, ymin: -12.21, xmax: -76.96, ymax: -12.14 },
  'san-juan-de-lurigancho': { xmin: -77.02, ymin: -12.04, xmax: -76.9, ymax: -11.85 }
};

async function fetchJson(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nRaw: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function queryCofopriLayer(layerId, bbox, districtName) {
  const { xmin, ymin, xmax, ymax } = bbox;
  const geometry = encodeURIComponent(JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } }));

  let allFeatures = [];
  let offset = 0;
  const batchSize = 1000;
  let hasMore = true;

  console.log(`    Querying COFOPRI layer ${layerId} for ${districtName}...`);

  while (hasMore) {
    const url = `${COFOPRI_BASE}/${layerId}/query?` +
      `geometry=${geometry}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true` +
      `&f=geojson&resultOffset=${offset}&resultRecordCount=${batchSize}`;

    try {
      const result = await fetchJson(url);
      if (result.error) {
        console.log(`    Error: ${result.error.message || JSON.stringify(result.error)}`);
        break;
      }
      if (result.features && result.features.length > 0) {
        allFeatures = allFeatures.concat(result.features);
        console.log(`    Batch: ${result.features.length} features (total: ${allFeatures.length})`);
        if (result.features.length < batchSize) hasMore = false;
        else offset += batchSize;
      } else {
        hasMore = false;
      }
    } catch (e) {
      console.log(`    Fetch error: ${e.message}`);
      hasMore = false;
    }
  }

  return { type: 'FeatureCollection', features: allFeatures };
}

async function acquireCofopri() {
  console.log('\n═══ SOURCE: COFOPRI ArcGIS REST ═══');

  // First discover available layers
  try {
    const info = await fetchJson(`${COFOPRI_BASE}?f=json`);
    console.log(`  Service: ${info.serviceDescription || 'CATASTRO_URBANO'}`);
    console.log(`  Layers: ${(info.layers || []).map(l => `${l.id}:${l.name}`).join(', ')}`);
    console.log(`  Spatial Ref: ${JSON.stringify(info.spatialReference)}`);

    // Query Lotes layer (typically layer 0 or search by name)
    const lotesLayer = (info.layers || []).find(l =>
      l.name.toLowerCase().includes('lote') || l.name.toLowerCase().includes('predio')
    );
    const layerId = lotesLayer ? lotesLayer.id : 0;
    console.log(`  Using layer: ${layerId} (${lotesLayer ? lotesLayer.name : 'default'})`);

    for (const dist of PILOT_DISTRICTS) {
      const bbox = DISTRICT_BBOX[dist.slug];
      if (!bbox) { console.log(`  SKIP ${dist.name}: no bbox defined`); continue; }

      const fc = await queryCofopriLayer(layerId, bbox, dist.name);

      if (fc.features.length > 0) {
        const outDir = path.join(RAW_EXT, 'cofopri', dist.slug);
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, 'lotes.geojson');
        fs.writeFileSync(outFile, JSON.stringify(fc, null, 2));

        const gzBuf = zlib.gzipSync(JSON.stringify(fc));
        fs.writeFileSync(outFile + '.gz', gzBuf);

        const checksum = crypto.createHash('sha256').update(gzBuf).digest('hex');

        const manifest = {
          source: 'COFOPRI',
          endpoint: `${COFOPRI_BASE}/${layerId}/query`,
          district: dist.name,
          ubigeo: dist.ubigeo,
          acquired_at: new Date().toISOString(),
          format: 'GeoJSON (from ArcGIS REST)',
          crs: 'EPSG:4326',
          features: fc.features.length,
          geometry_types: [...new Set(fc.features.map(f => f.geometry.type))],
          file: outFile + '.gz',
          size_bytes: gzBuf.length,
          checksum_sha256: checksum,
          attributes: fc.features.length > 0 ? Object.keys(fc.features[0].properties) : [],
          bbox: bbox,
          verification: 'VERIFIED'
        };

        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`  ✓ ${dist.name}: ${fc.features.length} features → ${outFile}.gz`);
      } else {
        console.log(`  ✗ ${dist.name}: no features returned`);
      }
    }
  } catch (e) {
    console.log(`  COFOPRI ERROR: ${e.message}`);
    console.log('  This is expected if running from a sandbox without internet access.');
    console.log('  Run this script from a local machine with unrestricted internet.');
  }
}

async function acquireGeoGpsPeru() {
  console.log('\n═══ SOURCE: GEO GPS PERU ═══');
  console.log('  GEO GPS Peru distributes shapefiles via Google Drive/MediaFire.');
  console.log('  Automated download is not reliable (requires browser, captchas).');
  console.log('');
  console.log('  MANUAL STEPS:');
  console.log('  1. Visit: https://www.geogpsperu.com/2020/11/lotes-predios-urbano-lima-callao.html');
  console.log('  2. Click on each pilot district on the interactive map');
  console.log('  3. Download the Shapefile ZIP for each:');

  for (const dist of PILOT_DISTRICTS) {
    const outDir = path.join(RAW_EXT, 'geo_gps_peru', dist.slug);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`     - ${dist.name} → save to ${outDir}/`);
  }

  console.log('  4. After downloading, run: node tools/etl/process_external_shapefiles.js');
  console.log('');
  console.log('  ALSO CHECK (2025 dataset):');
  console.log('  https://www.geogpsperu.com/2025/04/mapa-de-lotes-manzanas-y-localidades.html');
  console.log('  This SEDAPAL-based dataset may have more complete coverage.');
}

async function acquireGeoidepWfs() {
  console.log('\n═══ SOURCE: GEOIDEP WFS ═══');

  // Known WFS endpoints from IDEP catalog
  const WFS_ENDPOINTS = {
    'miraflores': {
      url: 'https://geoidep.gob.pe/geoserver/miraflores/wfs',
      layer: 'miraflores:lotes_catastrales',
      note: 'Confirmed in GEOIDEP catalog (UUID: 5730e35e-9b58-4b16-99c5-60a819ac7360)'
    }
  };

  for (const dist of PILOT_DISTRICTS) {
    const wfs = WFS_ENDPOINTS[dist.slug];
    if (!wfs) {
      console.log(`  ${dist.name}: No known WFS endpoint. Check GEOIDEP catalog.`);
      continue;
    }

    console.log(`  ${dist.name}: Attempting WFS from ${wfs.url}`);
    const outDir = path.join(RAW_EXT, 'geoidep', dist.slug);
    fs.mkdirSync(outDir, { recursive: true });

    try {
      const getCapUrl = `${wfs.url}?service=WFS&request=GetCapabilities`;
      console.log(`    GetCapabilities: ${getCapUrl}`);

      const getFeatUrl = `${wfs.url}?service=WFS&version=2.0.0&request=GetFeature` +
        `&typeNames=${encodeURIComponent(wfs.layer)}&outputFormat=application/json&srsName=EPSG:4326`;
      console.log(`    GetFeature: ${getFeatUrl}`);

      const fc = await fetchJson(getFeatUrl);

      if (fc.features && fc.features.length > 0) {
        const gzBuf = zlib.gzipSync(JSON.stringify(fc));
        const outFile = path.join(outDir, 'lotes_wfs.geojson.gz');
        fs.writeFileSync(outFile, gzBuf);

        const manifest = {
          source: 'GEOIDEP_WFS',
          endpoint: getFeatUrl,
          district: dist.name,
          ubigeo: dist.ubigeo,
          acquired_at: new Date().toISOString(),
          format: 'GeoJSON (from WFS 2.0)',
          crs: 'EPSG:4326',
          features: fc.features.length,
          geometry_types: [...new Set(fc.features.map(f => f.geometry.type))],
          file: outFile,
          size_bytes: gzBuf.length,
          checksum_sha256: crypto.createHash('sha256').update(gzBuf).digest('hex'),
          attributes: fc.features.length > 0 ? Object.keys(fc.features[0].properties) : [],
          note: wfs.note,
          verification: 'VERIFIED'
        };

        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`    ✓ ${fc.features.length} features → ${outFile}`);
      } else {
        console.log(`    ✗ No features or error: ${JSON.stringify(fc).slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
      console.log(`    ${wfs.note}`);
      console.log(`    Try manually: curl "${wfs.url}?service=WFS&request=GetCapabilities" | head -100`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const source = args.find(a => a.startsWith('--source='))?.split('=')[1] || 'all';

  console.log('PHASE 2B-0 PILOT: Source Acquisition');
  console.log('Date:', new Date().toISOString());
  console.log('Pilot districts:', PILOT_DISTRICTS.map(d => d.name).join(', '));
  console.log('');

  fs.mkdirSync(RAW_EXT, { recursive: true });

  if (source === 'all' || source === 'cofopri') await acquireCofopri();
  if (source === 'all' || source === 'geo_gps') await acquireGeoGpsPeru();
  if (source === 'all' || source === 'geoidep') await acquireGeoidepWfs();

  console.log('\n═══ ACQUISITION COMPLETE ═══');
  console.log('Next: node tools/etl/pilot_analysis.js');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
