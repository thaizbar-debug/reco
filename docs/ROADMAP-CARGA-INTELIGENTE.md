# Roadmap: carga de inmuebles "desde donde sea"

> Objetivo: que un corredor, propietario o inmobiliaria pueda subir su inventario a ReCo
> **sin rehacer nada**, partiendo de lo que ya tiene: un Excel propio, un chat de WhatsApp,
> sus notas de texto o sus avisos en Urbania, Adondevivir, Properati, Babilonia, Nexo, etc.

---

## 1. Punto de partida (lo que ya existe en ReCo)

| Pieza | Dónde | Estado |
|---|---|---|
| Publicación individual manual | `index.html` (modal de publicación) | ✅ |
| Carga masiva con plantilla de 30 columnas (XLSX/CSV) | `index.html` `_PUB_TPL_COLS`, `_pubBulkFile` | ✅ |
| Mapeo de columnas por sinónimos ("tu archivo usa otros nombres") | `_pubBulkGuessMap`, `_PUB_MAP_SYNONYMS` | ✅ básico |
| Paso de validación/edición fila por fila + fotos por fila | `_pubBulkValidateHTML`, `_pubBulkPhotosHTML` | ✅ |
| Publicación server-side con moderación (`status: 'pending'`) | `functions/index.js` `publishProperty` | ✅ |
| IA ya integrada (redacción de títulos/descripciones) con rate limit | `functions/index.js` `generateListingCopy` | ✅ |
| Geocodificación (Google Places + HERE) | `index.html` | ✅ |

**Conclusión:** ReCo ya tiene el 60 % de la tubería. Lo que falta no es otra pantalla de carga
por cada canal, sino **un único motor de extracción** que convierta *cualquier* entrada en
filas del esquema de 30 columnas y las deje en la bandeja de revisión que ya existe.

---

## 2. Qué hacen las mejores plataformas (benchmark)

| Plataforma / estándar | Cómo reciben inventario | Lección para ReCo |
|---|---|---|
| **Zillow (EE. UU.)** | Feed XML/MITS de socios aprobados + publicación manual en Rental Manager; sindicación vía CRMs (Rentvine, ShowMojo…) | Los grandes no cargan a mano: **sincronizan un feed** desde su software. |
| **MLS / RESO (EE. UU., +500 MLS)** | RESO Web API (OData) + Data Dictionary 2.0 como vocabulario común | Adoptar un **esquema canónico estable** con nombres estándar facilita integrarse con cualquiera. |
| **idealista (España)** | Importa feeds XML (formato Kyero) publicados por el CRM de la agencia; idealista es dueño del CRM Inmovilla | **Feed URL + sincronización programada** es la norma europea; tener CRM propio retiene a la agencia. |
| **EasyBroker (MX/LatAm)** | API REST pública (`/properties`, MLS entre agencias) | Una **API pública con API key** convierte a ReCo en destino de sindicación de otros CRMs. |
| **Tokko Broker (AR/PE/EC, Navent)** | CRM que difunde automáticamente a Urbania/Adondevivir | El CRM dominante en Perú pertenece al dueño de Urbania → **no contar con su cooperación**; ofrecer importación por archivo/enlace como alternativa. |
| **Bayut / Property Finder (EAU)** | App móvil para agentes (Profolio) + APIs para CRMs; WhatsApp usado para leads | **App/canal móvil** para publicar en 1 minuto desde el teléfono. |
| **Herramientas IA (PropertyListingsAI, Rankbreeze…)** | Fotos + datos sueltos → anuncio completo con IA | La IA ya es aceptada para **generar ficha desde fotos y texto libre**. |
| **CRMs LatAm (Mapaprop, Wasi)** | "Importar propiedad por URL" desde portales | **Importar por enlace** es una función que ya existe en la región: es esperable, no exótica. |

