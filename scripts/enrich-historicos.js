#!/usr/bin/env node
// Phase B: Extract and unify histórico pricing from Data_Consolidada.xlsx
//
// Reads the "histórico" sheet, converts all PEN transactions to USD
// using monthly BCRP exchange rates, and outputs a unified JSON file
// with all 1,750 transactions in USD for market intelligence analysis.
//
// Output: data/historicos_market.json
//
// Usage:
//   pip install openpyxl   (if not installed)
//   node scripts/enrich-historicos.js

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TC_PATH = path.join(__dirname, '..', 'data', 'tc_pen_usd_bcrp.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'historicos_market.json');

const MES_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, setiembre: 9, septiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12,
};

const tc = JSON.parse(fs.readFileSync(TC_PATH, 'utf8'));

function getTC(fecha) {
  if (!fecha) return null;
  const m = String(fecha).trim().toLowerCase().match(/([a-zñéíóúü]+)\s+(\d{4})/);
  if (!m) return null;
  const mes = MES_ES[m[1]];
  const year = m[2];
  if (!mes) return null;
  const key = `${year}-${String(mes).padStart(2, '0')}`;
  if (tc.mensual[key]) return { tc: tc.mensual[key], key, source: 'monthly' };
  if (tc.anual[year]) return { tc: tc.anual[year], key: year, source: 'annual' };
  return null;
}

const pyFile = path.join(__dirname, '_extract_historicos.py');
const tmpJson = path.join(__dirname, '_historicos_raw.json');

fs.writeFileSync(pyFile, `
import openpyxl, json

wb = openpyxl.load_workbook('data/Data_Consolidada.xlsx', read_only=True, data_only=True)
ws = wb['histórico']

rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if row[1] is None:
        continue
    def f(v):
        try: return float(v)
        except: return 0.0
    rows.append({
        'id_simple': row[0],
        'id': row[1],
        'fecha_venta': str(row[2] or '').strip(),
        'direccion': str(row[3] or '').strip(),
        'departamento': str(row[4] or '').strip(),
        'provincia': str(row[5] or '').strip(),
        'distrito': str(row[6] or '').strip(),
        'lat': f(row[7]),
        'lng': f(row[8]),
        'descripcion': str(row[9] or '').strip(),
        'tipo': str(row[10] or '').strip(),
        'antiguedad': row[11],
        'nro_estac': row[12],
        'area': f(row[13]),
        'area_libre': f(row[14]),
        'area_ocupada': f(row[15]),
        'area_techada': f(row[16]),
        'nro_depositos': row[17],
        'moneda': str(row[18] or '').strip(),
        'valor_unitario_usd': f(row[19]),
        'precio_total_pen': f(row[20]),
        'precio_total_usd': f(row[21]),
        'precio_prop_pen': f(row[22]),
        'precio_prop_usd': f(row[23]),
        'estac1_pen': f(row[24]), 'estac1_usd': f(row[25]),
        'estac2_pen': f(row[26]), 'estac2_usd': f(row[27]),
        'estac3_pen': f(row[28]), 'estac3_usd': f(row[29]),
        'estac4_pen': f(row[30]), 'estac4_usd': f(row[31]),
        'dep1_pen': f(row[32]), 'dep1_usd': f(row[33]),
        'dep2_pen': f(row[34]), 'dep2_usd': f(row[35]),
        'dep3_pen': f(row[36]), 'dep3_usd': f(row[37]),
        'dep4_pen': f(row[38]), 'dep4_usd': f(row[39]),
    })

wb.close()
with open('${tmpJson.replace(/\\/g, '/')}', 'w') as fp:
    json.dump(rows, fp)
print(f'Wrote {len(rows)} rows')
`);

console.log('Extracting históricos from Data_Consolidada.xlsx...');
execSync(`python3 ${pyFile}`, {
  maxBuffer: 50 * 1024 * 1024,
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});
const rawJson = fs.readFileSync(tmpJson, 'utf8');
fs.unlinkSync(pyFile);
fs.unlinkSync(tmpJson);

const rows = JSON.parse(rawJson);
console.log(`Extracted ${rows.length} históricos from Excel`);

let converted = 0;
let alreadyUSD = 0;
let noTC = 0;

const output = [];

