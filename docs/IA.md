# IA en ReCo: Claude (texto e imágenes) y Google Speech-to-Text (audio)

ReCo usa dos servicios de IA, sin OpenAI:

| Servicio | Para qué | Credencial |
|---|---|---|
| **Claude** (Anthropic): Haiku 5.5 y, si falla, Sonnet 5.5 | Leer texto, documentos, imágenes y páginas; armar las fichas; fotos; redactar | Secreto `ANTHROPIC_API_KEY` |
| **Google Cloud Speech-to-Text** (API v2, modelo Chirp 2) | Pasar a texto el audio de notas de voz y videos | Ninguna: usa la cuenta de servicio de las funciones |

## Dónde se usa

| Lugar de la plataforma | Función | Claude | Audio (Google) |
|---|---|---|---|
| Publicar → ¿Qué tienes?: pegar texto, Excel/CSV, PDF, Word, PowerPoint, chat de WhatsApp, flyers y capturas | `extractListings` | ✅ | |
| Publicar → video de un reel o TikTok | `extractListings` | ✅ imágenes del video | ✅ audio del video |
| Publicar → Desde un enlace (portal, web, post de redes) | `importListingPage` | ✅ | ✅ audio del video del post |
| Excel o feed con columnas desconocidas | `mapImportColumns`, `importSources` | ✅ | |
| Integraciones → Facebook / Instagram conectados | `metaConnect` | ✅ | ✅ video del post |
| Bot de WhatsApp | `whatsappProcessMessage` | ✅ | ✅ notas de voz |
| Correo de ingesta (PDF adjuntos leídos completos por Claude) | `emailProcess` | ✅ | |
| ✨ Ordenar con IA (portada, ambientes, marcas de agua) | `analyzePhotos` | ✅ | |
| ✨ Redactar con IA | `generateListingCopy` | ✅ | |

## Claude: Haiku primero; si falla, Sonnet en la misma llamada

Todo pasa por `_aiStructured` (`functions/index.js`). Cada pedido va primero a **Claude Haiku 5.5** y, si falla por
cualquier motivo, se repite **de inmediato y en la misma llamada** con **Claude Sonnet 5.5**. El usuario nunca tiene que
volver a intentarlo.

Cuenta como falla:
- Error de la API: caída, sobrecarga, límite de uso, tiempo agotado (60 s).
- Respuesta rechazada.
- Respuesta cortada por larga. Si se corta en los dos modelos, Sonnet la arma de nuevo más corta: máximo 12 inmuebles,
  uno por tipología.
- JSON que no se puede leer.
- Resultado que no sirve: ningún inmueble en un texto con datos o en un documento, texto vacío en "Redactar con IA", sin
  fotos en "Ordenar con IA".

Detalles:
- Sin reintentos con Haiku. Sonnet, que es la última opción, reintenta una vez los errores pasajeros.
- Una importación cuenta **una sola vez** en el límite de 30 por hora, aunque use los dos modelos.
- `importEvents` guarda `modelo` y `respaldo` (true si hizo falta Sonnet). En Cloud Logging aparece
  `[función] <modelo> falló` con el motivo.

## Audio: Google Cloud Speech-to-Text

`_transcribe` (`functions/index.js`) acepta OGG/Opus (notas de voz de WhatsApp), WAV (audio de los videos subidos, que el
navegador extrae), MP3 y MP4/AAC (videos de posts). Funciona en dos pasos:

1. **Pedido directo** con el audio, hasta 9 MB. Es el caso normal: notas de voz y reels cortos.
2. Si Google no lo acepta así (audio largo o pesado), **por lotes**. El audio se sube un momento a Cloud Storage
   (`tmp/transcripciones/`), Google lo transcribe, el resultado se espera hasta 2,5 minutos y el archivo se borra.

Si la transcripción falla, la importación sigue con el resto (texto e imágenes) y el error queda en el registro.

## 🔥 Configuración (para Thaiz)

### 1. Claude (Anthropic): obligatorio

1. Entrar a **https://platform.claude.com** con la cuenta de la empresa.
2. **Settings → Billing**: agregar tarjeta o créditos (para empezar, US$ 10–20) y un **límite de gasto** mensual. Una
   suscripción a claude.ai no incluye la API.
3. **Settings → API Keys → Create Key**, con un nombre como `reco-firebase-produccion`. Copiarla: empieza con
   `sk-ant-` y se muestra una sola vez.
4. Guardarla en Firebase:
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
   Pegar la clave cuando lo pida. No dejarla en chats ni en correos; si hace falta, crear otra y desactivar la anterior.

### 2. Google Cloud Speech-to-Text: obligatorio para el audio

En la consola de Google Cloud (**https://console.cloud.google.com**), proyecto `reco-5a5dd`:

1. **APIs y servicios → Biblioteca → "Cloud Speech-to-Text API" → Habilitar.**
2. **IAM y administración → IAM**: a la cuenta de servicio de las funciones (normalmente
   `PROJECT_NUMBER-compute@developer.gserviceaccount.com`; se ve en cada función de Cloud Run o Cloud Functions, pestaña
   "Seguridad") agregarle el rol **"Cloud Speech Client"** (`roles/speech.client`).
3. Para los audios largos (por lotes), Google lee el archivo desde el bucket de Storage del proyecto. Si en el registro
   aparece un error de permiso al transcribir por lotes, dar el rol **"Storage Object Viewer"** sobre ese bucket a la
   misma cuenta de servicio y a la del servicio de Speech-to-Text (`service-PROJECT_NUMBER@gcp-sa-speech.iam.gserviceaccount.com`).
4. (Opcional) Ajustar modelo, región o idioma en `functions/.env` si Google indica que no están disponibles en esa
   combinación:
   ```
   STT_MODEL=chirp_2
   STT_LOCATION=us-central1
   STT_LANGUAGE=es-US
   ```
   Si Google responde que el modelo no existe en esa región, por ejemplo, se cambia aquí sin tocar el código.

No hay clave que guardar: las funciones se identifican solas ante Google.

### 3. (Opcional) Modelos de Claude

En `functions/.env`:
```
AI_MODEL=claude-haiku-5-5
AI_FALLBACK_MODEL=claude-sonnet-5-5
```

### 4. Desplegar y probar

```bash
firebase deploy --only functions
```

Pruebas rápidas después de desplegar:
- **Claude:** Publicar → "Pegar texto" con un aviso corto. Debe aparecer el inmueble.
- **Audio:** subir un video corto de un reel o enviar una nota de voz al bot. En la ficha debe aparecer lo que se dice.
- **Registro:** si algo falla, en Cloud Logging aparece `[función] <modelo> falló`, `[transcribe]` o
  `audio no transcrito`, con el motivo.

### 5. Limpieza

El secreto `OPENAI_API_KEY` ya no se usa. Se puede borrar con `firebase functions:secrets:destroy OPENAI_API_KEY` y
cancelar la cuenta de OpenAI.

## Costo aproximado

Precios de lista; verificar los vigentes.

| Servicio | Precio |
|---|---|
| Claude Haiku 5.5 (principal) | US$ 0,10 / 0,50 por millón de tokens de entrada / salida |
| Claude Sonnet 5.5 (respaldo) | US$ 2 / 10 por millón de tokens de entrada / salida |
| Speech-to-Text (Chirp 2) | ~US$ 0,016 por minuto de audio; los primeros 60 minutos del mes suelen ser gratis |

Una importación de texto cuesta alrededor de US$ 0,001 con Haiku. Una nota de voz de 30 s cuesta menos de un centavo.