Patrón común: **(a)** canales de entrada múltiples → **(b)** un modelo de datos canónico →
**(c)** borrador revisable → **(d)** publicación/moderación → **(e)** sincronización continua para los grandes.

---

## 3. Arquitectura propuesta: un motor, muchos canales

```
 Excel cualquiera ─┐
 Texto / notas ────┤
 Chat WhatsApp ────┤                       ┌─────────────────────┐
 Enlace de portal ─┼─► extractListings() ─► importDrafts (borradores) ─► Bandeja de revisión ─► publishProperty
 PDF / flyer ──────┤   (Cloud Function, IA  │ 30 columnas + fotos │   (UI de carga masiva     (moderación
 Bot WhatsApp ─────┤    + parsers)          │ + confianza x campo │    ya existente)           existente)
 Feed / API ───────┘                       └─────────────────────┘
```

Principios:

1. **Un solo esquema canónico** = las 30 columnas actuales (`_PUB_TPL_COLS`). Documentar su
   equivalencia con RESO Data Dictionary (`ListPrice`, `BedroomsTotal`, `LivingArea`…) para futuros feeds.
2. **Todo entra como borrador**, nunca se publica directo. Colección nueva `importDrafts/{id}`
   con `source` (`excel|text|whatsapp|url|pdf|feed`), `sourceRef`, `confidence` por campo y `uid`.
3. **La IA nunca inventa datos duros**: precio, área, dormitorios, dirección → `null` si no están
   en la fuente. Los campos rellenados por IA se marcan visualmente en la revisión.
4. **Se cobra en llaves al publicar, no al extraer** (`_PUB_BULK_COST_PER` sigue igual). Extraer es gratis
   con un rate limit similar a `AI_COPY_LIMIT_PER_HOUR`.
5. **Deduplicación**: huella `distrito + área + precio + dormitorios` (+ URL de origen) para avisar
   "esta propiedad ya la subiste".
6. **Datos personales** (Ley 29733): eliminar teléfonos/nombres de propietarios que aparezcan en
   chats o notas antes de guardar la descripción pública.

---

## 4. Roadmap por fases

Prioridad = impacto en número de corredores × facilidad técnica.

### Fase 0 — Cimientos (1–2 semanas)

| # | Entregable | Detalle |
|---|---|---|
| 0.1 | Colección `importDrafts` + reglas Firestore | Solo el dueño lee/escribe; TTL de 30 días para borradores abandonados. |
| 0.2 | Cloud Function `extractListings` | Entrada: `{ kind, text?, rows?, url?, fileRef? }`. Salida: array de filas del esquema canónico + `confidence`. Usa salida estructurada (JSON Schema) del LLM; reutiliza el secreto/patrón de `generateListingCopy`. |
| 0.3 | Normalizadores deterministas | "S/ 450 mil", "US$185k", "120m2", "3 dorm", "Mira­flores" → valores limpios. Se ejecutan **antes** de la IA (más barato y predecible). |
| 0.4 | Bandeja de revisión genérica | Reutilizar `_pubBulkValidateHTML` alimentándola desde `importDrafts`; resaltar campos con baja confianza. |
| 0.5 | Métricas | Por canal: borradores creados, % publicados, % de campos corregidos por el usuario, tiempo hasta publicar. |

#### Estado de la Fase 0: implementada

| # | Dónde quedó |
|---|---|
| 0.1 | `firestore.rules` → `/importDrafts` (solo el dueño; el cliente solo crea borradores `excel`/`csv`, los de IA los escribe el servidor), `/importUsage`, `/importEvents`. TTL sobre `expiresAt` en `firestore.indexes.json`. |
| 0.2 | `functions/index.js` → `extractListings` (`kind: 'text'`, canal `text`/`whatsapp`). Salida estructurada estricta (`gpt-4o-mini`, temperatura 0) + `guardInvented` + `normalizeRow`. Límite de 30 llamadas/hora y 50 inmuebles por llamada. |
| 0.3 | `functions/shared/import-core.js` → módulo único que usan el navegador (`window.RecoImport`) y el servidor. Incluye `RESO_MAP` y limpieza de teléfonos y correos. Tests: `cd functions && npm test`. |
| 0.4 | `index.html` → la carga masiva normaliza todas las filas, las guarda como borradores, muestra "Retomar / Descartar", resalta los campos de IA (borde punteado) y avisa de duplicados. `publishProperty` borra el borrador en la misma transacción en que publica. |
| 0.5 | `importEvents` (por extracción: canal, caracteres, inmuebles, ms) y, en cada publicación importada, `importChannel`, `importAiFields`, `importEdits` y `fingerprint`. |

