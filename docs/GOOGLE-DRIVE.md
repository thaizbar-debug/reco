# Fotos desde Google Drive

Muchos corredores guardan las fotos de sus inmuebles en Google Drive, a veces con una carpeta por
inmueble. ReCo las trae de dos formas, en "Publicar uno", en la carga masiva y en el editor
"📷 Fotos" de Mis publicaciones:

| Forma | Para qué | Qué necesita |
|---|---|---|
| **Enlace de la carpeta** (o de una foto) | Carpetas compartidas con "Cualquier persona con el enlace". Sin iniciar sesión en Google. | Activar la API de Drive en el proyecto (paso 1). |
| **Elegir fotos de mi Google Drive** (Google Picker) | Fotos privadas, sin compartir la carpeta. Google pide permiso **solo para las fotos elegidas** (`drive.file`). | Pasos 1 y 2. Si no se configura, el botón no aparece. |

En la **carga masiva**, el enlace puede ser de una carpeta con **una subcarpeta por inmueble**:
cada subcarpeta se vuelve un grupo de fotos y se asigna al inmueble cuyo nombre se parece más
("Pardo 340 - Miraflores" ↔ "Av. Pardo 340"). El corredor revisa y confirma, como con "Súbelas de una vez".

Las fotos se descargan **en el navegador** (de a 3) y pasan por el mismo camino que las del equipo:
conversión a JPEG, HEIC, calidad, repetidas y máximo de 20 por inmueble. No pasan por el servidor.

## 1. API de Drive (enlace de carpeta)

1. Google Cloud Console del proyecto `reco-5a5dd` → **APIs y servicios → Biblioteca → Google Drive API → Habilitar**.
2. **Credenciales** → la clave de API del navegador (la de `firebaseConfig.apiKey` en `index.html`):
   - Si tiene "Restricciones de API", agregar **Google Drive API** a la lista.
   - Las restricciones de sitios web (referentes HTTP) pueden quedarse como están.
3. Probar: en ReCo, "📁 Desde Google Drive" con el enlace de una carpeta compartida.
   - Si dice "Google Drive todavía no está activado en ReCo", falta el paso 1 o 2.

Para usar otra clave, ponerla en `_GOOGLE_DRIVE.apiKey` en `index.html`.

## 2. Google Picker (fotos privadas), opcional

1. **APIs y servicios → Biblioteca → Google Picker API → Habilitar**.
2. **Pantalla de consentimiento de OAuth**: nombre de la app, logo y correo de soporte. Agregar el permiso
   `https://www.googleapis.com/auth/drive.file` (no sensible: no requiere verificación de Google).
3. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**:
   - Orígenes de JavaScript autorizados: el dominio de ReCo (y `http://localhost:3123` para pruebas).
4. En `index.html`, completar:
   ```js
   const _GOOGLE_DRIVE={ apiKey:'', clientId:'<ID de cliente>.apps.googleusercontent.com', appId:'<número del proyecto>' };
   ```
   El número del proyecto está en la Consola, en **Configuración del proyecto**.
5. Pasar la pantalla de consentimiento a **En producción** (mientras está "En prueba", solo pueden usarla los usuarios de prueba) y probar con una cuenta de Google que no sea del equipo.

## Límites

- Hasta 40 subcarpetas por enlace y 20 fotos por inmueble (en la carga masiva, hasta el máximo de "Súbelas de una vez").
- Se omiten archivos que no son imágenes (PDF, videos) y fotos de más de 30 MB.
- Enlaces antiguos con `resourcekey=` funcionan (se envía la clave del recurso).
- La API de Drive no tiene costo; su cuota por proyecto alcanza de sobra para este uso.
