# BUG-06 Deployment Runbook

**Bug:** Password reset (and all transactional) emails never arrive
**Branch:** `claude/transactional-email-recovery-am6p52`
**Commit:** `ac4dbc7`
**Project:** `reco-5a5dd`
**Region:** `southamerica-east1`

---

## Pre-deployment checklist

- [ ] Commit `ac4dbc7` reviewed and approved
- [ ] DNS records verified (steps 1-2 below)
- [ ] Firebase Extension verified (step 3 below)
- [ ] Resend domain `recosac.com` verified in Resend dashboard

---

## Step 1: Verify DNS records

**Do NOT proceed to deployment until all three pass.**

```bash
# SPF
dig TXT recosac.com +short
# Expected: contains "include:_spf.resend.com" or equivalent

# DKIM
dig TXT resend._domainkey.recosac.com +short
# Expected: "v=DKIM1; k=rsa; p=..." (public key)

# DMARC
dig TXT _dmarc.recosac.com +short
# Expected: "v=DMARC1; p=none; ..." (or quarantine/reject)
```

If any record is missing:
1. Log into Cloudflare dashboard for `recosac.com`
2. Add the missing DNS record(s) per Resend's domain setup instructions
3. Wait for propagation (typically 1-15 minutes for Cloudflare)
4. Re-verify with `dig`

Record results: ___

---

## Step 2: Verify Resend domain

1. Log into https://resend.com/domains
2. Confirm `recosac.com` shows as **Verified** (green)
3. If not verified, click "Verify" and ensure DNS records from Step 1 match

Record results: ___

---

## Step 3: Verify Firebase Extension

1. Open https://console.firebase.google.com/project/reco-5a5dd/extensions
2. Find "Trigger Email from Firestore" extension
3. Verify configuration:

| Parameter | Expected value |
|-----------|----------------|
| Email documents collection | `mail` |
| SMTP connection URI | `smtps://resend:RE_API_KEY@smtp.resend.com:465` |
| DEFAULT_FROM | `Reco <no-reply@recosac.com>` |
| Default REPLY-TO | `contacto@recosac.com` (optional) |

4. Confirm extension status is **Installed** (active)

Record results: ___

---

## Step 4: Deploy Firestore indexes

```bash
firebase deploy --only firestore:indexes
```

Expected output:
```
=== Deploying to 'reco-5a5dd'...
i  firestore: reading indexes from firestore.indexes.json...
i  firestore: deploying indexes...
+  firestore: deployed indexes
```

Record output: ___

---

## Step 5: Wait for index READY

1. Open https://console.firebase.google.com/project/reco-5a5dd/firestore/indexes
2. Find the new composite index: `mail` collection, fields `_resetFor` ASC + `_queuedAt` ASC
3. Wait until status shows **Enabled** (green checkmark)
4. Typical build time: 1-5 minutes on a small collection

**Do NOT proceed to Step 6 until the index is READY.**

Record status: ___

---

## Step 6: Deploy Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Expected output:
```
=== Deploying to 'reco-5a5dd'...
i  functions: preparing functions directory for uploading...
+  functions: functions folder uploaded successfully
i  functions: updating Node.js 22 function ...
+  Deploy complete!
```

Verify all 11 functions are listed:
- `unlockProperty`
- `publishProperty`
- `submitContactRequest`
- `getHistoricoDetail`
- `onMailWrite`
- `cleanupHistDetailAccess`
- `setAdminClaim`
- `grantKeys`
- `sendPasswordResetViaResend`
- `sendVerificationViaResend`
- `onPublicationModerated`

Record output: ___

---

## Step 7: Smoke test

Immediately after deploy, run a quick smoke test:

1. Open `recosac.com` in an incognito browser
2. Click "Olvidaste tu contrasena"
3. Enter a known test email
4. Submit
5. Verify:
   - UI shows success message (no errors)
   - Cloud Logs show the function executed (no crashes)
   - Email arrives within 60 seconds

```bash
# Check Cloud Logs for the function
firebase functions:log --only sendPasswordResetViaResend
```

If the smoke test fails:
- Check Cloud Logs for error details
- Check `/mail` collection for the queued document
- Check the extension's `delivery` subfield on the mail document
- DO NOT proceed to full UAT

Record results: ___

---

## Step 8: Execute UAT

Run the full test plan from `docs/BUG-06-UAT-TEST-PLAN.md`:

1. Password Reset tests (PR-01 through PR-10)
2. Verification tests (VE-01 through VE-05)
3. Contact tests (CO-01 through CO-05)
4. Moderation tests (MO-01 through MO-06)

Record all PASS/FAIL results in the test plan document.

---

## Step 9: Review Cloud Logs

After all UAT tests:

```bash
# All email-related function logs from the last hour
firebase functions:log --only sendPasswordResetViaResend,sendVerificationViaResend,submitContactRequest,onPublicationModerated,onMailWrite
```

Check for:
- [ ] No unexpected errors
- [ ] Rate limit logs appear correctly for PR-09
- [ ] Anti-enumeration (user-not-found) logged but not exposed for PR-02
- [ ] Idempotency skip logged for MO-04
- [ ] No duplicate email queue writes

Record findings: ___

---

## Step 10: Review Resend delivery

1. Log into https://resend.com
2. Go to Emails / Logs
3. Verify:
   - [ ] All test emails show as "Delivered"
   - [ ] No bounces
   - [ ] No spam complaints
   - [ ] Sender domain is `recosac.com`
   - [ ] SPF, DKIM pass on all deliveries

Record findings: ___

---

## Step 11: Record UAT results

Compile evidence per `docs/BUG-06-UAT-EVIDENCE.md`.

### Decision matrix

| Condition | Result | Action |
|-----------|--------|--------|
| All tests PASS, all evidence collected | BUG-06 RESOLVED | Close the bug |
| Some tests FAIL but non-blocking | BUG-06 PARTIAL | Document failures, plan fixes |
| Critical tests FAIL (email not received, link broken) | BUG-06 OPEN | Rollback functions, investigate |
| DNS/Extension misconfigured | BUG-06 BLOCKED | Fix configuration, re-run from Step 1 |

### Rollback procedure (if needed)

```bash
# Revert functions to previous version
git checkout ac38a1b -- functions/index.js
firebase deploy --only functions

# The Firestore index can remain — it's harmless
# The client-side dead code removal (index.html) has no runtime impact
```

---

## Final sign-off

| Item | Status | Signed by | Date |
|------|--------|-----------|------|
| DNS verified | ___ | ___ | ___ |
| Extension verified | ___ | ___ | ___ |
| Indexes deployed | ___ | ___ | ___ |
| Functions deployed | ___ | ___ | ___ |
| Smoke test passed | ___ | ___ | ___ |
| Full UAT passed | ___ | ___ | ___ |
| BUG-06 disposition | ___ | ___ | ___ |
