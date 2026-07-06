# Backend setup notes

Steps that have to be done manually in the Firebase / external dashboards.
The repo only contains the code that *uses* these resources; the resources
themselves live in your Google Cloud / Firebase / Resend accounts.

## 1. Firestore

- **Database mode:** Standard (Native).
- **Location:** `southamerica-east1`.
- **Rules:** copy `firestore.rules` from the repo into Firestore → Rules → Publish.

## 2. Storage

- **Plan:** requires Blaze (pay-as-you-go). Free tier still applies; a
  budget alert is configured in Google Cloud Billing.
- **Bucket location:** `us-east1` (free tier).
- **Rules:** copy `storage.rules` from the repo into Storage → Rules → Publish.

## 3. Authentication

- **Providers enabled:** Email/Password and Google.
- For Google sign-in to work outside production, run the site from
  `localhost` (e.g. `python3 -m http.server 8080`); `file://` is not an
  authorized origin.

## 4. Email notifications (Phase 5)

Approval / rejection emails are sent by the official Firebase extension
**"Trigger Email from Firestore"**. The app writes a document to the
`/mail` collection and the extension dispatches it via SMTP.

### 4.1 Resend account

1. Sign up at https://resend.com (no card needed).
2. Verify the sending domain you want to use (e.g. `recosac.com`). For
   testing you can skip and use the sandbox `onboarding@resend.dev`.
3. Go to API Keys → create one with "Sending access" → copy the
   `re_xxxxx...` value.

### 4.2 Install the Firebase extension

1. Open https://console.firebase.google.com/project/reco-5a5dd/extensions
2. Browse extensions → search **"Trigger Email from Firestore"** by Firebase.
3. Click **Install in console**. Accept the APIs/permissions it requests.
4. Configuration:
   - **SMTP connection URI:** `smtps://resend:YOUR_RESEND_API_KEY@smtp.resend.com:465`
     (replace `YOUR_RESEND_API_KEY` with the `re_...` key from step 4.1.)
   - **Email documents collection:** `mail`
   - **Default FROM address:** `Reco <no-reply@recosac.com>` (or the
     verified sender from Resend; if using sandbox, use
     `onboarding@resend.dev`).
   - **Default REPLY-TO address:** `contacto@recosac.com` (optional).
   - Leave the rest at defaults.
5. **Save**. The extension provisions a Cloud Function under the hood
   (~3 minutes the first time).

### 4.3 Test

1. From the app, log in as admin → Moderación → approve any pending
   publication.
2. Check the publication's `userEmail` inbox — the approval email
   should arrive within ~30 seconds.
3. If it doesn't arrive: open the document the app wrote in the
   `/mail/{autoId}` collection. The extension appends a `delivery`
   subfield with status / error info.

### 4.4 Cost

Resend free tier: 3,000 emails/month. Reco at MVP scale is nowhere near
that. Firebase Functions execution time for the extension is also well
within the free tier.
