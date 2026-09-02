#!/usr/bin/env node
/**
 * PHASE 2B-0.5 PILOT: External Source Acquisition
 *
 * Local data acquisition pipeline for 5 pilot districts in Lima, Peru.
 * Run from a LOCAL machine with internet access (not a sandbox).
 *
 * Usage:
 *   node tools/etl/acquire_pilot_sources.js [options]
 *
 * Options:
 *   --source=cofopri|geoidep|geo_gps|all   Source to acquire (default: all)
 *   --district=slug                         Single district slug (default: all 5)
 *   --dry-run                               Show planned queries without fetching
 *   --verbose                               Detailed HTTP logging
 *
 * Output goes to data/raw/external/<source>/<district>/
 * NEVER modifies parcel_master or any production data.
 *
 * Sources:
 *   1. COFOPRI ArcGIS REST API (official government catastro)
 *   2. GEOIDEP WFS (OGC standard, currently Miraflores only)
 *   3. GEO GPS Peru (manual shapefile downloads)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

// ── Constants ───────────────────────────────────────────────

const BASE = path.resolve(__dirname, '../..');
const RAW_EXT = path.join(BASE, 'data', 'raw', 'external');

const PILOT_DISTRICTS = [
  { name: 'MIRAFLORES',              ubigeo: '150122', slug: 'miraflores' },
  { name: 'LA VICTORIA',             ubigeo: '150115', slug: 'la-victoria' },
  { name: 'SURQUILLO',               ubigeo: '150141', slug: 'surquillo' },
  { name: 'CHORRILLOS',              ubigeo: '150108', slug: 'chorrillos' },
  { name: 'SAN JUAN DE LURIGANCHO',  ubigeo: '150132', slug: 'san-juan-de-lurigancho' },
];

const DISTRICT_BBOX = {
  'miraflores':              { xmin: -77.055, ymin: -12.145, xmax: -77.005, ymax: -12.095 },
  'la-victoria':             { xmin: -77.035, ymin: -12.08,  xmax: -76.99,  ymax: -12.04  },
  'surquillo':               { xmin: -77.02,  ymin: -12.115, xmax: -76.99,  ymax: -12.095 },
  'chorrillos':              { xmin: -77.04,  ymin: -12.21,  xmax: -76.96,  ymax: -12.14  },
  'san-juan-de-lurigancho':  { xmin: -77.02,  ymin: -12.04,  xmax: -76.9,   ymax: -11.85  },
};

const COFOPRI_BASE = 'https://geoportal.cofopri.gob.pe/cofopri/rest/services/Cofopri/CATASTRO_URBANO/MapServer';

const GEOIDEP_ENDPOINTS = {
  'miraflores': {
    url: 'https://geoidep.gob.pe/geoserver/miraflores/wfs',
    layer: 'miraflores:lotes_catastrales',
    uuid: '5730e35e-9b58-4b16-99c5-60a819ac7360',
  },
};

const GEO_GPS_PERU_URLS = [
  { year: 2020, url: 'https://www.geogpsperu.com/2020/11/lotes-predios-urbano-lima-callao.html', desc: 'Lotes/Predios Urbano Lima-Callao' },
  { year: 2025, url: 'https://www.geogpsperu.com/2025/04/mapa-de-lotes-manzanas-y-localidades.html', desc: 'SEDAPAL Lotes, Manzanas y Localidades' },
];

const BBOX_EXPAND_FACTOR = 0.05; // 5% margin

const HTTP_TIMEOUT_METADATA = 30000;
const HTTP_TIMEOUT_DATA = 60000;
const MAX_RETRIES = 3;
const BATCH_SIZE = 1000;

// ── CLI Parsing ─────────────────────────────────────────────

function parseCli() {
  const args = process.argv.slice(2);
  const opts = {
    source: 'all',
    district: 'all',
    dryRun: false,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--source='))   opts.source = arg.split('=')[1];
    if (arg.startsWith('--district=')) opts.district = arg.split('=')[1];
    if (arg === '--dry-run')           opts.dryRun = true;
    if (arg === '--verbose')           opts.verbose = true;
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node tools/etl/acquire_pilot_sources.js [options]

Options:
  --source=cofopri|geoidep|geo_gps|all   Source to acquire (default: all)
  --district=miraflores|la-victoria|surquillo|chorrillos|san-juan-de-lurigancho
                                         Single district (default: all 5)
  --dry-run                              Show planned queries without fetching
  --verbose                              Detailed HTTP logging`);
      process.exit(0);
    }
  }

  return opts;
}

// ── Logging ─────────────────────────────────────────────────

let VERBOSE = false;

function log(msg)     { console.log(msg); }
function logV(msg)    { if (VERBOSE) console.log(`  [VERBOSE] ${msg}`); }
function logErr(msg)  { console.error(`  [ERROR] ${msg}`); }

// ── HTTP Utilities ──────────────────────────────────────────

/**
 * Fetch a URL and return { statusCode, headers, body } as a Buffer.
 * Supports http and https. Follows 301/302 redirects (up to 5).
 * Retries up to MAX_RETRIES with exponential backoff.
 */
function httpGet(urlStr, { timeout = HTTP_TIMEOUT_METADATA, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    function attempt(currentUrl, redirectCount, retryCount) {
      const parsed = new URL(currentUrl);
      const transport = parsed.protocol === 'https:' ? https : http;

      logV(`HTTP GET ${currentUrl} (attempt ${retryCount + 1}/${MAX_RETRIES}, timeout ${timeout}ms)`);

      const req = transport.get(currentUrl, { timeout }, res => {
        // Handle redirects
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error(`Too many redirects (${maxRedirects}) for ${urlStr}`));
            return;
          }
          const redirectUrl = new URL(res.headers.location, currentUrl).href;
          logV(`Redirect ${res.statusCode} -> ${redirectUrl}`);
          // Consume current response to free socket
          res.resume();
          attempt(redirectUrl, redirectCount + 1, retryCount);
          return;
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          logV(`Response: ${res.statusCode}, ${body.length} bytes`);
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        });
        res.on('error', err => {
          if (retryCount < MAX_RETRIES - 1) {
            const delay = Math.pow(2, retryCount) * 1000;
            logV(`Response error, retrying in ${delay}ms: ${err.message}`);
            setTimeout(() => attempt(currentUrl, redirectCount, retryCount + 1), delay);
          } else {
            reject(err);
          }
        });
      });

      req.on('error', err => {
        if (retryCount < MAX_RETRIES - 1) {
          const delay = Math.pow(2, retryCount) * 1000;
          logV(`Request error, retrying in ${delay}ms: ${err.message}`);
          setTimeout(() => attempt(currentUrl, redirectCount, retryCount + 1), delay);
        } else {
          reject(err);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (retryCount < MAX_RETRIES - 1) {
          const delay = Math.pow(2, retryCount) * 1000;
          logV(`Timeout, retrying in ${delay}ms`);
          setTimeout(() => attempt(currentUrl, redirectCount, retryCount + 1), delay);
        } else {
          reject(new Error(`Timeout after ${MAX_RETRIES} attempts for ${urlStr}`));
        }
      });
    }

    attempt(urlStr, 0, 0);
  });
}