Despliegue: `firebase deploy --only functions:extractListings,functions:publishProperty,firestore:rules,firestore:indexes`.
Como `index.html` carga `functions/shared/import-core.js`, ese archivo tiene que publicarse junto con el sitio.

### Fase 1 — Quick wins: "pega lo que tengas" (3–5 semanas) ⭐ máxima prioridad

| # | Canal | Cómo funciona | Por qué primero |
|---|---|---|---|
| 1.1 | **Excel de cualquier formato** | Si los sinónimos no reconocen las columnas obligatorias, se envían cabeceras + 5 filas de muestra a `extractListings` para proponer el mapeo. Detectar la fila de cabecera (no siempre es la 1), recorrer todas las hojas, separar celdas combinadas ("3D/2B"). **"Recordar mi formato"**: guardar el mapeo por usuario para la próxima carga. | Ya existe 80 % del flujo; elimina la plantilla como requisito. |
| 1.2 | **Pegar texto libre** (notas, mensajes, avisos) | Nueva pestaña "Pegar texto" con un textarea. La IA separa N inmuebles de un bloque de texto y los convierte en filas. | Cubre notas del celular, mensajes de WhatsApp copiados y avisos de cualquier web con **un solo** desarrollo. |
| 1.3 | **Chat de WhatsApp exportado** | El corredor usa *Exportar chat → Incluir archivos* (genera un `.zip` con `_chat.txt` + fotos). ReCo descomprime en el navegador, agrupa mensajes y fotos por cercanía temporal y remitente, y extrae los inmuebles con fotos ya asignadas. | Resuelve "solo trabajo por WhatsApp" **sin** necesitar todavía la API de Meta. |
| 1.4 | **Importar desde enlace** (Urbania, Adondevivir, Properati, Babilonia, Nexo, Mercado Libre, etc.) | El usuario pega la URL **de su propio aviso**. La función descarga la página y lee primero datos estructurados (JSON-LD `schema.org`, Open Graph, `__NEXT_DATA__`) y, si no basta, pasa el texto a la IA. Las fotos se copian a Storage. Checkbox obligatorio: "Declaro que soy el anunciante o tengo autorización". | El corredor ya hizo el trabajo de carga en otro portal: reutilizarlo es el mayor ahorro de tiempo. |
| 1.5 | **Plan B del enlace: marcador "Enviar a ReCo"** | Si el portal bloquea la descarga desde servidor (anti-bots), ofrecer un *bookmarklet* que el usuario arrastra a su barra; al pulsarlo en su aviso, envía el contenido de la página (que su navegador ya cargó) a ReCo. | Evita bloqueos y no depende de scraping desde nuestros servidores. |

### Fase 2 — Canales móviles y multimedia (1–3 meses)

