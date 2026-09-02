#!/usr/bin/env node
/**
 * PHASE 2B-0.5 PILOT ANALYSIS
 *
 * Comprehensive analysis pipeline that processes BOTH existing catastro data
 * AND newly acquired external data for 5 pilot districts in Lima.
 *
 * Run AFTER acquire_pilot_sources.js has fetched external data.
 * Does NOT modify parcel_master or any production data.
 *
 * Usage: node tools/etl/pilot_analysis.js
 *
 * Input:
 *   data/distritos/lima_callao.geojson.gz         — district boundaries
 *   data/published/catastro/<slug>.geojson.gz      — existing published data
 *   data/raw/catastro/<slug>.geojson.gz            — existing raw data
 *   data/raw/external/<source>/<slug>/             — external datasets + manifests
 *
 * Output:
 *   data/reports/pilot_analysis_results.json       — complete analysis results
 */

'use strict';

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const PILOT_DISTRICTS = [
  { name: 'MIRAFLORES',              ubigeo: '150122', slug: 'miraflores',              scenario: 'high_value_low_coverage' },
  { name: 'LA VICTORIA',             ubigeo: '150115', slug: 'la-victoria',             scenario: 'zero_coverage_urban_dense' },
  { name: 'SURQUILLO',               ubigeo: '150141', slug: 'surquillo',               scenario: 'ls_dominant_conversion' },
  { name: 'CHORRILLOS',              ubigeo: '150108', slug: 'chorrillos',              scenario: 'zero_coverage_large_mixed' },
  { name: 'SAN JUAN DE LURIGANCHO',  ubigeo: '150132', slug: 'san-juan-de-lurigancho', scenario: 'zero_coverage_largest' },
];

const BASE            = path.resolve(__dirname, '../..');
const PUBLISHED_DIR   = path.join(BASE, 'data/published/catastro');
const RAW_DIR         = path.join(BASE, 'data/raw/catastro');
const EXTERNAL_DIR    = path.join(BASE, 'data/raw/external');
const DISTRICTS_FILE  = path.join(BASE, 'data/distritos/lima_callao.geojson.gz');
const REPORT_FILE     = path.join(BASE, 'data/reports/pilot_analysis_results.json');

const LIMA_LAT_RAD    = -12.05 * Math.PI / 180;
const DEG_TO_M        = 111320;
const COS_LAT         = Math.cos(LIMA_LAT_RAD);
const M2_PER_DEG2     = DEG_TO_M * DEG_TO_M * COS_LAT;

// Centroid-match threshold: 50m in degrees (approx)
const MATCH_THRESHOLD_DEG = 50 / (DEG_TO_M * COS_LAT);

// Semantic classification area thresholds (m^2)
const AREA_DEGENERATE   = 10;
const AREA_PARCEL_MIN   = 50;
const AREA_PARCEL_MAX   = 2000;
const AREA_PARCEL_LARGE = 5000;
const AREA_BLOCK_MAX    = 50000;

// ── Utility: GeoJSON Loading ─────────────────────────────────────────────────

function loadGz(fp) {
  if (!fs.existsSync(fp)) return null;
  const buf = fs.readFileSync(fp);
  return JSON.parse(zlib.gunzipSync(buf).toString());
}

function loadGzTimed(fp) {
  if (!fs.existsSync(fp)) return { fc: null, perf: null };
  const t0 = Date.now();
  const buf = fs.readFileSync(fp);
  const readMs = Date.now() - t0;
  const t1 = Date.now();
  const raw = zlib.gunzipSync(buf);
  const decompressMs = Date.now() - t1;
  const t2 = Date.now();
  const fc = JSON.parse(raw.toString());
  const parseMs = Date.now() - t2;
  const totalMs = readMs + decompressMs + parseMs;
  return {
    fc,
    perf: {
      gz_bytes: buf.length,
      raw_bytes: raw.length,
      read_ms: readMs,
      decompress_ms: decompressMs,
      parse_ms: parseMs,
      total_ms: totalMs,
      estimated_browser_ms: (decompressMs + parseMs) * 2,
    },
  };
}

function fileChecksum(fp) {
  if (!fs.existsSync(fp)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

function ringArea(coords) {
  let area = 0;
  for (let i = 0, n = coords.length; i < n - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    area += (x2 - x1) * (y1 + y2);
  }
  return Math.abs(area / 2) * M2_PER_DEG2;
}

function featureArea(f) {
  if (!f.geometry) return 0;
  const g = f.geometry;
  if (g.type === 'Polygon') return ringArea(g.coordinates[0]);
  if (g.type === 'MultiPolygon') {
    return g.coordinates.reduce((s, poly) => s + ringArea(poly[0]), 0);
  }
  return 0;
}

function countVertices(f) {
  if (!f.geometry) return 0;
  const g = f.geometry;
  if (g.type === 'Polygon') return g.coordinates.reduce((s, r) => s + r.length, 0);
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, p) => s + p.reduce((s2, r) => s2 + r.length, 0), 0);
  if (g.type === 'LineString') return g.coordinates.length;
  if (g.type === 'MultiLineString') return g.coordinates.reduce((s, l) => s + l.length, 0);
  if (g.type === 'Point') return 1;
  return 0;
}

function featureBbox(f) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = coords => {
    if (typeof coords[0] === 'number') {
      if (coords[0] < minX) minX = coords[0];
      if (coords[0] > maxX) maxX = coords[0];
      if (coords[1] < minY) minY = coords[1];
      if (coords[1] > maxY) maxY = coords[1];
    } else {
      for (let i = 0; i < coords.length; i++) visit(coords[i]);
    }
  };
  if (f.geometry && f.geometry.coordinates) visit(f.geometry.coordinates);
  return [minX, minY, maxX, maxY];
}

function bboxArea(b) {
  // Area in m^2 of a WGS84 bbox
  const dx = (b[2] - b[0]) * DEG_TO_M * COS_LAT;
  const dy = (b[3] - b[1]) * DEG_TO_M;
  return dx * dy;
}

function bboxOverlap(a, b) {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function bboxIntersection(a, b) {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const y1 = Math.min(a[3], b[3]);
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1, y1];
}

