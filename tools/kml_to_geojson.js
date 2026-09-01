#!/usr/bin/env node
/*
 * Convierte catastro KML (polígonos/líneas de lotes) a GeoJSON optimizado y
 * comprimido (.geojson.gz) para cargar por distrito bajo demanda en el mapa.
 *
 * Uso:
 *   node tools/kml_to_geojson.js <salida.geojson.gz> <entrada1.kml> [entrada2.kml ...]
 *
 * Acepta uno o varios archivos KML (o JSON del conector de Drive). Cuando se
 * pasan varios, une todos los features y deduplica por coordenadas del primer
 * vértice para evitar lotes repetidos entre KMLs superpuestos.
 *
 * Optimizaciones: descarta la altura (z), redondea coordenadas a 5 decimales
 * (~1 m), minifica y aplica gzip. Conserva el tipo de geometría (Polygon/LineString).
 */
const fs = require('fs');
const zlib = require('zlib');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('uso: node kml_to_geojson.js <out.geojson.gz> <in1.kml> [in2.kml ...]');
  process.exit(1);
}

const outPath = args[0];
const inPaths = args.slice(1);

const round = n => Math.round(parseFloat(n) * 1e5) / 1e5;
function parseCoords(txt) {
  const pts = [];
  for (const tok of txt.trim().split(/\s+/)) {
    const a = tok.split(',');
    if (a.length >= 2) { const x = round(a[0]), y = round(a[1]); if (!isNaN(x) && !isNaN(y)) pts.push([x, y]); }
  }
  return pts;
}

function extractFeatures(kml) {
  const feats = [];
  for (const m of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const blk = m[1];
    if (/<Polygon>/.test(blk)) {
      const outer = blk.match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
      if (outer) { const r = parseCoords(outer[1]); if (r.length >= 4) feats.push({ t: 'Polygon', c: [r] }); }
    } else if (/<LineString>/.test(blk)) {
      const cm = blk.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
      if (cm) { const r = parseCoords(cm[1]); if (r.length >= 2) feats.push({ t: 'LineString', c: r }); }
    }
  }
  return feats;
}

function featureKey(f) {
  const coords = f.t === 'Polygon' ? f.c[0] : f.c;
  if (coords.length < 2) return `${f.t}:${JSON.stringify(coords)}`;
  return `${f.t}:${coords[0][0]},${coords[0][1]}|${coords[1][0]},${coords[1][1]}|${coords.length}`;
}

const features = [];
const seen = new Set();
let dupes = 0;

for (const inPath of inPaths) {
  let kml = fs.readFileSync(inPath, 'utf8');
  if (inPath.endsWith('.json') || kml.trimStart().startsWith('{')) {
    try { const j = JSON.parse(kml); if (j.content) kml = Buffer.from(j.content, 'base64').toString('utf8'); } catch (e) {}
  }
  const feats = extractFeatures(kml);
  for (const f of feats) {
    const key = featureKey(f);
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    features.push(f);
  }
  console.log(`  ${inPath}: ${feats.length} features`);
}

const fc = {
  type: 'FeatureCollection',
  features: features.map(f => ({ type: 'Feature', properties: {}, geometry: { type: f.t, coordinates: f.c } }))
};
const json = JSON.stringify(fc);
const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
fs.writeFileSync(outPath, gz);
const poly = features.filter(f => f.t === 'Polygon').length;
const line = features.length - poly;
const dupeMsg = dupes > 0 ? ` (${dupes} duplicados removidos)` : '';
console.log(`${outPath}: ${features.length} lotes (${poly} polígonos, ${line} líneas)${dupeMsg} · GeoJSON ${(json.length/1024).toFixed(0)}KB · gzip ${(gz.length/1024).toFixed(0)}KB`);
