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

## Fase 2 — Fichas de inmuebles indexables

- Usar URLs reales en lugar de `#prop=`: `/inmueble/{tipo}-{operacion}-{distrito}-{dormitorios}-dorm-{id}`.
  Ejemplo: `/inmueble/departamento-venta-barranco-3-dorm-abc123`.
- Generar el HTML estático de cada ficha con un script en GitHub Actions que lea Firestore. Cada ficha lleva:
  - un `<h1>` con la dirección,
  - descripción, precio y m²,
  - fotos con `alt`,
  - JSON-LD (`RealEstateListing` / `Offer`),
  - canonical propio,
  - un enlace para "ver en el mapa" que abre la app (`index.html#prop=ID`).
- Regenerar `sitemap.xml` en cada corrida. Al despublicar un inmueble, devolver 404 o redirigir.
- Mantener el `#prop=` interno de la app. Las páginas nuevas son la puerta de entrada desde Google.

## Fase 3 — "Búsqueda especial" (páginas por distrito, m², tipo)

**Requisito del negocio:** estas páginas **no** deben verse en la landing ni en la navegación principal (no queremos parecernos a Urbania). Se llega a ellas por:

1. Un único enlace discreto **"Búsqueda especial"** en el footer de `index.html` (columna "Explorar") y de `landing.html`.
2. El `sitemap.xml`, que es la vía por la que Google las encuentra.

### Estructura

```
/busqueda-especial/                          ← hub (al que lleva el footer)
/busqueda-especial/departamentos-en-venta-miraflores/
/busqueda-especial/departamentos-en-alquiler-san-isidro/
/busqueda-especial/casas-en-venta-la-molina/
/busqueda-especial/precio-m2-barranco/        ← datos de data/precios_distrito_2025.csv
/busqueda-especial/departamentos-venta-surco-60-a-90-m2/
/busqueda-especial/departamentos-venta-miraflores-3-dormitorios/
```

- **Hub `/busqueda-especial/`:** un buscador con filtros (operación, tipo, distrito, rango de m², dormitorios, precio) y, debajo, un directorio de enlaces a todas las combinaciones. El directorio es lo que permite que Google rastree todas las páginas.
- **Cada página de combinación incluye:**
  - un H1 con la búsqueda exacta ("Departamentos en venta en Miraflores"),
  - un párrafo con datos propios: mediana USD/m², P25–P75 y transacciones de los últimos 18 meses,
  - el listado de los inmuebles que coinciden (enlaces a sus fichas de la Fase 2),
  - un botón "Ver en el mapa" que abre la app con el filtro aplicado (`index.html#op=venta&...`),
  - enlaces a distritos vecinos y rangos de m² cercanos (enlazado interno).
- **Combinaciones iniciales:** {venta, alquiler} × {departamento, casa, oficina, terreno} × los 16 distritos con datos (Ate, Barranco, Breña, Chorrillos, Jesús María, La Molina, Lince, Los Olivos, Magdalena, Miraflores, Pueblo Libre, San Borja, San Isidro, San Miguel, Surco, Surquillo), más las páginas de "precio m²" por distrito y los rangos de m²/dormitorios en los distritos con más oferta.
- **Regla anti contenido pobre:** solo se publica (y se incluye en el sitemap) una combinación con al menos 3 inmuebles activos o con datos de precio del distrito. Las demás llevan `noindex`.
- Las páginas se generan con el mismo pipeline estático de la Fase 2.

## SEM — Anuncios patrocinados (recién después de las Fases 1 y 2 + medición)

| Concepto | Mensual (estimado) |
|---|---|
| Google Ads – marca "Reco / ReCo SAC" | S/ 100–200 |
| Google Ads – long-tail por distrito/tipo (con destino a las páginas de la Fase 3) | S/ 1,200–2,500 |
| Microsoft Ads (Bing/Edge/Yahoo/DuckDuckGo) | S/ 150–300 |
| **Total piloto** | **≈ S/ 1,500–3,000 + IGV** |

Costo por clic de referencia en Lima, sector inmobiliario: S/ 2–8 (cifras de agencias, a validar en el Planificador de palabras clave). Hacer un piloto de 2–3 meses y escalar solo las palabras que generen contactos.