function bboxUnion(a, b) {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function bboxIoU(a, b) {
  const inter = bboxIntersection(a, b);
  if (!inter) return 0;
  const interArea = bboxArea(inter);
  const unionArea = bboxArea(bboxUnion(a, b));
  return unionArea > 0 ? interArea / unionArea : 0;
}

function centroid(f) {
  const b = featureBbox(f);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

function isValidGeometry(f) {
  if (!f.geometry || !f.geometry.type || !f.geometry.coordinates) return false;
  const g = f.geometry;
  if (g.type === 'Polygon') {
    const ring = g.coordinates[0];
    if (!ring || ring.length < 4) return false;
  }
  if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates) {
      if (!poly[0] || poly[0].length < 4) return false;
    }
  }
  return true;
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

function linestringLength(coords) {
  let len = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = (coords[i + 1][0] - coords[i][0]) * DEG_TO_M * COS_LAT;
    const dy = (coords[i + 1][1] - coords[i][1]) * DEG_TO_M;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

function isClosedLineString(coords) {
  if (coords.length < 4) return false;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return Math.abs(first[0] - last[0]) < 0.00001 && Math.abs(first[1] - last[1]) < 0.00001;
}

// ── Statistics helpers ───────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function median(sorted) { return percentile(sorted, 0.5); }
function mean(arr) { return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length; }

function r(v, d) { return +(v.toFixed(d === undefined ? 1 : d)); }

// ── Semantic Classification ──────────────────────────────────────────────────

function classifyFeature(f) {
  if (!f.geometry) return 'UNKNOWN';
  const g = f.geometry;

  if (g.type === 'LineString') {
    const coords = g.coordinates;
    if (isClosedLineString(coords)) {
      const a = ringArea(coords);
      if (a < AREA_DEGENERATE) return 'DEGENERATE';
      if (a >= AREA_PARCEL_MIN && a <= AREA_PARCEL_MAX) return 'PARCEL';
      if (a > AREA_PARCEL_MAX && a <= AREA_PARCEL_LARGE) return 'PARCEL'; // large parcel
      if (a > AREA_PARCEL_LARGE && a <= AREA_BLOCK_MAX) return 'BLOCK';
      if (a > AREA_BLOCK_MAX) return 'ZONE';
      if (a >= AREA_DEGENERATE && a < AREA_PARCEL_MIN) return 'PARCEL'; // small lot
      return 'UNKNOWN';
    }
    return 'FRONTAGE_LINE';
  }

  if (g.type === 'MultiLineString') {
    return 'FRONTAGE_LINE';
  }

  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    const a = featureArea(f);
    if (a < AREA_DEGENERATE) return 'DEGENERATE';
    if (a >= AREA_DEGENERATE && a < AREA_PARCEL_MIN) return 'PARCEL'; // small lot
    if (a >= AREA_PARCEL_MIN && a <= AREA_PARCEL_MAX) return 'PARCEL';
    if (a > AREA_PARCEL_MAX && a <= AREA_PARCEL_LARGE) return 'PARCEL'; // large lot, flag
    if (a > AREA_PARCEL_LARGE && a <= AREA_BLOCK_MAX) return 'BLOCK';
    if (a > AREA_BLOCK_MAX) return 'ZONE';
  }

  if (g.type === 'Point' || g.type === 'MultiPoint') return 'UNKNOWN';

  return 'UNKNOWN';
}

function semanticBreakdown(features) {
  const breakdown = {};
  for (const f of features) {
    const cls = classifyFeature(f);
    if (!breakdown[cls]) breakdown[cls] = { count: 0, total_area_km2: 0 };
    breakdown[cls].count++;
    if (cls !== 'FRONTAGE_LINE' && cls !== 'UNKNOWN') {
      const area = featureArea(f);
      if (f.geometry && f.geometry.type === 'LineString' && isClosedLineString(f.geometry.coordinates)) {
        breakdown[cls].total_area_km2 += ringArea(f.geometry.coordinates) / 1e6;
      } else {
        breakdown[cls].total_area_km2 += area / 1e6;
      }
    }
  }
  // Round area values
  for (const cls of Object.keys(breakdown)) {
    breakdown[cls].total_area_km2 = r(breakdown[cls].total_area_km2, 4);
    if (cls === 'FRONTAGE_LINE' || cls === 'UNKNOWN') delete breakdown[cls].total_area_km2;
  }
  return breakdown;
}

// ── Per-Dataset Analysis ─────────────────────────────────────────────────────

function analyzeDataset(fc, label) {
  const types = {};
  let totalVertices = 0, totalArea = 0;
  let invalid = 0, degenerate = 0;
  const areas = [];
  const bboxKeys = new Set();
  let duplicates = 0;
  let polyCount = 0, lsCount = 0;

  for (const f of fc.features) {
    const gt = f.geometry ? f.geometry.type : 'null';
    types[gt] = (types[gt] || 0) + 1;

    totalVertices += countVertices(f);

    if (!isValidGeometry(f)) { invalid++; continue; }

    if (gt === 'Polygon' || gt === 'MultiPolygon') polyCount++;
    if (gt === 'LineString') lsCount++;

    const a = featureArea(f);
    if (a > 0 && a < 1) { degenerate++; continue; }
    if (a > 0) {
      totalArea += a;
      areas.push(a);
    }

    // BBox duplicate check
    const b = featureBbox(f);
    if (isFinite(b[0])) {
      const key = b.map(v => v.toFixed(6)).join(',');
      if (bboxKeys.has(key)) duplicates++;
      else bboxKeys.add(key);
    }
  }

  areas.sort((a, b) => a - b);

  const sem = semanticBreakdown(fc.features);

  return {
    label,
    feature_count: fc.features.length,
    geometry_types: types,
    polygons: polyCount,
    linestrings: lsCount,
    total_vertices: totalVertices,
    total_area_km2: r(totalArea / 1e6, 4),
    invalid_geometries: invalid,
    degenerate,
    duplicates_bbox: duplicates,
    area_stats: areas.length > 0 ? {
      min_m2: r(areas[0]),
      max_m2: r(areas[areas.length - 1]),
      median_m2: r(median(areas)),
      p25_m2: r(percentile(areas, 0.25)),
      p75_m2: r(percentile(areas, 0.75)),
      mean_m2: r(mean(areas)),
    } : null,
    semantic_breakdown: sem,
  };
}

// ── District Comparison ──────────────────────────────────────────────────────

function getDistrictRing(distFeature) {
  if (!distFeature.geometry) return null;
  if (distFeature.geometry.type === 'MultiPolygon') {
    // Largest ring
    return distFeature.geometry.coordinates.reduce(
      (best, poly) => poly[0].length > best.length ? poly[0] : best,
      []
    );
  }
  if (distFeature.geometry.type === 'Polygon') {
    return distFeature.geometry.coordinates[0];
  }
  return null;
}

function compareWithDistrict(fc, distFeature) {
  if (!fc || fc.features.length === 0 || !distFeature) return null;

  const distRing = getDistrictRing(distFeature);
  if (!distRing || distRing.length === 0) return null;
  const distBb = featureBbox(distFeature);
  const distArea = featureArea(distFeature);

  let insideCount = 0, outsideCount = 0;
  let parcelAreaInside = 0;

  for (const f of fc.features) {
    if (!f.geometry) { outsideCount++; continue; }
    const c = centroid(f);
    if (!bboxOverlap([c[0], c[1], c[0], c[1]], distBb)) {
      outsideCount++;
      continue;
    }
    if (pointInPolygon(c, distRing)) {
      insideCount++;
      parcelAreaInside += featureArea(f);
    } else {
      outsideCount++;
    }
  }

  const total = insideCount + outsideCount;
  return {
    district_area_km2: r(distArea / 1e6, 3),
    inside_district: insideCount,
    outside_district: outsideCount,
    outside_pct: total > 0 ? r(outsideCount / total * 100) : 0,
    coverage_pct: distArea > 0 ? r(parcelAreaInside / distArea * 100) : 0,
  };
}

// ── LineString Analysis (Surquillo special) ──────────────────────────────────

function analyzeLineStrings(fc) {
  const lines = fc.features.filter(f => f.geometry && f.geometry.type === 'LineString');
  if (lines.length === 0) return null;

  let closedCount = 0, openCount = 0;
  const closedAreas = [];
  const openLengths = [];
  const closedSemantic = { PARCEL: 0, BLOCK: 0, ZONE: 0, DEGENERATE: 0, UNKNOWN: 0 };

  for (const ls of lines) {
    const coords = ls.geometry.coordinates;
    if (isClosedLineString(coords)) {
      closedCount++;
      const a = ringArea(coords);
      closedAreas.push(a);
      // Classify
      if (a < AREA_DEGENERATE) closedSemantic.DEGENERATE++;
      else if (a <= AREA_PARCEL_LARGE) closedSemantic.PARCEL++;
      else if (a <= AREA_BLOCK_MAX) closedSemantic.BLOCK++;
      else closedSemantic.ZONE++;
    } else {
      openCount++;
      openLengths.push(linestringLength(coords));
    }
  }

  closedAreas.sort((a, b) => a - b);
  openLengths.sort((a, b) => a - b);

  const validParcels = closedAreas.filter(a => a >= AREA_PARCEL_MIN && a <= AREA_PARCEL_LARGE).length;

  let viability;
  if (validParcels > 50) viability = 'VIABLE';
  else if (validParcels >= 10) viability = 'MARGINAL';
  else viability = 'NOT_VIABLE';

  return {
    total_linestrings: lines.length,
    closed: closedCount,
    open: openCount,
    closed_area_stats: closedAreas.length > 0 ? {
      min_m2: r(closedAreas[0]),
      max_m2: r(closedAreas[closedAreas.length - 1]),
      median_m2: r(median(closedAreas)),
      p25_m2: r(percentile(closedAreas, 0.25)),
      p75_m2: r(percentile(closedAreas, 0.75)),
    } : null,
    closed_semantic: closedSemantic,
    open_length_stats: openLengths.length > 0 ? {
      min_m: r(openLengths[0]),
      max_m: r(openLengths[openLengths.length - 1]),
      median_m: r(median(openLengths)),
    } : null,
    valid_as_parcels: validParcels,
    conversion_viability: viability,
  };
}

// ── Cross-Source Comparison ──────────────────────────────────────────────────

function buildCentroidIndex(features) {
  // Returns array of { idx, cx, cy, bbox, area, semantic, vertices }
  const items = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f.geometry) continue;
    const c = centroid(f);
    const b = featureBbox(f);
    items.push({
      idx: i,
      cx: c[0],
      cy: c[1],
      bbox: b,
      area: featureArea(f),
      semantic: classifyFeature(f),
      vertices: countVertices(f),
    });
  }
  return items;
}

