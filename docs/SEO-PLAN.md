# Plan SEO y SEM — Reco (recosac.com)

## Diagnóstico inicial (oct-2026)

| Problema | Impacto |
|---|---|
| Las fichas de inmuebles usan `index.html#prop=ID`. Google ignora todo lo que va después de `#`, así que para el buscador el sitio es una sola página. | Crítico: ningún inmueble puede aparecer en Google. |
| Los inmuebles se cargan desde Firestore con JavaScript después de abrir la página. | Alto |
| No había `meta description`, canonical, Open Graph, datos estructurados, `robots.txt` ni `sitemap.xml`. | Alto (corregido en la Fase 1) |
| Había llamadas a `gtag(...)`, pero no se cargaba el script de Google Analytics. | Alto: no se medía nada (corregido en la Fase 1, falta el ID) |
| `index.html` pesa unos 870 KB en un solo archivo, con imágenes en base64. | Medio (Core Web Vitals) |

## Fase 1 — Base técnica ✅ (en código)

- [x] Title, `meta description`, canonical y `robots` en `index.html` y `landing.html`.
- [x] Open Graph y Twitter Card con imagen optimizada de 1200×630 (`assets/og-image.jpg`).
- [x] Favicon y apple-touch-icon (`assets/`).
- [x] JSON-LD `Organization` + `WebSite` en `index.html`.
- [x] `robots.txt`, que bloquea prototipos, documentación y archivos internos.
- [x] `sitemap.xml`.
- [x] Carga de GA4 con Consent Mode v2, conectada al banner de cookies existente.

**Pendiente (fuera del código, lo hace el equipo):**

1. Crear la propiedad GA4 y pegar el ID `G-XXXXXXXXXX` en `window.GA_MEASUREMENT_ID` (`index.html` y `landing.html`).
2. Dar de alta `recosac.com` en **Google Search Console** (verificar por DNS) y enviar `https://recosac.com/sitemap.xml`.
3. Hacer lo mismo en **Bing Webmaster Tools** (se puede importar desde Search Console).
4. Crear el **Google Business Profile** de Reco / VANET DATA S.A.C.
5. Unificar el correo de contacto: `landing.html` usa `anuncios@reco.pe` y el dominio es `recosac.com`.
6. ⚠️ Seguridad: `robots.txt` **no** oculta archivos. Todo lo que está en el repo es público en el sitio, incluidos `data/reco_github_repo.zip`, los `.xlsx` y los `.docx`. Hay que sacarlos del sitio publicado si no deben ser públicos.

## Fase 2 — Fichas de inmuebles indexables ✅ (en código)

- [x] `scripts/build-seo-pages.js` genera `inmueble/{tipo}-{operacion}-{distrito}-{id}/index.html` por cada inmueble en **Venta/Alquiler**.
  Ejemplo: `/inmueble/departamento-venta-miraflores-118-ci1508-25/`.
  - La URL no incluye precio ni dormitorios, así no cambia si se edita el aviso.
  - Los **Histórico no se publican**, porque su detalle se desbloquea con llaves.
- [x] Cada ficha incluye:
  - un H1 y una descripción redactada a partir de los datos,
  - precio, precio/m², áreas y características,
  - fotos con `alt`,
  - JSON-LD `RealEstateListing` + `BreadcrumbList`, canonical y Open Graph con la foto del inmueble,
  - 6 inmuebles relacionados del mismo distrito (enlazado interno),
  - botones "Contactar" y "Ver en el mapa" que abren la app (`/index.html#prop=ID`), donde vive el flujo de contacto.
- [x] Solo muestra datos que la app ya muestra públicamente. Nunca datos del dueño.
- [x] `sitemap.xml` se regenera completo con todas las fichas.
- [x] `404.html` para avisos retirados ("Este inmueble ya no está disponible").
- [x] Workflow `.github/workflows/seo-pages.yml`:
  - regenera y hace commit en `main` cuando cambia `data/properties.json`, y cada día a las 04:17 de Lima;
  - también se puede correr a mano desde Actions.
- [x] Tests en `tests/seo-pages.spec.js`.

**Pendiente (fuera del código):**

