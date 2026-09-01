#!/usr/bin/env node
/*
 * Convierte TODOS los KML de catastro en data/catastro/kml/ a .geojson.gz
 * Uso: node tools/convert_all_catastro.js [directorio_kml]
 *
 * Por defecto busca KMLs en data/catastro/kml/
 * Mapea cada archivo a su distrito y combina las partes automáticamente.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const kmlDir = process.argv[2] || path.join(__dirname, '..', 'data', 'catastro', 'kml');
const outDir = path.join(__dirname, '..', 'data', 'catastro');
const converter = path.join(__dirname, 'kml_to_geojson.js');

if (!fs.existsSync(kmlDir)) {
  console.error(`No existe el directorio: ${kmlDir}`);
  console.error('Crea data/catastro/kml/ y coloca los archivos KML ahí.');
  process.exit(1);
}

const files = fs.readdirSync(kmlDir).filter(f => f.toLowerCase().endsWith('.kml'));
if (files.length === 0) {
  console.error(`No se encontraron archivos .kml en ${kmlDir}`);
  process.exit(1);
}

function classifyFile(filename) {
  const upper = filename.toUpperCase();
  if (upper.includes('MANZANA')) return null;

  if (upper.startsWith('ATE ') || upper.startsWith('ATE_')) return 'ate';
  if (upper.includes('BARRANCO') && upper.includes('LOTES')) return 'barranco';
  if (upper.includes('BREÑA') || upper.includes('BRENA') || upper.startsWith('BRE')) return 'brena';
  if (upper.includes('CALLAO')) return 'callao';
  if (upper.includes('CARABAYLLO')) return 'carabayllo';
  if (upper.includes('CERCADO DE LIMA') && upper.includes('LOTES')) return 'cercado-de-lima';
  if (upper.includes('CHORRILLOS')) return 'chorrillos';
  if (upper.includes('EL_AGUSTINO') || upper.includes('EL AGUSTINO')) return 'el-agustino';
  if (upper.includes('INDEPENDENCIA')) return 'independencia';
  if (upper.includes('JESUS MARIA') || upper.includes('JESÚS MARÍA')) return 'jesus-maria';
  if (upper.includes('LA MOLINA') && upper.includes('LOTE')) return 'la-molina';
  if (upper.includes('LINCE')) return 'lince';
  if (upper.includes('LURIN') || upper.includes('LURÍN')) return 'lurin';
  if (upper.includes('MAGDALENA')) return 'magdalena-del-mar';
  if (upper.includes('MIRAFLORES') && upper.includes('LOTES')) return 'miraflores';
  if (upper.includes('PUEBLO LIBRE')) return 'pueblo-libre';
  if (upper.includes('PUNTA HERMOSA')) return 'punta-hermosa';
  if (upper.includes('PUNTA NEGRA')) return 'punta-negra';
  if (upper.includes('RIMAC') || upper.includes('RÍMAC')) return 'rimac';
  if (upper.includes('SAN BARTOLO')) return 'san-bartolo';
  if (upper.includes('SAN BORJA') && !upper.includes('MANZANA')) return 'san-borja';
  if (upper.includes('SAN ISIDRO')) return 'san-isidro';
  if (upper.includes('SAN JUAN DE MIRAFLORES') || upper.includes('150133')) return 'san-juan-de-miraflores';
  if (upper.includes('SAN LUIS')) return 'san-luis';
  if (upper.includes('SAN MIGUEL') || upper.includes('150136')) return 'san-miguel';
  if (upper.includes('SANTA ANITA')) return 'santa-anita';
  if (upper.includes('SURCO')) return 'santiago-de-surco';
  if (upper.includes('SURQUILLO')) return 'surquillo';
  if (upper.includes('150108')) return 'chorrillos';
  if (upper.includes('150122') && upper.includes('MIRAFLORES')) return 'miraflores';

  return null;
}

const groups = {};
let skipped = [];

for (const file of files) {
  const slug = classifyFile(file);
  if (!slug) {
    skipped.push(file);
    continue;
  }
  if (!groups[slug]) groups[slug] = [];
  groups[slug].push(path.join(kmlDir, file));
}

if (skipped.length > 0) {
  console.log(`\nArchivos ignorados (MANZANAS o no reconocidos):`);
  skipped.forEach(f => console.log(`  - ${f}`));
}

const slugs = Object.keys(groups).sort();
console.log(`\nDistritos encontrados: ${slugs.length}`);
slugs.forEach(s => console.log(`  ${s}: ${groups[s].length} archivo(s)`));
console.log('');

let ok = 0, fail = 0;
for (const slug of slugs) {
  const outPath = path.join(outDir, `${slug}.geojson.gz`);
  const inputs = groups[slug].map(f => `"${f}"`).join(' ');
  const cmd = `node "${converter}" "${outPath}" ${inputs}`;
  try {
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(result.trim());
    ok++;
  } catch (e) {
    console.error(`ERROR en ${slug}: ${e.stderr || e.message}`);
    fail++;
  }
}

console.log(`\nResultado: ${ok} distritos convertidos, ${fail} errores`);