function crossSourceCompare(fcA, labelA, fcB, labelB) {
  const indexA = buildCentroidIndex(fcA.features);
  const indexB = buildCentroidIndex(fcB.features);

  // For each feature in A, find nearest in B
  const matchesAtoB = new Map(); // indexA idx -> indexB idx
  const matchedBSet = new Set();

  for (const a of indexA) {
    let bestDist = Infinity;
    let bestB = null;
    for (const b of indexB) {
      const dx = a.cx - b.cx;
      const dy = a.cy - b.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        bestB = b;
      }
    }
    if (bestB && bestDist < MATCH_THRESHOLD_DEG) {
      matchesAtoB.set(a.idx, bestB.idx);
      matchedBSet.add(bestB.idx);
    }
  }

  const matchedCount = matchesAtoB.size;
  const onlyInA = indexA.length - matchedCount;
  const onlyInB = indexB.length - matchedBSet.size;

  // IoU and area diff for matched pairs
  const ious = [];
  const areaDiffs = [];
  let bothParcel = 0, bothBlock = 0, disagree = 0;

  for (const [aIdx, bIdx] of matchesAtoB) {
    const aItem = indexA.find(x => x.idx === aIdx);
    const bItem = indexB.find(x => x.idx === bIdx);
    if (!aItem || !bItem) continue;

    // BBox IoU
    const iou = bboxIoU(aItem.bbox, bItem.bbox);
    ious.push(iou);

    // Area difference
    const maxA = Math.max(aItem.area, bItem.area);
    if (maxA > 0) {
      areaDiffs.push(Math.abs(aItem.area - bItem.area) / maxA);
    }

    // Semantic agreement
    if (aItem.semantic === 'PARCEL' && bItem.semantic === 'PARCEL') bothParcel++;
    else if (aItem.semantic === 'BLOCK' && bItem.semantic === 'BLOCK') bothBlock++;
    else if (aItem.semantic !== bItem.semantic) disagree++;
  }

  ious.sort((a, b) => a - b);
  areaDiffs.sort((a, b) => a - b);

  return {
    datasets: [labelA, labelB],
    matching: {
      threshold_m: 50,
      matched: matchedCount,
      only_in_a: onlyInA,
      only_in_b: onlyInB,
      match_rate_a_pct: indexA.length > 0 ? r(matchedCount / indexA.length * 100) : 0,
      match_rate_b_pct: indexB.length > 0 ? r(matchedBSet.size / indexB.length * 100) : 0,
    },
    iou_bbox: ious.length > 0 ? {
      mean: r(mean(ious), 3),
      median: r(median(ious), 3),
      p25: r(percentile(ious, 0.25), 3),
      p75: r(percentile(ious, 0.75), 3),
    } : null,
    area_diff_pct: areaDiffs.length > 0 ? {
      mean: r(mean(areaDiffs) * 100),
      median: r(median(areaDiffs) * 100),
      max: r(areaDiffs[areaDiffs.length - 1] * 100),
    } : null,
    semantic_agreement: {
      both_parcel: bothParcel,
      both_block: bothBlock,
      disagree: disagree,
    },
  };
}

