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

- Client code still writes `/publications` directly. That path will be
  closed in the `publishProperty` PR after the migration lands.
- The public `data/properties.json` still ships the premium fields
  (owner, phone, sun, val, pdf_*). Stripping them from the JSON and
  pointing the frontend at `unlockProperty` happens together in the
  follow-up PR so unlocked histórico details do not go blank between
  the two.

## 6. Premium data migration (one-time)

`functions/scripts/migrate-premium-to-firestore.js` extracts the
premium fields from `data/properties.json` and writes them to the
`/propertiesPremium/{id}` collection so `unlockProperty` has something
to return. Idempotent — re-running overwrites, does not duplicate.

### 6.1 Generate a service account key (one time)

1. Open https://console.firebase.google.com/project/reco-5a5dd/settings/serviceaccounts/adminsdk
2. **Node.js** is selected by default. Click **Generate new private key**.
3. Confirm on the prompt. A JSON file downloads. Rename it to
   `service-account-key.json` and move it into `functions/scripts/`.
4. Verify the path is `functions/scripts/service-account-key.json`.
   `.gitignore` covers it explicitly, plus broad patterns for any
   filename containing `service-account` or `firebase-adminsdk`.

**Do not commit this file.** Anyone with the JSON has admin write
access to your Firestore, Storage and every other Firebase resource.
If it ever leaks, revoke it immediately from the same page you
generated it on.

### 6.2 Run the migration

```
cd functions
node scripts/migrate-premium-to-firestore.js
```

Expected output (last few lines):

```
  ...committed 2663 / 2663

✓ Wrote 2663 docs to /propertiesPremium.
  with owner: <n>
  with phone: <n>
  with sun (histórico data): <n>
  with val (historical values): <n>
  with pdfs (partidas): <n>
```

Runtime is about 15–30 s over ~7 batches of 400 writes each.
Firestore write cost for the whole run is negligible (~US$0.005).

### 6.3 Verify

Call `unlockProperty` from the browser with an authenticated session
using a real property id — e.g. `885-RP4625-25`:

```
firebase.app().functions('southamerica-east1').httpsCallable('unlockProperty')({propertyId:'885-RP4625-25'}).then(r=>console.log('got premium:', Object.keys(r.data.premium || {})))
```

Expected: an object listing keys like `owner`, `phone`, `sun`. That
confirms the collection is populated and the callable is working end
to end.

Note: this call **actually spends a key** on the calling account.
Refund yourself from the Firestore data console afterwards if needed.

### 6.4 Delete the service account key when done

Once migration is complete you do not need the key on your laptop
until the next migration. Delete
`functions/scripts/service-account-key.json` to shrink the blast
radius if the laptop is ever compromised. Regenerating a fresh key
next time takes 30 seconds.
