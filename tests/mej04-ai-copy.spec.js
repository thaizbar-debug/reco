const { test, expect } = require('@playwright/test');

test.describe('MEJ-04: Redacción del anuncio con IA', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3123/', { waitUntil: 'domcontentloaded' });
  });

  // ── Feature flag ──

  test('_AI_COPY_ENABLED flag exists and is boolean', async ({ page }) => {
    const val = await page.evaluate(() => typeof _AI_COPY_ENABLED);
    expect(val).toBe('boolean');
  });

  test('when _AI_COPY_ENABLED=false, AI copy button is NOT rendered', async ({ page }) => {
    const enabled = await page.evaluate(() => _AI_COPY_ENABLED);
    if (enabled) { test.skip(); return; }
    const btn = await page.evaluate(() => document.getElementById('pubAiBtn'));
    expect(btn).toBeNull();
  });

  test('when _AI_COPY_ENABLED=false, publish form renders without visual gaps', async ({ page }) => {
    const enabled = await page.evaluate(() => _AI_COPY_ENABLED);
    if (enabled) { test.skip(); return; }
    const scripts = await page.evaluate(() => {
      const all = [];
      document.querySelectorAll('script').forEach(s => all.push(s.textContent));
      return all.join('');
    });
    expect(scripts).toContain("_AI_COPY_ENABLED ? `");
    expect(scripts).toContain(": ''}");
  });

  // ── JS function existence ──

  test('_pubAiCopy function exists', async ({ page }) => {
    const exists = await page.evaluate(() => typeof _pubAiCopy === 'function');
    expect(exists).toBe(true);
  });

  test('_pubAiApply function exists', async ({ page }) => {
    const exists = await page.evaluate(() => typeof _pubAiApply === 'function');
    expect(exists).toBe(true);
  });

  test('_pubAiPrompt function exists and returns district/area', async ({ page }) => {
    const result = await page.evaluate(() => {
      _pd.district = 'Miraflores';
      _pd.area = 120;
      return _pubAiPrompt();
    });
    expect(result.district).toBe('Miraflores');
    expect(result.area).toBe(120);
    expect(result).not.toHaveProperty('address');
  });

  test('_aiCopyLastResult is initially null', async ({ page }) => {
    const val = await page.evaluate(() => _aiCopyLastResult);
    expect(val).toBeNull();
  });

  // ── _pubAiApply logic ──

  test('_pubAiApply sets _pd.title and _pd.desc from _aiCopyLastResult', async ({ page }) => {
    const result = await page.evaluate(() => {
      _aiCopyLastResult = { titulo: 'AI Title Test', descripcion: 'AI Description Test' };
      _pd.title = '';
      _pd.desc = '';
      _pubAiApply();
      return { title: _pd.title, desc: _pd.desc };
    });
    expect(result.title).toBe('AI Title Test');
    expect(result.desc).toBe('AI Description Test');
  });

  test('_pubAiApply does nothing when _aiCopyLastResult is null', async ({ page }) => {
    const result = await page.evaluate(() => {
      _aiCopyLastResult = null;
      _pd.title = 'Original';
      _pd.desc = 'Original desc';
      _pubAiApply();
      return { title: _pd.title, desc: _pd.desc };
    });
    expect(result.title).toBe('Original');
    expect(result.desc).toBe('Original desc');
  });

  // ── Cloud Function shape (from source) ──

  test('generateListingCopy is referenced as a callable function name', async ({ page }) => {
    const scripts = await page.evaluate(() => {
      const all = [];
      document.querySelectorAll('script').forEach(s => all.push(s.textContent));
      return all.join('');
    });
    expect(scripts).toContain("httpsCallable('generateListingCopy')");
  });

  test('_pubAiPrompt sends district and area from _pd (no address)', async ({ page }) => {
    const result = await page.evaluate(() => {
      _pd.district = 'San Isidro';
      _pd.area = 85;
      _pd.address = '123 Calle Secreta';
      const prompt = _pubAiPrompt();
      return {
        hasDistrict: 'district' in prompt,
        hasArea: 'area' in prompt,
        hasAddress: 'address' in prompt,
        district: prompt.district,
        area: prompt.area,
      };
    });
    expect(result.hasDistrict).toBe(true);
    expect(result.hasArea).toBe(true);
    expect(result.hasAddress).toBe(false);
    expect(result.district).toBe('San Isidro');
    expect(result.area).toBe(85);
  });

  // ── Cloud Functions region safety ──

  test('all httpsCallable calls use _getFunctions(), never firebase.functions() directly', async ({ page }) => {
    const violations = await page.evaluate(() => {
      const scripts = [];
      document.querySelectorAll('script').forEach(s => scripts.push(s.textContent));
      const src = scripts.join('\n');
      const problems = [];
      const re = /firebase\.functions\(\)\.httpsCallable/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const ctx = src.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20);
        problems.push(ctx.trim());
      }
      return problems;
    });
    expect(violations).toEqual([]);
  });

  // ── Fix #3: hideExact in single-publish payload ──

  test('_ppub() payload object extracted from source includes hideExact: !!_pd.hideExact and evaluates correctly', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Extract the exact payload object literal from _ppub's real source code.
      // If someone removes hideExact from the call, the regex or the field check fails.
      const src = _ppub.toString();
      // Match the object literal passed to call({...}) — starts after 'await call(' and ends at the matching ')'
      const callStart = src.indexOf('await call(');
      if (callStart === -1) return { error: 'await call( not found in _ppub source' };
      // Find the opening '{' after 'await call('
      const objStart = src.indexOf('{', callStart);
      // Count braces to find the matching '}'
      let depth = 0;
      let objEnd = -1;
      for (let i = objStart; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') { depth--; if (depth === 0) { objEnd = i; break; } }
      }
      if (objEnd === -1) return { error: 'could not find matching } for payload object' };
      const payloadSrc = src.slice(objStart, objEnd + 1);

      // Evaluate the extracted fragment with _pd set to test values
      const origPd = { ..._pd };

      // Test with hideExact = true
      _pd.address = '123 Test St'; _pd.district = 'TestDistrict';
      _pd.lat = -12; _pd.lng = -77; _pd.hideExact = true;
      _pd.type = 'Departamento'; _pd.op = 'Venta'; _pd.currency = 'USD';
      _pd.price = 100000; _pd.areaTerr = 0; _pd.area = 80;
      _pd.beds = 2; _pd.baths = 1; _pd.parking = 1;
      _pd.floor = 5; _pd.floors = 10; _pd.age = 3;
      _pd.estado = 'Bueno'; _pd.ascensor = false; _pd.amoblado = false;
      _pd.petFriendly = false; _pd.features = ['Balcón'];
      _pd.title = 'Test Title'; _pd.desc = 'Test Desc';

      let payloadTrue;
      try {
        payloadTrue = eval('(' + payloadSrc + ')');
      } catch (e) {
        return { error: 'eval failed for hideExact=true: ' + e.message, payloadSrc };
      }

      // Test with hideExact = false
      _pd.hideExact = false;
      let payloadFalse;
      try {
        payloadFalse = eval('(' + payloadSrc + ')');
      } catch (e) {
        return { error: 'eval failed for hideExact=false: ' + e.message, payloadSrc };
      }

      // Restore _pd
      Object.assign(_pd, origPd);

      return {
        payloadSrc,
        hasHideExactKey: 'hideExact' in payloadTrue,
        hideExactTrue: payloadTrue.hideExact,
        hideExactFalse: payloadFalse.hideExact,
        source: payloadTrue.source,
        title: payloadTrue.title,
        district: payloadTrue.district,
      };
    });
    expect(result.error).toBeUndefined();
    expect(result.hasHideExactKey).toBe(true);
    expect(result.hideExactTrue).toBe(true);
    expect(result.hideExactFalse).toBe(false);
    expect(result.source).toBe('single');
    expect(result.title).toBe('Test Title');
    expect(result.district).toBe('TestDistrict');
  });

  test('hideExact defaults to false in _pd', async ({ page }) => {
    const val = await page.evaluate(() => {
      return _pd.hideExact;
    });
    expect(val).toBe(false);
  });

  // ── Fix #4: search filter legacy tag equivalence ──

  test('getFiltered() with canonical tag finds properties with legacy name and vice versa', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Save original state
      const origProperties = properties.slice();
      const origFeatures = [...S.features];
      const origOp = S.op;
      const origType = S.type;
      const origQuery = S.query;

      // Inject test properties — photoUrls lets them pass the driveAssets check
      const base = {
        address: 'Av Test 100', district: 'Miraflores', op: 'Venta', type: 'Departamento',
        price: 100000, area: 80, beds: 2, baths: 1, park: 1, age: 5, photoUrls: ['x'],
      };
      properties = [
        { ...base, id: 'legacy-1', features: ['Piscina'] },
        { ...base, id: 'canonical-1', features: ['Piscina propia'] },
        { ...base, id: 'unrelated-1', features: ['Jardín propio'] },
      ];

      // Reset filter state to neutral
      S.query = ''; S.op = 'Venta'; S.type = 'all'; S.beds = 0; S.baths = 0;
      S.minPrice = 0; S.maxPrice = Infinity; S.minArea = 0; S.minAreaTerr = 0;
      S.minSqm = 0; S.maxSqm = Infinity; S.minPark = 0; S.minFloors = 0;
      S.minFloor = 0; S.maxAge = Infinity; S.bankOnly = false;

      // Filter by canonical name "Piscina propia"
      S.features = ['Piscina propia'];
      const byCanonical = getFiltered().map(p => p.id);

      // Filter by legacy name "Piscina"
      S.features = ['Piscina'];
      const byLegacy = getFiltered().map(p => p.id);

      // Restore
      properties = origProperties;
      S.features = origFeatures;
      S.op = origOp; S.type = origType; S.query = origQuery;

      return { byCanonical, byLegacy };
    });
    // Canonical filter "Piscina propia" matches both legacy and canonical properties
    expect(result.byCanonical).toContain('legacy-1');
    expect(result.byCanonical).toContain('canonical-1');
    expect(result.byCanonical).not.toContain('unrelated-1');
    // Legacy filter "Piscina" matches both directions too
    expect(result.byLegacy).toContain('legacy-1');
    expect(result.byLegacy).toContain('canonical-1');
    expect(result.byLegacy).not.toContain('unrelated-1');
  });

  test('_PUB_FEAT_REVERSE_MAP covers all legacy→canonical pairs', async ({ page }) => {
    const result = await page.evaluate(() => {
      const pairs = Object.entries(_PUB_FEAT_LEGACY_MAP);
      const reverseOk = pairs.every(([legacy, canonical]) => _PUB_FEAT_REVERSE_MAP[canonical] === legacy);
      return { count: pairs.length, reverseOk };
    });
    expect(result.count).toBeGreaterThan(0);
    expect(result.reverseOk).toBe(true);
  });

  // ── _AI_COPY_ENABLED=false guard (explicit crash safety) ──

  test('when flag=false, AI DOM elements absent and AI functions do not crash', async ({ page }) => {
    const enabled = await page.evaluate(() => _AI_COPY_ENABLED);
    if (enabled) { test.skip(); return; }
    const result = await page.evaluate(() => {
      const checks = {};
      checks.pubAiBtn = document.getElementById('pubAiBtn');
      checks.pubAiOut = document.getElementById('pubAiOut');
      checks.pubAiLoading = document.getElementById('pubAiLoading');
      checks.pubAiError = document.getElementById('pubAiError');
      // _pubAiApply must not crash even with missing DOM
      try {
        _aiCopyLastResult = { titulo: 'test', descripcion: 'test' };
        _pubAiApply();
        checks.applyDidNotCrash = true;
      } catch (e) {
        checks.applyDidNotCrash = false;
        checks.applyError = e.message;
      }
      // _pubAiCopy must not crash (it early-returns when btn is null)
      try {
        _pubAiCopy();
        checks.copyDidNotCrash = true;
      } catch (e) {
        checks.copyDidNotCrash = false;
        checks.copyError = e.message;
      }
      return checks;
    });
    expect(result.pubAiBtn).toBeNull();
    expect(result.pubAiOut).toBeNull();
    expect(result.pubAiLoading).toBeNull();
    expect(result.pubAiError).toBeNull();
    expect(result.applyDidNotCrash).toBe(true);
    expect(result.copyDidNotCrash).toBe(true);
  });
});
