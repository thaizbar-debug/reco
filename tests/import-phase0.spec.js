const { test, expect } = require('@playwright/test');

// Fase 0 del roadmap de carga inteligente (docs/ROADMAP-CARGA-INTELIGENTE.md):
// núcleo compartido, normalización en la bandeja, borradores y duplicados.
test.describe('Fase 0: carga inteligente — bandeja de revisión', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
    // La bandeja se pinta dentro del modal de publicación.
    await page.evaluate(() => {
      _pubTab = 'bulk';
      document.getElementById('pubOverlay').classList.add('open');
      document.getElementById('pubModal').classList.add('open');
    });
  });

  test('RecoImport (functions/shared/import-core.js) se carga en el navegador', async ({ page }) => {
    const info = await page.evaluate(() => ({
      type: typeof RecoImport,
      sameCols: JSON.stringify(RecoImport.COLS) === JSON.stringify(_PUB_TPL_COLS),
    }));
    expect(info.type).toBe('object');
    expect(info.sameCols).toBe(true);
  });

  test('las etiquetas del catálogo (IA y servidor) son las mismas que las del formulario', async ({ page }) => {
    const same = await page.evaluate(() => JSON.stringify(RecoCatalogo.ETIQUETAS) === JSON.stringify({
      etiquetas_generales: _PUB_FEATS_GEN, etiquetas_ambientes: _PUB_FEATS_AMB, etiquetas_vista: _PUB_FEATS_VISTA,
      etiquetas_acceso: _PUB_FEATS_ACCESO, etiquetas_zonas: _PUB_FEATS_ZONA }));
    expect(same).toBe(true);
  });

  test('_pubBulkLoadRows normaliza filas "sucias" antes de validar', async ({ page }) => {
    const rows = await page.evaluate(() => {
      _pubBulkFileName = 'mi-inventario.xlsx';
      _pubBulkLoadRows([{
        direccion: 'Av. Larco 1150', distrito: 'miraflores', tipo_publicacion: 'se vende',
        tipo_propiedad: 'dpto', tipo_moneda: '', precio: 'US$ 185,000', area_techada: '85 m2',
        nro_dormitorios: '3 dorm', titulo: 'Depa en Miraflores', descripcion: 'Bonito. Cel 987654321',
      }]);
      return _pubBulkRows.map(a => ({ row: a.row, valid: a.valid, notes: a.notes, source: a.source }));
    });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.valid).toBe(true);
    expect(r.source).toBe('excel');
    expect(r.row.distrito).toBe('Miraflores');
    expect(r.row.tipo_publicacion).toBe('Venta');
    expect(r.row.tipo_propiedad).toBe('Departamento');
    expect(r.row.precio).toBe('185000');
    expect(r.row.tipo_moneda).toBe('USD');
    expect(r.row.area_techada).toBe('85');
    expect(r.row.nro_dormitorios).toBe('3');
    expect(r.row.descripcion).not.toContain('987654321');
    expect(r.notes[0]).toContain('contacto');
  });

  test('bandeja: abreviaturas y En construcción → antigüedad 0, con aviso', async ({ page }) => {
    const a = await page.evaluate(() => {
      _pubBulkFileName = 'x.xlsx';
      _pubBulkLoadRows([{ direccion: 'Jr. A 1', distrito: 'sjl', tipo_publicacion: 'Vta.', tipo_propiedad: 'Dpto.',
        tipo_moneda: 'S/.', precio: '350 mil', area_techada: '70', estado: 'E/C', antiguedad: '3', titulo: 't', descripcion: 'd' }]);
      return _pubBulkRows[0];
    });
    expect(a.valid).toBe(true);
    expect([a.row.tipo_publicacion, a.row.tipo_propiedad, a.row.tipo_moneda, a.row.precio, a.row.distrito])
      .toEqual(['Venta', 'Departamento', 'PEN', '350000', 'San Juan de Lurigancho']);
    expect([a.row.estado, a.row.antiguedad]).toEqual(['En construcción', '0']);
    expect(a.warnings.join(' ')).toContain('se publicará como 0');
  });

  test('mapeo de Excel propio: "S/ 450 mil" ya no se pierde', async ({ page }) => {
    const row = await page.evaluate(() => {
      _pubBulkRaw = [{ dir: 'Jr. X 123', zona: 'Surco', valor: 'S/ 450 mil', metraje: '120,5', nombre: 'Casa', detalle: 'Casa amplia' }];
      _pubBulkHeaders = Object.keys(_pubBulkRaw[0]);
      _pubBulkMap = _pubBulkGuessMap(_pubBulkHeaders);
      _pubBulkApplyMap();
      return _pubBulkRows[0].row;
    });
    expect(row.precio).toBe('450000');
    expect(row.tipo_moneda).toBe('PEN');
    expect(row.area_techada).toBe('120.5');
    expect(row.distrito).toBe('Santiago de Surco');
  });

  test('_pubBulkSubmitPayload enlaza el borrador y conserva el canal', async ({ page }) => {
    const out = await page.evaluate(() => {
      const row = RecoImport.normalizeRow({ direccion: 'A 1', distrito: 'Lince', precio: '100000', area_techada: '50', titulo: 't', descripcion: 'd' }).row;
      const excel = _pubBulkSubmitPayload({ row, source: 'excel', draftId: 'abc123', edited: { precio: 1, titulo: 1 } });
      const text = _pubBulkSubmitPayload({ row, source: 'text', draftId: null, edited: {} });
      return { excel, text };
    });
    expect(out.excel.source).toBe('bulk');
    expect(out.excel.importDraftId).toBe('abc123');
    expect(out.excel.importEdits).toBe(2);
    expect(out.text.source).toBe('text');
    expect(out.text.importDraftId).toBeUndefined();
  });

  test('borradores de IA: celdas detectadas resaltadas hasta que se editan', async ({ page }) => {
    const res = await page.evaluate(() => {
      _pubBulkLoadDrafts([{
        id: 'd1', source: 'whatsapp',
        row: RecoImport.normalizeRow({ direccion: 'Av. Pardo 500', distrito: 'Miraflores', tipo_publicacion: 'Venta', tipo_propiedad: 'Departamento', precio: '200000', area_techada: '90', titulo: 'Depa', descripcion: 'Texto' }).row,
        aiFields: ['direccion', 'distrito', 'tipo_publicacion', 'tipo_propiedad', 'precio', 'area_techada', 'titulo', 'descripcion'],
        inferredFields: ['titulo'], edited: [], notes: ['Quitamos 1 dato de contacto de descripcion.'],
      }], { batchId: 'b1', source: 'whatsapp', sourceName: null });
      const before = {
        step: _pubBulkStep,
        name: _pubBulkFileName,
        precio: _pubBulkCellStyle(_pubBulkRows[0], 'precio', false),
        titulo: _pubBulkCellStyle(_pubBulkRows[0], 'titulo', false),
        html: document.getElementById('pubBulkStepBody').innerHTML,
      };
      _pubBulkEdit(0, 'precio', '210000');
      return { before, after: _pubBulkCellStyle(_pubBulkRows[0], 'precio', false), edited: _pubBulkRows[0].edited };
    });
    expect(res.before.step).toBe(2);
    expect(res.before.name).toBe('WhatsApp');
    expect(res.before.precio).toContain('dashed');
    expect(res.before.titulo).toContain('#d97706');
    expect(res.before.html).toContain('borde punteado');
    expect(res.before.html).toContain('ℹ 1');
    expect(res.after).not.toContain('dashed');
    expect(res.edited).toEqual({ precio: 1 });
  });

  test('detecta duplicados dentro del lote y contra publicaciones propias', async ({ page }) => {
    const res = await page.evaluate(() => {
      const base = { direccion: 'A 1', distrito: 'Lince', tipo_publicacion: 'Venta', tipo_propiedad: 'Casa', precio: '100000', area_techada: '50', titulo: 't', descripcion: 'd' };
      _pubBulkFileName = 'x.csv';
      _pubBulkLoadRows([base, { ...base, direccion: 'A 1 (copia)' }, { ...base, precio: '90000' }]);
      _pubOwnFingerprints = new Set([RecoImport.fingerprint({ district: 'Lince', op: 'Venta', type: 'Casa', area: 50, price: 90000, beds: 0 })]);
      _pubBulkMarkDupes();
      return { dupes: _pubBulkRows.map(a => a.dupe), source: _pubBulkRows[0].source,
        html: (_pubBulkRefresh(), document.getElementById('pubBulkStepBody').innerHTML) };
    });
    expect(res.source).toBe('csv');
    expect(res.dupes[0]).toBe('');
    expect(res.dupes[1]).toContain('fila 1');
    expect(res.dupes[2]).toContain('Ya tienes');
    expect(res.html).toContain('parecen repetidas');
  });

  test('banner de borradores pendientes con Retomar / Descartar', async ({ page }) => {
    const html = await page.evaluate(() => {
      _pubDraftGroups = [{ batchId: 'b9', source: 'text', sourceName: null, at: Date.now(), docs: [{ id: 'x' }, { id: 'y' }] }];
      return _pubDraftsBannerHTML();
    });
    expect(html).toContain('2 inmuebles');
    expect(html).toContain('Texto pegado');
    expect(html).toContain("_pubDraftsResume('b9')");
    expect(html).toContain("_pubDraftsDiscard('b9')");
  });
});