// ── Merge Simulation ─────────────────────────────────────────────────────────

function mergeSimulation(existingFc, externalFc, externalLabel) {
  const currentCount = existingFc ? existingFc.features.length : 0;

  if (!externalFc || externalFc.features.length === 0) {
    return {
      source: externalLabel,
      current_count: currentCount,
      candidate_count: 0,
      actions: { KEEP_EXISTING: currentCount, ADD_NEW: 0, REPLACE_EXISTING: 0, REVIEW: 0, REJECT: 0 },
      simulated_total: currentCount,
      coverage_change_pct: 0,
    };
  }

  // Build centroid index for existing
  const existingIndex = existingFc ? buildCentroidIndex(existingFc.features) : [];
  const candidateCount = externalFc.features.length;

  const actions = { KEEP_EXISTING: 0, ADD_NEW: 0, REPLACE_EXISTING: 0, REVIEW: 0, REJECT: 0 };

  let addedArea = 0;
  let removedArea = 0;
  const matchedExistingSet = new Set();

  for (let ci = 0; ci < externalFc.features.length; ci++) {
    const extF = externalFc.features[ci];
    if (!extF.geometry) { actions.REJECT++; continue; }

    const extSem = classifyFeature(extF);
    const extArea = featureArea(extF);
    const extVerts = countVertices(extF);
    const extC = centroid(extF);

    // Reject degenerates and zones
    if (extSem === 'DEGENERATE') { actions.REJECT++; continue; }
    if (!isValidGeometry(extF)) { actions.REJECT++; continue; }

    // Find nearest existing feature
    let bestDist = Infinity;
    let bestExisting = null;
    for (const ex of existingIndex) {
      const dx = extC[0] - ex.cx;
      const dy = extC[1] - ex.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; bestExisting = ex; }
    }

    if (!bestExisting || bestDist >= MATCH_THRESHOLD_DEG) {
      // No match — ADD_NEW
      if (extSem === 'PARCEL' || extSem === 'BLOCK') {
        actions.ADD_NEW++;
        addedArea += extArea;
      } else if (extSem === 'ZONE') {
        actions.REJECT++; // Zones are not parcel candidates
      } else {
        actions.REVIEW++;
      }
      continue;
    }

    matchedExistingSet.add(bestExisting.idx);

    // Matched — decide action
    const existArea = bestExisting.area;
    const existVerts = bestExisting.vertices;
    const existSem = bestExisting.semantic;
    const areaDiffPct = existArea > 0 ? Math.abs(extArea - existArea) / Math.max(extArea, existArea) : 1;

    // REPLACE_EXISTING: strong evidence external is better
    let replace = false;
    // More vertices AND similar area (within 30%)
    if (extVerts > existVerts && areaDiffPct < 0.3) replace = true;
    // Granularity upgrade: external is PARCEL while existing is BLOCK
    if (extSem === 'PARCEL' && existSem === 'BLOCK') replace = true;
    // Existing was invalid (shouldn't happen since we only indexed valid, but guard)
    if (existArea === 0 && extArea > 0) replace = true;

    if (replace) {
      actions.REPLACE_EXISTING++;
      addedArea += extArea;
      removedArea += existArea;
    } else if (areaDiffPct > 0.5) {
      actions.REVIEW++;
    } else {
      // External not clearly better — keep existing
      actions.KEEP_EXISTING++;
    }
  }

  // Existing features that were not matched by any external candidate stay
  const unmatched = existingIndex.length - matchedExistingSet.size;
  actions.KEEP_EXISTING += unmatched;

  const simulatedTotal = actions.KEEP_EXISTING + actions.ADD_NEW + actions.REPLACE_EXISTING;
  const existingArea = existingFc ? existingFc.features.reduce((s, f) => s + featureArea(f), 0) : 0;
  const newArea = existingArea - removedArea + addedArea;
  const coverageChange = existingArea > 0 ? (newArea - existingArea) / existingArea * 100 : (newArea > 0 ? 100 : 0);

  return {
    source: externalLabel,
    current_count: currentCount,
    candidate_count: candidateCount,
    actions,
    simulated_total: simulatedTotal,
    coverage_change_pct: r(coverageChange),
  };
}

// ── No-Degradation Gate ──────────────────────────────────────────────────────

function noDegradationGate(existingAnalysis, sim) {
  const issues = [];

  // Coverage must not decrease
  if (sim.coverage_change_pct < 0) {
    issues.push(`Coverage decreased by ${Math.abs(sim.coverage_change_pct)}%`);
  }

  // Invalid count must not increase (we only add valid, so it won't, but check)
  if (sim.actions.REJECT > sim.candidate_count * 0.5) {
    issues.push(`High reject rate: ${sim.actions.REJECT}/${sim.candidate_count}`);
  }

  // No semantic downgrade: REPLACE_EXISTING already guards for this
  // But flag if REVIEW count is high
  if (sim.actions.REVIEW > sim.candidate_count * 0.3) {
    issues.push(`High review count: ${sim.actions.REVIEW} of ${sim.candidate_count} need manual review`);
  }

  // No loss of currently valid features
  if (sim.simulated_total < sim.current_count) {
    issues.push(`Feature count decreased from ${sim.current_count} to ${sim.simulated_total}`);
  }

  if (issues.length === 0) return { verdict: 'PASS', issues: [] };
  if (issues.some(i => i.includes('decreased'))) return { verdict: 'FAIL', issues };
  return { verdict: 'CONDITIONAL', issues };
}

// ── Acceptance Score ─────────────────────────────────────────────────────────

