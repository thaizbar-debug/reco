# API pública de ReCo (v1)

Para que un CRM, la web de una inmobiliaria o un integrador publique y mantenga inmuebles en
ReCo sin pasar por la web.

- **URL base:** `https://southamerica-east1-reco-5a5dd.cloudfunctions.net/api`
- **Formato:** JSON (`Content-Type: application/json`), UTF-8.
- **Moderación:** todo lo que se crea, o cuyo contenido cambia, queda **pendiente de revisión** del
  equipo de ReCo (`status: "pending"`) antes de mostrarse en la búsqueda, igual que una publicación
  hecha en la web.

## Autenticación

1. En recosac.com → **Mi cuenta → Integraciones → API para desarrolladores → Crear clave**.
2. La clave (`reco_live_…`) se muestra **una sola vez**: guárdala como un secreto. ReCo solo guarda
   su huella (hash).
3. Envíala en cada pedido:

```
Authorization: Bearer reco_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

(también se acepta la cabecera `X-Api-Key`). Puedes tener hasta 3 claves activas y revocarlas
cuando quieras.

**Límite:** 120 pedidos por minuto por clave (después, `429`).

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/v1/ping` | Prueba la clave |
| `GET` | `/v1/properties?status=&page=` | Lista tus publicaciones (50 por página, más recientes primero) |
| `GET` | `/v1/properties/{id}` | Una publicación |
| `POST` | `/v1/properties` | Crea. Con `external_id`, **crea o actualiza** (upsert) |
| `PATCH` | `/v1/properties/{id}` | Actualiza solo los campos enviados |
| `DELETE` | `/v1/properties/{id}` | Retira la publicación (`status: "withdrawn"`, deja de mostrarse) |

`status`: `pending` (en revisión), `approved` (visible), `rejected` (ver `rejection_reason`),
`withdrawn` (retirada). Un `PATCH` sobre una publicación retirada la vuelve a enviar a revisión.

## Campos

Se aceptan en **inglés**, con nombres **RESO** o con los de la **plantilla de carga masiva** de
ReCo. Pasan por los mismos sinónimos y abreviaturas que el resto de la plataforma (`"Dpto."` →
Departamento, `"Vta"` → Venta, `"US$ 185,000"` → 185000 USD, `"En planos"` → En proyecto con
antigüedad 0, etc.).

| Campo (inglés) | RESO | Plantilla | Notas |
|---|---|---|---|
| `external_id` | `ListingKey`, `ListingId` | — | Tu id. Con él, `POST` actualiza en vez de duplicar |
| `type` | `PropertyType`, `PropertySubType` | `tipo_propiedad` | Departamento, Casa, Oficina, Local comercial, Terreno, Otros |
| `operation` | — | `tipo_publicacion` | Venta o Alquiler |
| `price` | `ListPrice` | `precio` | Número o texto (`"S/ 450 mil"`) |
| `currency` | `CurrencyCode` | `tipo_moneda` | USD o PEN (si no viene, se toma del precio) |
| `address` | `UnparsedAddress` | `direccion` | |
| `district` | `City` | `distrito` | Distrito (Lima y Callao se normalizan: "Surco" → Santiago de Surco) |
| `lat`, `lng` | `Latitude`, `Longitude` | `latitud`, `longitud` | Si no vienen, ReCo intenta ubicar la dirección |
| `area_built` | `LivingArea` | `area_techada` | m². **Obligatoria** salvo en Terreno |
| `area_land` | `LotSizeArea` | `area_terreno` | m². **Obligatoria en Terreno** |
| `bedrooms` | `BedroomsTotal` | `nro_dormitorios` | |
| `bathrooms` | `BathroomsTotalInteger` | `nro_banos` | |
| `parking` | `ParkingTotal` | `nro_estacionamientos` | |
| `floor` | `EntryLevel` | `piso` | |
| `unit_floors` | `Stories` | `niveles` | 2 = dúplex |
| `building_floors` | `StoriesTotal` | `nro_pisos` | |
| `age` / `year_built` | `YearBuilt` | `antiguedad` | Años o año de construcción |
| `construction_status` | `DevelopmentStatus` | `estado` | Construido, En proyecto, En construcción |
| `elevator`, `furnished`, `pet_friendly` | `Furnished`, `PetsAllowed` | `ascensor`, `amoblado`, `pet_friendly` | `true` / `false` |
| `features` | — | `etiquetas_*` | Lista: `["Gimnasio", "Vista al mar", "Balcón"]` |
| `title` | — | `titulo` | Obligatorio, máx. 200 |
| `description` | `PublicRemarks` | `descripcion` | Obligatoria, máx. 5000. Teléfonos y correos se quitan |
| `photos` | `Media` (`MediaURL`) | — | Hasta 12 URLs públicas JPG/PNG/WEBP; ReCo las descarga |

Los campos desconocidos se ignoran y se informan en `warnings`.

### Verificación previa a publicar

