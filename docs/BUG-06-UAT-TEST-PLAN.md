# BUG-06 UAT Test Plan

**Bug:** Password reset (and all transactional) emails never arrive
**Commit:** `ac4dbc7` on branch `claude/transactional-email-recovery-am6p52`
**Date:** 2026-09-05

**Prerequisites for all tests:**
- Firestore indexes deployed and READY (especially `mail(_resetFor, _queuedAt)`)
- Cloud Functions deployed to `southamerica-east1`
- Firebase Extension "Trigger Email from Firestore" active with correct SMTP config
- DNS records (SPF, DKIM, DMARC) propagated for `recosac.com`
- Resend domain `recosac.com` verified
- Access to email inbox for test accounts

---

## PASSWORD RESET

### PR-01: Usuario existente

- **Objetivo:** Verificar que un usuario registrado recibe el email de reset
- **Precondicion:** Cuenta registrada con email verificado en Firebase Auth
- **Pasos:**
  1. Ir a la pantalla de login en `recosac.com`
  2. Click en "Olvidaste tu contrasena"
  3. Ingresar el email del usuario existente
  4. Click en enviar
- **Resultado esperado:** UI muestra mensaje de exito (sin revelar si el email existe). Email llega al inbox en menos de 60 segundos.
- **Evidencia:** Screenshot del mensaje UI + screenshot del email recibido con timestamp + headers del email
- **Estado:** PASS / FAIL ___

### PR-02: Usuario inexistente

- **Objetivo:** Verificar anti-enumeracion -- la respuesta es identica a PR-01
- **Precondicion:** Email que NO esta registrado en Firebase Auth
- **Pasos:**
  1. Ir a la pantalla de login
  2. Click en "Olvidaste tu contrasena"
  3. Ingresar un email no registrado (ej: `noexiste-test-xyz@recosac.com`)
  4. Click en enviar
- **Resultado esperado:** UI muestra el MISMO mensaje de exito que PR-01. NO llega ningun email. No hay error visible. Cloud Logs muestran `auth/user-not-found` capturado silenciosamente.
- **Evidencia:** Screenshot del mensaje UI (debe ser identico a PR-01) + Cloud Logs mostrando el catch
- **Estado:** PASS / FAIL ___

### PR-03: Email invalido

- **Objetivo:** Verificar validacion de formato de email
- **Precondicion:** Ninguna
- **Pasos:**
  1. Ir a la pantalla de login
  2. Click en "Olvidaste tu contrasena"
  3. Ingresar un email invalido (ej: `noesmail`, `@falta.com`, `sin-tld@dominio`)
  4. Click en enviar
- **Resultado esperado:** Error visible indicando email invalido. La funcion lanza `invalid-argument`.
- **Evidencia:** Screenshot del mensaje de error
- **Estado:** PASS / FAIL ___

### PR-04: Recepcion real del correo

- **Objetivo:** Verificar que el email llega, con remitente y subject correctos
- **Precondicion:** PR-01 ejecutado exitosamente
- **Pasos:**
  1. Abrir el inbox del usuario de PR-01
  2. Buscar el email de reset
  3. Verificar: remitente, subject, contenido HTML
- **Resultado esperado:**
  - From: `Reco <no-reply@recosac.com>` (o el DEFAULT_FROM configurado)
  - Subject: `Restablece tu contrasena en Reco`
  - Body: contiene link de reset, branding Reco, boton "Restablecer contrasena"
  - Headers: SPF pass, DKIM pass, DMARC pass
- **Evidencia:** Screenshot completo del email + headers (Authentication-Results)
- **Estado:** PASS / FAIL ___

### PR-05: Click del link

- **Objetivo:** Verificar que el link de reset es funcional
- **Precondicion:** Email de PR-04 recibido
- **Pasos:**
  1. Click en el link/boton de reset en el email
  2. Verificar que abre la pagina de Firebase Auth para cambiar contrasena
- **Resultado esperado:** Se abre la pagina de cambio de contrasena de Firebase Auth. No hay errores. El link no esta expirado.
- **Evidencia:** Screenshot de la pagina de cambio de contrasena
- **Estado:** PASS / FAIL ___

### PR-06: Cambio de contrasena