/**
 * Fetch a URL and parse the response as JSON.
 */
async function fetchJson(urlStr, opts = {}) {
  const res = await httpGet(urlStr, opts);
  if (res.statusCode !== 200) {
    throw Object.assign(
      new Error(`HTTP ${res.statusCode} from ${urlStr}`),
      { httpStatus: res.statusCode }
    );
  }
  const text = res.body.toString('utf-8');
  try {
    return { data: JSON.parse(text), httpStatus: res.statusCode };
  } catch (e) {
    throw new Error(`JSON parse error from ${urlStr}: ${e.message}\nRaw (first 300 chars): ${text.slice(0, 300)}`);
  }
}

/**
 * Fetch a URL and return response body as text.
 */
async function fetchText(urlStr, opts = {}) {
  const res = await httpGet(urlStr, opts);
  return { text: res.body.toString('utf-8'), httpStatus: res.statusCode };
}

// ── Bbox Utilities ──────────────────────────────────────────

/**
 * Expand a bounding box by a percentage on each side.
 */
function expandBbox(bbox, factor) {
  const dx = (bbox.xmax - bbox.xmin) * factor;
  const dy = (bbox.ymax - bbox.ymin) * factor;
  return {
    xmin: bbox.xmin - dx,
    ymin: bbox.ymin - dy,
    xmax: bbox.xmax + dx,
    ymax: bbox.ymax + dy,
  };
}

/**
 * Compute bounding box from a GeoJSON FeatureCollection.
 */
function computeBboxFromFeatures(features) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const f of features) {
    if (!f.geometry || !f.geometry.coordinates) continue;
    visitCoords(f.geometry.coordinates, ([x, y]) => {
      if (x < xmin) xmin = x;
      if (y < ymin) ymin = y;
      if (x > xmax) xmax = x;
      if (y > ymax) ymax = y;
    });
  }
  if (xmin === Infinity) return null;
  return { xmin, ymin, xmax, ymax };
}

function visitCoords(coords, fn) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') {
    fn(coords);
    return;
  }
  for (const c of coords) visitCoords(c, fn);
}

// ── GeoJSON Validation ──────────────────────────────────────

/**
 * Validate a GeoJSON FeatureCollection and return statistics.
 */
function validateGeoJson(fc) {
  const result = {
    valid: false,
    featureCount: 0,
    featuresWithGeometry: 0,
    featuresWithoutGeometry: 0,
    geometryTypes: {},
    attributes: [],
    parseErrors: [],
    areaEstimates: [],
  };

  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    result.parseErrors.push('Not a valid GeoJSON FeatureCollection');
    return result;
  }

  result.featureCount = fc.features.length;

  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i];
    if (!f) {
      result.parseErrors.push(`Feature at index ${i} is null/undefined`);
      continue;
    }

    if (f.geometry && f.geometry.type) {
      result.featuresWithGeometry++;
      const gt = f.geometry.type;
      result.geometryTypes[gt] = (result.geometryTypes[gt] || 0) + 1;

      // Quick area estimate for first 10 polygons
      if ((gt === 'Polygon' || gt === 'MultiPolygon') && result.areaEstimates.length < 10) {
        const area = estimateAreaDeg2(f.geometry);
        if (area > 0) {
          result.areaEstimates.push(area);
        }
      }
    } else {
      result.featuresWithoutGeometry++;
      if (result.featuresWithoutGeometry <= 5) {
        result.parseErrors.push(`Feature at index ${i} has no geometry`);
      }
    }

    // Collect attribute names from first feature
    if (i === 0 && f.properties) {
      result.attributes = Object.keys(f.properties);
    }
  }

  result.valid = result.featureCount > 0 && result.parseErrors.length === 0;

  return result;
}

/**
 * Rough area estimate in square degrees (for manzana vs predio detection).
 * Manzanas (blocks) are typically > 0.000001 deg^2 (~1200 m^2 at Lima latitude).
 * Predios (lots) are typically < 0.000001 deg^2.
 */
function estimateAreaDeg2(geometry) {
  let rings = [];
  if (geometry.type === 'Polygon') {
    rings = [geometry.coordinates[0]];
  } else if (geometry.type === 'MultiPolygon') {
    rings = geometry.coordinates.map(p => p[0]);
  }

  let totalArea = 0;
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    // Shoelace formula
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1];
      area -= ring[i + 1][0] * ring[i][1];
    }
    totalArea += Math.abs(area) / 2;
  }
  return totalArea;
}

/**
 * Classify features as likely predios or manzanas based on area.
 */
function classifyByArea(areaEstimates) {
  if (areaEstimates.length === 0) return 'UNKNOWN';
  const median = areaEstimates.sort((a, b) => a - b)[Math.floor(areaEstimates.length / 2)];

  // At Lima latitude (~12 S), 1 degree lon ~ 108km, 1 degree lat ~ 111km
  // 1e-7 deg^2 ~ 1.2 m^2, 1e-6 deg^2 ~ 12 m^2, 1e-5 deg^2 ~ 120 m^2
  // Typical lote: 90-300 m^2 => ~7.5e-6 to 2.5e-5 deg^2
  // Typical manzana: 3000-15000 m^2 => ~2.5e-4 to 1.25e-3 deg^2
  if (median < 1e-4) return 'LIKELY_PREDIOS';
  if (median > 5e-4) return 'LIKELY_MANZANAS';
  return 'MIXED_OR_UNCERTAIN';
}