La misma de la web: dirección, distrito, título, descripción, tipo, operación, moneda y precio mayor
que 0; el área según el tipo (Terreno exige área de terreno y no área techada; Departamento,
Oficina y Local exigen área techada; Casa, techada). En un Terreno, dormitorios, baños, pisos y
similares se guardan en 0. Si algo falla: `422` con la lista en `error.errors`.

## Ejemplos

```bash
curl -X POST "$BASE/v1/properties" \
  -H "Authorization: Bearer $RECO_KEY" -H "Content-Type: application/json" \
  -d '{
    "external_id": "CRM-1001",
    "type": "Departamento", "operation": "Venta",
    "price": 185000, "currency": "USD",
    "address": "Av. Larco 1234", "district": "Miraflores",
    "area_built": 90, "bedrooms": 3, "bathrooms": 2, "elevator": true,
    "features": ["Gimnasio", "Vista al mar"],
    "title": "Departamento con vista al mar en Miraflores",
    "description": "Departamento luminoso a dos cuadras del malecón.",
    "photos": ["https://micrm.com/fotos/1001-1.jpg"]
  }'
```

Respuesta `201`:

```json
{
  "data": {
    "id": "pX8k…", "external_id": "CRM-1001", "status": "pending",
    "type": "Departamento", "operation": "Venta", "currency": "USD", "price": 185000,
    "area": 90, "area_built": 90, "area_land": 0, "bedrooms": 3,
    "photos": ["https://firebasestorage.googleapis.com/…"],
    "reso": { "ListingKey": "pX8k…", "ListPrice": 185000, "StandardStatus": "Coming Soon", "…": "…" }
  },
  "warnings": []
}
```

Bajar el precio (sigue aprobada; cambios de título, descripción, dirección, distrito, tipo,
operación, moneda, fotos o un precio que cambia más de 50 % vuelven a revisión):

```bash
curl -X PATCH "$BASE/v1/properties/pX8k…" -H "Authorization: Bearer $RECO_KEY" \
  -H "Content-Type: application/json" -d '{"price": 179000}'
```

Retirar (vendido):

```bash
curl -X DELETE "$BASE/v1/properties/pX8k…" -H "Authorization: Bearer $RECO_KEY"
```

## Errores

```json
{ "error": { "code": "invalid-argument", "message": "área de terreno obligatoria para Terreno.", "errors": ["área de terreno obligatoria para Terreno"] } }
```

| HTTP | `code` | Cuándo |
|---|---|---|
| 401 | `unauthenticated` | Falta la clave, es inválida o está revocada |
| 404 | `not-found` | La publicación no existe o no es tuya; ruta desconocida |
| 409 | `failed-precondition` | La operación no se puede hacer ahora |
| 422 | `invalid-argument` | No pasa la verificación previa a publicar |
| 429 | `resource-exhausted` | Más de 120 pedidos por minuto |
| 500 | `internal` | Error de ReCo: reintenta |

## Webhooks

En **Integraciones → Webhook** registra una URL `https://` pública. ReCo envía un `POST` por evento:

| Evento | Cuándo |
|---|---|
| `property.created` | Se creó una publicación (web, carga masiva, conexión automática o API) |
| `property.approved` / `property.rejected` | La moderación la aprobó o la rechazó |
| `property.pending` | Volvió a revisión (por ejemplo, cambió la descripción) |
| `property.withdrawn` | Se retiró (API, conexión automática o el dueño) |
| `property.deleted` | Se eliminó |
| `lead.created` | Alguien pidió contacto por uno de tus inmuebles |
| `ping` | Botón "Probar" |

```json
{ "id": "evt_…", "type": "property.approved", "created_at": "2026-10-25T14:00:00.000Z", "data": { "id": "pX8k…", "status": "approved", "…": "…" } }
```

**Firma.** Cada envío trae `X-Reco-Signature: t=<unix>,v1=<hex>`, donde
`v1 = HMAC-SHA256(secreto, "<t>.<cuerpo>")`. El secreto (`whsec_…`) está en Integraciones.
Verifícala y descarta envíos con `t` de más de 5 minutos:

```js
const [, t, v1] = req.get('X-Reco-Signature').match(/^t=(\d+),v1=([0-9a-f]+)$/);
const esperado = crypto.createHmac('sha256', process.env.RECO_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(esperado)) && Math.abs(Date.now() / 1000 - t) < 300;
```

Responde `2xx` en menos de 10 s. Si falla, ReCo reintenta 2 veces (a los 2 y 6 s); el último
resultado se ve en Integraciones.

## Otras formas de integrarse

- **Conexión automática** (sin programar): si tu CRM o tu web ya genera un feed XML (Kyero u
  otro), JSON o CSV, o tu inventario está en Google Sheets, EasyBroker o Wasi, conéctalo en
  Integraciones y ReCo lo sincroniza solo cada 6, 12 o 24 horas.
- **Correo:** reenvía fichas a tu dirección personal de Integraciones.