- **Objetivo:** Verificar que el cambio de contrasena funciona
- **Precondicion:** PR-05 completado
- **Pasos:**
  1. Ingresar nueva contrasena en la pagina de reset
  2. Confirmar
- **Resultado esperado:** Mensaje de exito. Contrasena cambiada en Firebase Auth.
- **Evidencia:** Screenshot del mensaje de exito
- **Estado:** PASS / FAIL ___

### PR-07: Login con nueva contrasena

- **Objetivo:** Verificar que el login funciona con la contrasena nueva
- **Precondicion:** PR-06 completado
- **Pasos:**
  1. Ir a `recosac.com`
  2. Login con el email y la nueva contrasena
- **Resultado esperado:** Login exitoso. Acceso a la cuenta.
- **Evidencia:** Screenshot del dashboard post-login
- **Estado:** PASS / FAIL ___

### PR-08: Solicitudes repetidas

- **Objetivo:** Verificar que multiples solicitudes generan multiples emails validos
- **Precondicion:** Cuenta existente
- **Pasos:**
  1. Solicitar reset 2 veces consecutivas (dentro del rate limit)
  2. Verificar que ambos emails llegan
  3. Click en el link del segundo email
  4. Cambiar contrasena
- **Resultado esperado:** 2 emails llegan. Ambos links son validos. El segundo link funciona para cambiar contrasena.
- **Evidencia:** Screenshots de ambos emails con timestamps
- **Estado:** PASS / FAIL ___

### PR-09: Rate limit

- **Objetivo:** Verificar que el rate limit de 3/email/hora funciona
- **Precondicion:** Cuenta existente
- **Pasos:**
  1. Solicitar reset 3 veces para el mismo email
  2. Solicitar reset una 4ta vez
  3. Verificar respuesta
- **Resultado esperado:** Las 3 primeras solicitudes generan emails. La 4ta devuelve `{ok: true}` pero NO genera email. UI muestra mensaje identico (anti-enumeracion). Cloud Logs muestran `rate-limit hit`.
- **Evidencia:** Cloud Logs mostrando rate-limit + verificar que solo llegaron 3 emails
- **Estado:** PASS / FAIL ___

### PR-10: Verificar anti-enumeracion

- **Objetivo:** Confirmar que no hay forma de distinguir entre usuario existente, inexistente y rate-limited
- **Precondicion:** PR-01, PR-02, PR-09 completados
- **Pasos:**
  1. Comparar las respuestas UI de PR-01 (existente), PR-02 (inexistente), PR-09 (rate-limited)
  2. Verificar tiempos de respuesta (no deben diferir significativamente)
- **Resultado esperado:** Las 3 respuestas son visualmente identicas. No hay timing leak significativo.
- **Evidencia:** Screenshots comparativos de las 3 respuestas
- **Estado:** PASS / FAIL ___

---

## VERIFICATION EMAIL

### VE-01: Registro

- **Objetivo:** Verificar que el registro con email dispara el email de verificacion
- **Precondicion:** Email no registrado previamente
- **Pasos:**
  1. Ir a `recosac.com`
  2. Click en "Registrarse"
  3. Completar formulario con email nuevo
  4. Submit
- **Resultado esperado:** Cuenta creada. Se llama a `sendVerificationViaResend`. Email de verificacion enviado.
- **Evidencia:** Screenshot del formulario completado + Cloud Logs mostrando la llamada
- **Estado:** PASS / FAIL ___

### VE-02: Recepcion del email

- **Objetivo:** Verificar que el email de verificacion llega correctamente
- **Precondicion:** VE-01 completado
- **Pasos:**
  1. Abrir inbox del email registrado
  2. Buscar email de verificacion
- **Resultado esperado:**
  - From: `Reco <no-reply@recosac.com>`
  - Subject: `Verifica tu cuenta en Reco`
  - Body: link de verificacion, branding Reco
  - Headers: SPF pass, DKIM pass
- **Evidencia:** Screenshot del email + headers
- **Estado:** PASS / FAIL ___

### VE-03: Click del link

- **Objetivo:** Verificar que el link de verificacion funciona
- **Precondicion:** VE-02 completado
- **Pasos:**
  1. Click en el link de verificacion en el email
  2. Verificar que redirige a `recosac.com`
