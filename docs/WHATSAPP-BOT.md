# Bot de WhatsApp de ReCo: configuración

El corredor conecta su número a su cuenta, envía sus inmuebles al WhatsApp de ReCo (texto, fotos o
notas de voz) y escribe **LISTO**. El bot le responde con los inmuebles encontrados y un enlace a
`recosac.com/#borradores`, donde los revisa y publica. El código ya está listo
(`functions/index.js` → `whatsappLink`, `whatsappWebhook`, `whatsappProcessMessage`;
`functions/whatsapp-core.js`); falta conectarlo a Meta.

> Mientras no se complete esta guía, el bot queda apagado: la tarjeta "ReCo en tu WhatsApp" no se
> muestra en la web (`_PUB_WA_BOT_NUMBER` vacío) y las tres funciones no se despliegan.

## 1. En Meta (una sola vez)

1. **Cuenta comercial verificada** en [Meta Business Suite](https://business.facebook.com/) (Configuración del negocio → Centro de seguridad → Verificación del negocio).
2. **App**: en [Meta for Developers](https://developers.facebook.com/apps) → Crear app → tipo *Empresa* → agregar el producto **WhatsApp**.
3. **Número**: WhatsApp → Configuración de la API → agregar un número **dedicado** (no puede estar usándose en la app normal de WhatsApp ni en WhatsApp Business). Verificarlo y pedir la aprobación del nombre visible ("ReCo").
4. Anotar:
   - **Phone number ID** (identificador del número, no el número).
   - El número en formato internacional sin "+" (p. ej. `51987654321`).
5. **Token permanente**: Configuración del negocio → Usuarios del sistema → crear uno con rol *Administrador* → asignarle la app y la cuenta de WhatsApp → *Generar token* con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`, sin vencimiento.
6. **App secret**: en la app → Configuración → Básica → *Clave secreta de la app*.
7. Inventar un **verify token** (cualquier texto largo al azar, p. ej. `openssl rand -hex 16`).

## 2. En Firebase

```bash
# Secretos (pide el valor por consola)
firebase functions:secrets:set WHATSAPP_TOKEN          # token permanente (paso 1.5)
firebase functions:secrets:set WHATSAPP_APP_SECRET     # clave secreta de la app (paso 1.6)
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN   # el texto inventado (paso 1.7)

# Parámetro: Phone number ID (paso 1.4)
echo "WHATSAPP_PHONE_NUMBER_ID=123456789012345" >> functions/.env

# Despliegue
firebase deploy --only functions:whatsappLink,functions:whatsappWebhook,functions:whatsappProcessMessage,functions:publishProperty,firestore:rules,storage
```

Anotar la **URL de `whatsappWebhook`** que muestra el despliegue (p. ej. `https://whatsappwebhook-xxxx-rj.a.run.app`).

**Fotos del bot:** se guardan en Storage en `imports/{uid}/…`. Para que se borren solas a los 30 días (las publicadas ya se copiaron a `publications/`):

```bash
gsutil lifecycle set tools/storage-lifecycle-imports.json gs://<bucket-del-proyecto>
```

## 3. Conectar el webhook en Meta

WhatsApp → Configuración → Webhook → *Editar*:
- **URL de devolución de llamada:** la URL de `whatsappWebhook`.
- **Token de verificación:** el mismo `WHATSAPP_VERIFY_TOKEN`.
- *Verificar y guardar*. Luego, en *Campos del webhook*, **suscribirse a `messages`**.

## 4. Activar en la web

En `index.html`, poner el número del paso 1.4 y publicar el sitio:

```js
const _PUB_WA_BOT_NUMBER='51987654321';
```

## 5. Probar

1. En recosac.com → Publicar → Subir varios → **ReCo en tu WhatsApp** → *Conectar mi WhatsApp* → *Abrir WhatsApp* y enviar `VINCULAR 123456`. El bot responde "quedó conectado".
2. Enviar un texto ("Vendo dpto. en Surco, 3 dorm, 90 m2, US$ 185 mil"), 2 fotos y una nota de voz. Escribir **LISTO**.
3. El bot responde con el resumen y el enlace. En `#borradores` aparece el inmueble con sus fotos.
4. Publicarlo y comprobar que las fotos estén en la publicación.

En Firestore se ven: `whatsappLinks` (número → cuenta), `whatsappSessions` (mensajes pendientes), `whatsappInbox` (mensajes recibidos), `importDrafts` (`source: 'whatsapp'`, `photoUrls`) e `importEvents` (`kind: 'bot'`).

## Comandos del bot

| El corredor escribe | El bot |
|---|---|
| `VINCULAR 123456` | Conecta el número con la cuenta (código de la web, vence en 15 min, un solo uso) |
| Texto, fotos, notas de voz | Los guarda (confirma solo el primero) |
| `LISTO` | Transcribe las notas de voz, guarda las fotos, busca los inmuebles y responde con el resumen |
| `CANCELAR` | Borra lo que tenía guardado |
| `AYUDA` / `HOLA` | Explica cómo usarlo |
| PDF, Word, stickers, videos… | Pide subir esos archivos en la web |

## Costos y límites

- **Meta:** las respuestas del bot van dentro de la ventana de 24 h que abre el corredor al escribir (conversación de servicio). Revisa la tarifa vigente para Perú en la [página de precios de WhatsApp Business](https://developers.facebook.com/docs/whatsapp/pricing).
- **OpenAI:** la transcripción de notas de voz (máx. 5 por envío) y la extracción, igual que en la web.
- **Límites:** 30 procesamientos por hora y usuario (compartido con la web), 80 mensajes y 30 fotos por envío y 16 MB por archivo.
- **Privacidad:** se guardan el teléfono (para vincularlo a la cuenta) y los mensajes hasta procesarlos. Como en el resto del importador, los teléfonos y correos se quitan de las descripciones.
