#!/usr/bin/env node
// Automated review of ZONA_DESTACADOS curated data.
// Queries HERE Browse API for notable establishments per district,
// compares with current curated data, and generates a PR-ready diff.
//
// Usage:
//   node scripts/update-zona-destacados.mjs              # apply changes + report
//   node scripts/update-zona-destacados.mjs --dry-run    # report only, no file changes
//   node scripts/update-zona-destacados.mjs --report-only # same as --dry-run

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(__dirname, '..', 'index.html');
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--report-only');

// ── District center coordinates (approximate) ──────────────────
const DISTRICT_CENTERS = {
  'Miraflores':        [-12.1197, -77.0300],
  'San Isidro':        [-12.0980, -77.0360],
  'Barranco':          [-12.1450, -77.0220],
  'Santiago de Surco': [-12.1120, -76.9980],
  'Surco':             [-12.1120, -76.9980],
  'La Molina':         [-12.0860, -76.9500],
  'San Borja':         [-12.1010, -77.0050],
  'Jesús María':       [-12.0720, -77.0430],
  'San Miguel':        [-12.0770, -77.0840],
  'Magdalena del Mar': [-12.0910, -77.0720],
  'Chorrillos':        [-12.1650, -77.0100],
  'Lince':             [-12.0840, -77.0370],
  'Surquillo':         [-12.1130, -77.0250],
  'Pueblo Libre':      [-12.0730, -77.0660],
  'Los Olivos':        [-11.9960, -77.0650],
  'Ate':               [-12.0300, -76.9200],
  'Breña':             [-12.0580, -77.0530],
  'San Martín de Porres': [-12.0200, -77.0550],
  'Cercado de Lima':   [-12.0490, -77.0310],
};

// ── HERE Browse API category codes ──────────────────────────────
const HERE_CATS = [
  { code: '600-6100-0062,600-6200-0063,600-6300-0066,600-6300-0067', label: 'Supermercado', ico: '🛒' },
  { code: '550-5510-0202,550-5510-0204,550-5510-0000', label: 'Parque', ico: '🌳' },
  { code: '800-8000-0159,800-8000-0158,800-8000-0000', label: 'Hospital/Clínica', ico: '🏥' },
  { code: '800-8200-0174,800-8200-0173,800-8200-0000', label: 'Educación', ico: '🎓' },
  { code: '700-7000-0107,700-7010-0108', label: 'Banco', ico: '🏦' },
  { code: '600-6900-0000,600-6400-0000', label: 'Centro comercial', ico: '🏬' },
  { code: '400-4100-0035,400-4100-0036,400-4100-0000', label: 'Transporte', ico: '🚌' },
  { code: '100-1000-0000,100-1000-0001,100-1100-0000', label: 'Restaurante', ico: '🍽️' },
  { code: '200-2000-0011,200-2100-0019', label: 'Hotel', ico: '🏨' },
  { code: '300-3000-0023,300-3100-0030', label: 'Cultura', ico: '🎨' },
];

// Known important brands/chains — always tag as "destacado"
const LANDMARK_KEYWORDS = [
  'real plaza','jockey plaza','open plaza','larcomar','mega plaza','plaza norte',
  'mall aventura','plaza san miguel','mall del sur','la rambla',
  'wong','metro ','plaza vea','tottus','vivanda',
  'clínica','clinica','hospital','essalud',
  'universidad','univ ','pucp','ulima','uni ','usmp','usil','upc','esan','up ',
  'museo','teatro','estadio',
  'parque kennedy','campo de marte','olivar','pantanos de villa',
  'línea 1','línea 2','metropolitano','estación',
];