- **Resultado esperado:** Link funcional. Redireccion a la app. `emailVerified` se marca como `true` en Firebase Auth.
- **Evidencia:** Screenshot de la redireccion + Firebase Auth mostrando `emailVerified: true`
- **Estado:** PASS / FAIL ___

### VE-04: Cuenta verificada

- **Objetivo:** Verificar que la app reconoce la cuenta como verificada
- **Precondicion:** VE-03 completado
- **Pasos:**
  1. Login con la cuenta recien verificada
  2. Verificar que no aparece banner/modal de "verifica tu email"
- **Resultado esperado:** Login sin advertencias de verificacion. Acceso completo.
- **Evidencia:** Screenshot del dashboard post-login
- **Estado:** PASS / FAIL ___

### VE-05: Resend verification

- **Objetivo:** Verificar que se puede reenviar el email de verificacion
- **Precondicion:** Cuenta registrada pero no verificada
- **Pasos:**
  1. Login con cuenta no verificada
  2. Click en "Reenviar email de verificacion"
  3. Verificar que el email llega
- **Resultado esperado:** Segundo email de verificacion llega. Link funcional.
- **Evidencia:** Screenshot del segundo email
- **Estado:** PASS / FAIL ___

---

## CONTACT

### CO-01: Envio de solicitud de contacto

- **Objetivo:** Verificar que el formulario de contacto funciona
- **Precondicion:** Usuario logueado. Publicacion activa de otro usuario.
- **Pasos:**
  1. Navegar a una publicacion aprobada
  2. Click en "Contactar"
  3. Completar formulario (nombre, email, telefono, mensaje)
  4. Click en "Enviar"
- **Resultado esperado:** UI muestra mensaje de exito. La callable `submitContactRequest` retorna `{contactRequestId: ...}`.
- **Evidencia:** Screenshot del mensaje de exito + ID del contactRequest
- **Estado:** PASS / FAIL ___

### CO-02: ContactRequest creado en Firestore

- **Objetivo:** Verificar que el documento se creo en Firestore
- **Precondicion:** CO-01 completado
- **Pasos:**
  1. Abrir Firebase Console > Firestore
  2. Navegar a `/contactRequests/{id}` usando el ID de CO-01
  3. Verificar campos
- **Resultado esperado:** Documento existe con `fromUserId`, `fromName`, `fromEmail`, `fromPhone`, `message`, `pubId`, `kind`, `createdAt`.
- **Evidencia:** Screenshot del documento en Firestore
- **Estado:** PASS / FAIL ___

### CO-03: Email recibido por owner

- **Objetivo:** Verificar que el owner de la publicacion recibe el email de contacto
- **Precondicion:** CO-01 completado. Acceso al inbox del owner.
- **Pasos:**
  1. Abrir inbox del owner de la publicacion
  2. Buscar email de contacto
- **Resultado esperado:**
  - From: `Reco <no-reply@recosac.com>`
  - Subject contiene la direccion de la propiedad
  - Body: nombre, email, telefono y mensaje del interesado
  - Headers: SPF pass, DKIM pass
- **Evidencia:** Screenshot del email completo + headers
- **Estado:** PASS / FAIL ___

### CO-04: Reply-To correcto

- **Objetivo:** Verificar que el Reply-To del email de contacto es el email del interesado
- **Precondicion:** CO-03 completado
- **Pasos:**
  1. En el email recibido por el owner, click en "Responder"
  2. Verificar que el destinatario es el email del interesado (no `no-reply@recosac.com`)
- **Resultado esperado:** Reply-To es el email del interesado que envio la solicitud.
- **Evidencia:** Screenshot mostrando el Reply-To en headers
- **Estado:** PASS / FAIL ___

### CO-05: Ausencia de duplicados

- **Objetivo:** Verificar que no se envian emails duplicados de contacto
- **Precondicion:** CO-01 completado
- **Pasos:**
  1. Esperar 5 minutos despues de CO-01
  2. Verificar inbox del owner
  3. Verificar coleccion `/mail` en Firestore (solo 1 doc para esta solicitud)
