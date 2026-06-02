#!/usr/bin/env node
/*
 * Convierte un catastro KML (polígonos/líneas de lotes) a GeoJSON optimizado y
 * comprimido (.geojson.gz) para cargar por distrito bajo demanda en el mapa.
 *
 * Uso:
 *   node tools/kml_to_geojson.js <entrada.kml | entrada.json(MCP)> <salida.geojson.gz>
 *
 * Optimizaciones: descarta la altura (z), redondea coordenadas a 5 decimales
 * (~1 m), minifica y aplica gzip. Conserva el tipo de geometría (Polygon/LineString).
 */
const fs = require('fs');
const zlib = require('zlib');

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('uso: node kml_to_geojson.js <in.kml|in.json> <out.geojson.gz>'); process.exit(1); }

let kml = fs.readFileSync(inPath, 'utf8');
// Si es un JSON del conector de Drive ({content: base64}), decodificar.
if (inPath.endsWith('.json') || kml.trimStart().startsWith('{')) {
  try { const j = JSON.parse(kml); if (j.content) kml = Buffer.from(j.content, 'base64').toString('utf8'); } catch (e) {}
}

const round = n => Math.round(parseFloat(n) * 1e5) / 1e5;
function parseCoords(txt) {
  const pts = [];
  for (const tok of txt.trim().split(/\s+/)) {
    const a = tok.split(',');
    if (a.length >= 2) { const x = round(a[0]), y = round(a[1]); if (!isNaN(x) && !isNaN(y)) pts.push([x, y]); }
  }
  return pts;
}

const features = [];
const reColin = /<coordinates>([\s\S]*?)<\/coordinates>/;
for (const m of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
  const blk = m[1];
  if (/<Polygon>/.test(blk)) {
    const outer = blk.match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    if (outer) { const r = parseCoords(outer[1]); if (r.length >= 4) features.push({ t: 'Polygon', c: [r] }); }
  } else if (/<LineString>/.test(blk)) {
    const cm = blk.match(reColin);
    if (cm) { const r = parseCoords(cm[1]); if (r.length >= 2) features.push({ t: 'LineString', c: r }); }
  }
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
console.log(`${outPath}: ${features.length} lotes (${poly} polígonos, ${line} líneas) · GeoJSON ${(json.length/1024).toFixed(0)}KB · gzip ${(gz.length/1024).toFixed(0)}KB`);