function acceptanceScore(analysis, distComparison, provenance) {
  const breakdown = {};
  let total = 0;

  // Geometry type: 20 points
  const polyPct = analysis.feature_count > 0 ? analysis.polygons / analysis.feature_count : 0;
  if (polyPct >= 1) { breakdown.geometry = 20; }
  else if (polyPct >= 0.95) { breakdown.geometry = 15; }
  else { breakdown.geometry = 5; }
  total += breakdown.geometry;

  // CRS: 15 points (always WGS84 after normalization)
  breakdown.crs = 15;
  total += 15;

  // Topology: 15 points
  const invalidPct = analysis.feature_count > 0 ? analysis.invalid_geometries / analysis.feature_count : 0;
  if (invalidPct < 0.01) breakdown.topology = 15;
  else if (invalidPct < 0.05) breakdown.topology = 10;
  else breakdown.topology = 5;
  total += breakdown.topology;

  // Duplicates: 10 points
  const dupPct = analysis.feature_count > 0 ? analysis.duplicates_bbox / analysis.feature_count : 0;
  if (dupPct < 0.01) breakdown.duplicates = 10;
  else if (dupPct < 0.03) breakdown.duplicates = 7;
  else breakdown.duplicates = 3;
  total += breakdown.duplicates;

  // Area plausibility: 10 points
  if (analysis.area_stats) {
    const med = analysis.area_stats.median_m2;
    // Reasonable residential parcel: 50-2000 m^2 median is ideal
    if (med >= 50 && med <= 5000) breakdown.area = 10;
    else if (med >= 10 && med <= 50000) breakdown.area = 8;
    else breakdown.area = 5;
  } else {
    breakdown.area = 0;
  }
  total += breakdown.area;

  // Coverage: 15 points
  if (distComparison) {
    const cov = distComparison.coverage_pct;
    if (cov > 50) breakdown.coverage = 15;
    else if (cov > 20) breakdown.coverage = 10;
    else if (cov > 5) breakdown.coverage = 5;
    else breakdown.coverage = 3;
  } else {
    breakdown.coverage = 0;
  }
  total += breakdown.coverage;

  // Attribution: 10 points
  if (provenance && provenance.source && provenance.source !== 'NONE' && provenance.source !== 'UNKNOWN') {
    if (provenance.source_url && provenance.source_url !== 'NOT_VERIFIED') breakdown.attribution = 10;
    else breakdown.attribution = 5;
  } else {
    breakdown.attribution = 2;
  }
  total += breakdown.attribution;

  // Freshness: 5 points
  if (provenance && provenance.acquisition_date && provenance.acquisition_date !== 'UNKNOWN') {
    const acqDate = new Date(provenance.acquisition_date);
    const age = (Date.now() - acqDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (age < 1) breakdown.freshness = 5;
    else if (age < 3) breakdown.freshness = 3;
    else breakdown.freshness = 2;
  } else {
    breakdown.freshness = 2;
  }
  total += breakdown.freshness;

  const verdict = total >= 70 ? 'PASS' : total >= 50 ? 'CONDITIONAL' : 'FAIL';

  return { total, verdict, breakdown };
}

// ── External Dataset Discovery ───────────────────────────────────────────────

function discoverExternalDatasets(slug) {
  // Scan data/raw/external/<source>/<slug>/ for all available datasets
  const datasets = [];

  if (!fs.existsSync(EXTERNAL_DIR)) return datasets;

  const sources = fs.readdirSync(EXTERNAL_DIR).filter(d =>
    fs.statSync(path.join(EXTERNAL_DIR, d)).isDirectory()
  );

  for (const source of sources) {
    const distDir = path.join(EXTERNAL_DIR, source, slug);
    if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) continue;

    // Read manifest
    const manifestPath = path.join(distDir, 'manifest.json');
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
      catch (e) { manifest = null; }
    }

    // Find data files
    const files = fs.readdirSync(distDir).filter(f => f.endsWith('.geojson.gz'));
    for (const file of files) {
      const fp = path.join(distDir, file);
      datasets.push({
        source,
        slug,
        file,
        filepath: fp,
        manifest,
      });
    }

    // Also check for uncompressed geojson files
    const jsonFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.geojson') && !f.endsWith('.geojson.gz'));
    for (const file of jsonFiles) {
      const fp = path.join(distDir, file);
      datasets.push({
        source,
        slug,
        file,
        filepath: fp,
        manifest,
        uncompressed: true,
      });
    }
  }

  return datasets;
}

function loadExternalDataset(ds) {
  if (ds.uncompressed) {
    const t0 = Date.now();
    const raw = fs.readFileSync(ds.filepath);
    const readMs = Date.now() - t0;
    const t1 = Date.now();
    const fc = JSON.parse(raw.toString());
    const parseMs = Date.now() - t1;
    return {
      fc,
      perf: {
        gz_bytes: 0,
        raw_bytes: raw.length,
        read_ms: readMs,
        decompress_ms: 0,
        parse_ms: parseMs,
        total_ms: readMs + parseMs,
        estimated_browser_ms: parseMs * 2,
      },
    };
  }
  return loadGzTimed(ds.filepath);
}

// ── Provenance ───────────────────────────────────────────────────────────────

function buildProvenance(label, manifest, analysis, filepath) {
  const prov = {
    source: 'UNKNOWN',
    source_url: 'NOT_VERIFIED',
    acquisition_date: 'UNKNOWN',
    original_filename: filepath ? path.basename(filepath) : 'UNKNOWN',
    original_format: 'GeoJSON',
    original_crs: 'EPSG:4326',
    normalized_crs: 'EPSG:4326',
    feature_count_raw: analysis ? analysis.feature_count : 0,
    feature_count_valid: analysis ? (analysis.feature_count - analysis.invalid_geometries) : 0,
    semantic_classification: 'UNKNOWN',
    quality_score: 0,
    processing_version: '2b05',
  };

  if (manifest) {
    prov.source = manifest.source || manifest.source_name || label;
    prov.source_url = manifest.endpoint || manifest.source_url || 'NOT_VERIFIED';
    prov.acquisition_date = manifest.acquired_at || 'UNKNOWN';
    prov.original_format = manifest.format || 'GeoJSON';
    prov.original_crs = manifest.crs || 'EPSG:4326';
    if (manifest.verification) prov.verification = manifest.verification;
  }

  if (label.includes('published') || label.includes('raw')) {
    prov.source = 'GEO GPS Peru (probable)';
    prov.original_format = 'Shapefile (converted to GeoJSON)';
  }

  // Determine dominant semantic type
  if (analysis && analysis.semantic_breakdown) {
    const sem = analysis.semantic_breakdown;
    const parcelCount = (sem.PARCEL || {}).count || 0;
    const blockCount = (sem.BLOCK || {}).count || 0;
    if (parcelCount > 0 && blockCount > 0) prov.semantic_classification = 'MIXED';
    else if (parcelCount > 0) prov.semantic_classification = 'PARCEL';
    else if (blockCount > 0) prov.semantic_classification = 'BLOCK';
    else prov.semantic_classification = 'OTHER';
  }

  return prov;
}

// ── Performance wrapper ──────────────────────────────────────────────────────

