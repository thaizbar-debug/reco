const { test, expect } = require('@playwright/test');

test.describe('PR A: Carga masiva — esquema de 30 columnas', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
  });

  // ── Template columns ────────────────────────────────────────────
  test('_PUB_TPL_COLS has exactly 31 entries (30 columns)', async ({ page }) => {
    const cols = await page.evaluate(() => _PUB_TPL_COLS);
    expect(cols).toHaveLength(31);
    expect(cols[0]).toBe('direccion');
    expect(cols[1]).toBe('departamento');
    expect(cols[2]).toBe('provincia');
    expect(cols[3]).toBe('distrito');
    expect(cols[29]).toBe('titulo');
    expect(cols[30]).toBe('descripcion');
  });

  test('template includes departamento and provincia columns', async ({ page }) => {
    const cols = await page.evaluate(() => _PUB_TPL_COLS);
    expect(cols).toContain('departamento');
    expect(cols).toContain('provincia');
  });

  test('template help mentions departamento/provincia are geocoding only', async ({ page }) => {
    const help = await page.evaluate(() => _PUB_TPL_HELP);
    const deptoHelp = help.find(h => h[0] === 'departamento');
    const provHelp = help.find(h => h[0] === 'provincia');
    expect(deptoHelp[3]).toContain('no se guarda como dato aparte');
    expect(provHelp[3]).toContain('no se guarda como dato aparte');
  });

  // ── Boolean parsing ──────────────────────────────────────────────
  test('_pubParseBool handles Sí/No/Verdadero/Falso/1/0', async ({ page }) => {
    const results = await page.evaluate(() => [
      _pubParseBool('Sí'),
      _pubParseBool('sí'),
      _pubParseBool('si'),
      _pubParseBool('Yes'),
      _pubParseBool('true'),
      _pubParseBool('Verdadero'),
      _pubParseBool('1'),
      _pubParseBool(1),
      _pubParseBool('No'),
      _pubParseBool('false'),
      _pubParseBool('0'),
      _pubParseBool(0),
      _pubParseBool(''),
      _pubParseBool(null),
    ]);
    expect(results).toEqual([
      true, true, true, true, true, true, true, true,
      false, false, false, false, false, false,
    ]);
  });

  test('_pubParseBoolInvert inverts: mostrar_direccion=No → hideExact=true', async ({ page }) => {
    const results = await page.evaluate(() => [
      _pubParseBoolInvert('No'),
      _pubParseBoolInvert('Sí'),
      _pubParseBoolInvert(''),
    ]);
    expect(results).toEqual([true, false, false]);
  });

  // ── Tag parsing ──────────────────────────────────────────────────
  test('_pubParseTagCol validates tags against correct group', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubParseTagCol('Piscina propia;Terraza propia;Balcón', _PUB_FEATS_GEN);
    });
    expect(result.tags).toContain('Piscina propia');
    expect(result.tags).toContain('Terraza propia');
    expect(result.tags).toContain('Balcón');
    expect(result.warnings).toHaveLength(0);
  });

  test('_pubParseTagCol maps legacy tags', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubParseTagCol('Jardín;Piscina;Terraza', _PUB_FEATS_GEN);
    });
    expect(result.tags).toContain('Jardín propio');
    expect(result.tags).toContain('Piscina propia');
    expect(result.tags).toContain('Terraza propia');
  });

  test('_pubParseTagCol warns when legacy tag maps to a different group', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubParseTagCol('Jardín', _PUB_FEATS_AMB);
    });
    expect(result.tags).toContain('Jardín propio');
    expect(result.warnings.some(w => w.includes('grupo incorrecto'))).toBe(true);
  });

  test('_pubParseTagCol warns on unrecognized tags without blocking', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubParseTagCol('Balcón;InventedTag;AnotherFake', _PUB_FEATS_GEN);
    });
    expect(result.tags).toEqual(['Balcón']);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('InventedTag');
    expect(result.warnings[1]).toContain('AnotherFake');
  });

  // ── Coordinate validation ────────────────────────────────────────
  test('_pubValidateCoords warns for coordinates far from Peru', async ({ page }) => {
    const warns = await page.evaluate(() => _pubValidateCoords(40.7, -74.0));
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain('lejos de Perú');
  });

  test('_pubValidateCoords does not warn for Lima coordinates', async ({ page }) => {
    const warns = await page.evaluate(() => _pubValidateCoords(-12.05, -77.03));
    expect(warns).toHaveLength(0);
  });

  // ── Row validation ───────────────────────────────────────────────
  test('_pubBulkValidateRow validates required fields', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkValidateRow({
        direccion:'', distrito:'Miraflores', titulo:'Test', descripcion:'Desc',
        precio:'0', area_techada:'90', tipo_propiedad:'Departamento',
        tipo_publicacion:'Venta', tipo_moneda:'USD'
      });
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('dirección'))).toBe(true);
    expect(result.errors.some(e => e.includes('precio'))).toBe(true);
  });

  test('_pubBulkValidateRow warns for floor height inconsistency', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkValidateRow({
        direccion:'Av Test 1', distrito:'Miraflores', titulo:'Test',
        descripcion:'Desc', precio:'100000', area_techada:'90',
        tipo_propiedad:'Departamento', tipo_publicacion:'Venta', tipo_moneda:'USD',
        piso:'9', niveles:'3', nro_pisos:'10'
      });
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('supera la altura'))).toBe(true);
  });

  // ── Row to pub data (Firestore document) ─────────────────────────
  test('_pubBulkRowToPubData does NOT include departamento or provincia', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkRowToPubData({
        direccion:'Av Larco 1150', departamento:'Lima', provincia:'Lima',
        distrito:'Miraflores', latitud:'-12.1195', longitud:'-77.0305',
        mostrar_direccion:'Sí', tipo_publicacion:'Venta',
        tipo_propiedad:'Departamento', nro_dormitorios:'3', nro_banos:'2',
        nro_estacionamientos:'1', nro_pisos:'15', piso:'8', niveles:'2',
        antiguedad:'5', estado:'Construido', ascensor:'No', amoblado:'No',
        pet_friendly:'Sí', tipo_moneda:'USD', precio:'185000',
        area_terreno:'0', area_techada:'85',
        etiquetas_generales:'Balcón;Terraza propia',
        etiquetas_ambientes:'Gimnasio',
        etiquetas_vista:'Vista a parque',
        etiquetas_acceso:'Avenida',
        etiquetas_zonas:'Residencial',
        titulo:'Depto moderno', descripcion:'Gran departamento'
      });
    });
    expect(result).not.toHaveProperty('departamento');
    expect(result).not.toHaveProperty('provincia');
    expect(Object.keys(result)).not.toContain('departamento');
    expect(Object.keys(result)).not.toContain('provincia');
  });

  test('_pubBulkRowToPubData passes through lat/lng when provided', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkRowToPubData({
        direccion:'Av Larco 1150', departamento:'Lima', provincia:'Lima',
        distrito:'Miraflores', latitud:'-12.1195', longitud:'-77.0305',
        mostrar_direccion:'Sí', tipo_publicacion:'Venta',
        tipo_propiedad:'Departamento', nro_dormitorios:'3', nro_banos:'2',
        nro_estacionamientos:'1', nro_pisos:'15', piso:'8', niveles:'1',
        antiguedad:'5', estado:'Construido', ascensor:'No', amoblado:'No',
        pet_friendly:'No', tipo_moneda:'USD', precio:'185000',
        area_terreno:'0', area_techada:'85',
        etiquetas_generales:'', etiquetas_ambientes:'',
        etiquetas_vista:'', etiquetas_acceso:'', etiquetas_zonas:'',
        titulo:'Depto moderno', descripcion:'Gran departamento'
      });
    });
    expect(result.lat).toBeCloseTo(-12.1195, 4);
    expect(result.lng).toBeCloseTo(-77.0305, 4);
  });

  test('_pubBulkRowToPubData converts mostrar_direccion=No to hideExact=true', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkRowToPubData({
        direccion:'Av Test', distrito:'Miraflores', titulo:'T', descripcion:'D',
        precio:'100000', area_techada:'90', tipo_propiedad:'Departamento',
        tipo_publicacion:'Venta', tipo_moneda:'USD', mostrar_direccion:'No',
        niveles:'1', etiquetas_generales:'', etiquetas_ambientes:'',
        etiquetas_vista:'', etiquetas_acceso:'', etiquetas_zonas:''
      });
    });
    expect(result.hideExact).toBe(true);
  });

  test('_pubBulkRowToPubData converts niveles to unitFloors', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkRowToPubData({
        direccion:'Av Test', distrito:'Miraflores', titulo:'T', descripcion:'D',
        precio:'100000', area_techada:'90', tipo_propiedad:'Departamento',
        tipo_publicacion:'Venta', tipo_moneda:'USD', mostrar_direccion:'Sí',
        niveles:'3', piso:'5', nro_pisos:'20',
        etiquetas_generales:'', etiquetas_ambientes:'',
        etiquetas_vista:'', etiquetas_acceso:'', etiquetas_zonas:''
      });
    });
    expect(result.unitFloors).toBe(3);
    expect(result.features).toContain('Tríplex');
  });

  test('_pubBulkRowToPubData parses boolean fields correctly', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkRowToPubData({
        direccion:'Av Test', distrito:'Miraflores', titulo:'T', descripcion:'D',
        precio:'100000', area_techada:'90', tipo_propiedad:'Casa',
        tipo_publicacion:'Alquiler', tipo_moneda:'PEN', mostrar_direccion:'Sí',
        niveles:'1', ascensor:'Sí', amoblado:'Verdadero', pet_friendly:'1',
        etiquetas_generales:'', etiquetas_ambientes:'',
        etiquetas_vista:'', etiquetas_acceso:'', etiquetas_zonas:''
      });
    });
    expect(result.ascensor).toBe(true);
    expect(result.amoblado).toBe(true);
    expect(result.petFriendly).toBe(true);
  });

  test('_pubBulkRowToPubData merges all 5 tag groups into features', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkRowToPubData({
        direccion:'Av Test', distrito:'Miraflores', titulo:'T', descripcion:'D',
        precio:'100000', area_techada:'90', tipo_propiedad:'Departamento',
        tipo_publicacion:'Venta', tipo_moneda:'USD', mostrar_direccion:'Sí',
        niveles:'1',
        etiquetas_generales:'Balcón;Piscina propia',
        etiquetas_ambientes:'Gimnasio;Piscina del edificio',
        etiquetas_vista:'Vista al mar',
        etiquetas_acceso:'Avenida',
        etiquetas_zonas:'Residencial'
      });
    });
    expect(result.features).toContain('Balcón');
    expect(result.features).toContain('Piscina propia');
    expect(result.features).toContain('Gimnasio');
    expect(result.features).toContain('Piscina del edificio');
    expect(result.features).toContain('Vista al mar');
    expect(result.features).toContain('Avenida');
    expect(result.features).toContain('Residencial');
  });

  test('_pubBulkRowToPubData defaults niveles to 1 and estado to Construido', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkRowToPubData({
        direccion:'Av Test', distrito:'Miraflores', titulo:'T', descripcion:'D',
        precio:'100000', area_techada:'90', tipo_propiedad:'Departamento',
        tipo_publicacion:'Venta', tipo_moneda:'USD', mostrar_direccion:'',
        niveles:'', estado:'',
        etiquetas_generales:'', etiquetas_ambientes:'',
        etiquetas_vista:'', etiquetas_acceso:'', etiquetas_zonas:''
      });
    });
    expect(result.unitFloors).toBe(1);
    expect(result.estado).toBe('Construido');
  });

  // ── Column mapping (MEJ-02) ──────────────────────────────────────
  test('_pubBulkGuessMap maps synonym headers to canonical keys', async ({ page }) => {
    const map = await page.evaluate(() => {
      return _pubBulkGuessMap([
        'dir','zona','operación','category','divisa','valor','m2',
        'habitaciones','baño','cochera','floor','pisos','años',
        'nombre','detalle','depto','province','lat','lon',
        'mostrar direccion','elevator','amueblado','mascotas',
        'status','terreno','tags generales','tags ambientes',
        'tags vista','tags acceso','tags zonas'
      ]);
    });
    expect(map.direccion).toBe('dir');
    expect(map.distrito).toBe('zona');
    expect(map.tipo_publicacion).toBe('operación');
    expect(map.titulo).toBe('nombre');
    expect(map.descripcion).toBe('detalle');
  });

  test('_pubBulkNeedsMapping detects non-template headers', async ({ page }) => {
    const needs = await page.evaluate(() => {
      return _pubBulkNeedsMapping(['address','zone','price','sqm','title','desc']);
    });
    expect(needs).toBe(true);
  });

  test('_pubBulkNeedsMapping returns false for template headers', async ({ page }) => {
    const needs = await page.evaluate(() => {
      return _pubBulkNeedsMapping(_PUB_TPL_COLS);
    });
    expect(needs).toBe(false);
  });

  // ── CSV parser (BUG-15) ──────────────────────────────────────────
  test('_pubParseCSV handles semicolon-separated CSV with BOM', async ({ page }) => {
    const rows = await page.evaluate(() => {
      const csv = '﻿direccion;distrito;precio\nAv Test;Miraflores;100000';
      return _pubParseCSV(csv);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].direccion).toBe('Av Test');
    expect(rows[0].distrito).toBe('Miraflores');
    expect(rows[0].precio).toBe('100000');
  });

  test('_pubParseCSV handles comma-separated CSV', async ({ page }) => {
    const rows = await page.evaluate(() => {
      const csv = 'direccion,distrito,precio\nAv Test,Miraflores,100000';
      return _pubParseCSV(csv);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].direccion).toBe('Av Test');
    expect(rows[0].distrito).toBe('Miraflores');
  });

  test('_pubParseCSV strips sep= header line', async ({ page }) => {
    const rows = await page.evaluate(() => {
      const csv = 'sep=;\ndireccion;distrito;precio\nAv Test;Miraflores;100000';
      return _pubParseCSV(csv);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].direccion).toBe('Av Test');
  });

  // ── Wizard steps ─────────────────────────────────────────────────
  test('_PUB_BULK_STEPS has 4 steps', async ({ page }) => {
    const steps = await page.evaluate(() => _PUB_BULK_STEPS);
    expect(steps).toHaveLength(4);
  });

  test('_pubBulkStepNum returns 1 for map step', async ({ page }) => {
    const num = await page.evaluate(() => {
      _pubBulkStep = 'map';
      return _pubBulkStepNum();
    });
    expect(num).toBe(1);
  });

  // ── Valores estándar: sinónimos, abreviaturas, estado y antigüedad ──
  test('RecoCatalogo (functions/shared/catalogo.js) se carga y coincide con las listas de la página', async ({ page }) => {
    const r = await page.evaluate(() => ({
      t: typeof RecoCatalogo,
      same: [
        [_PUB_BULK_TYPES, RecoCatalogo.TYPES], [_PUB_BULK_OPS, RecoCatalogo.OPS],
        [_PUB_BULK_CURRENCIES, RecoCatalogo.CURRENCIES], [_PUB_BULK_ESTADOS, RecoCatalogo.ESTADOS],
      ].every(([a, b]) => JSON.stringify(a) === JSON.stringify(b)),
      sinAnt: RecoCatalogo.ESTADOS.filter(_pubSinAntiguedad),
    }));
    expect(r.t).toBe('object');
    expect(r.same).toBe(true);
    expect(r.sinAnt).toEqual(['En proyecto', 'En construcción']);
  });

  const base = { direccion: 'A 1', distrito: 'Lince', precio: '1', area_techada: '1', titulo: 't', descripcion: 'd' };

  test('_pubBulkStandardize: sinónimos y abreviaturas a valores estándar', async ({ page }) => {
    const row = await page.evaluate((b) => _pubBulkStandardize({ ...b,
      tipo_propiedad: 'Dpto.', tipo_publicacion: 'Vta.', tipo_moneda: 'U$S', estado: 'E/C', antiguedad: '4',
      ascensor: 'x', amoblado: 'si', pet_friendly: 'NO', mostrar_direccion: 'Depende',
    }).row, base);
    expect(row.tipo_propiedad).toBe('Departamento');
    expect(row.tipo_publicacion).toBe('Venta');
    expect(row.tipo_moneda).toBe('USD');
    expect(row.estado).toBe('En construcción');
    expect(row.antiguedad).toBe('0');
    expect(row.ascensor).toBe('Sí');
    expect(row.amoblado).toBe('Sí');
    expect(row.pet_friendly).toBe('No');
    expect(row.mostrar_direccion).toBe('Depende'); // no reconocido: se deja tal cual
  });

  test('_pubBulkStandardize: estado escrito en la columna antigüedad', async ({ page }) => {
    const rows = await page.evaluate((b) => [
      _pubBulkStandardize({ ...b, estado: '', antiguedad: 'En planos' }).row,
      _pubBulkStandardize({ ...b, estado: '', antiguedad: 'A estrenar' }).row,
      _pubBulkStandardize({ ...b, estado: '', antiguedad: '2015' }).row,
      _pubBulkStandardize({ ...b, estado: '', antiguedad: '' }).row,
    ], base);
    expect([rows[0].estado, rows[0].antiguedad]).toEqual(['En proyecto', '0']);
    expect([rows[1].estado, rows[1].antiguedad]).toEqual(['', '0']);
    expect(rows[2].estado).toBe('');
    expect(Number(rows[2].antiguedad)).toBe(new Date().getFullYear() - 2015);
    expect([rows[3].estado, rows[3].antiguedad]).toEqual(['', '']);
  });

  test('plantilla estándar: "venta", "dpto", "S/" ya no dan error', async ({ page }) => {
    const r = await page.evaluate((b) => {
      _pubBulkLoadRows([{ ...b, tipo_publicacion: 'venta', tipo_propiedad: 'dpto', tipo_moneda: 'S/', estado: 'Preventa', antiguedad: '7' }]);
      const a = _pubBulkRows[0];
      return { valid: a.valid, errors: a.errors, warnings: a.warnings, row: a.row, pub: _pubBulkRowToPubData(a.row) };
    }, base);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.row.tipo_publicacion).toBe('Venta');
    expect(r.row.tipo_propiedad).toBe('Departamento');
    expect(r.row.tipo_moneda).toBe('PEN');
    expect(r.pub.estado).toBe('En proyecto');
    expect(r.pub.age).toBe(0);
    expect(r.pub.currency).toBe('PEN');
    expect(r.warnings.join(' ')).toContain('se publicará como 0');
  });

  test('_pubBulkRowToPubData: En planos / En construcción → antigüedad 0', async ({ page }) => {
    const d = await page.evaluate((b) => [
      _pubBulkRowToPubData({ ...b, estado: 'En planos', antiguedad: '7' }),
      _pubBulkRowToPubData({ ...b, estado: 'En construcción', antiguedad: '3' }),
      _pubBulkRowToPubData({ ...b, estado: 'Construido', antiguedad: '3' }),
    ], base);
    expect([d[0].estado, d[0].age]).toEqual(['En proyecto', 0]);
    expect([d[1].estado, d[1].age]).toEqual(['En construcción', 0]);
    expect([d[2].estado, d[2].age]).toEqual(['Construido', 3]);
  });

  test('_pubBulkValidateRow avisa estado no reconocido y antigüedad forzada a 0', async ({ page }) => {
    const w = await page.evaluate((b) => [
      _pubBulkValidateRow({ ...b, estado: 'Bueno' }),
      _pubBulkValidateRow({ ...b, estado: 'En planos', antiguedad: '3' }),
      _pubBulkValidateRow({ ...b, estado: 'Construido', antiguedad: '3' }),
      _pubBulkValidateRow({ ...b, tipo_propiedad: 'Planeta' }),
    ], base);
    expect(w[0].valid).toBe(true);
    expect(w[0].warnings.join(' ')).toContain('Estado no reconocido');
    expect(w[1].warnings.join(' ')).toContain('se publicará como 0');
    expect(w[2].warnings).toEqual([]);
    expect(w[3].valid).toBe(false);
  });

  test('plantilla documenta sinónimos y la regla de antigüedad', async ({ page }) => {
    const h = await page.evaluate(() => Object.fromEntries(_PUB_TPL_HELP.map(x => [x[0], x])));
    expect(h.estado[2]).toBe('Construido / En proyecto / En construcción');
    expect(h.estado[3]).toContain('En planos');
    expect(h.estado[3]).toContain('E/C');
    expect(h.antiguedad[3]).toContain('En construcción');
    expect(h.tipo_propiedad[3]).toContain('Dpto.');
  });

  test('formulario individual: En proyecto y En construcción fijan antigüedad 0', async ({ page }) => {
    const r = await page.evaluate(() => {
      _pd = { age: 12, estado: 'Construido' };
      document.body.insertAdjacentHTML('beforeend', '<input id="pubAgeInput" value="12">');
      const inp = document.getElementById('pubAgeInput');
      const out = {};
      _pubSetEstado('En proyecto');
      out.proy = { age: _pd.age, val: inp.value, disabled: inp.disabled };
      _pubSetEstado('Construido');
      out.cons = inp.disabled;
      _pd.age = 9;
      _pubSetEstado('En construcción');
      out.obra = { age: _pd.age, val: inp.value, disabled: inp.disabled };
      return out;
    });
    expect(r.proy).toEqual({ age: 0, val: '0', disabled: true });
    expect(r.cons).toBe(false);
    expect(r.obra).toEqual({ age: 0, val: '0', disabled: true });
  });

  // ── Photo assistant (MEJ-01) ─────────────────────────────────────
  test('_PUB_BULK_PHOTO_MAX is 12', async ({ page }) => {
    const max = await page.evaluate(() => _PUB_BULK_PHOTO_MAX);
    expect(max).toBe(12);
  });
});