const TRENDING_KEYWORDS = [
  'central restaurante','maido','astrid','isolina','la mar cebichería',
  'rafael','kjolle','mérito','cosme','la bonbonniere','mercado 28',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractApiKey(html) {
  const m = html.match(/HERE_API_KEY\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

function extractCurrentData(html) {
  const revMatch = html.match(/ZONA_DESTACADOS_REV\s*=\s*'([^']*)'/);
  const rev = revMatch ? revMatch[1] : '';

  const blockMatch = html.match(/const ZONA_DESTACADOS\s*=\s*(\{[\s\S]*?\n\});/);
  if (!blockMatch) return { rev, data: {} };

  try {
    const data = new Function('return ' + blockMatch[1])();
    return { rev, data };
  } catch {
    console.error('Failed to parse ZONA_DESTACADOS from HTML');
    return { rev, data: {} };
  }
}

async function queryHERE(apiKey, lat, lng, catCodes, limit = 25) {
  const radius = 2000;
  const url = `https://browse.search.hereapi.com/v1/browse?at=${lat},${lng}&categories=${catCodes}&limit=${limit}&in=circle:${lat},${lng};r=${radius}&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HERE API ${res.status}`);
  const j = await res.json();
  return j.items || [];
}

function classifyPlace(name, catLabel) {
  const low = name.toLowerCase();
  if (TRENDING_KEYWORDS.some(k => low.includes(k))) return 'trending';
  if (LANDMARK_KEYWORDS.some(k => low.includes(k))) return 'destacado';
  const importantCats = ['Hospital/Clínica', 'Educación', 'Centro comercial', 'Cultura', 'Transporte'];
  if (importantCats.includes(catLabel)) return 'destacado';
  return null;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371e3, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function scanDistrict(apiKey, district, center) {
  const [lat, lng] = center;
  const allItems = [];
  let apiErrors = 0;

  for (const cat of HERE_CATS) {
    try {
      const items = await queryHERE(apiKey, lat, lng, cat.code, 15);
      items.forEach(it => {
        allItems.push({
          name: it.title || '',
          cat: cat.label,
          ico: cat.ico,
          lat: it.position?.lat,
          lng: it.position?.lng,
          dist: it.distance || (it.position ? haversine(lat, lng, it.position.lat, it.position.lng) : 9999),
        });
      });
    } catch (e) {
      apiErrors++;
    }
    await sleep(200);
  }

  if (apiErrors === HERE_CATS.length) {
    // All API calls failed — return null to signal "no data available"
    return null;
  }

  // Deduplicate by name
  const seen = new Set();
  const unique = allItems.filter(it => {
    const key = it.name.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Score and filter: only keep places worth curating
  return unique
    .map(it => ({ ...it, tag: classifyPlace(it.name, it.cat) }))
    .filter(it => it.tag !== null)
    .sort((a, b) => {
      const w = { destacado: 0, trending: 1, nuevo: 2 };
      return (w[a.tag] || 9) - (w[b.tag] || 9) || a.dist - b.dist;
    })
    .slice(0, 12);
}

function compareDistrict(district, current, scanned) {
  const currentNames = new Set((current || []).map(e => e.name.toLowerCase().trim()));
  const scannedNames = new Set(scanned.map(e => e.name.toLowerCase().trim()));

  const toAdd = scanned.filter(s => !currentNames.has(s.name.toLowerCase().trim()));
  const toRemove = (current || []).filter(c => !scannedNames.has(c.name.toLowerCase().trim()));
  const kept = (current || []).filter(c => scannedNames.has(c.name.toLowerCase().trim()));

  return { toAdd, toRemove, kept };
}

function mergeDistrict(current, diff) {
  // Keep existing entries that are still detected, update tags for scanned matches
  const merged = [...diff.kept];

  // Add new notable places
  for (const entry of diff.toAdd) {
    merged.push({
      name: entry.name,
      cat: entry.cat,
      ico: entry.ico,
      tag: 'nuevo',
      lat: Math.round(entry.lat * 10000) / 10000,
      lng: Math.round(entry.lng * 10000) / 10000,
    });
  }

  // removed entries are simply dropped (not in merged)
  return merged;
}

function serializeData(data) {
  const lines = ['{'];
  const districts = Object.entries(data);
  districts.forEach(([dist, entries], di) => {
    lines.push(`  '${dist}': [`);
    entries.forEach((e, ei) => {
      const parts = [`name:'${e.name.replace(/'/g, "\\'")}'`];
      parts.push(`cat:'${e.cat}'`);
      parts.push(`ico:'${e.ico}'`);
      parts.push(`tag:'${e.tag}'`);
      if (e.lat != null) parts.push(`lat:${e.lat}`);
      if (e.lng != null) parts.push(`lng:${e.lng}`);
      const comma = ei < entries.length - 1 ? ',' : ',';
      lines.push(`    {${parts.join(',')}}${comma}`);
    });
    const dComma = di < districts.length - 1 ? ',' : ',';
    lines.push(`  ]${dComma}`);
  });
  lines.push('}');
  return lines.join('\n');
}

function patchHTML(html, newData, newRev) {
  html = html.replace(
    /ZONA_DESTACADOS_REV\s*=\s*'[^']*'/,
    `ZONA_DESTACADOS_REV = '${newRev}'`
  );
  const serialized = serializeData(newData);
  html = html.replace(
    /const ZONA_DESTACADOS\s*=\s*\{[\s\S]*?\n\};/,
    `const ZONA_DESTACADOS = ${serialized};`
  );
  return html;
}

function generateReport(changes, newRev) {
  const lines = [];
  lines.push(`# Zona Destacados — Revisión ${newRev}`);
  lines.push('');
  lines.push(`Fecha de ejecución: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  let totalAdded = 0, totalRemoved = 0, totalKept = 0;

  for (const [dist, diff] of Object.entries(changes)) {
    if (diff.toAdd.length === 0 && diff.toRemove.length === 0) continue;
    lines.push(`## ${dist}`);
    lines.push('');

    if (diff.toAdd.length > 0) {
      lines.push('**Nuevos establecimientos detectados:**');
      diff.toAdd.forEach(e => {
        lines.push(`- ${e.ico} **${e.name}** — ${e.cat} (${Math.round(e.dist)} m del centro del distrito)`);
      });
      lines.push('');
      totalAdded += diff.toAdd.length;
    }

    if (diff.toRemove.length > 0) {
      lines.push('**Establecimientos no detectados (posiblemente cerrados o renombrados):**');
      diff.toRemove.forEach(e => {
        lines.push(`- ${e.ico} ~~${e.name}~~ — ${e.cat}`);
      });
      lines.push('');
      totalRemoved += diff.toRemove.length;
    }

    totalKept += diff.kept.length;
  }

  lines.push('---');
  lines.push('## Resumen');
  lines.push('');
  lines.push(`| Métrica | Cantidad |`);
  lines.push(`|---------|----------|`);
  lines.push(`| Establecimientos mantenidos | ${totalKept} |`);
  lines.push(`| Nuevos agregados | ${totalAdded} |`);
  lines.push(`| Eliminados (no detectados) | ${totalRemoved} |`);
  lines.push(`| Distritos revisados | ${Object.keys(changes).length} |`);
  lines.push('');

  if (totalAdded === 0 && totalRemoved === 0) {
    lines.push('> Sin cambios significativos en esta revisión.');
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('📍 Zona Destacados — actualización periódica');
  console.log(`   Modo: ${DRY_RUN ? 'solo reporte (dry-run)' : 'aplicar cambios'}`);
  console.log('');

  const html = readFileSync(HTML_PATH, 'utf8');
  const apiKey = extractApiKey(html);
  if (!apiKey) { console.error('HERE_API_KEY no encontrado en index.html'); process.exit(2); }

  const { rev: oldRev, data: currentData } = extractCurrentData(html);
  console.log(`   Revisión anterior: ${oldRev}`);
  console.log(`   Distritos curados: ${Object.keys(currentData).length}`);
  console.log('');

  const now = new Date();
  const newRev = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const changes = {};
  const updatedData = { ...currentData };
  let hasChanges = false;

  for (const [district, center] of Object.entries(DISTRICT_CENTERS)) {
    process.stdout.write(`   Escaneando ${district}...`);
    try {
      const scanned = await scanDistrict(apiKey, district, center);
      if (scanned === null) {
        console.log(' API no disponible, manteniendo datos actuales');
        changes[district] = { toAdd: [], toRemove: [], kept: currentData[district] || [] };
        continue;
      }
      const diff = compareDistrict(district, currentData[district], scanned);
      changes[district] = diff;

      if (diff.toAdd.length > 0 || diff.toRemove.length > 0) {
        hasChanges = true;
        updatedData[district] = mergeDistrict(currentData[district], diff);
        console.log(` +${diff.toAdd.length} -${diff.toRemove.length}`);
      } else {
        console.log(' sin cambios');
      }
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
      changes[district] = { toAdd: [], toRemove: [], kept: currentData[district] || [] };
    }
    await sleep(500);
  }

  console.log('');

  const report = generateReport(changes, newRev);
  console.log(report);

  const reportPath = resolve(__dirname, '..', 'zona-update-report.md');
  writeFileSync(reportPath, report);
  console.log(`\n📄 Reporte guardado en: zona-update-report.md`);

  if (!hasChanges) {
    console.log('\n✅ Sin cambios detectados.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('\n🔍 Dry-run — no se modificó index.html');
    process.exit(0);
  }

  const patchedHTML = patchHTML(html, updatedData, newRev);
  writeFileSync(HTML_PATH, patchedHTML);
  console.log(`\n✏️  index.html actualizado (rev: ${newRev})`);
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(2); });
