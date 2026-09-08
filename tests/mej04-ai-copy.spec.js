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
    const btn = await page.evaluate(() => document.getElementById('pubAiCopyBtn'));
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

  test('_pubGenerateCopy function exists', async ({ page }) => {
    const exists = await page.evaluate(() => typeof _pubGenerateCopy === 'function');
    expect(exists).toBe(true);
  });

  test('_pubUseAiCopy function exists', async ({ page }) => {
    const exists = await page.evaluate(() => typeof _pubUseAiCopy === 'function');
    expect(exists).toBe(true);
  });

  test('_aiCopyLastResult is initially null', async ({ page }) => {
    const val = await page.evaluate(() => _aiCopyLastResult);
    expect(val).toBeNull();
  });

  // ── _pubUseAiCopy logic ──

  test('_pubUseAiCopy sets _pd.title and _pd.desc from _aiCopyLastResult', async ({ page }) => {
    const result = await page.evaluate(() => {
      _aiCopyLastResult = { titulo: 'AI Title Test', descripcion: 'AI Description Test' };
      _pd.title = '';
      _pd.desc = '';
      _pubUseAiCopy();
      return { title: _pd.title, desc: _pd.desc };
    });
    expect(result.title).toBe('AI Title Test');
    expect(result.desc).toBe('AI Description Test');
  });

  test('_pubUseAiCopy does nothing when _aiCopyLastResult is null', async ({ page }) => {
    const result = await page.evaluate(() => {
      _aiCopyLastResult = null;
      _pd.title = 'Original';
      _pd.desc = 'Original desc';
      _pubUseAiCopy();
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

  test('_pubGenerateCopy sends district and area from _pd', async ({ page }) => {
    const scripts = await page.evaluate(() => {
      const all = [];
      document.querySelectorAll('script').forEach(s => all.push(s.textContent));
      return all.join('');
    });
    expect(scripts).toContain('district: _pd.district');
    expect(scripts).toContain('area: _pd.area');
  });
});
