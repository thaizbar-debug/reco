# ReCo SAC

Plataforma inmobiliaria para publicar y gestionar propiedades en Peru.

## Tests

El proyecto usa [Playwright](https://playwright.dev/) como suite de pruebas E2E.

### Cobertura

| Suite | Archivo | Tests |
|-------|---------|-------|
| MEJ-05: Campos de pisos | `tests/mej05-floors.spec.js` | 7 |
| MEJ-06: Legacy tag mapping | `tests/mej05-floors.spec.js` | 3 |
| Carga masiva (30 columnas) | `tests/bulk-upload.spec.js` | 28 |

**Total: 38 tests**

### Ejecutar localmente

```bash
npm install
npx playwright install --with-deps chromium
npx playwright test
```

Para entornos con Chromium pre-instalado (ej. Claude Code Remote):

```bash
PLAYWRIGHT_CHROMIUM_PATH=/ruta/al/chrome npx playwright test
```

### CI

GitHub Actions ejecuta los tests automaticamente en cada PR y push a `main`.
Ver `.github/workflows/playwright.yml`.
