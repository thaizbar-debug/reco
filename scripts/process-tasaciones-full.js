#!/usr/bin/env node
// Phase B: Process ALL 47,476 raw tasaciones from Excel
//
// The current serie_precios_tasaciones.json only has 24K records
// filtered by ≥20 tasaciones + ≥3 years per district. This script
// processes the full dataset with a lighter filter (≥5 tasaciones
// per district) so more data is available for market intelligence.
//
// Output: data/tasaciones_full.json
//
// Usage:
//   node scripts/process-tasaciones-full.js

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'tasaciones_full.json');
const MIN_N_DISTRICT = 5;
const MIN_N_RELIABLE_VAR = 20;

const pyFile = path.join(__dirname, '_extract_tasaciones.py');
const tmpJson = path.join(__dirname, '_tasaciones_raw.json');

fs.writeFileSync(pyFile, `
import openpyxl, json

wb = openpyxl.load_workbook('data/tasaciones_inmuebles_consolidado.xlsx', read_only=True, data_only=True)
ws = wb.active

rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if row[0] is None:
        continue
    def f(v):
        try: return float(v)
        except: return None
    rows.append({
        'year': int(row[0]),
        'ubicacion': str(row[1] or '').strip(),
        'distrito': str(row[2] or '').strip(),
        'departamento': str(row[3] or '').strip(),
        'valor_comercial': f(row[4]),
        'valor_unitario': f(row[5]),
    })

wb.close()
with open('${tmpJson.replace(/\\/g, '/')}', 'w') as fp:
    json.dump(rows, fp)
print(f'Wrote {len(rows)} rows')
`);

console.log('Extracting all tasaciones from Excel...');
execSync(`python3 ${pyFile}`, {
  maxBuffer: 100 * 1024 * 1024,
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});
const rawJson = fs.readFileSync(tmpJson, 'utf8');
fs.unlinkSync(pyFile);
fs.unlinkSync(tmpJson);

const rows = JSON.parse(rawJson);
console.log(`Extracted ${rows.length} raw tasaciones`);

// Group by district → year
const byDistrict = {};
for (const r of rows) {
  const d = r.distrito || '';
  if (!d) continue;
  if (!byDistrict[d]) byDistrict[d] = { departamento: r.departamento, years: {} };
  if (!byDistrict[d].years[r.year]) byDistrict[d].years[r.year] = [];
  if (r.valor_unitario != null && r.valor_unitario > 0) {
    byDistrict[d].years[r.year].push({
      valor_unitario: r.valor_unitario,
      valor_comercial: r.valor_comercial,
    });
  }
}

// Calculate statistics per district-year
function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const distritos = {};
let totalEntries = 0;
let totalRecords = 0;
let includedDistricts = 0;
let excludedDistricts = 0;

for (const [distrito, info] of Object.entries(byDistrict)) {
  const totalN = Object.values(info.years).reduce((s, arr) => s + arr.length, 0);
  if (totalN < MIN_N_DISTRICT) {
    excludedDistricts++;
    continue;
  }
  includedDistricts++;

  const distEntry = {
    departamento: info.departamento,
    total_tasaciones: totalN,
    años: {},
  };

  const yearKeys = Object.keys(info.years).sort();
  let prevMediana = null;

  for (const y of yearKeys) {
    const vals = info.years[y].map(v => v.valor_unitario).sort((a, b) => a - b);
    const valsCom = info.years[y].map(v => v.valor_comercial).filter(v => v != null && v > 0);
    const n = vals.length;
    if (n === 0) continue;

    totalEntries++;
    totalRecords += n;

    const mediana = percentile(vals, 50);
    const entry = {
      mediana_usd_m2: Math.round(mediana * 100) / 100,
      promedio_usd_m2: Math.round(vals.reduce((a, b) => a + b, 0) / n * 100) / 100,
      n_tasaciones: n,
      min: Math.round(Math.min(...vals) * 100) / 100,
      max: Math.round(Math.max(...vals) * 100) / 100,
    };

    if (n >= 4) {
      entry.p25 = Math.round(percentile(vals, 25) * 100) / 100;
      entry.p75 = Math.round(percentile(vals, 75) * 100) / 100;
    }

    if (valsCom.length > 0) {
      const sortedCom = valsCom.sort((a, b) => a - b);
      entry.valor_comercial_mediana = Math.round(percentile(sortedCom, 50) * 100) / 100;
      entry.valor_comercial_n = valsCom.length;
    }

    if (prevMediana != null && n >= MIN_N_RELIABLE_VAR) {
      entry.var_pct = Math.round((mediana - prevMediana) / prevMediana * 10000) / 100;
    }

    prevMediana = mediana;
    distEntry.años[y] = entry;
  }

  if (Object.keys(distEntry.años).length > 0) {
    distritos[distrito] = distEntry;
  }
}

const result = {
  metadata: {
    fuente: 'tasaciones_inmuebles_consolidado.xlsx',
    generado: new Date().toISOString().slice(0, 10),
    descripcion: 'Serie completa de tasaciones procesadas con filtro ligero',
    total_registros_raw: rows.length,
    total_registros_con_valor_unitario: totalRecords,
    total_distritos: Object.keys(distritos).length,
    total_distritos_excluidos: excludedDistricts,
    total_entries_distrito_año: totalEntries,
    criterio_inclusion: `Mínimo ${MIN_N_DISTRICT} tasaciones por distrito`,
    criterio_var_pct: `var_pct solo calculado para entries con n ≥ ${MIN_N_RELIABLE_VAR}`,
    periodo: '2017-2024',
    unidad: 'USD/m²',
  },
  distritos,
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result));

console.log(`\n═══ TASACIONES FULL PROCESSING ═══`);
console.log(`✓ Raw records: ${rows.length}`);
console.log(`✓ With valor unitario: ${totalRecords}`);
console.log(`✓ Districts included (n≥${MIN_N_DISTRICT}): ${includedDistricts}`);
console.log(`✓ Districts excluded: ${excludedDistricts}`);
console.log(`✓ District-year entries: ${totalEntries}`);
console.log(`✓ Wrote ${OUTPUT_PATH}`);
