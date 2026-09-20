# BUG-06 UAT Checklist

**Bug:** Password reset (and all transactional) emails never arrive
**Commit:** `ac4dbc7` on branch `claude/transactional-email-recovery-am6p52`
**Date:** 2026-09-05
**Status:** CODE PRE-UAT READY, UAT PENDING

---

## A. DNS / Deliverability

Domain: `recosac.com`
DNS Provider: Cloudflare (`kimora.ns.cloudflare.com`)

| # | Check | How to verify | Status |
|---|-------|---------------|--------|
| A-01 | SPF record exists for `recosac.com` | `dig TXT recosac.com` — must contain `v=spf1 include:_spf.resend.com ~all` (or similar Resend include) | NOT VERIFIED -- REQUIRES DNS ACCESS |
| A-02 | DKIM record exists | `dig TXT resend._domainkey.recosac.com` — must return a DKIM public key (`v=DKIM1; k=rsa; p=...`) | NOT VERIFIED -- REQUIRES DNS ACCESS |
| A-03 | DMARC record exists | `dig TXT _dmarc.recosac.com` — must return `v=DMARC1; p=none` (or `quarantine`/`reject`) | NOT VERIFIED -- REQUIRES DNS ACCESS |
| A-04 | SPF alignment | The `Return-Path` domain on delivered emails must match or be a subdomain of `recosac.com` | NOT VERIFIED -- REQUIRES EMAIL DELIVERY |
| A-05 | DKIM alignment | The `d=` value in the DKIM signature on delivered emails must be `recosac.com` | NOT VERIFIED -- REQUIRES EMAIL DELIVERY |
| A-06 | DMARC alignment | At least SPF or DKIM must pass AND align with the `From:` domain (`recosac.com`) | NOT VERIFIED -- REQUIRES EMAIL DELIVERY |
| A-07 | Resend domain verified | Resend dashboard must show `recosac.com` as verified (green checkmark) | NOT VERIFIED -- REQUIRES RESEND ACCESS |

### How to verify DNS records

```bash
# SPF
dig TXT recosac.com +short | grep spf

# DKIM
dig TXT resend._domainkey.recosac.com +short

# DMARC
dig TXT _dmarc.recosac.com +short

# Full alignment test (after sending a real email)
# Check email headers: Authentication-Results, DKIM-Signature, Return-Path
# Or use https://www.mail-tester.com/ — send a test email to the address it provides
```

---

## B. Firebase Extension

Extension name: **Trigger Email from Firestore** (by Firebase)
Firebase project: `reco-5a5dd`
Console URL: `https://console.firebase.google.com/project/reco-5a5dd/extensions`

| # | Parameter | Expected value | Source | Status |
|---|-----------|----------------|--------|--------|
| B-01 | Extension installed and active | Yes | `BACKEND_SETUP.md` section 4.2 | NOT VERIFIED -- REQUIRES FIREBASE ACCESS |
| B-02 | Extension version | Latest stable | Firebase Console | NOT VERIFIED -- REQUIRES FIREBASE ACCESS |
| B-03 | Email documents collection | `mail` | `BACKEND_SETUP.md` L72 and `firebase.json` | VERIFIED in code -- collection name `mail` used in all `db.collection('mail').add(...)` calls in `functions/index.js` |
| B-04 | SMTP connection URI | `smtps://resend:RE_API_KEY@smtp.resend.com:465` | `BACKEND_SETUP.md` L70 | NOT VERIFIED -- REQUIRES FIREBASE ACCESS (do NOT store API key in code) |
| B-05 | SMTP host | `smtp.resend.com` | `BACKEND_SETUP.md` L70 | NOT VERIFIED -- REQUIRES FIREBASE ACCESS |
| B-06 | SMTP port | `465` (TLS) | `BACKEND_SETUP.md` L70 | NOT VERIFIED -- REQUIRES FIREBASE ACCESS |
| B-07 | SMTP credentials | Resend API key as password, `resend` as username | `BACKEND_SETUP.md` L70 | NOT VERIFIED -- REQUIRES FIREBASE ACCESS |
| B-08 | DEFAULT_FROM | `Reco <no-reply@recosac.com>` | `BACKEND_SETUP.md` L73 | NOT VERIFIED -- REQUIRES FIREBASE ACCESS |
| B-09 | Default REPLY-TO | `contacto@recosac.com` (optional) | `BACKEND_SETUP.md` L76 | NOT VERIFIED -- REQUIRES FIREBASE ACCESS |
| B-10 | Extension Cloud Function provisioned | Extension should have created its own Cloud Function for processing `/mail` docs | Firebase Console > Functions | NOT VERIFIED -- REQUIRES FIREBASE ACCESS |