| # | Canal | Cómo funciona |
|---|---|---|
| 2.1 | **Bot de WhatsApp de ReCo** (WhatsApp Business Cloud API) | El corredor vincula su número (OTP) y envía al número de ReCo fotos + texto o **nota de voz** (se transcribe). El bot responde con un resumen ("Depa 3D/2B, 85 m², Miraflores, US$185,000 — ¿falta algo?") y un enlace para revisar y publicar en un toque. Requiere verificación de empresa en Meta y presupuesto por mensajes: validar la tarifa vigente de Meta para Perú antes de lanzar. |
| 2.2 | **Fotos en bloque con auto-agrupación** | Subir 200 fotos de golpe; se agrupan por fecha/hora EXIF y similitud, se clasifican (cocina, baño, fachada) y se elige portada. Alerta de fotos con marca de agua de otros portales. |
| 2.3 | **Importar perfil completo de un portal** | Pegar la URL del perfil de la inmobiliaria en un portal → listar todos sus avisos → importar en lote (mismo motor que 1.4). |
| 2.4 | **PDF, fichas técnicas y flyers (imagen)** | Lectura con modelo de visión: brochures de proyectos, fichas de captación, capturas de pantalla. |
| 2.5 | **PWA "Publicar rápido"** | Botón de compartir del celular → ReCo (Web Share Target): compartir fotos o texto desde la galería o WhatsApp directamente al importador. |

### Fase 3 — Sincronización para inmobiliarias grandes (3–6 meses)

| # | Entregable | Detalle |
|---|---|---|
| 3.1 | **Feed por URL** (XML/JSON/CSV) | La agencia registra la URL del feed que ya genera su CRM o web. ReCo lo lee cada X horas: crea, actualiza precios y **despublica** lo que desaparece. Aceptar formatos comunes (Kyero/idealista, genéricos de CRMs LatAm) con mapeo asistido por IA la primera vez. |
| 3.2 | **Google Sheets conectado** | Para quien ya mantiene su inventario en una hoja de cálculo: vincular la hoja y sincronizar cambios. |
| 3.3 | **API pública de ReCo** | API key por cuenta, endpoints `POST/PATCH/DELETE /properties`, webhooks de estado (aprobado/rechazado/lead). Nombres de campos alineados con RESO. Habilita integraciones con EasyBroker, Wasi, webs propias de inmobiliarias y desarrolladores. |
| 3.4 | **Conectores directos a CRMs locales** | Priorizar los que tengan API abierta (EasyBroker, Wasi). Tokko Broker pertenece a Navent (dueño de Urbania/Adondevivir): no depender de él; cubrirlo con 1.4/2.3 y 3.1. |
| 3.5 | **Email de ingesta** | `publica+<id>@…`: reenviar un correo con ficha/fotos crea un borrador. |

---

## 5. Matriz de priorización

| Iniciativa | Usuarios beneficiados | Esfuerzo | Dependencias | Orden |
|---|---|---|---|---|
| 1.2 Pegar texto | Todos (notas, WhatsApp, webs) | Bajo | 0.2 | **1** |
| 1.1 Excel cualquiera + recordar formato | Inmobiliarias con mucho inventario | Bajo | 0.2, 0.3 | **2** |
| 1.4 / 1.5 Importar por enlace | Corredores ya activos en portales | Medio | 0.2, Storage | **3** |
| 1.3 Chat WhatsApp exportado | Corredores "solo WhatsApp" | Medio | 0.2 | **4** |
| 2.5 PWA compartir | Usuarios móviles | Bajo | 1.2 | 5 |
| 2.1 Bot WhatsApp | Corredores "solo WhatsApp" | Alto | Meta Business, 0.2 | 6 |
| 2.2 Fotos en bloque | Todos | Medio | — | 7 |
| 3.1 Feed por URL | Inmobiliarias grandes | Alto | Esquema canónico | 8 |
| 3.3 API pública | Agencias/CRMs | Alto | 3.1 | 9 |

---

## 6. Cómo proceder (siguientes 30 días)

1. **Semana 1** — Definir el esquema canónico (30 columnas + mapeo RESO) y el contrato de
   `extractListings`. Reunir un **set de prueba real**: 20 Excels de corredores, 20 textos de
   notas/WhatsApp y 20 URLs de avisos de distintos portales.
