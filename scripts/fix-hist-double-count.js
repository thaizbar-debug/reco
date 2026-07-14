#!/usr/bin/env node
// Corrige el bug de double-count en los precios de inmuebles Históricos.
//
// Contexto:
// Para ~415 inmuebles Históricos, p.price en properties.json guarda el
// TOTAL de la transacción (propiedad + estacionamientos + depósitos),
// no solo el precio de la propiedad. Como strip-premium.js precomputa
// priceTotal = p.price + sum(estacVals) + sum(depVals), los extras se
// suman dos veces y el card muestra un total inflado.
//
// Fuente de verdad: data/Data_Consolidada.xlsx hoja "histórico",
// columnas "precio propiedad", "precio estacionamiento N", "precio
// depósito N" (en la moneda indicada por "tipo moneda"). El Excel
// refleja los PDFs de partidas registrales.
//
// Este script:
//   1) Detecta los casos de double-count claro
//      (p.price == propiedad_Excel + sum(estac_Excel) + sum(dep_Excel))
//   2) Reescribe p.price ← precio propiedad del Excel
//   3) Recomputa priceTotal y priceProp
//   4) Lista los casos "raros" que no siguen el patrón, sin tocarlos
//
// Uso:
//   node scripts/fix-hist-double-count.js           # dry-run, no escribe
//   node scripts/fix-hist-double-count.js --write   # aplica cambios

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const JSON_PATH = path.join(REPO, 'data', 'properties.json');
const XLSX_PATH = path.join(REPO, 'data', 'Data_Consolidada.xlsx');
const WRITE = process.argv.includes('--write');

// Usamos python + openpyxl para leer el Excel: es la vía más simple sin
// agregar dependencias npm. El script escupe JSON por stdout.
const { execFileSync } = require('node:child_process');
const PY = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(r"${XLSX_PATH}", data_only=True)
ws = wb["histórico"]
rows = list(ws.iter_rows(values_only=True))
hdr = rows[0]
COL = {name: i for i, name in enumerate(hdr)}
def num(v):
    try: return float(v) if v is not None else 0.0
    except: return 0.0
out = []
for row in rows[1:]:
    rid = row[COL["id"]]
    if not rid: continue
    cur_lbl = row[COL["tipo moneda"]] or ""
    is_usd = "Dólares" in cur_lbl
    is_pen = "Soles" in cur_lbl
    if not (is_usd or is_pen): continue
    suffix = "dólares" if is_usd else "soles"
    prop = num(row[COL[f"precio propiedad {suffix}"]])
    total = num(row[COL[f"precio total {suffix}"]])
    est = [num(row[COL[f"precio estacionamiento {i} {suffix}"]]) for i in (1,2,3,4)]
    dep = [num(row[COL[f"precio depósito {i} {suffix}"]]) for i in (1,2,3,4)]
    out.append({"id": rid, "cur": "$" if is_usd else "S/",
                "prop": prop, "total": total,
                "est_sum": sum(est), "dep_sum": sum(dep)})
json.dump(out, sys.stdout)
`;
const excelRows = JSON.parse(execFileSync('python3', ['-c', PY]).toString());
const excelById = new Map(excelRows.map((r) => [r.id, r]));

const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const properties = Array.isArray(raw.properties) ? raw.properties : [];

let fixed = 0;
let alreadyOk = 0;
const raros = [];
const excelZero = [];

for (const p of properties) {
  if (p.op !== 'Histórico') continue;
  const ex = excelById.get(p.id);
  if (!ex) continue;

  const expectedTotal = ex.prop + ex.est_sum + ex.dep_sum;
  const currentPrice = Number(p.price) || 0;

  // Excel sin datos: no verificable, saltamos.
  if (expectedTotal === 0) {
    excelZero.push(p.id);
    continue;
  }

  // Caso ya correcto: p.price == propiedad del Excel (no double-count).
  if (Math.abs(currentPrice - ex.prop) < 1) {
    alreadyOk++;
    continue;
  }

  // Caso double-count claro: p.price == propiedad + extras del Excel.
  if (Math.abs(currentPrice - expectedTotal) < 1) {
    // Fix: p.price ← propiedad. priceTotal y priceProp se recomputan.
    p.price = ex.prop;
    p.priceProp = ex.prop;
    p.priceTotal = expectedTotal;
    fixed++;
    continue;
  }

  // Caso raro: no cuadra ni con propiedad ni con total. No tocamos.
  raros.push({
    id: p.id,
    cur: ex.cur,
    p_price: currentPrice,
    excel_prop: ex.prop,
    excel_total: expectedTotal,
    excel_est: ex.est_sum,
    excel_dep: ex.dep_sum,
    diff_vs_prop: currentPrice - ex.prop,
    diff_vs_total: currentPrice - expectedTotal,
  });
}

console.log(`\n═══ Resumen ═══`);
console.log(`Ya correctos (p.price == propiedad Excel):  ${alreadyOk}`);
console.log(`Corregidos (double-count claro):            ${fixed}`);
console.log(`Excel sin precio, saltados:                 ${excelZero.length}`);
console.log(`Casos raros para revisar a mano:            ${raros.length}`);

if (raros.length) {
  console.log(`\n── Casos raros ──`);
  for (const r of raros) {
    console.log(`  ${r.id}  ${r.cur}  p.price=${r.p_price.toLocaleString()}  ` +
      `excel_prop=${r.excel_prop.toLocaleString()}  excel_total=${r.excel_total.toLocaleString()}  ` +
      `(diff vs prop: ${r.diff_vs_prop.toLocaleString()}, vs total: ${r.diff_vs_total.toLocaleString()})`);
  }
}

if (WRITE) {
  fs.writeFileSync(JSON_PATH, JSON.stringify(raw));
  console.log(`\n✓ Escritos ${fixed} cambios a ${JSON_PATH}`);
} else {
  console.log(`\n(dry-run — corre con --write para aplicar)`);
}