### Critical note

The `DEFAULT_FROM` address (`no-reply@recosac.com`) MUST match the domain verified in Resend. If Resend only has a different sender verified (e.g., `onboarding@resend.dev` sandbox), emails will fail silently or be rejected.

---

## C. Cloud Functions

### Functions in commit `ac4dbc7`

| # | Function | Type | Trigger | BUG-06 changes | Status |
|---|----------|------|---------|-----------------|--------|
| C-01 | `sendPasswordResetViaResend` | `onCall` | HTTPS callable | Rate limiting added (3/email/hour), `_resetFor`/`_queuedAt` fields on mail doc | VERIFIED in code |
| C-02 | `sendVerificationViaResend` | `onCall` | HTTPS callable | No changes in this commit | VERIFIED in code |
| C-03 | `submitContactRequest` | `onCall` | HTTPS callable | Enhanced error logging, `adminAuditLog` write on email failure | VERIFIED in code |
| C-04 | `onPublicationModerated` | `onDocumentWritten` | Firestore trigger on `/publications/{pubId}` | Idempotency via `_lastNotifiedStatus`, Auth fallback for `userEmail` | VERIFIED in code |
| C-05 | `onMailWrite` | `onDocumentWritten` | Firestore trigger on `/mail/{mailId}` | No changes in this commit (observability trigger) | VERIFIED in code |
| C-06 | `unlockProperty` | `onCall` | HTTPS callable | No changes | NOT APPLICABLE |
| C-07 | `publishProperty` | `onCall` | HTTPS callable | No changes | NOT APPLICABLE |
| C-08 | `getHistoricoDetail` | `onCall` | HTTPS callable | No changes | NOT APPLICABLE |
| C-09 | `cleanupHistDetailAccess` | `onSchedule` | Scheduled (cron) | No changes | NOT APPLICABLE |
| C-10 | `setAdminClaim` | `onCall` | HTTPS callable | No changes | NOT APPLICABLE |
| C-11 | `grantKeys` | `onCall` | HTTPS callable | No changes | NOT APPLICABLE |

### Expected state after deploy

- All 11 functions deployed to `southamerica-east1`
- Region: `southamerica-east1` (matches Firestore)
- Runtime: Node.js 22
- App Check: enforced on all `onCall` functions

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `firebase-admin` | `^12.4.0` | Firestore, Auth admin SDK |
| `firebase-functions` | `^6.0.0` | Cloud Functions v2 runtime |

No new dependencies were added in commit `ac4dbc7`.

---

## D. Firestore

### Required indexes

| # | Collection | Fields | Query scope | Defined in | Status |
|---|------------|--------|-------------|------------|--------|
| D-01 | `contactRequests` | `fromUserId` ASC, `createdAt` ASC | COLLECTION | `firestore.indexes.json` | Pre-existing |
| D-02 | `histDetailAccess` | `uid` ASC, `at` ASC | COLLECTION | `firestore.indexes.json` | Pre-existing |
| D-03 | `mail` | `_resetFor` ASC, `_queuedAt` ASC | COLLECTION | `firestore.indexes.json` | **NEW in ac4dbc7** -- PENDING DEPLOY |

### Index file

- Path: `firestore.indexes.json`
- Referenced by: `firebase.json` (`"indexes": "firestore.indexes.json"`)

### Deploy command

```bash
firebase deploy --only firestore:indexes
```

After deploying, wait for the index to show status `READY` in the Firebase Console:
`https://console.firebase.google.com/project/reco-5a5dd/firestore/indexes`

The index typically takes 1-5 minutes to build on an empty or small collection.

### Critical note

The composite index D-03 MUST be deployed and `READY` BEFORE deploying functions. Without it, the `sendPasswordResetViaResend` function will fail on first invocation with a Firestore error requesting index creation.