- **Resultado esperado:** Exactamente 1 email recibido. Exactamente 1 documento en `/mail` para esta solicitud de contacto.
- **Evidencia:** Screenshot del inbox (solo 1 email) + Firestore query
- **Estado:** PASS / FAIL ___

---

## MODERATION

### MO-01: pending -> approved

- **Objetivo:** Verificar que aprobar una publicacion envia el email de aprobacion
- **Precondicion:** Publicacion en status `pending`. Admin logueado.
- **Pasos:**
  1. Login como admin
  2. Ir a Moderacion
  3. Aprobar la publicacion
  4. Verificar inbox del publisher
- **Resultado esperado:**
  - Status cambia a `approved` en Firestore
  - `onPublicationModerated` se dispara
  - Email de aprobacion llega al publisher
  - Subject: contiene referencia a aprobacion
  - `_lastNotifiedStatus` se escribe como `approved` en el doc de la publicacion
- **Evidencia:** Screenshot del email + Firestore doc mostrando `_lastNotifiedStatus: 'approved'`
- **Estado:** PASS / FAIL ___

### MO-02: pending -> rejected

- **Objetivo:** Verificar que rechazar una publicacion envia el email de rechazo
- **Precondicion:** Publicacion en status `pending`. Admin logueado.
- **Pasos:**
  1. Login como admin
  2. Ir a Moderacion
  3. Rechazar la publicacion (con razon)
  4. Verificar inbox del publisher
- **Resultado esperado:**
  - Status cambia a `rejected` en Firestore
  - Email de rechazo llega con la razon incluida
  - `_lastNotifiedStatus` se escribe como `rejected`
- **Evidencia:** Screenshot del email con razon + Firestore doc
- **Estado:** PASS / FAIL ___

### MO-03: rejected -> approved

- **Objetivo:** Verificar que cambiar de rechazado a aprobado envia nuevo email
- **Precondicion:** Publicacion previamente rechazada (MO-02 completado)
- **Pasos:**
  1. Login como admin
  2. Aprobar la publicacion previamente rechazada
  3. Verificar inbox del publisher
- **Resultado esperado:** Email de aprobacion llega. `_lastNotifiedStatus` cambia de `rejected` a `approved`.
- **Evidencia:** Screenshot del email + Firestore doc mostrando transicion
- **Estado:** PASS / FAIL ___

### MO-04: approved -> pending -> approved (idempotencia)

- **Objetivo:** Verificar que re-aprobar sin cambio intermedio NO genera email duplicado
- **Precondicion:** Publicacion previamente aprobada con `_lastNotifiedStatus: 'approved'`
- **Pasos:**
  1. Login como admin
  2. Cambiar status a `pending` (si la UI lo permite, o via Firestore Console)
  3. Cambiar status de vuelta a `approved`
  4. Verificar inbox del publisher
- **Resultado esperado:** NO llega email nuevo porque `_lastNotifiedStatus` ya es `approved`. Cloud Logs muestran "already notified, skipping".
- **Evidencia:** Cloud Logs mostrando skip + inbox sin email nuevo
- **Estado:** PASS / FAIL ___

### MO-05: Update sin cambio de status

- **Objetivo:** Verificar que un update que no cambia el status no envia email
- **Precondicion:** Publicacion aprobada
- **Pasos:**
  1. Editar un campo no-status de la publicacion (ej: `description`)
  2. Verificar que no se dispara email
- **Resultado esperado:** `onPublicationModerated` se dispara pero retorna inmediatamente (`newStatus === oldStatus`). No se escribe a `/mail`.
- **Evidencia:** Cloud Logs mostrando el early return
- **Estado:** PASS / FAIL ___

### MO-06: Ausencia de duplicados incorrectos

- **Objetivo:** Verificar que no hay duplicados en ningun flujo de moderacion
- **Precondicion:** MO-01 a MO-05 completados
- **Pasos:**
  1. Revisar inbox del publisher por todos los emails de moderacion
  2. Contar emails vs transiciones esperadas
  3. Verificar coleccion `/mail` por duplicados
- **Resultado esperado:** Numero de emails = numero de transiciones unicas notificadas. Sin duplicados.
- **Evidencia:** Lista de emails recibidos con timestamps vs lista de transiciones en Firestore
- **Estado:** PASS / FAIL ___
