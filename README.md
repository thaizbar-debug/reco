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
| Carga inteligente Fase 0: bandeja, borradores, duplicados | `tests/import-phase0.spec.js` | 9 |
| Carga inteligente: `extractListings`, `importListingPage`, `mapImportColumns`, bot de WhatsApp y `publishProperty` (handlers reales) | `tests/import-engine.test.js` | 27 |
| Importar PDF, Word y PowerPoint (lectura real de `tests/fixtures/import`) | `tests/import-documents.spec.js` | 7 |
| Fase 1: pegar texto, chats de WhatsApp, enlace, marcador y Excel de cualquier formato | `tests/import-fase1.spec.js` | 14 |
| Fase 2: flyers, fotos en bloque (EXIF), perfil de portal, compartir desde el celular (service worker) y bot de WhatsApp en la web | `tests/import-fase2.spec.js` | 15 |

El catálogo de valores estándar (`functions/shared/catalogo.js`) y los normalizadores (`functions/shared/import-core.js`) tienen tests unitarios sin dependencias:
`cd functions && npm test`.

Los tests de documentos sirven pdf.js y JSZip desde `node_modules` (devDependencies `pdfjs-dist@3.11.174`,
`jszip@3.10.1` y `xlsx@0.18.5`, las mismas versiones que `index.html` carga desde cdnjs). Los archivos de prueba se regeneran con
`tests/fixtures/import/make_fixtures.py` y `make_pdf.js`.

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
