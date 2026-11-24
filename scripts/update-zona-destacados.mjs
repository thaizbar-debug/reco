#!/usr/bin/env node
// Automated review of ZONA_DESTACADOS curated data.
// Queries HERE Browse API for notable establishments per district,
// compares with current curated data, and generates a PR-ready diff.
// Optionally fetches establishment photos via Google Places API.
//
// Usage:
//   node scripts/update-zona-destacados.mjs              # apply changes + report
//   node scripts/update-zona-destacados.mjs --dry-run    # report only, no file changes
//   node scripts/update-zona-destacados.mjs --report-only # same as --dry-run
//   node scripts/update-zona-destacados.mjs --skip-photos # skip photo fetching

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(__dirname, '..', 'index.html');
const PHOTOS_DIR = resolve(__dirname, '..', 'data', 'zona-photos');
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--report-only');
const SKIP_PHOTOS = process.argv.includes('--skip-photos');

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
  'bcp','bbva','interbank','scotiabank','banco de la nación','banco falabella',
  'colegio','senati','isil','tecsup',
  'museo','teatro','estadio',
  'parque kennedy','campo de marte','olivar','pantanos de villa',
  'línea 1','línea 2','metropolitano','estación',
];

const TRENDING_KEYWORDS = [
  'central restaurante','maido','astrid','isolina','la mar cebichería',
  'rafael','kjolle','mérito','cosme','la bonbonniere','mercado 28',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function extractApiKey(html) {
  const m = html.match(/HERE_API_KEY\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

function extractGoogleKey(html) {
  const m = html.match(/GOOGLE_MAPS_KEY\s*=\s*'([^']*)'/);
  return m && m[1] ? m[1] : null;
}

function getGooglePlacesKey(html) {
  return process.env.GOOGLE_PLACES_KEY || extractGoogleKey(html) || null;
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
  const importantCats = ['Hospital/Clínica', 'Educación', 'Centro comercial', 'Cultura', 'Transporte', 'Banco', 'Supermercado'];
  if (importantCats.includes(catLabel)) return 'destacado';
  return null;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371e3, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Google Places API — photo fetching ─────────────────────────
async function searchGooglePlace(gKey, name, lat, lng) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const body = {
    textQuery: `${name} Lima Peru`,
    locationBias: {
      circle: { center: { latitude: lat, longitude: lng }, radius: 500.0 }
    },
    maxResultCount: 1,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': gKey,
      'X-Goog-FieldMask': 'places.id,places.photos',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const j = await res.json();
  const place = j.places?.[0];
  if (!place?.photos?.length) return null;
  return place.photos[0].name;
}

async function downloadGooglePhoto(gKey, photoName, destPath) {
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&skipHttpRedirect=true`;
  const res = await fetch(url, {
    headers: { 'X-Goog-Api-Key': gKey },
  });
  if (!res.ok) return false;
  const j = await res.json();
  const photoUri = j.photoUri;
  if (!photoUri) return false;

  const imgRes = await fetch(photoUri);
  if (!imgRes.ok) return false;
  const buf = Buffer.from(await imgRes.arrayBuffer());
  writeFileSync(destPath, buf);
  return true;
}

async function fetchPhotoForEntry(gKey, entry, districtSlug) {
  if (entry.photo) return entry.photo;
  if (!entry.lat || !entry.lng) return null;

  const placeSlug = slugify(entry.name);
  const distDir = resolve(PHOTOS_DIR, districtSlug);
  mkdirSync(distDir, { recursive: true });
  const fileName = `${placeSlug}.jpg`;
  const destPath = resolve(distDir, fileName);

  if (existsSync(destPath)) {
    return `data/zona-photos/${districtSlug}/${fileName}`;
  }

  try {
    const photoName = await searchGooglePlace(gKey, entry.name, entry.lat, entry.lng);
    if (!photoName) return null;
    await sleep(100);
    const ok = await downloadGooglePhoto(gKey, photoName, destPath);
    if (!ok) return null;
    return `data/zona-photos/${districtSlug}/${fileName}`;
  } catch {
    return null;
  }
}

async function fetchPhotosForDistrict(gKey, district, entries) {
  const districtSlug = slugify(district);
  let fetched = 0;
  const updated = [];
  for (const entry of entries) {
    if (entry.photo) {
      updated.push(entry);
      continue;
    }
    const photoPath = await fetchPhotoForEntry(gKey, entry, districtSlug);
    updated.push({ ...entry, photo: photoPath });
    if (photoPath) fetched++;
    await sleep(200);
  }
  return { entries: updated, fetched };
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
    .map(it => ({ ...it, tag: classifyPlace(it.name, it.cat), photo: null }))
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
  const currentByName = new Map((current || []).map(e => [e.name.toLowerCase().trim(), e]));

  // Keep existing entries that are still detected, preserving photo field
  const merged = diff.kept.map(e => {
    const prev = currentByName.get(e.name.toLowerCase().trim());
    return prev ? { ...e, photo: prev.photo || null } : { ...e, photo: null };
  });

  // Add new notable places
  for (const entry of diff.toAdd) {
    merged.push({
      name: entry.name,
      cat: entry.cat,
      ico: entry.ico,
      tag: 'nuevo',
      lat: Math.round(entry.lat * 10000) / 10000,
      lng: Math.round(entry.lng * 10000) / 10000,
      photo: null,
    });
  }

  // Ensure essential categories: Supermercado, Educación/Colegio, Banco
  const hasCat = (cats) => merged.some(e => cats.some(c => e.cat.toLowerCase().includes(c)));
  const essentialCats = [
    { cats: ['supermercado'], fallbackCat: 'Supermercado', fallbackIco: '🛒' },
    { cats: ['universidad', 'colegio', 'educación', 'instituto'], fallbackCat: 'Educación', fallbackIco: '🎓' },
    { cats: ['banco'], fallbackCat: 'Banco', fallbackIco: '🏦' },
  ];
  for (const { cats } of essentialCats) {
    if (!hasCat(cats)) {
      const removed = diff.toRemove.find(e => cats.some(c => e.cat.toLowerCase().includes(c)));
      if (removed) {
        merged.push({ ...removed, photo: currentByName.get(removed.name.toLowerCase().trim())?.photo || null });
      }
    }
  }

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
      parts.push(`photo:${e.photo ? `'${e.photo.replace(/'/g, "\\'")}'` : 'null'}`);
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

  // ── Photo fetching via Google Places API ────────────────────
  const gKey = getGooglePlacesKey(html);
  let totalPhotos = 0;

  if (!gKey) {
    console.log('📷 Google Places API key no configurada — fotos omitidas.');
    console.log('   Configura GOOGLE_PLACES_KEY como secreto de GitHub o');
    console.log('   GOOGLE_MAPS_KEY en index.html para habilitar fotos.\n');
  } else if (SKIP_PHOTOS) {
    console.log('📷 Fotos omitidas (--skip-photos)\n');
  } else if (DRY_RUN) {
    console.log('📷 Fotos omitidas en modo dry-run\n');
  } else {
    console.log('📷 Descargando fotos de establecimientos...');
    mkdirSync(PHOTOS_DIR, { recursive: true });
    for (const [district, entries] of Object.entries(updatedData)) {
      const missing = entries.filter(e => !e.photo).length;
      if (missing === 0) continue;
      process.stdout.write(`   📸 ${district} (${missing} sin foto)...`);
      try {
        const { entries: withPhotos, fetched } = await fetchPhotosForDistrict(gKey, district, entries);
        updatedData[district] = withPhotos;
        if (fetched > 0) hasChanges = true;
        totalPhotos += fetched;
        console.log(` ${fetched} fotos descargadas`);
      } catch (e) {
        console.log(` ERROR: ${e.message}`);
      }
    }
    console.log(`   Total fotos nuevas: ${totalPhotos}\n`);
  }

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
  if (totalPhotos > 0) {
    console.log(`📷 ${totalPhotos} fotos guardadas en data/zona-photos/`);
  }
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(2); });