// ── File Output Utilities ───────────────────────────────────

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Write GeoJSON data, compressed copy, and manifest.
 * Returns the manifest object.
 */
function writeAcquisitionOutput(outDir, layerName, fc, meta) {
  ensureDir(outDir);

  const rawFileName = `raw_${layerName}.geojson`;
  const gzFileName = `${rawFileName}.gz`;
  const rawPath = path.join(outDir, rawFileName);
  const gzPath = path.join(outDir, gzFileName);
  const manifestPath = path.join(outDir, 'manifest.json');

  // Write raw GeoJSON
  const rawContent = JSON.stringify(fc, null, 2);
  fs.writeFileSync(rawPath, rawContent, 'utf-8');
  const rawSize = Buffer.byteLength(rawContent, 'utf-8');

  // Write gzipped
  const gzBuf = zlib.gzipSync(rawContent);
  fs.writeFileSync(gzPath, gzBuf);
  const gzSize = gzBuf.length;

  // Checksum of raw file
  const checksum = crypto.createHash('sha256').update(rawContent).digest('hex');

  // Validate
  const validation = validateGeoJson(fc);
  const classification = classifyByArea(validation.areaEstimates);

  const bboxResult = computeBboxFromFeatures(fc.features || []);

  const manifest = {
    source: meta.source,
    source_url: meta.sourceUrl,
    district: meta.district,
    ubigeo: meta.ubigeo,
    acquired_at: new Date().toISOString(),
    original_format: meta.originalFormat || 'GeoJSON',
    original_crs: meta.originalCrs || 'EPSG:4326',
    normalized_crs: 'EPSG:4326',
    feature_count_raw: validation.featureCount,
    geometry_types: Object.keys(validation.geometryTypes),
    geometry_type_counts: validation.geometryTypes,
    attributes: validation.attributes,
    file_raw: rawPath,
    file_gz: gzPath,
    size_bytes_raw: rawSize,
    size_bytes_gz: gzSize,
    checksum_sha256: checksum,
    bbox_query: meta.bboxQuery || null,
    bbox_result: bboxResult,
    http_status: meta.httpStatus || null,
    errors: validation.parseErrors,
    features_without_geometry: validation.featuresWithoutGeometry,
    verification: validation.valid ? 'VERIFIED' : (validation.featureCount > 0 ? 'PARTIAL' : 'FAILED'),
    semantic_classification: classification,
    area_estimates_sample: validation.areaEstimates.map(a => a.toExponential(3)),
    layer_metadata: meta.layerMeta || null,
  };

  // Merge existing manifest if present (append layers)
  let existingManifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (_) { /* ignore */ }
  }

  if (existingManifest && existingManifest.layers) {
    existingManifest.layers.push(manifest);
    existingManifest.updated_at = new Date().toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(existingManifest, null, 2));
  } else if (existingManifest && existingManifest.source === manifest.source) {
    // Multiple layers for same source: convert to multi-layer manifest
    const multi = {
      source: manifest.source,
      district: manifest.district,
      ubigeo: manifest.ubigeo,
      updated_at: new Date().toISOString(),
      layers: [existingManifest, manifest],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(multi, null, 2));
  } else {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  return manifest;
}

// ── Error Logging ───────────────────────────────────────────

const collectedErrors = [];

function logStructuredError(source, url, httpStatus, error, reason, alternative) {
  const entry = {
    source,
    url,
    http_status: httpStatus || null,
    error: error || '',
    reason: reason || '',
    alternative: alternative || '',
    timestamp: new Date().toISOString(),
  };
  collectedErrors.push(entry);
  logErr(`${source}: ${error} (${reason || 'unknown reason'})`);
  return entry;
}

// ── COFOPRI ArcGIS REST API ─────────────────────────────────

async function discoverCofopriLayers() {
  log('  Discovering COFOPRI layers...');
  const url = `${COFOPRI_BASE}?f=json`;

  const { data: info, httpStatus } = await fetchJson(url, { timeout: HTTP_TIMEOUT_METADATA });

  log(`  Service: ${info.serviceDescription || info.description || 'CATASTRO_URBANO'}`);
  log(`  Spatial Reference: ${JSON.stringify(info.spatialReference || {})}`);

  const layers = info.layers || [];
  log(`  Available layers (${layers.length}):`);
  for (const l of layers) {
    log(`    [${l.id}] ${l.name} (minScale: ${l.minScale || 'n/a'}, maxScale: ${l.maxScale || 'n/a'})`);
  }

  return { layers, info, httpStatus };
}

async function getCofopriLayerMetadata(layerId) {
  const url = `${COFOPRI_BASE}/${layerId}?f=json`;
  try {
    const { data } = await fetchJson(url, { timeout: HTTP_TIMEOUT_METADATA });
    return {
      id: layerId,
      name: data.name || `layer_${layerId}`,
      description: data.description || '',
      geometryType: data.geometryType || 'unknown',
      fields: (data.fields || []).map(f => ({ name: f.name, type: f.type, alias: f.alias })),
      maxRecordCount: data.maxRecordCount || BATCH_SIZE,
      capabilities: data.capabilities || '',
    };
  } catch (e) {
    logV(`Failed to get metadata for layer ${layerId}: ${e.message}`);
    return { id: layerId, name: `layer_${layerId}`, error: e.message };
  }
}

