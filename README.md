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
| Fase 3: conexiones automáticas (feeds Kyero/JSON/CSV, Google Sheets, EasyBroker, Wasi), API pública con webhooks y correo de ingesta (handlers reales) | `tests/import-fase3.test.js` | 11 |
| Fase 3: pantalla de Integraciones y estado "Retirada" | `tests/import-fase3.spec.js` | 6 |
| Captación desde redes: enlace de posts de Facebook / Instagram / TikTok y de cualquier web, video subido y conectar página de Facebook / Instagram (handlers reales) | `tests/import-redes.test.js` | 8 |
| Captación desde redes en la web: PDF de proyecto (fotos y planos), video (imágenes + audio), post privado y tarjeta de Facebook / Instagram | `tests/import-redes.spec.js` | 6 |
| Fotos: borrar al eliminar la publicación y editar las fotos de una publicación enviada (handlers reales) | `tests/fotos.test.js` | 3 |
| Fotos en la web: repetidas, oscuras, borrosas y de baja resolución; portada y orden; HEIC; subida en paralelo con reintentos y miniaturas; editor en Mis publicaciones | `tests/fotos.spec.js` | 8 |

El catálogo de valores estándar (`functions/shared/catalogo.js`), los normalizadores (`functions/shared/import-core.js`), el bot de WhatsApp (`functions/whatsapp-core.js`), el núcleo de feeds (`functions/feed-core.js`) y la lectura de posts de redes (`functions/social-core.js`) tienen tests unitarios sin dependencias:
`cd functions && npm test`.

Los tests de documentos sirven pdf.js y JSZip desde `node_modules` (devDependencies `pdfjs-dist@3.11.174`,
`jszip@3.10.1` y `xlsx@0.18.5`, las mismas versiones que `index.html` carga desde cdnjs). `heic2any@0.0.4` es la misma
versión que la página carga desde jsDelivr para convertir fotos de iPhone. Los archivos de prueba se regeneran con
`tests/fixtures/import/make_fixtures.py` y `make_pdf.js`.

Documentación de integraciones: `docs/API.md` (API pública), `docs/INTEGRACIONES.md` (puesta en marcha) y `docs/REDES-SOCIALES.md` (captar desde Facebook, Instagram y TikTok).

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
