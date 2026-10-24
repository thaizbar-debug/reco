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

  // ── Estado: "En planos" = "En proyecto", antigüedad 0 ─────────────
  test('_pubBulkEstado acepta En planos / preventa como En proyecto', async ({ page }) => {
    const r = await page.evaluate(() => [
      _pubBulkEstado('En planos'), _pubBulkEstado('en proyecto'), _pubBulkEstado('Preventa'),
      _pubBulkEstado('En construcción'), _pubBulkEstado('Construido'), _pubBulkEstado('Estreno'),
      _pubBulkEstado(''), _pubBulkEstado('Bueno'),
    ]);
    expect(r).toEqual(['En proyecto', 'En proyecto', 'En proyecto', 'En construcción', 'Construido', 'Construido', '', '']);
  });

  test('_pubBulkRowToPubData: En planos → En proyecto con antigüedad 0', async ({ page }) => {
    const d = await page.evaluate(() => _pubBulkRowToPubData({
      direccion: 'A 1', distrito: 'Lince', precio: '1', area_techada: '1', titulo: 't', descripcion: 'd',
      estado: 'En planos', antiguedad: '7',
    }));
    expect(d.estado).toBe('En proyecto');
    expect(d.age).toBe(0);
  });

  test('_pubBulkValidateRow avisa estado no reconocido y antigüedad en proyecto', async ({ page }) => {
    const w = await page.evaluate(() => {
      const base = { direccion: 'A 1', distrito: 'Lince', precio: '1', area_techada: '1', titulo: 't', descripcion: 'd' };
      return [
        _pubBulkValidateRow({ ...base, estado: 'Bueno' }),
        _pubBulkValidateRow({ ...base, estado: 'En planos', antiguedad: '3' }),
        _pubBulkValidateRow({ ...base, estado: 'Construido', antiguedad: '3' }),
      ];
    });
    expect(w[0].valid).toBe(true);
    expect(w[0].warnings.join(' ')).toContain('Estado no reconocido');
    expect(w[1].warnings.join(' ')).toContain('antigüedad se publicará como 0');
    expect(w[2].warnings).toEqual([]);
  });

  test('plantilla documenta En proyecto (y acepta En planos)', async ({ page }) => {
    const h = await page.evaluate(() => _PUB_TPL_HELP.find(x => x[0] === 'estado'));
    expect(h[2]).toBe('Construido / En proyecto / En construcción');
    expect(h[3]).toContain('En planos');
  });

  test('formulario individual: elegir En proyecto fija antigüedad 0', async ({ page }) => {
    const r = await page.evaluate(() => {
      _pd = { age: 12, estado: 'Construido' };
      document.body.insertAdjacentHTML('beforeend', '<input id="pubAgeInput" value="12">');
      _pubSetEstado('En proyecto');
      const inp = document.getElementById('pubAgeInput');
      const afterProj = { age: _pd.age, val: inp.value, disabled: inp.disabled };
      _pubSetEstado('Construido');
      return { afterProj, disabledAfter: inp.disabled, estado: _pd.estado };
    });
    expect(r.afterProj).toEqual({ age: 0, val: '0', disabled: true });
    expect(r.disabledAfter).toBe(false);
    expect(r.estado).toBe('Construido');
  });

  // ── Photo assistant (MEJ-01) ─────────────────────────────────────
  test('_PUB_BULK_PHOTO_MAX is 12', async ({ page }) => {
    const max = await page.evaluate(() => _PUB_BULK_PHOTO_MAX);
    expect(max).toBe(12);
  });
});
