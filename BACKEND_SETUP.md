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

## 5. Cloud Functions (Phase 6)

Server-side gate for premium data reads and key spending. The client
alone cannot be trusted: any user can open DevTools and set
`S.unlockedIds` to every property, so gating has to happen server-side.

### 5.1 Prerequisites

- **Firebase Blaze plan** — required for Cloud Functions. Free tier is
  generous (2M invocations / month, 400k GB-s / month), so at MVP scale
  the invoice should stay at $0. Set a low budget alert (e.g. $5) in
  Google Cloud Billing to be safe.
- **Node.js 22** locally (`node --version`).
- **Firebase CLI:** `npm install -g firebase-tools`.
- `firebase login` from the repo root.

### 5.2 First-time deploy

```
cd functions
npm install
cd ..
firebase deploy --only functions
```

The first deploy takes 2–4 minutes because Google Cloud provisions the
runtime and the callable endpoint. Later deploys are ~30–60 seconds.

Region for all functions is **southamerica-east1** (same as Firestore)
so writes stay local — cheaper and lower latency than us-central1.

### 5.3 Local emulator (for testing without a real deploy)

```
cd functions
npm run serve
```

This starts Firestore, Auth and Functions emulators on localhost.
Point the client at them by adding, before Firebase is used:

```
firebase.functions().useEmulator('localhost', 5001);
firebase.firestore().useEmulator('localhost', 8080);
firebase.auth().useEmulator('http://localhost:9099');
```

Only for local dev. Never commit those lines.

### 5.4 The functions we ship

- `unlockProperty` — takes `{ propertyId }`, checks the caller has ≥ 1
  key, decrements atomically, appends to `keyHistory`, and returns the
  premium fields for that property. Follow-up PRs will add
  `publishProperty` and the data migration from `properties.json` to
  `/propertiesPremium`.

### 5.5 What is NOT yet in place

- The `/propertiesPremium` collection is empty until the data-migration
  PR runs. Calling `unlockProperty` today returns `not-found` for every
  property. That is expected; the callable exists so the frontend can
  wire onto it now and the migration PR is a data + wiring flip only.
- Client code still writes `/publications` directly. That path will be
  closed in the `publishProperty` PR after the migration lands.
