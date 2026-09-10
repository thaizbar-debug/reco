const { test, expect } = require('@playwright/test');

test.describe('MEJ-05: Campos de pisos', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
  });

  test('publish form renders 3 floor fields when type is Departamento', async ({ page }) => {
    await page.evaluate(() => {
      _pd.type = 'Departamento';
      renderPublish();
    });
    const html = await page.evaluate(() => document.getElementById('vPublish').innerHTML);
    expect(html).toContain('Piso en el que está');
    expect(html).toContain('Niveles que ocupa');
    expect(html).toContain('Pisos del edificio');
  });

  test('_pd initializes unitFloors to 1', async ({ page }) => {
    const unitFloors = await page.evaluate(() => {
      return typeof _pd !== 'undefined' ? _pd.unitFloors : undefined;
    });
    expect(unitFloors).toBe(1);
  });

  test('_pubFloorsText returns correct text for duplex', async ({ page }) => {
    const text = await page.evaluate(() => {
      if(typeof _pd==='undefined') return 'no _pd';
      _pd.floor=6; _pd.unitFloors=2; _pd.floors=10;
      return typeof _pubFloorsText==='function' ? _pubFloorsText() : 'no fn';
    });
    expect(text).toContain('Ocupa 2 niveles');
    expect(text).toContain('pisos 6 al 7');
    expect(text).toContain('edificio de 10 pisos');
  });

  test('_pubFloorsText warns when floors exceed building height', async ({ page }) => {
    const text = await page.evaluate(() => {
      _pd.floor=9; _pd.unitFloors=3; _pd.floors=10;
      return _pubFloorsText();
    });
    expect(text).toContain('Revisa: supera la altura del edificio');
  });

  test('_pubLevelTag returns Dúplex for unitFloors=2', async ({ page }) => {
    const tag = await page.evaluate(() => {
      _pd.unitFloors=2;
      return typeof _pubLevelTag==='function' ? _pubLevelTag() : 'no fn';
    });
    expect(tag).toBe('Dúplex');
  });

  test('_pubLevelTag returns Tríplex for unitFloors=3', async ({ page }) => {
    const tag = await page.evaluate(() => {
      _pd.unitFloors=3;
      return _pubLevelTag();
    });
    expect(tag).toBe('Tríplex');
  });

  test('_pubLevelTag returns empty for unitFloors=1', async ({ page }) => {
    const tag = await page.evaluate(() => {
      _pd.unitFloors=1;
      return _pubLevelTag();
    });
    expect(tag).toBe('');
  });
});

test.describe('MEJ-06: Legacy tag mapping', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
  });

  test('_PUB_FEAT_LEGACY_MAP maps old tags to new', async ({ page }) => {
    const map = await page.evaluate(() => _PUB_FEAT_LEGACY_MAP);
    expect(map['Jardín']).toBe('Jardín propio');
    expect(map['Piscina']).toBe('Piscina propia');
    expect(map['Terraza']).toBe('Terraza propia');
    expect(map['Área de cafetería']).toBe('Cafetería del edificio');
    expect(map['Vista interior']).toBe('Vista a área interior');
    expect(map['Privado']).toBe('Vía privada');
  });

  test('_PUB_FEATS includes both legacy and new names', async ({ page }) => {
    const feats = await page.evaluate(() => _PUB_FEATS);
    expect(feats).toContain('Jardín propio');
    expect(feats).toContain('Jardín');
    expect(feats).toContain('Piscina propia');
    expect(feats).toContain('Piscina');
  });

  test('getFiltered matches property with legacy tag when filtering by canonical name', async ({ page }) => {
    const matched = await page.evaluate(() => {
      const saved = properties.slice();
      const savedFeatures = S.features.slice();
      const savedMapMode = S.mapMode;
      try {
        properties.length = 0;
        properties.push({id:'__t__', op:'Venta', type:'Departamento', price:100000, area:80,
          beds:2, baths:2, parking:0, floor:0, floors:0, unitFloors:1, age:5,
          bank:false, isNew:false, features:['Piscina'], photoUrls:['fake']});
        Object.assign(S, {op:'Venta', type:'all', bankOnly:false, minPrice:0, maxPrice:Infinity,
          minArea:0, minAreaTerr:0, beds:0, baths:0, minPark:0, minFloors:0, minFloor:0,
          maxAge:Infinity, minSqm:0, maxSqm:Infinity, query:'', radiusCenter:null,
          polyFinished:false, commute:null, mapMode:'text', features:['Piscina propia']});
        return getFiltered().some(p => p.id === '__t__');
      } finally {
        properties.length = 0;
        saved.forEach(p => properties.push(p));
        S.features = savedFeatures;
        S.mapMode = savedMapMode;
      }
    });
    expect(matched).toBe(true);
  });

  test('bulk row converter maps legacy tags and adds level tag', async ({ page }) => {
    const result = await page.evaluate(() => {
      return _pubBulkRowToPubData({
        direccion:'Av Test 1', distrito:'Miraflores',
        tipo_propiedad:'Departamento', tipo_publicacion:'Venta', tipo_moneda:'USD',
        precio:'200000', area_techada:'90',
        nro_dormitorios:'3', nro_banos:'2', nro_estacionamientos:'1',
        piso:'6', niveles:'2', nro_pisos:'10',
        antiguedad:'3', titulo:'Test', descripcion:'Desc',
        mostrar_direccion:'Sí',
        etiquetas_generales:'Jardín;Piscina;Terraza',
        etiquetas_ambientes:'', etiquetas_vista:'',
        etiquetas_acceso:'', etiquetas_zonas:''
      });
    });
    expect(result.unitFloors).toBe(2);
    expect(result.features).toContain('Jardín propio');
    expect(result.features).toContain('Piscina propia');
    expect(result.features).toContain('Terraza propia');
    expect(result.features).toContain('Dúplex');
    expect(result.features).not.toContain('Jardín');
  });
});