async function queryCofopriLayer(layerId, bbox, districtName, opts) {
  const expandedBbox = expandBbox(bbox, BBOX_EXPAND_FACTOR);
  const geometry = JSON.stringify({
    xmin: expandedBbox.xmin,
    ymin: expandedBbox.ymin,
    xmax: expandedBbox.xmax,
    ymax: expandedBbox.ymax,
    spatialReference: { wkid: 4326 },
  });

  let allFeatures = [];
  let offset = 0;
  let hasMore = true;
  let lastHttpStatus = null;
  const errors = [];

  log(`    Querying layer ${layerId} for ${districtName}...`);
  log(`    Bbox (expanded 5%): [${expandedBbox.xmin.toFixed(4)}, ${expandedBbox.ymin.toFixed(4)}, ${expandedBbox.xmax.toFixed(4)}, ${expandedBbox.ymax.toFixed(4)}]`);

  if (opts.dryRun) {
    const url = `${COFOPRI_BASE}/${layerId}/query?` +
      `geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true` +
      `&f=geojson&resultOffset=0&resultRecordCount=${BATCH_SIZE}`;
    log(`    [DRY-RUN] Would query: ${url}`);
    return { fc: { type: 'FeatureCollection', features: [] }, httpStatus: null, errors: [] };
  }

  while (hasMore) {
    const url = `${COFOPRI_BASE}/${layerId}/query?` +
      `geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true` +
      `&f=geojson&resultOffset=${offset}&resultRecordCount=${BATCH_SIZE}`;

    try {
      const { data: result, httpStatus } = await fetchJson(url, { timeout: HTTP_TIMEOUT_DATA });
      lastHttpStatus = httpStatus;

      if (result.error) {
        const errMsg = result.error.message || JSON.stringify(result.error);
        errors.push(`Offset ${offset}: API error: ${errMsg}`);
        log(`    Error at offset ${offset}: ${errMsg}`);
        hasMore = false;
        continue;
      }

      if (result.features && result.features.length > 0) {
        allFeatures = allFeatures.concat(result.features);
        log(`    Batch at offset ${offset}: ${result.features.length} features (running total: ${allFeatures.length})`);
        if (result.features.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          offset += BATCH_SIZE;
        }
      } else {
        hasMore = false;
        if (offset === 0) {
          log(`    No features returned for ${districtName}`);
        }
      }
    } catch (e) {
      const status = e.httpStatus || null;
      lastHttpStatus = status;
      errors.push(`Offset ${offset}: ${e.message}`);
      logStructuredError('COFOPRI', url, status, e.message,
        'Network error or service unavailable',
        'Try again later or check if COFOPRI geoportal is accessible');
      hasMore = false;
    }
  }

  return {
    fc: { type: 'FeatureCollection', features: allFeatures },
    httpStatus: lastHttpStatus,
    errors,
  };
}

async function acquireCofopri(districts, opts) {
  log('\n======================================================');
  log('  SOURCE: COFOPRI ArcGIS REST API');
  log('======================================================');

  const results = [];

  try {
    // Step 1: Discover layers
    const { layers, info, httpStatus: serviceStatus } = await discoverCofopriLayers();

    // Step 2: Get metadata for all layers
    log('\n  Fetching layer metadata...');
    const layerMetas = [];
    for (const l of layers) {
      const meta = await getCofopriLayerMetadata(l.id);
      layerMetas.push(meta);
      log(`    [${meta.id}] ${meta.name}: ${meta.geometryType}, ${(meta.fields || []).length} fields`);
    }

    // Step 3: Identify candidate layers (lote/predio, but also query all)
    const candidateLayers = layerMetas.filter(l =>
      !l.error &&
      l.geometryType &&
      l.geometryType !== 'unknown'
    );

    const primaryLayers = candidateLayers.filter(l =>
      l.name.toLowerCase().includes('lote') ||
      l.name.toLowerCase().includes('predio')
    );

    if (primaryLayers.length > 0) {
      log(`\n  Primary layers (lote/predio): ${primaryLayers.map(l => `[${l.id}] ${l.name}`).join(', ')}`);
    } else {
      log('\n  No layers with "lote" or "predio" found. Will query all geometry layers.');
    }

    const layersToQuery = primaryLayers.length > 0 ? primaryLayers : candidateLayers;

    // Step 4: Query each layer for each district
    for (const dist of districts) {
      const bbox = DISTRICT_BBOX[dist.slug];
      if (!bbox) {
        log(`\n  SKIP ${dist.name}: no bounding box defined`);
        continue;
      }

      log(`\n  --- ${dist.name} (${dist.ubigeo}) ---`);
      const outDir = path.join(RAW_EXT, 'cofopri', dist.slug);

      for (const layer of layersToQuery) {
        const layerSlug = layer.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const { fc, httpStatus, errors } = await queryCofopriLayer(layer.id, bbox, dist.name, opts);

        if (opts.dryRun) continue;

        if (fc.features.length > 0) {
          const manifest = writeAcquisitionOutput(outDir, layerSlug, fc, {
            source: 'COFOPRI',
            sourceUrl: `${COFOPRI_BASE}/${layer.id}/query`,
            district: dist.name,
            ubigeo: dist.ubigeo,
            originalFormat: 'GeoJSON (from ArcGIS REST)',
            originalCrs: 'EPSG:4326',
            bboxQuery: expandBbox(bbox, BBOX_EXPAND_FACTOR),
            httpStatus,
            layerMeta: {
              layerId: layer.id,
              layerName: layer.name,
              geometryType: layer.geometryType,
              fieldCount: (layer.fields || []).length,
            },
          });

          log(`    OK ${dist.name}/${layer.name}: ${manifest.feature_count_raw} features, ` +
              `${manifest.semantic_classification}, ${(manifest.size_bytes_gz / 1024).toFixed(1)} KB gz`);

          results.push({
            district: dist.name,
            layer: layer.name,
            features: manifest.feature_count_raw,
            status: 'success',
          });
        } else {
          if (errors.length > 0) {
            results.push({
              district: dist.name,
              layer: layer.name,
              features: 0,
              status: 'error',
              errors,
            });
          } else {
            results.push({
              district: dist.name,
              layer: layer.name,
              features: 0,
              status: 'empty',
            });
          }
        }
      }
    }
  } catch (e) {
    logStructuredError('COFOPRI', COFOPRI_BASE, e.httpStatus || null, e.message,
      'Failed to connect to COFOPRI service',
      'Ensure internet access and that geoportal.cofopri.gob.pe is reachable');
    log(`\n  COFOPRI acquisition failed: ${e.message}`);
  }

  return results;
}

// ── GEOIDEP WFS ─────────────────────────────────────────────