2. **Semana 2** — Implementar `extractListings` (texto) + normalizadores + `importDrafts`.
   Medir precisión campo por campo contra el set de prueba (meta: ≥ 95 % en precio, área,
   distrito y operación; ningún dato inventado).
3. **Semana 3** — Lanzar **"Pegar texto"** y el **mapeo IA para Excel** con 10 corredores piloto.
   Añadir tests Playwright como los de `tests/bulk-upload.spec.js` (con la IA simulada).
4. **Semana 4** — Importar por enlace para los 3 portales más usados por los pilotos (empezar
   por los que exponen JSON-LD/`__NEXT_DATA__`) + bookmarklet como respaldo.
5. Con los datos del piloto, decidir entre **bot de WhatsApp** (si la mayoría trabaja solo por
   WhatsApp) o **feeds/API** (si el volumen viene de inmobiliarias grandes).

### Indicadores de éxito

- Tiempo medio para publicar el primer inmueble: objetivo < 3 minutos.
- % de inmuebles nuevos que entran por canales "sin plantilla": objetivo > 50 % a 3 meses.
- % de campos que el usuario corrige tras la extracción: objetivo < 10 %.
- Inmuebles por cuenta de inmobiliaria activa (debería multiplicarse con Excel libre y feeds).

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| La IA inventa precio o área | Esquema con `null` permitido, regla "solo datos presentes en la fuente", resaltado y confirmación obligatoria antes de publicar. |
| Términos de uso de portales / scraping | Importar solo URLs individuales que el usuario declara como suyas, sin rastreo masivo; bookmarklet ejecutado por el propio usuario; respetar bloqueos; registrar `sourceUrl` para auditoría. |
| Publicación de avisos ajenos (fraude) | Moderación existente + deduplicación + alerta de marcas de agua de otros portales. |
| Costos de IA | Normalizadores deterministas primero, IA solo para lo ambiguo; rate limit por usuario; cachear el mapeo de Excel por usuario. |
| Datos personales en chats/notas | Limpieza de teléfonos/nombres antes de guardar; borradores con TTL; aviso de privacidad actualizado. |
| Dependencia de Meta (bot WhatsApp) | Fase 1.3 (chat exportado) y 2.5 (compartir) cubren el caso sin API de Meta. |

---

### Fuentes consultadas

- Zillow Rentals Feed Integrations — https://www.zillowgroup.com/developers/api/rentals/rentals-feed-integrations/
- Rentec Direct, cambios en sindicación de Zillow — https://www.rentecdirect.com/blog/zillow-rental-listing-changes/
- RESO Common Format (RESOStandards) — https://github.com/RESOStandards/transport/blob/23a935c6009d526de6ad843179acad6062455f73/reso-common-format.md
- Kyero/idealista XML import — https://www.wp-immomakler.de/en/kyero-idealista-inmobalia-immobilien-import-export-wordpress-plugin/
- Houzez Property Feed (formato idealista) — https://wordpress.org/plugins/houzez-property-feed/
- EasyBroker API (gem oficial) — https://github.com/easybroker/easybroker_gem
- Tokko Broker (alternativas y mercados) — https://www.comparasoftware.com/tokko-broker
- Diseño web inmobiliarias Lima (Tokko/EasyBroker y portales) — https://kom.pe/diseno-web-inmobiliarias-lima/
- Mapaprop, importar propiedades por URL — https://help.mapaprop.com/en/help/propiedades/importar-propiedades/importar-propiedades-por-url
- PropBridge (APIs de Property Finder/Bayut) — https://www.bitrix24.com/apps/app/vortexweb.property_leads/
- PropertyListingsAI — https://topai.tools/t/propertylistingsai
- Rankbreeze AI Listing Writer — https://support.rankbreeze.com/en/articles/15282318-create-a-high-converting-airbnb-listing-with-rankbreeze-s-ai-listing-writer
- WhatsApp API para inmobiliarias en LatAm — https://reach.tools/industria/bienes-raices-2/