- Para incluir las **publicaciones de usuarios aprobadas** (Firestore), crear en GitHub → Settings → Secrets → Actions el secreto `FIREBASE_SERVICE_ACCOUNT`. Su valor es el JSON de una cuenta de servicio de `reco-5a5dd` con rol de solo lectura en Firestore (`roles/datastore.viewer`). La lectura anónima por REST está bloqueada, probablemente por App Check. Sin el secreto, solo se generan las fichas de `data/properties.json`.
- `main` está protegida. Si rechaza el push del bot, el workflow deja los cambios en la rama `chore/seo-regen` y abre un PR automático. Para que pueda abrirlo, activar en GitHub → Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests". Para que el push sea directo, agregar `github-actions[bot]` como excepción en la protección de `main`.
- Tras el deploy: enviar `sitemap.xml` en Search Console y pedir la indexación de 3–5 fichas para acelerar.

## Fase 3 — "Búsqueda especial" ✅ (en código)

**Requisito del negocio:** estas páginas **no** aparecen en la landing ni en la navegación principal (no queremos parecernos a Urbania). Se llega a ellas solo por:

1. El enlace discreto **"Búsqueda especial"** en el footer de `index.html` (columna "Explorar"), de `landing.html` y de las fichas.
2. El `sitemap.xml`, que es la vía por la que Google las encuentra.

Las genera el mismo `scripts/build-seo-pages.js` (código en `scripts/seo/`):

| Ruta | Contenido |
|---|---|
| `/busqueda-especial/` | Buscador (operación, tipo, distrito, m² mín./máx., dormitorios, precio máx.) que filtra `inmuebles.json` en el navegador y guarda los filtros en la URL. Debajo, un directorio con todas las búsquedas, la tabla de precio del m² por distrito y los enlaces "En toda Lima". |
| `/busqueda-especial/{tipos}-en-{venta o alquiler}-en-{distrito}/` | Ej. `departamentos-en-venta-en-miraflores`. Incluye: H1, resumen con datos (cantidad, precio mediano, rango, área mediana, US$/m²), los avisos (hasta 48, del más barato al más caro), "Ver en el mapa" (abre la app filtrada) y búsquedas relacionadas. |
| `.../{tipos}-en-{op}-en-lima/` | Lo mismo para toda Lima Metropolitana y Callao. |
| `...-{n}-dormitorios/`, `...-4-o-mas-dormitorios/` | Variantes por dormitorios (departamentos y casas). |
| `...-hasta-60-m2/`, `...-60-a-90-m2/` … `...-mas-de-180-m2/` | Variantes por metraje (departamentos). |
| `/busqueda-especial/precio-m2-{distrito}/` | Mediana y rango (P25–P75) del precio de oferta por m² de departamentos y casas en venta (avisos actuales en US$), serie de tasaciones por año (solo años con 30+ tasaciones), enlace a históricos en el mapa y comparativo de distritos. |

**Reglas de calidad:**

- Una combinación se publica solo si tiene **3 o más avisos**.
- Si dos combinaciones listan exactamente los mismos avisos, se publica una sola (evita contenido duplicado).
- Las cifras no mezclan monedas.
- Un área menor a 10 m² se trata como "sin dato": hay avisos cargados con "1 m²" (por ejemplo Calle Cantuarias 355 y Santander 186), que conviene corregir en el origen.
- `data/precios_distrito_2025.csv` **no se usa**: no está claro de dónde salen sus datos y no coincide con la serie de tasaciones de la app.

Resultado actual: 268 páginas (buscador + combinaciones + 26 distritos con precio del m²).

## SEM — Anuncios patrocinados (recién después de las Fases 1 y 2 + medición)

| Concepto | Mensual (estimado) |
|---|---|
| Google Ads – marca "Reco / ReCo SAC" | S/ 100–200 |
| Google Ads – long-tail por distrito/tipo (con destino a las páginas de la Fase 3) | S/ 1,200–2,500 |
| Microsoft Ads (Bing/Edge/Yahoo/DuckDuckGo) | S/ 150–300 |
| **Total piloto** | **≈ S/ 1,500–3,000 + IGV** |

Costo por clic de referencia en Lima, sector inmobiliario: S/ 2–8 (cifras de agencias, a validar en el Planificador de palabras clave). Hacer un piloto de 2–3 meses y escalar solo las palabras que generen contactos.