async function discoverGeoidepLayers(wfsUrl) {
  const capUrl = `${wfsUrl}?service=WFS&version=2.0.0&request=GetCapabilities`;
  log(`    GetCapabilities: ${capUrl}`);

  try {
    const { text: capXml, httpStatus } = await fetchText(capUrl, { timeout: HTTP_TIMEOUT_METADATA });

    // Simple XML parsing to find FeatureType names (no external XML parser)
    const featureTypes = [];
    const regex = /<(?:wfs:)?FeatureType[^>]*>([\s\S]*?)<\/(?:wfs:)?FeatureType>/gi;
    let match;
    while ((match = regex.exec(capXml)) !== null) {
      const block = match[1];
      const nameMatch = block.match(/<(?:wfs:)?Name>(.*?)<\/(?:wfs:)?Name>/i);
      const titleMatch = block.match(/<(?:wfs:)?Title>(.*?)<\/(?:wfs:)?Title>/i);
      const crsMatch = block.match(/<(?:wfs:)?DefaultCRS>(.*?)<\/(?:wfs:)?DefaultCRS>/i) ||
                       block.match(/<(?:wfs:)?DefaultSRS>(.*?)<\/(?:wfs:)?DefaultSRS>/i);
      if (nameMatch) {
        featureTypes.push({
          name: nameMatch[1],
          title: titleMatch ? titleMatch[1] : '',
          defaultCrs: crsMatch ? crsMatch[1] : 'unknown',
        });
      }
    }

    log(`    Found ${featureTypes.length} feature types:`);
    for (const ft of featureTypes) {
      log(`      - ${ft.name} (${ft.title}) [CRS: ${ft.defaultCrs}]`);
    }

    return { featureTypes, httpStatus, raw: capXml };
  } catch (e) {
    logV(`GetCapabilities failed: ${e.message}`);
    return { featureTypes: [], httpStatus: e.httpStatus || null, error: e.message };
  }
}

async function queryGeoidepWfs(wfsUrl, layerName, districtName, opts) {
  const WFS_PAGE_SIZE = 1000;
  let allFeatures = [];
  let startIndex = 0;
  let hasMore = true;
  let lastHttpStatus = null;
  let detectedCrs = 'EPSG:4326';
  const errors = [];

  // Try application/json first, then GML
  const outputFormats = ['application/json', 'application/json;charset=UTF-8', 'GML3'];

  let usableFormat = null;

  for (const fmt of outputFormats) {
    const testUrl = `${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=${encodeURIComponent(layerName)}&outputFormat=${encodeURIComponent(fmt)}` +
      `&count=1&startIndex=0&srsName=EPSG:4326`;

    if (opts.dryRun) {
      log(`    [DRY-RUN] Would test format: ${fmt}`);
      log(`    [DRY-RUN] URL: ${testUrl}`);
      return { fc: { type: 'FeatureCollection', features: [] }, httpStatus: null, crs: detectedCrs, errors: [] };
    }

    try {
      logV(`Testing output format: ${fmt}`);
      const { data: testResult, httpStatus } = await fetchJson(testUrl, { timeout: HTTP_TIMEOUT_METADATA });
      if (testResult.features !== undefined) {
        usableFormat = fmt;
        lastHttpStatus = httpStatus;

        // Detect CRS from response
        if (testResult.crs) {
          if (testResult.crs.properties && testResult.crs.properties.name) {
            detectedCrs = testResult.crs.properties.name;
          } else if (typeof testResult.crs === 'string') {
            detectedCrs = testResult.crs;
          }
        }
        log(`    Using format: ${fmt}, detected CRS: ${detectedCrs}`);
        break;
      }
    } catch (e) {
      logV(`Format ${fmt} failed: ${e.message}`);
    }
  }

  if (!usableFormat) {
    errors.push('No usable WFS output format found (tried: ' + outputFormats.join(', ') + ')');
    logStructuredError('GEOIDEP_WFS', wfsUrl, null,
      'No usable output format',
      'Server may not support JSON output',
      'Try manually with GML output or use QGIS to connect to the WFS');
    return { fc: { type: 'FeatureCollection', features: [] }, httpStatus: lastHttpStatus, crs: detectedCrs, errors };
  }

  // Paginated fetch
  log(`    Fetching features for ${districtName} (paginated, ${WFS_PAGE_SIZE}/batch)...`);

  while (hasMore) {
    const url = `${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=${encodeURIComponent(layerName)}&outputFormat=${encodeURIComponent(usableFormat)}` +
      `&count=${WFS_PAGE_SIZE}&startIndex=${startIndex}&srsName=EPSG:4326`;

    try {
      const { data: result, httpStatus } = await fetchJson(url, { timeout: HTTP_TIMEOUT_DATA });
      lastHttpStatus = httpStatus;

      if (result.features && result.features.length > 0) {
        allFeatures = allFeatures.concat(result.features);
        log(`    Batch at startIndex ${startIndex}: ${result.features.length} features (running total: ${allFeatures.length})`);

        if (result.features.length < WFS_PAGE_SIZE) {
          hasMore = false;
        } else {
          startIndex += WFS_PAGE_SIZE;
        }

        // Also check numberMatched / numberReturned
        if (result.numberMatched !== undefined && allFeatures.length >= result.numberMatched) {
          hasMore = false;
        }
      } else {
        hasMore = false;
        if (startIndex === 0) {
          log(`    No features returned for ${districtName}`);
        }
      }
    } catch (e) {
      errors.push(`startIndex ${startIndex}: ${e.message}`);
      logStructuredError('GEOIDEP_WFS', url, e.httpStatus || null, e.message,
        'WFS fetch error',
        'Check if geoidep.gob.pe is accessible');
      hasMore = false;
    }
  }

  return {
    fc: { type: 'FeatureCollection', features: allFeatures },
    httpStatus: lastHttpStatus,
    crs: detectedCrs,
    errors,
  };
}

