# Leer avisos de portales protegidos (Urbania, Adondevivir…)

## Qué pasa

Los portales grandes (Urbania, Adondevivir y otros del mismo grupo) usan protecciones anti-bots, como Cloudflare.
Estas protecciones **bloquean las descargas que vienen de servidores en la nube**, como las Cloud Functions de ReCo.

El navegador del usuario sí pasa, porque es una persona real desde una conexión de casa. Por eso el antiguo marcador
"Enviar a ReCo" lograba leer el texto. Ese marcador era complicado para los usuarios y se quitó.

## Cómo lee ReCo un enlace ahora (`importListingPage` → `_fetchPageHtml`)

1. **Descarga directa.** Funciona con la mayoría de webs de inmobiliarias, Properati, Babilonia, etc.
2. **Reintento con los encabezados de un navegador.** Sirve en algunos sitios con protecciones simples.
3. **Servicio de lectura** (si está configurado). Un proveedor externo descarga la página desde
   **conexiones residenciales de Perú** y resuelve la verificación anti-bots:
   - Primero intenta en modo económico (proxy premium).
   - Si el portal igual lo bloquea, usa el modo sigiloso, que cuesta más.
   - Las fotos que el portal también bloquea se piden por el mismo servicio.
4. Si nada funciona, el usuario ve el mensaje: *"urbania.pe no dejó que ReCo leyera la página. Copia el texto del aviso
   y pégalo en 'Pegar texto'"*. El cursor queda en "Pegar texto".

Cada lectura se registra en `importEvents`:
- Las que funcionan llevan `via` con el valor `directo`, `navegador` o `servicio`.
- Los bloqueos llevan `kind: 'bloqueado'` y el `host`.

Así se ve qué portales bloquean y cuánto se usa el servicio.

**Sin el servicio de lectura, Urbania y Adondevivir seguirán bloqueando la lectura por enlace.**

## Configuración (para Thaiz)

1. Crear una cuenta en uno de estos proveedores. Los tres funcionan igual en ReCo:

   | Proveedor | `SCRAPER_PROVIDER` |
   |---|---|
   | [ScrapingBee](https://www.scrapingbee.com) (recomendado) | `scrapingbee` (por defecto) |
   | [ZenRows](https://www.zenrows.com) | `zenrows` |
   | [ScraperAPI](https://www.scraperapi.com) | `scraperapi` |

   Todos tienen una prueba gratis. Los planes pagos parten de unos US$ 50 al mes; revisar el precio vigente.
   Cada aviso consume entre 10 y 75 créditos según el modo (más 10–25 por cada foto bloqueada).
   Antes de pagar, conviene probar con la cuenta gratis 10 enlaces reales de Urbania y Adondevivir.
2. Guardar la clave como secreto:
   ```bash
   firebase functions:secrets:set SCRAPER_API_KEY
   ```
3. Si no es ScrapingBee, configurar el proveedor en `functions/.env`:
   ```
   SCRAPER_PROVIDER=zenrows
   ```
4. Desplegar: `firebase deploy --only functions:importListingPage`.
   - `importListingPage` ahora declara el secreto `SCRAPER_API_KEY`. El despliegue pide crearlo si no existe.
   - Si todavía no se quiere usar un servicio, se puede crear con un valor vacío. Los pasos 1 y 2 de la lectura siguen funcionando igual.

## Por qué falló "Enviar a ReCo" con el proyecto de Urbania

El marcador sí entregó el texto completo, pero la lectura con IA falló ("No pudimos leer el aviso").

La página de un proyecto en Urbania lista muchas unidades. La respuesta de la IA, con un inmueble por unidad,
se cortaba por largo y quedaba un JSON incompleto. Ahora:

- Se permite una respuesta más larga (`max_tokens` de 16 000).
- Si igual se corta, se pide de nuevo más corta: como máximo 12 inmuebles, una entrada por tipología y no por
  unidad, con descripciones breves.
- El registro de errores incluye si la respuesta se cortó y cuántos caracteres tenía la página, para diagnosticar
  en Cloud Logging (`[importListingPage] IA error`). Desde la migración a Claude, si la respuesta se corta con Haiku se repite con Sonnet en la misma llamada (`docs/IA.md`).

## Fotos

Muchos portales arman la galería con JavaScript, así que las fotos no están en etiquetas `<img>` sino como URLs
dentro de los scripts de la página.

Si la página tiene menos de 4 fotos visibles, ReCo también busca URLs de imágenes en los scripts:
- Acepta URLs con barras escapadas (`\/`) o con `/`.
- Descarta logos, íconos y banners.
