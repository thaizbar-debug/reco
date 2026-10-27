# Captar inmuebles desde redes sociales

La mayoría de corredores tiene su inventario publicado en **Facebook, Instagram o TikTok**. ReCo
ofrece tres caminos, de menos a más completo:

| Camino | Qué hace el corredor | Qué necesita ReCo |
|---|---|---|
| **1. Enlace de un post** | Pega el enlace de su post (o lo comparte a ReCo desde el celular) en *Publicar → Subir varios → Desde un enlace* | Nada: ya funciona al desplegar `importListingPage` |
| **2. Video o captura** | Sube el video del reel/TikTok (MP4/MOV) o una captura del post | Nada: `extractListings` |
| **3. Conectar su página** | *Mi cuenta → Integraciones → Conectar con Facebook*, elige posts y los importa todos | App de Meta (abajo) |

## 1. Enlace de un post — cómo se lee

Ninguna red deja leer un post sin iniciar sesión, así que se usan sus **vías públicas para
insertar posts en otras webs** (`functions/social-core.js`):

| Red | Enlaces aceptados | Fuente |
|---|---|---|
| Facebook | `facebook.com/share/…`, `/share/v/…`, `/posts/…`, `/reel/…`, `/watch?v=`, `/photo?fbid=`, `fb.watch` | `facebook.com/plugins/post.php` o `plugins/video.php` (posts públicos de páginas y perfiles) |
| Instagram | `/p/…`, `/reel/…`, `/tv/…`, `/share/…` | `instagram.com/p/{código}/embed/captioned/` (texto, todas las fotos del carrusel y el video) |
| TikTok | `tiktok.com/@…/video/…`, `vm.tiktok.com/…` | oEmbed público (`tiktok.com/oembed`): texto y miniatura |
| YouTube | `youtube.com/watch`, `/shorts/`, `youtu.be` | oEmbed + descripción de la página |
| Cualquier otra web | Página del proyecto o del aviso | La página misma (texto, JSON-LD, fotos) |

- Los enlaces cortos (`facebook.com/share/…`, `vm.tiktok.com/…`) se siguen hasta el post. Si la
  red manda al login, se toma el destino real del parámetro `next`.
- Si el post trae un **video descargable** (reels de Instagram, videos de Facebook), su audio se
  **transcribe con Whisper** y lo que dice el corredor (precio, áreas…) cuenta como fuente.
- Se quitan los textos de la aplicación ("Me gusta", "Comentar"…), las fotos de perfil y los emojis.
- **Post privado o que la red no muestra** → el corredor ve: "Sube una captura del post o pega su
  texto", con los dos botones. **Enlace de un perfil** → "Conecta tu página en Integraciones".
- Cada enlace usa una de las 30 importaciones con IA por hora; los que fallan no la consumen. Aparte, hay un tope de 120 enlaces leídos por hora y usuario (para que el servidor no se use para descargar páginas sin límite).

> ⚠️ **No probado contra Facebook, Instagram ni TikTok reales**: desde el entorno de desarrollo
> no hay salida a esas redes. Los lectores se probaron con páginas de ejemplo con la estructura
> que publican hoy. Probar con 5–10 posts reales de corredores después de desplegar y, si una
> red cambió su formato, ajustar `social-core.js` (los cambios son pequeños y tienen tests).

## 2. Video o captura

- **Video** (MP4, MOV, WEBM; se descarga del celular desde la app de la red): el navegador toma
  hasta 6 imágenes del video (van a la IA y quedan como fotos) y el audio (mono, 16 kHz, hasta
  150 s), que el servidor transcribe con Whisper.
- **Captura** del post (con su texto): va como imagen a la IA, igual que un flyer.

## 3. Conectar la página de Facebook / Instagram (Graph API)

Permite ver los últimos posts de la **página de Facebook** del corredor y del **Instagram
profesional** vinculado a esa página, elegirlos e importarlos de a 10 (con fotos y videos).
**Meta no permite leer perfiles personales de Facebook**: para esos, el camino 1.

### Configuración (una sola vez, Thaiz)

1. En [Meta for Developers](https://developers.facebook.com/apps) usar la app de ReCo (la misma
   del bot de WhatsApp sirve) o crear una de tipo *Empresa*.
2. Agregar el producto **Inicio de sesión con Facebook para empresas** (Facebook Login).
   - *URI de redireccionamiento de OAuth válidos*: la URL de la función `metaOAuth`
     (`https://southamerica-east1-reco-5a5dd.cloudfunctions.net/metaOAuth`).
   - Dominio de la app: `recosac.com`.
3. Permisos a pedir en **Revisión de la app** (sin aprobación solo funciona con los
   administradores y evaluadores de la app):
   - `pages_show_list`, `pages_read_engagement`, `business_management` (posts de la página).
   - `instagram_basic` (posts del Instagram profesional vinculado).
   - Requiere **verificación del negocio** y un video que muestre el flujo (Integraciones →
     Conectar → elegir posts → importar).
4. Guardar las credenciales:

   ```bash
   echo "META_APP_ID=123456789012345" >> functions/.env
   firebase functions:secrets:set META_APP_SECRET     # Configuración → Básica → Clave secreta
   firebase deploy --only functions:metaConnect,functions:metaOAuth,firestore:rules
   ```

5. Probar con una página propia: Integraciones → *Conectar con Facebook* → aceptar → elegir la
   página → *Ver mis posts* → importar 2 o 3 → se abre la revisión con sus fotos.

Mientras `META_APP_ID` esté vacío, la tarjeta dice "Muy pronto" y explica cómo pegar enlaces.

> ⚠️ No usar `firebase deploy --only functions` (todas) antes de crear `META_APP_SECRET`
> (ni los secretos de WhatsApp y del correo de ingesta): esas funciones no se despliegan sin
> ellos.

### Datos que se guardan (solo servidor)

| Colección | Qué guarda |
|---|---|
| `metaOAuthStates/{state}` | Estado de un inicio de sesión (15 min, un solo uso) |
| `metaAccounts/{uid}` | Páginas e Instagram conectados (nombre e id) y posts ya importados |
| `metaTokens/{uid}` | Tokens de acceso de las páginas (nadie los lee desde la web) |

"Desconectar" en Integraciones borra los dos últimos. Los pedidos a Meta se firman con
`appsecret_proof`. ReCo solo **lee** posts: nunca publica en las redes del corredor.