async function acquireGeoidep(districts, opts) {
  log('\n======================================================');
  log('  SOURCE: GEOIDEP WFS');
  log('======================================================');

  const results = [];

  for (const dist of districts) {
    const endpoint = GEOIDEP_ENDPOINTS[dist.slug];
    if (!endpoint) {
      log(`\n  ${dist.name}: No known WFS endpoint. Check GEOIDEP catalog at https://geoidep.gob.pe/`);
      results.push({ district: dist.name, status: 'no_endpoint' });
      continue;
    }

    log(`\n  --- ${dist.name} (${dist.ubigeo}) ---`);
    log(`    WFS URL: ${endpoint.url}`);
    log(`    Layer: ${endpoint.layer}`);
    log(`    UUID: ${endpoint.uuid}`);

    // Step 1: Discover layers via GetCapabilities
    const { featureTypes } = await discoverGeoidepLayers(endpoint.url);

    // Verify that the expected layer exists in capabilities
    const layerFound = featureTypes.some(ft =>
      ft.name === endpoint.layer || ft.name.endsWith(':' + endpoint.layer.split(':').pop())
    );
    if (featureTypes.length > 0 && !layerFound) {
      log(`    WARNING: Expected layer "${endpoint.layer}" not found in GetCapabilities.`);
      log(`    Available layers: ${featureTypes.map(ft => ft.name).join(', ')}`);
    }

    // Step 2: Query the layer
    const { fc, httpStatus, crs, errors } = await queryGeoidepWfs(
      endpoint.url, endpoint.layer, dist.name, opts
    );

    if (opts.dryRun) continue;

    if (fc.features.length > 0) {
      const outDir = path.join(RAW_EXT, 'geoidep', dist.slug);
      const layerSlug = endpoint.layer.split(':').pop().toLowerCase().replace(/[^a-z0-9]+/g, '_');

      const manifest = writeAcquisitionOutput(outDir, layerSlug, fc, {
        source: 'GEOIDEP_WFS',
        sourceUrl: endpoint.url,
        district: dist.name,
        ubigeo: dist.ubigeo,
        originalFormat: 'GeoJSON (from WFS 2.0)',
        originalCrs: crs,
        httpStatus,
        layerMeta: {
          layer: endpoint.layer,
          uuid: endpoint.uuid,
          detectedCrs: crs,
          availableFeatureTypes: featureTypes.map(ft => ft.name),
        },
      });

      log(`    OK ${dist.name}: ${manifest.feature_count_raw} features, ` +
          `CRS: ${crs}, ${manifest.semantic_classification}, ${(manifest.size_bytes_gz / 1024).toFixed(1)} KB gz`);

      results.push({
        district: dist.name,
        layer: endpoint.layer,
        features: manifest.feature_count_raw,
        status: 'success',
      });
    } else {
      results.push({
        district: dist.name,
        layer: endpoint.layer,
        features: 0,
        status: errors.length > 0 ? 'error' : 'empty',
        errors,
      });
    }
  }

  return results;
}

// ── GEO GPS Peru ────────────────────────────────────────────

const SHAPEFILE_REQUIRED_EXTS = ['.shp', '.dbf', '.shx'];
const SHAPEFILE_OPTIONAL_EXTS = ['.prj', '.cpg', '.shp.xml'];

function findShapefilesInDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  const files = fs.readdirSync(dirPath);
  const shpFiles = files.filter(f => f.endsWith('.shp'));

  const result = [];
  for (const shp of shpFiles) {
    const base = shp.replace(/\.shp$/, '');
    const present = {};
    const missing = [];

    for (const ext of SHAPEFILE_REQUIRED_EXTS) {
      const fname = base + ext;
      if (files.includes(fname)) {
        present[ext] = fname;
      } else {
        missing.push(ext);
      }
    }

    for (const ext of SHAPEFILE_OPTIONAL_EXTS) {
      const fname = base + ext;
      if (files.includes(fname)) {
        present[ext] = fname;
      }
    }

    result.push({
      baseName: base,
      shpFile: shp,
      presentFiles: present,
      missingRequired: missing,
      valid: missing.length === 0,
    });
  }

  return result;
}

function findGeoJsonInDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath);
  return files.filter(f => f.endsWith('.geojson') || f.endsWith('.json'));
}

