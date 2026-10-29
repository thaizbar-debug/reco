# Integraciones (Fase 3): puesta en marcha

Qué hay y qué falta configurar para activarlo. El código está en `functions/index.js`
(secciones "Conexiones automáticas", "API pública" y "Correo de ingesta") y
`functions/feed-core.js`; la pantalla está en **Mi cuenta → 🔌 Integraciones** (`#integraciones`).

## 1. Conexiones automáticas (feeds, Google Sheets, EasyBroker, Wasi)

No necesitan cuentas externas de ReCo: cada inmobiliaria pone su propio enlace o su clave.

| Fuente | Qué pone el usuario |
|---|---|
| Feed | URL de un feed XML (Kyero u otro), JSON o CSV |
| Google Sheets | Enlace de la hoja, compartida como "Cualquier persona con el enlace → Lector" o publicada en la web |
| EasyBroker | Clave de API (EasyBroker → Configuración → Integraciones → API) |
| Wasi | Id de empresa + token (Wasi → Configuración → API; requiere plan Pro) |

**Desplegar:**

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions:importSources,functions:syncImportSources,functions:publishProperty
```

- `firestore:indexes` crea el índice `importSources (estado, nextRunAt)` que usa la tarea
  programada y la política TTL de `emailInbox.expiresAt`. Revisar en la consola que el índice
  quede *Enabled* y el TTL *Serving*.
- `syncImportSources` es una **tarea programada (cada hora)**: Firebase crea el job de Cloud
  Scheduler al desplegar. La primera vez puede pedir habilitar la API de Cloud Scheduler.
- Cada corrida procesa como máximo 8 conexiones, 1000 inmuebles por conexión, 25 inmuebles con
  fotos nuevas y 80 detalles de CRM; lo que no alcanza queda para la siguiente hora.

**Opcional — ubicar en el mapa lo que llega sin coordenadas** (feeds y API):

```bash
echo "HERE_API_KEY=xxxxxxxx" >> functions/.env   # clave de HERE para servidor (no la del navegador)
```

Sin esta clave los inmuebles se publican igual, sin punto en el mapa hasta que el dueño o un admin
los ubique.

**Verificado con datos de prueba, no contra cuentas reales:** los adaptadores de EasyBroker
(`GET /v1/properties` + detalle, cabecera `X-Authorization`) y Wasi (`POST /v1/property/search`)
siguen sus APIs públicas, pero hay que probarlos con una cuenta real antes de anunciarlos.

## 2. API pública

```bash
firebase deploy --only functions:api,functions:apiAccess,functions:apiWebhookPublication,functions:apiWebhookLead
```

- URL: `https://southamerica-east1-reco-5a5dd.cloudfunctions.net/api` (está en `_API_BASE` en
  `index.html` y en `docs/API.md`). Si el despliegue muestra otra URL, actualizar ambos.
- `api` es una función HTTP **pública** (la autenticación es la clave de API). Si la organización
  de Google Cloud bloquea `allUsers` como invocador, hay que permitirlo para esta función.
- Documentación para integradores: `docs/API.md` (se publica con el sitio en
  `recosac.com/docs/API.md`).

## 3. Correo de ingesta (Postmark Inbound)

1. Crear una cuenta en [Postmark](https://postmarkapp.com) → servidor "ReCo" → **Inbound**.
2. Copiar la dirección de entrada (p. ej. `abc123@inbound.postmarkapp.com`). Opcional: usar un
   dominio propio (`importar.recosac.com`) con su registro MX según la guía de Postmark.
3. Inventar un secreto largo (`openssl rand -hex 24`) y guardarlo:

   ```bash
   firebase functions:secrets:set INBOUND_EMAIL_SECRET
   echo "INBOUND_EMAIL_ADDRESS=abc123@inbound.postmarkapp.com" >> functions/.env
   firebase deploy --only functions:emailIngest,functions:emailInbound,functions:emailProcess
   ```

4. En Postmark → Inbound → **Webhook URL**:
   `https://postmark:<SECRETO>@<URL de emailInbound>` (la URL la muestra el despliegue). Activar
   "Include raw email content" **no** es necesario.
5. Probar: en Integraciones copiar la dirección personal (`abc123+código@…`), reenviarle un correo
   con una ficha y fotos; debe llegar la respuesta con el enlace a `#borradores`.

- Los adjuntos se guardan en Storage en `imports/{uid}/…` (la regla de
  `tools/storage-lifecycle-imports.json` los borra a los 30 días) y el correo en `emailInbox`
  (TTL de 30 días).
- Los PDF adjuntos se envían a la IA como archivo (máx. 2 por correo, 10 MB c/u). Word y Excel no:
  la respuesta pide subirlos en la web.

> ⚠️ Mientras no se configure, la tarjeta "Correo para publicar" dice "Muy pronto" y las tres
> funciones de correo **no deben desplegarse** (falta el secreto `INBOUND_EMAIL_SECRET`). No usar
> `firebase deploy --only functions` (todas) hasta crear ese secreto y los del bot de WhatsApp.

## Colecciones nuevas de Firestore (todas escritas solo por el servidor)

| Colección | Qué guarda | Lectura desde la web |
|---|---|---|
| `importSources` | Conexiones automáticas: tipo, enlace, mapeo, frecuencia, último resultado | El dueño |
| `importSourceSecrets` | Claves de EasyBroker / Wasi | Nadie |
| `apiKeys` | Hash de cada clave de API, prefijo, uso | Nadie |
| `apiAccounts` | URL del webhook, secreto, último envío | Nadie |
| `apiUsage` | Contador por minuto de cada clave | Nadie |
| `emailIngestTokens` / `emailIngestUsers` | Código de la dirección personal ↔ usuario | Nadie |
| `emailInbox` | Correos recibidos (texto y rutas de adjuntos), 30 días | Nadie |

Campos nuevos en `publications`: `status: 'withdrawn'` (retirada; con `withdrawnBy`,
`withdrawnFrom`, `withdrawnReason`), `syncSourceId`, `syncKey`, `syncHash`, `syncRaw`,
`syncPhotos`, `syncVersion`, `syncSourceName`, `syncError`, `apiExternalId`, `apiPhotoSources`;
`source` puede ser `feed`, `api` o `email`. En `importDrafts`: `syncSourceId`, `syncKey`,
`syncRow`, `syncRaw`… y `source: 'feed' | 'email'`.