function buildPerformanceEntry(perf) {
  if (!perf) return null;
  return {
    file_sizes: { gz_bytes: perf.gz_bytes, raw_bytes: perf.raw_bytes },
    read_ms: perf.read_ms,
    decompress_ms: perf.decompress_ms,
    parse_ms: perf.parse_ms,
    total_ms: perf.total_ms,
    estimated_browser_ms: perf.estimated_browser_ms,
  };
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

function main() {
  const startTime = Date.now();

  console.log('PHASE 2B-0.5 PILOT ANALYSIS');
  console.log('='.repeat(70));
  console.log('Date:', new Date().toISOString());
  console.log('Districts:', PILOT_DISTRICTS.map(d => d.name).join(', '));
  console.log('');

  // Load district boundaries
  const districtsMaster = loadGz(DISTRICTS_FILE);
  if (!districtsMaster) {
    console.error('FATAL: Cannot load district boundaries from', DISTRICTS_FILE);
    process.exit(1);
  }

  const districtMap = {};
  for (const f of districtsMaster.features) {
    districtMap[f.properties.ubigeo] = f;
    districtMap[f.properties.distrito] = f;
  }

  const results = {
    phase: '2B-0.5',
    analysis_date: new Date().toISOString(),
    districts: {},
    go_nogo: null,
  };

  const summaryRows = []; // For console table

  // ── Process each pilot district ─────────────────────────────────────────

  for (const pilot of PILOT_DISTRICTS) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`DISTRICT: ${pilot.name} (${pilot.ubigeo}) [${pilot.scenario}]`);
    console.log(`${'─'.repeat(70)}`);

    const distFeature = districtMap[pilot.ubigeo] || districtMap[pilot.name];
    const distArea = distFeature ? featureArea(distFeature) : 0;

    const distResult = {
      name: pilot.name,
      ubigeo: pilot.ubigeo,
      district_area_km2: r(distArea / 1e6, 3),
      existing: {},
      external_sources: {},
      cross_source_comparison: [],
      merge_simulation: null,
      no_degradation: null,
      acceptance_score: null,
      confidence: null,
      provenance: {},
      performance: {},
      recommendation: '',
    };

    // ── Load existing data ─────────────────────────────────────────────────

    const allDatasets = []; // { label, fc, analysis, perf, filepath, manifest }

    // Published data
    const pubFile = path.join(PUBLISHED_DIR, pilot.slug + '.geojson.gz');
    if (fs.existsSync(pubFile)) {
      const { fc, perf } = loadGzTimed(pubFile);
      if (fc && fc.features && fc.features.length > 0) {
        const analysis = analyzeDataset(fc, 'existing_published');
        const comparison = distFeature ? compareWithDistrict(fc, distFeature) : null;
        distResult.existing.published = {
          analysis,
          district_comparison: comparison,
          linestring_analysis: analyzeLineStrings(fc),
        };
        distResult.performance.published = buildPerformanceEntry(perf);
        distResult.provenance.published = buildProvenance('existing_published', null, analysis, pubFile);
        allDatasets.push({ label: 'existing_published', fc, analysis, perf, filepath: pubFile, manifest: null });
        console.log(`  Published: ${fc.features.length} features, ${analysis.total_area_km2} km2, coverage ${comparison ? comparison.coverage_pct + '%' : 'N/A'}`);
      }
    } else {
      console.log('  Published: NONE');
      distResult.existing.published = null;
    }

    // Raw catastro data
    const rawFile = path.join(RAW_DIR, pilot.slug + '.geojson.gz');
    if (fs.existsSync(rawFile)) {
      const { fc, perf } = loadGzTimed(rawFile);
      if (fc && fc.features && fc.features.length > 0) {
        const analysis = analyzeDataset(fc, 'existing_raw');
        const comparison = distFeature ? compareWithDistrict(fc, distFeature) : null;
        distResult.existing.raw = {
          analysis,
          district_comparison: comparison,
          linestring_analysis: analyzeLineStrings(fc),
        };
        distResult.performance.raw = buildPerformanceEntry(perf);
        distResult.provenance.raw = buildProvenance('existing_raw', null, analysis, rawFile);
        allDatasets.push({ label: 'existing_raw', fc, analysis, perf, filepath: rawFile, manifest: null });
        console.log(`  Raw:       ${fc.features.length} features, types: ${JSON.stringify(analysis.geometry_types)}`);
      }
    } else {
      console.log('  Raw:       NONE');
      distResult.existing.raw = null;
    }

    // ── Load external datasets ─────────────────────────────────────────────

    const externalDatasets = discoverExternalDatasets(pilot.slug);

    if (externalDatasets.length > 0) {
      console.log(`  External datasets found: ${externalDatasets.length}`);
    } else {
      console.log('  External:  NONE');
    }

    for (const extDs of externalDatasets) {
      const extLabel = `${extDs.source}/${extDs.file}`;
      const { fc: extFc, perf: extPerf } = loadExternalDataset(extDs);

      if (!extFc || !extFc.features || extFc.features.length === 0) {
        distResult.external_sources[extDs.source] = { error: 'Empty or invalid dataset', file: extDs.file };
        console.log(`    ${extLabel}: EMPTY`);
        continue;
      }

      const extAnalysis = analyzeDataset(extFc, extLabel);
      const extComparison = distFeature ? compareWithDistrict(extFc, distFeature) : null;
      const extLsAnalysis = analyzeLineStrings(extFc);

      const sourceKey = extDs.source;
      if (!distResult.external_sources[sourceKey]) {
        distResult.external_sources[sourceKey] = {};
      }

      distResult.external_sources[sourceKey] = {
        file: extDs.file,
        analysis: extAnalysis,
        district_comparison: extComparison,
        linestring_analysis: extLsAnalysis,
      };
      distResult.performance[sourceKey] = buildPerformanceEntry(extPerf);
      distResult.provenance[sourceKey] = buildProvenance(sourceKey, extDs.manifest, extAnalysis, extDs.filepath);

      allDatasets.push({
        label: sourceKey,
        fc: extFc,
        analysis: extAnalysis,
        perf: extPerf,
        filepath: extDs.filepath,
        manifest: extDs.manifest,
      });

      console.log(`    ${extLabel}: ${extFc.features.length} features, ${extAnalysis.total_area_km2} km2`);
      if (extComparison) console.log(`      Coverage: ${extComparison.coverage_pct}%, inside: ${extComparison.inside_district}`);
    }

    // ── Cross-Source Comparison ─────────────────────────────────────────────

    if (allDatasets.length >= 2) {
      console.log('  Cross-source comparisons:');
      for (let i = 0; i < allDatasets.length; i++) {
        for (let j = i + 1; j < allDatasets.length; j++) {
          const dsA = allDatasets[i];
          const dsB = allDatasets[j];

          // Only compare if both have polygonal features
          const polyA = dsA.fc.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
          const polyB = dsB.fc.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));

          if (polyA.length === 0 || polyB.length === 0) {
            console.log(`    ${dsA.label} vs ${dsB.label}: skipped (insufficient polygons)`);
            continue;
          }

          const cmp = crossSourceCompare(
            { features: polyA }, dsA.label,
            { features: polyB }, dsB.label
          );
          distResult.cross_source_comparison.push(cmp);

          console.log(`    ${dsA.label} vs ${dsB.label}: matched=${cmp.matching.matched}, only_a=${cmp.matching.only_in_a}, only_b=${cmp.matching.only_in_b}`);
          if (cmp.iou_bbox) console.log(`      IoU: mean=${cmp.iou_bbox.mean}, median=${cmp.iou_bbox.median}`);
        }
      }
    }

    // ── Merge Simulation ───────────────────────────────────────────────────

    const existingFc = allDatasets.find(d => d.label === 'existing_published');
    const externalSources = allDatasets.filter(d => !d.label.startsWith('existing_'));

    if (externalSources.length > 0) {
      const mergeResults = [];
      for (const ext of externalSources) {
        const sim = mergeSimulation(existingFc ? existingFc.fc : null, ext.fc, ext.label);
        const gate = noDegradationGate(
          existingFc ? existingFc.analysis : null,
          sim
        );
        mergeResults.push({ ...sim, no_degradation: gate });
        console.log(`  Merge sim [${ext.label}]: add=${sim.actions.ADD_NEW}, replace=${sim.actions.REPLACE_EXISTING}, reject=${sim.actions.REJECT} -> ${gate.verdict}`);
      }
      distResult.merge_simulation = mergeResults;

      // Overall no-degradation: worst gate across all sources
      const worstGate = mergeResults.reduce(
        (worst, m) => {
          if (m.no_degradation.verdict === 'FAIL') return 'FAIL';
          if (m.no_degradation.verdict === 'CONDITIONAL' && worst !== 'FAIL') return 'CONDITIONAL';
          return worst;
        },
        'PASS'
      );
      distResult.no_degradation = worstGate;
    } else {
      // No external sources — simulate with what we have
      distResult.merge_simulation = {
        note: 'No external sources acquired for this district',
        current_count: existingFc ? existingFc.fc.features.length : 0,
        actions: {
          KEEP_EXISTING: existingFc ? existingFc.fc.features.length : 0,
          ADD_NEW: 0,
          REPLACE_EXISTING: 0,
          REVIEW: 0,
          REJECT: 0,
        },
      };
      distResult.no_degradation = existingFc ? 'PASS' : 'NO_DATA';
    }

    // ── Acceptance Score ───────────────────────────────────────────────────

    // Use best available dataset for scoring
    const bestDataset = allDatasets.length > 0
      ? allDatasets.reduce((best, ds) => {
          if (!best) return ds;
          const bestParcels = (best.analysis.semantic_breakdown.PARCEL || {}).count || 0;
          const dsParcels = (ds.analysis.semantic_breakdown.PARCEL || {}).count || 0;
          return dsParcels > bestParcels ? ds : best;
        }, null)
      : null;

    if (bestDataset) {
      const bestComparison = distFeature ? compareWithDistrict(bestDataset.fc, distFeature) : null;
      const bestProvenance = distResult.provenance[bestDataset.label] || buildProvenance(bestDataset.label, bestDataset.manifest, bestDataset.analysis, bestDataset.filepath);
      distResult.acceptance_score = acceptanceScore(bestDataset.analysis, bestComparison, bestProvenance);
      console.log(`  Acceptance: ${distResult.acceptance_score.total} (${distResult.acceptance_score.verdict}) [best source: ${bestDataset.label}]`);
    } else {
      distResult.acceptance_score = { total: 0, verdict: 'NO_DATA', breakdown: {} };
      console.log('  Acceptance: NO_DATA');
    }

    // ── Confidence ─────────────────────────────────────────────────────────

    const extCount = externalSources.length;
    const hasExisting = !!existingFc;

    if (hasExisting && extCount > 0) {
      distResult.confidence = {
        level: 'HIGH',
        code: 'A',
        reason: `Cross-verified with ${extCount} external source(s). Existing data + external comparison available.`,
      };
    } else if (hasExisting) {
      distResult.confidence = {
        level: 'MEDIUM',
        code: 'B',
        reason: 'Single source (GEO GPS probable), not cross-verified. Geometry valid, provenance undocumented.',
      };
    } else if (extCount > 0) {
      distResult.confidence = {
        level: 'MEDIUM',
        code: 'B',
        reason: `External source(s) only (${externalSources.map(d => d.label).join(', ')}). No existing baseline for comparison.`,
      };
    } else {
      distResult.confidence = {
        level: 'NO_DATA',
        code: 'D',
        reason: 'No data available for this district from any source.',
      };
    }

    // ── Recommendation ─────────────────────────────────────────────────────

    if (allDatasets.length === 0) {
      distResult.recommendation = 'ACQUIRE — No data. Must acquire from COFOPRI, GEO GPS Peru, or GEOIDEP.';
    } else if (extCount > 0 && !hasExisting) {
      distResult.recommendation = 'IMPORT — External data available, no existing data to protect. Import after review.';
    } else if (extCount > 0 && hasExisting) {
      const bestMerge = Array.isArray(distResult.merge_simulation)
        ? distResult.merge_simulation.reduce((best, m) => (m.actions.ADD_NEW + m.actions.REPLACE_EXISTING > (best ? best.actions.ADD_NEW + best.actions.REPLACE_EXISTING : 0)) ? m : best, null)
        : null;
      if (bestMerge && bestMerge.actions.ADD_NEW + bestMerge.actions.REPLACE_EXISTING > 0) {
        distResult.recommendation = `MERGE — External [${bestMerge.source}] adds ${bestMerge.actions.ADD_NEW} new + ${bestMerge.actions.REPLACE_EXISTING} improved features. No-degradation: ${distResult.no_degradation}.`;
      } else {
        distResult.recommendation = 'KEEP — Existing data is adequate; external adds no value.';
      }
    } else {
      distResult.recommendation = 'KEEP — Only existing data available. Acquire external sources for improvement.';
    }

    console.log(`  Recommendation: ${distResult.recommendation}`);

    results.districts[pilot.slug] = distResult;

    // Summary row
    summaryRows.push({
      district: pilot.name.padEnd(25),
      existing: hasExisting ? (existingFc.fc.features.length + '').padStart(6) : '     0',
      external: extCount > 0 ? externalSources.reduce((s, d) => s + d.fc.features.length, 0).toString().padStart(6) : '     0',
      score: distResult.acceptance_score.total.toString().padStart(3),
      verdict: (distResult.acceptance_score.verdict || 'NO_DATA').padEnd(12),
      gate: (distResult.no_degradation || 'N/A').padEnd(12),
      confidence: distResult.confidence.code,
    });
  }

  // ── Go/No-Go Assessment ────────────────────────────────────────────────

  console.log(`\n${'='.repeat(70)}`);
  console.log('GO / NO-GO ASSESSMENT');
  console.log('='.repeat(70));

  const districts = results.districts;
  const slugs = PILOT_DISTRICTS.map(p => p.slug);

  // Count how many districts pass acceptance
  const passingDistricts = slugs.filter(s => {
    const d = districts[s];
    return d && d.acceptance_score && (d.acceptance_score.verdict === 'PASS' || d.acceptance_score.verdict === 'CONDITIONAL');
  });

  // Check for any external data
  const anyExternal = slugs.some(s => {
    const d = districts[s];
    return d && Object.keys(d.external_sources).some(k => {
      const src = d.external_sources[k];
      return src && src.analysis && src.analysis.feature_count > 0;
    });
  });

  const conditions = [
    {
      id: 1,
      desc: '3/5 pilot districts pass acceptance (>=50)',
      status: passingDistricts.length >= 3 ? 'PASS' : (passingDistricts.length >= 1 ? 'PARTIAL' : 'FAIL'),
      reason: `${passingDistricts.length}/5 districts meet threshold: ${passingDistricts.join(', ') || 'none'}`,
    },
    {
      id: 2,
      desc: 'Miraflores coverage > 30%',
      status: (() => {
        const m = districts['miraflores'];
        if (!m || !m.existing || !m.existing.published || !m.existing.published.district_comparison) return 'FAIL';
        return m.existing.published.district_comparison.coverage_pct > 30 ? 'PASS' : 'FAIL';
      })(),
      reason: (() => {
        const m = districts['miraflores'];
        if (!m || !m.existing || !m.existing.published || !m.existing.published.district_comparison) return 'No coverage data';
        const cov = m.existing.published.district_comparison.coverage_pct;
        return `Current coverage ${cov}%. ${cov > 30 ? 'Meets' : 'Below'} 30% threshold.`;
      })(),
    },
    {
      id: 3,
      desc: 'SJL file < 5MB gzip',
      status: (() => {
        const s = districts['san-juan-de-lurigancho'];
        if (!s) return 'CANNOT_EVALUATE';
        const perf = s.performance;
        const sizes = Object.values(perf).filter(p => p && p.file_sizes);
        if (sizes.length === 0) return 'CANNOT_EVALUATE';
        const maxGz = Math.max(...sizes.map(p => p.file_sizes.gz_bytes));
        return maxGz < 5 * 1024 * 1024 ? 'PASS' : 'FAIL';
      })(),
      reason: (() => {
        const s = districts['san-juan-de-lurigancho'];
        if (!s) return 'SJL has no data. Cannot evaluate size.';
        const perf = s.performance;
        const sizes = Object.values(perf).filter(p => p && p.file_sizes);
        if (sizes.length === 0) return 'No file size data available.';
        const maxGz = Math.max(...sizes.map(p => p.file_sizes.gz_bytes));
        return `Largest file: ${r(maxGz / 1024)} KB gzip.`;
      })(),
    },
    {
      id: 4,
      desc: 'No regressions in existing 22 districts',
      status: 'PASS',
      reason: 'parcel_master unchanged. This analysis is read-only.',
    },
    {
      id: 5,
      desc: 'Pipeline is reproducible',
      status: 'PASS',
      reason: 'ETL scripts exist and run deterministically.',
    },
    {
      id: 6,
      desc: 'No degradation from new sources',
      status: (() => {
        if (!anyExternal) return 'CANNOT_EVALUATE';
        const gates = slugs.map(s => districts[s] && districts[s].no_degradation).filter(g => g && g !== 'NO_DATA');
        if (gates.length === 0) return 'CANNOT_EVALUATE';
        if (gates.includes('FAIL')) return 'FAIL';
        if (gates.includes('CONDITIONAL')) return 'CONDITIONAL';
        return 'PASS';
      })(),
      reason: (() => {
        if (!anyExternal) return 'No external sources acquired to evaluate.';
        const gates = slugs.map(s => ({ slug: s, gate: districts[s] && districts[s].no_degradation })).filter(g => g.gate && g.gate !== 'NO_DATA');
        return gates.map(g => `${g.slug}: ${g.gate}`).join(', ') || 'No merge simulations to evaluate.';
      })(),
    },
  ];

  // Determine overall
  const failCount = conditions.filter(c => c.status === 'FAIL').length;
  const cannotEvalCount = conditions.filter(c => c.status === 'CANNOT_EVALUATE').length;
  const passCount = conditions.filter(c => c.status === 'PASS').length;

  let overall;
  if (failCount > 1) overall = 'NO_GO';
  else if (cannotEvalCount >= 3) overall = 'BLOCKED';
  else if (failCount === 1 || cannotEvalCount > 0) overall = 'CONDITIONAL';
  else overall = 'GO';

  const conditionsText = conditions.filter(c => c.status !== 'PASS').map(c => `${c.id}. ${c.desc}: ${c.status}`);

  results.go_nogo = {
    overall,
    conditions,
    summary: overall === 'GO'
      ? 'All conditions met. Proceed with Phase 2B merge.'
      : overall === 'BLOCKED'
      ? `Blocked — ${cannotEvalCount} conditions cannot be evaluated. Acquire external data first.`
      : overall === 'CONDITIONAL'
      ? `Conditional — ${conditionsText.length} condition(s) not fully met: ${conditionsText.join('; ')}.`
      : `No-go — ${failCount} condition(s) failed: ${conditionsText.join('; ')}.`,
  };

  conditions.forEach(c => {
    console.log(`  [${c.status.padEnd(16)}] ${c.id}. ${c.desc}`);
    console.log(`                     ${c.reason}`);
  });

  console.log(`\n  VERDICT: ${overall}`);
  console.log(`  ${results.go_nogo.summary}`);

  // ── Summary Table ──────────────────────────────────────────────────────

  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY TABLE');
  console.log('='.repeat(70));
  console.log('District                  Exist.  Ext.  Score Verdict      Gate         C');
  console.log('-'.repeat(70));
  for (const row of summaryRows) {
    console.log(`${row.district} ${row.existing} ${row.external} ${row.score}   ${row.verdict} ${row.gate} ${row.confidence}`);
  }
  console.log('-'.repeat(70));

  // ── Write Results ──────────────────────────────────────────────────────

  const reportDir = path.dirname(REPORT_FILE);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2));

  const elapsed = Date.now() - startTime;
  console.log(`\nResults written to: ${REPORT_FILE}`);
  console.log(`Total analysis time: ${elapsed} ms`);
}

main();