function checkOgr2ogr() {
  try {
    const { execSync } = require('child_process');
    execSync('ogr2ogr --version', { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

function convertShapefileToGeoJson(shpPath, outPath) {
  try {
    const { execSync } = require('child_process');
    execSync(`ogr2ogr -f GeoJSON -t_srs EPSG:4326 "${outPath}" "${shpPath}"`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    logErr(`ogr2ogr conversion failed: ${e.message}`);
    return false;
  }
}

function writeDownloadInstructions(outDir, districtName) {
  const instructions = `GEO GPS PERU - MANUAL DOWNLOAD INSTRUCTIONS
=============================================

District: ${districtName}
Target directory: ${outDir}

This data source requires manual browser download because files are
hosted on Google Drive/MediaFire with CAPTCHA protection.

STEP 1: Visit one of these pages:

  (a) 2020 dataset (Lotes/Predios Urbano Lima-Callao):
      ${GEO_GPS_PERU_URLS[0].url}

  (b) 2025 SEDAPAL dataset (Lotes, Manzanas y Localidades):
      ${GEO_GPS_PERU_URLS[1].url}

STEP 2: On the page, look for the interactive map and click on
        "${districtName}" or navigate to the download link for this district.

STEP 3: Download the ZIP file containing the Shapefile.

STEP 4: Extract the ZIP contents into this directory:
        ${outDir}

EXPECTED FILES (Shapefile format):
  Required:
    - <name>.shp    (geometry)
    - <name>.dbf    (attributes)
    - <name>.shx    (spatial index)
  Optional but recommended:
    - <name>.prj    (coordinate reference system)
    - <name>.cpg    (character encoding)

  OR a GeoJSON file:
    - <name>.geojson

EXPECTED CRS: EPSG:4326 (WGS84) or EPSG:32718 (UTM 18S)
EXPECTED GEOMETRY: Polygon or MultiPolygon (lot/parcel boundaries)

STEP 5: Re-run this script to process the downloaded files:
        node tools/etl/acquire_pilot_sources.js --source=geo_gps --district=${districtName.toLowerCase().replace(/\s+/g, '-')}

Generated: ${new Date().toISOString()}
`;

  fs.writeFileSync(path.join(outDir, '_download_instructions.txt'), instructions, 'utf-8');
}

async function acquireGeoGpsPeru(districts, opts) {
  log('\n======================================================');
  log('  SOURCE: GEO GPS PERU (Manual Download)');
  log('======================================================');

  const hasOgr = checkOgr2ogr();
  if (hasOgr) {
    log('  ogr2ogr detected: shapefile-to-GeoJSON conversion available');
  } else {
    log('  ogr2ogr NOT detected: shapefile conversion will not be available');
    log('  Install GDAL/OGR for automatic shapefile conversion.');
  }

  const results = [];

  for (const dist of districts) {
    const outDir = path.join(RAW_EXT, 'geo_gps_peru', dist.slug);
    ensureDir(outDir);

    log(`\n  --- ${dist.name} (${dist.ubigeo}) ---`);
    log(`    Directory: ${outDir}`);

    // Check for existing shapefiles
    const shapefiles = findShapefilesInDir(outDir);
    const geojsonFiles = findGeoJsonInDir(outDir);

    if (shapefiles.length === 0 && geojsonFiles.length === 0) {
      // No files found - write instructions
      log(`    No data files found.`);
      writeDownloadInstructions(outDir, dist.name);
      log(`    Written: _download_instructions.txt`);
      log(`    ACTION REQUIRED: Download shapefile manually (see instructions above)`);

      results.push({
        district: dist.name,
        status: 'manual_download_needed',
        directory: outDir,
      });
      continue;
    }

    // Process shapefiles
    for (const shp of shapefiles) {
      log(`    Found shapefile: ${shp.shpFile}`);

      if (!shp.valid) {
        log(`    WARNING: Missing required files: ${shp.missingRequired.join(', ')}`);
        logStructuredError('GEO_GPS_PERU', outDir, null,
          `Incomplete shapefile: missing ${shp.missingRequired.join(', ')}`,
          'Shapefile requires .shp, .dbf, and .shx at minimum',
          'Re-download and extract the complete ZIP file');

        results.push({
          district: dist.name,
          shapefile: shp.shpFile,
          status: 'invalid_shapefile',
          missing: shp.missingRequired,
        });
        continue;
      }

      log(`    Valid shapefile: ${Object.values(shp.presentFiles).join(', ')}`);

      if (opts.dryRun) {
        log(`    [DRY-RUN] Would convert ${shp.shpFile} to GeoJSON`);
        results.push({ district: dist.name, shapefile: shp.shpFile, status: 'dry_run' });
        continue;
      }

      // Convert to GeoJSON
      const shpFullPath = path.join(outDir, shp.shpFile);
      const geojsonName = `raw_${shp.baseName}.geojson`;
      const geojsonFullPath = path.join(outDir, geojsonName);

      if (hasOgr) {
        log(`    Converting ${shp.shpFile} to GeoJSON...`);
        const converted = convertShapefileToGeoJson(shpFullPath, geojsonFullPath);

        if (converted && fs.existsSync(geojsonFullPath)) {
          // Read and validate the converted GeoJSON
          try {
            const fcStr = fs.readFileSync(geojsonFullPath, 'utf-8');
            const fc = JSON.parse(fcStr);

            // Detect original CRS from .prj if present
            let originalCrs = 'UNKNOWN';
            const prjFile = path.join(outDir, shp.baseName + '.prj');
            if (fs.existsSync(prjFile)) {
              const prjContent = fs.readFileSync(prjFile, 'utf-8');
              if (prjContent.includes('WGS_1984') || prjContent.includes('WGS 84')) {
                originalCrs = 'EPSG:4326';
              } else if (prjContent.includes('UTM') && prjContent.includes('18S')) {
                originalCrs = 'EPSG:32718';
              } else {
                originalCrs = prjContent.slice(0, 100);
              }
            }

            const manifest = writeAcquisitionOutput(outDir, shp.baseName, fc, {
              source: 'GEO_GPS_PERU',
              sourceUrl: GEO_GPS_PERU_URLS[0].url,
              district: dist.name,
              ubigeo: dist.ubigeo,
              originalFormat: 'Shapefile (converted via ogr2ogr)',
              originalCrs,
            });

            log(`    OK ${shp.shpFile}: ${manifest.feature_count_raw} features, ` +
                `${manifest.semantic_classification}, ${(manifest.size_bytes_gz / 1024).toFixed(1)} KB gz`);

            results.push({
              district: dist.name,
              shapefile: shp.shpFile,
              features: manifest.feature_count_raw,
              status: 'success',
            });
          } catch (e) {
            logErr(`Failed to read converted GeoJSON: ${e.message}`);
            results.push({ district: dist.name, shapefile: shp.shpFile, status: 'conversion_error', error: e.message });
          }
        } else {
          log(`    Conversion failed for ${shp.shpFile}`);
          results.push({ district: dist.name, shapefile: shp.shpFile, status: 'conversion_failed' });
        }
      } else {
        log(`    CANNOT CONVERT: ogr2ogr is not available.`);
        log(`    Install GDAL (apt-get install gdal-bin, brew install gdal, etc.)`);
        log(`    Then re-run: node tools/etl/acquire_pilot_sources.js --source=geo_gps --district=${dist.slug}`);

        results.push({
          district: dist.name,
          shapefile: shp.shpFile,
          status: 'needs_ogr2ogr',
        });
      }
    }

    // Process existing GeoJSON files (user may have placed them directly)
    for (const gjFile of geojsonFiles) {
      // Skip files we generated (raw_ prefix or manifest)
      if (gjFile.startsWith('raw_') || gjFile === 'manifest.json') continue;

      log(`    Found GeoJSON: ${gjFile}`);

      if (opts.dryRun) {
        log(`    [DRY-RUN] Would validate ${gjFile}`);
        results.push({ district: dist.name, geojsonFile: gjFile, status: 'dry_run' });
        continue;
      }

      try {
        const fcStr = fs.readFileSync(path.join(outDir, gjFile), 'utf-8');
        const fc = JSON.parse(fcStr);

        const baseName = gjFile.replace(/\.(geo)?json$/, '');

        const manifest = writeAcquisitionOutput(outDir, baseName, fc, {
          source: 'GEO_GPS_PERU',
          sourceUrl: GEO_GPS_PERU_URLS[0].url,
          district: dist.name,
          ubigeo: dist.ubigeo,
          originalFormat: 'GeoJSON (user-provided)',
          originalCrs: 'EPSG:4326',
        });

        log(`    OK ${gjFile}: ${manifest.feature_count_raw} features, ` +
            `${manifest.semantic_classification}, ${(manifest.size_bytes_gz / 1024).toFixed(1)} KB gz`);

        results.push({
          district: dist.name,
          geojsonFile: gjFile,
          features: manifest.feature_count_raw,
          status: 'success',
        });
      } catch (e) {
        logErr(`Failed to process ${gjFile}: ${e.message}`);
        logStructuredError('GEO_GPS_PERU', path.join(outDir, gjFile), null,
          `Invalid GeoJSON: ${e.message}`,
          'File may be corrupted or not valid GeoJSON',
          'Re-download or verify file format');

        results.push({
          district: dist.name,
          geojsonFile: gjFile,
          status: 'invalid',
          error: e.message,
        });
      }
    }
  }

  // Print manual download summary
  const needsDownload = results.filter(r => r.status === 'manual_download_needed');
  if (needsDownload.length > 0) {
    log('\n  ---- MANUAL DOWNLOADS NEEDED ----');
    log('  The following districts need manual shapefile downloads:');
    for (const r of needsDownload) {
      log(`    - ${r.district}: save to ${r.directory}/`);
    }
    log('');
    log('  Download sources:');
    for (const src of GEO_GPS_PERU_URLS) {
      log(`    [${src.year}] ${src.desc}`);
      log(`           ${src.url}`);
    }
  }

  return results;
}

// ── Summary Report ──────────────────────────────────────────

function generateSummary(cofopriResults, geoidepResults, geoGpsResults, startTime) {
  const endTime = new Date();

  const allResults = [
    ...(cofopriResults || []).map(r => ({ ...r, source: 'COFOPRI' })),
    ...(geoidepResults || []).map(r => ({ ...r, source: 'GEOIDEP_WFS' })),
    ...(geoGpsResults || []).map(r => ({ ...r, source: 'GEO_GPS_PERU' })),
  ];

  const totalAttempted = allResults.length;
  const totalSucceeded = allResults.filter(r => r.status === 'success').length;
  const totalFeatures = allResults
    .filter(r => r.status === 'success')
    .reduce((sum, r) => sum + (r.features || 0), 0);

  const manualNeeded = allResults.filter(r =>
    r.status === 'manual_download_needed' || r.status === 'needs_ogr2ogr'
  );

  const featuresBySourceDistrict = {};
  for (const r of allResults.filter(x => x.status === 'success')) {
    const key = `${r.source}/${r.district}`;
    featuresBySourceDistrict[key] = (featuresBySourceDistrict[key] || 0) + (r.features || 0);
  }

  const summary = {
    phase: '2B-0.5',
    pipeline: 'acquire_pilot_sources',
    started_at: startTime.toISOString(),
    completed_at: endTime.toISOString(),
    duration_seconds: Math.round((endTime - startTime) / 1000),
    total_sources_attempted: totalAttempted,
    total_sources_succeeded: totalSucceeded,
    total_features_acquired: totalFeatures,
    features_by_source_district: featuresBySourceDistrict,
    manual_downloads_needed: manualNeeded.map(r => ({
      source: r.source,
      district: r.district,
      reason: r.status,
      directory: r.directory || null,
    })),
    errors: collectedErrors,
    results: allResults,
  };

  const summaryPath = path.join(RAW_EXT, 'acquisition_summary.json');
  ensureDir(RAW_EXT);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  return { summary, summaryPath };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const startTime = new Date();
  const opts = parseCli();
  VERBOSE = opts.verbose;

  log('PHASE 2B-0.5 PILOT: External Source Acquisition');
  log(`Date: ${startTime.toISOString()}`);
  log(`Mode: ${opts.dryRun ? 'DRY-RUN' : 'LIVE'}`);
  log(`Verbose: ${opts.verbose}`);
  log(`Source filter: ${opts.source}`);
  log(`District filter: ${opts.district}`);
  log('');

  // Filter districts
  let districts;
  if (opts.district === 'all') {
    districts = PILOT_DISTRICTS;
  } else {
    districts = PILOT_DISTRICTS.filter(d => d.slug === opts.district);
    if (districts.length === 0) {
      logErr(`Unknown district: ${opts.district}`);
      log(`Valid districts: ${PILOT_DISTRICTS.map(d => d.slug).join(', ')}`);
      process.exit(1);
    }
  }

  log(`Pilot districts (${districts.length}): ${districts.map(d => d.name).join(', ')}`);
  log('');

  ensureDir(RAW_EXT);

  let cofopriResults = null;
  let geoidepResults = null;
  let geoGpsResults = null;

  if (opts.source === 'all' || opts.source === 'cofopri') {
    cofopriResults = await acquireCofopri(districts, opts);
  }

  if (opts.source === 'all' || opts.source === 'geoidep') {
    geoidepResults = await acquireGeoidep(districts, opts);
  }

  if (opts.source === 'all' || opts.source === 'geo_gps') {
    geoGpsResults = await acquireGeoGpsPeru(districts, opts);
  }

  // Generate summary
  if (!opts.dryRun) {
    const { summary, summaryPath } = generateSummary(cofopriResults, geoidepResults, geoGpsResults, startTime);

    log('\n======================================================');
    log('  ACQUISITION SUMMARY');
    log('======================================================');
    log(`  Duration: ${summary.duration_seconds}s`);
    log(`  Sources attempted: ${summary.total_sources_attempted}`);
    log(`  Sources succeeded: ${summary.total_sources_succeeded}`);
    log(`  Total features acquired: ${summary.total_features_acquired}`);

    if (Object.keys(summary.features_by_source_district).length > 0) {
      log('  Features by source/district:');
      for (const [key, count] of Object.entries(summary.features_by_source_district)) {
        log(`    ${key}: ${count}`);
      }
    }

    if (summary.manual_downloads_needed.length > 0) {
      log(`  Manual downloads needed: ${summary.manual_downloads_needed.length}`);
      for (const m of summary.manual_downloads_needed) {
        log(`    - ${m.source}/${m.district}: ${m.reason}`);
      }
    }

    if (summary.errors.length > 0) {
      log(`  Errors: ${summary.errors.length}`);
      for (const e of summary.errors) {
        log(`    - ${e.source}: ${e.error}`);
      }
    }

    log(`\n  Summary written to: ${summaryPath}`);
  } else {
    log('\n======================================================');
    log('  DRY-RUN COMPLETE - no data was fetched');
    log('======================================================');
  }

  log('\nNext steps:');
  log('  1. If manual downloads needed, follow the instructions above');
  log('  2. Run: node tools/etl/pilot_analysis.js');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