for (const r of rows) {
  const isPEN = r.moneda === 'Soles Peruanos';
  const isUSD = r.moneda === 'Dólares Americanos';

  let precio_total_usd, precio_prop_usd;
  let estac_usd = [], dep_usd = [];
  let tc_used = null;
  let tc_source = null;

  if (isUSD) {
    alreadyUSD++;
    precio_total_usd = r.precio_total_usd;
    precio_prop_usd = r.precio_prop_usd;
    estac_usd = [r.estac1_usd, r.estac2_usd, r.estac3_usd, r.estac4_usd];
    dep_usd = [r.dep1_usd, r.dep2_usd, r.dep3_usd, r.dep4_usd];
  } else if (isPEN) {
    const tcInfo = getTC(r.fecha_venta);
    if (tcInfo) {
      converted++;
      tc_used = tcInfo.tc;
      tc_source = tcInfo.source;
      precio_total_usd = Math.round(r.precio_total_pen / tc_used * 100) / 100;
      precio_prop_usd = Math.round(r.precio_prop_pen / tc_used * 100) / 100;
      estac_usd = [r.estac1_pen, r.estac2_pen, r.estac3_pen, r.estac4_pen].map(v =>
        v > 0 ? Math.round(v / tc_used * 100) / 100 : 0
      );
      dep_usd = [r.dep1_pen, r.dep2_pen, r.dep3_pen, r.dep4_pen].map(v =>
        v > 0 ? Math.round(v / tc_used * 100) / 100 : 0
      );
    } else {
      noTC++;
      precio_total_usd = 0;
      precio_prop_usd = 0;
      estac_usd = [0, 0, 0, 0];
      dep_usd = [0, 0, 0, 0];
    }
  }

  const nEstac = [estac_usd[0], estac_usd[1], estac_usd[2], estac_usd[3]].filter(v => v > 0).length;
  const nDep = [dep_usd[0], dep_usd[1], dep_usd[2], dep_usd[3]].filter(v => v > 0).length;
  const areaPricing = r.area_ocupada > 0 ? r.area_ocupada : (r.area_techada > 0 ? r.area_techada : r.area);
  const precioM2 = (areaPricing > 0 && precio_prop_usd > 0)
    ? Math.round(precio_prop_usd / areaPricing * 100) / 100
    : null;

  output.push({
    id: r.id,
    fecha_venta: r.fecha_venta,
    distrito: r.distrito,
    departamento: r.departamento,
    provincia: r.provincia,
    tipo: r.tipo,
    lat: r.lat,
    lng: r.lng,
    area: r.area,
    area_techada: r.area_techada,
    area_ocupada: r.area_ocupada,
    area_libre: r.area_libre,
    antiguedad: r.antiguedad,
    moneda_original: isPEN ? 'PEN' : 'USD',
    tc_aplicado: tc_used,
    tc_fuente: tc_source,
    precio_total_usd: precio_total_usd,
    precio_prop_usd: precio_prop_usd,
    precio_m2_usd: precioM2,
    valor_unitario_terreno_usd: r.valor_unitario_usd,
    estacionamientos: nEstac,
    estac_valores_usd: estac_usd.filter(v => v > 0),
    depositos: nDep,
    dep_valores_usd: dep_usd.filter(v => v > 0),
  });
}

const result = {
  metadata: {
    generado: new Date().toISOString().slice(0, 10),
    fuente: 'Data_Consolidada.xlsx (hoja histórico)',
    total: output.length,
    moneda_original_usd: alreadyUSD,
    convertidos_pen_a_usd: converted,
    sin_tipo_cambio: noTC,
    tc_fuente: 'BCRP - Tipo de cambio bancario promedio venta mensual',
    tc_archivo: 'data/tc_pen_usd_bcrp.json',
  },
  historicos: output,
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result));
console.log(`\n═══ HISTORICOS ENRICHMENT ═══`);
console.log(`✓ Total: ${output.length}`);
console.log(`✓ Already USD: ${alreadyUSD}`);
console.log(`✓ Converted PEN→USD: ${converted}`);
console.log(`✓ No exchange rate found: ${noTC}`);
console.log(`✓ With precio_m2: ${output.filter(o => o.precio_m2_usd).length}`);
console.log(`✓ Wrote ${OUTPUT_PATH}`);
