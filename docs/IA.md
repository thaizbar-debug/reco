# IA en ReCo (Claude)

Toda la IA de texto e imágenes usa **Claude**. Pasa por una sola función del servidor, `_aiStructured` en
`functions/index.js`.

## Qué la usa

| Función | Para qué |
|---|---|
| `extractListings` | Pegar texto, PDF, Word, PowerPoint, chat de WhatsApp, flyers y capturas, video (cuadros + audio transcrito) |
| `importListingPage` | Enlace de un aviso, de una web o de un post de redes |
| `metaConnect` | Posts de la página de Facebook / Instagram conectada |
| `whatsappProcessMessage` | Bot de WhatsApp |
| `emailProcess` | Correo de ingesta. Los PDF adjuntos van directo a Claude, que los lee completos |
| `mapImportColumns`, `importSources` | Reconocer las columnas de un Excel, un feed o un Google Sheets |
| `analyzePhotos` | ✨ Ordenar con IA (portada, ambientes, marcas de agua) |
| `generateListingCopy` | ✨ Redactar con IA |

## Haiku primero; si falla, Sonnet en la misma llamada

Cada pedido va primero a **Claude Haiku 5.5**, que es rápido y económico. Si falla por cualquier motivo, se repite
**de inmediato y en la misma llamada** con **Claude Sonnet 5.5**. El usuario nunca tiene que volver a intentarlo.

Cuenta como falla:

| Falla | Ejemplo |
|---|---|
| Error de la API | Caída, sobrecarga, límite de uso, tiempo agotado (Haiku: 60 s) |
| Respuesta rechazada | `stop_reason: refusal` |
| Respuesta cortada por larga | `stop_reason: max_tokens`, por ejemplo un proyecto con decenas de unidades |
| JSON que no se puede leer | Respuesta incompleta o mal formada |
| Resultado que no sirve | Ningún inmueble en un texto con números o en un documento, texto vacío en "Redactar con IA", sin fotos en "Ordenar con IA" |

Detalles:
- **Sin reintentos con Haiku.** Ante cualquier error se pasa directo a Sonnet. Sonnet sí reintenta una vez los
  errores pasajeros de la API, porque es la última opción.
- **Respuesta cortada en los dos modelos.** Se pide a Sonnet una respuesta más corta: máximo 12 inmuebles, una
  entrada por tipología.
- **Ningún inmueble en ninguno de los dos.** El resultado vacío es real: se muestra "No encontramos inmuebles" y no
  un error.
- **Límite de uso.** Una importación cuenta una sola vez en el límite de 30 por hora, aunque haya usado los dos
  modelos.
- **Esfuerzo de razonamiento bajo** (`effort: low`). Para extraer datos alcanza y gasta menos.
- **Salida estructurada** (`output_config.format`): la respuesta siempre respeta el esquema JSON.

Cada importación queda registrada en `importEvents`:
- `modelo`: el modelo que dio el resultado.
- `respaldo`: `true` si hizo falta Sonnet.

Así se ve con qué frecuencia Haiku falla y cuánto se usa Sonnet. En Cloud Logging aparece `[función] <modelo> falló`
con el motivo.

## Configuración (para Thaiz)

1. Guardar la clave de la API de Claude (Anthropic) como secreto:
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
2. (Opcional) Cambiar los modelos sin tocar el código, en `functions/.env`:
   ```
   AI_MODEL=claude-haiku-5-5
   AI_FALLBACK_MODEL=claude-sonnet-5-5
   ```
3. Desplegar las funciones de la tabla de arriba.

## Costo (precio de lista por millón de tokens)

| Modelo | Entrada | Salida |
|---|---|---|
| Claude Haiku 5.5 (principal) | US$ 0,10 | US$ 0,50 |
| Claude Sonnet 5.5 (respaldo) | US$ 2,00 | US$ 10,00 |

Una importación de texto cuesta alrededor de US$ 0,001 con Haiku. Si hace falta Sonnet, unas 20 veces más, pero
solo en esos casos.

## Audio

Claude no transcribe audio. Las notas de voz del bot y el audio de los videos siguen con **Whisper de OpenAI**, que
es el único uso que queda del secreto `OPENAI_API_KEY`.

La alternativa propuesta es Google Cloud Speech-to-Text, que está en el mismo proyecto y no necesita clave. Falta
confirmar qué formatos de audio acepta (el MP4 de los reels) antes de cambiarlo.
