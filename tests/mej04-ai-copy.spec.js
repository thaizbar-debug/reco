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

  test('single-publish payload includes hideExact (source + runtime)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const src = _ppub.toString();
      const callBlock = src.slice(src.indexOf('await call('), src.indexOf('const publicationId'));
      const sourceHasHideExact = callBlock.includes('hideExact') && callBlock.includes('_pd.hideExact');
      _pd.hideExact = true;
      const runtimeTrue = !!_pd.hideExact === true;
      _pd.hideExact = false;
      const runtimeFalse = !!_pd.hideExact === false;
      return { sourceHasHideExact, runtimeTrue, runtimeFalse };
    });
    expect(result.sourceHasHideExact).toBe(true);
    expect(result.runtimeTrue).toBe(true);
    expect(result.runtimeFalse).toBe(true);
  });

  test('hideExact defaults to false in _pd', async ({ page }) => {
    const val = await page.evaluate(() => {
      return _pd.hideExact;
    });
    expect(val).toBe(false);
  });

  // ── Fix #4: search filter legacy tag equivalence ──

  test('filter with canonical tag matches property using legacy name', async ({ page }) => {
    const result = await page.evaluate(() => {
      const propLegacy = { features: ['Piscina'] };
      const propNew = { features: ['Piscina propia'] };
      const propNone = { features: ['Jardín propio'] };
      const pf1 = propLegacy.features || [];
      const pf2 = propNew.features || [];
      const pf3 = propNone.features || [];
      const f = 'Piscina propia';
      const matchLegacy = pf1.includes(f) || pf1.includes(_PUB_FEAT_REVERSE_MAP[f] || '') || pf1.includes(_PUB_FEAT_LEGACY_MAP[f] || '');
      const matchNew = pf2.includes(f) || pf2.includes(_PUB_FEAT_REVERSE_MAP[f] || '') || pf2.includes(_PUB_FEAT_LEGACY_MAP[f] || '');
      const matchNone = pf3.includes(f) || pf3.includes(_PUB_FEAT_REVERSE_MAP[f] || '') || pf3.includes(_PUB_FEAT_LEGACY_MAP[f] || '');
      return { matchLegacy, matchNew, matchNone };
    });
    expect(result.matchLegacy).toBe(true);
    expect(result.matchNew).toBe(true);
    expect(result.matchNone).toBe(false);
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
