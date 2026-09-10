# BUG-06 UAT Evidence Checklist

**Bug:** Password reset (and all transactional) emails never arrive
**Commit:** `ac4dbc7` on branch `claude/transactional-email-recovery-am6p52`
**Date:** 2026-09-05

---

## Instructions

For each evidence item, capture the artifact described and store it in a shared
location (e.g., Google Drive folder, Notion page, or internal wiki). Mark each
item as CAPTURED or PENDING.

**Do NOT include API keys, passwords, tokens, or any credentials in evidence.**
Redact sensitive values before saving screenshots.

---

## 1. Configuration Evidence

| # | Evidence | Description | Status |
|---|----------|-------------|--------|
| 1.1 | Firebase Extension config screenshot | Screenshot of "Trigger Email from Firestore" extension config page showing collection, SMTP host/port, DEFAULT_FROM. **Redact the API key in the SMTP URI.** | PENDING |
| 1.2 | DNS SPF result | Output of `dig TXT recosac.com` showing SPF record | PENDING |
| 1.3 | DNS DKIM result | Output of `dig TXT resend._domainkey.recosac.com` showing DKIM key | PENDING |
| 1.4 | DNS DMARC result | Output of `dig TXT _dmarc.recosac.com` showing DMARC policy | PENDING |
| 1.5 | Resend domain verification | Screenshot of Resend dashboard showing `recosac.com` as verified | PENDING |
| 1.6 | Firestore index status | Screenshot of Firebase Console showing `mail(_resetFor, _queuedAt)` index as Enabled | PENDING |

## 2. Deployment Evidence

| # | Evidence | Description | Status |
|---|----------|-------------|--------|
| 2.1 | Index deploy output | Terminal output of `firebase deploy --only firestore:indexes` | PENDING |
| 2.2 | Functions deploy output | Terminal output of `firebase deploy --only functions` showing all 11 functions | PENDING |
| 2.3 | Functions list verification | Screenshot of Firebase Console > Functions showing all deployed functions with region `southamerica-east1` | PENDING |

## 3. Password Reset Evidence

| # | Evidence | Description | Status |
|---|----------|-------------|--------|
| 3.1 | Email received | Screenshot of reset email in inbox (sender, subject, timestamp visible) | PENDING |
| 3.2 | Sender visible | From field shows `Reco <no-reply@recosac.com>` | PENDING |
| 3.3 | Subject line | Subject is `Restablece tu contrasena en Reco` | PENDING |
| 3.4 | Email timestamp | Delivery timestamp (within 60s of request) | PENDING |
| 3.5 | Reset link | Screenshot showing the reset link/button in email body | PENDING |
| 3.6 | Password changed | Screenshot of successful password change page | PENDING |
| 3.7 | Login successful | Screenshot of successful login with new password | PENDING |
| 3.8 | Email headers | Authentication-Results header showing SPF pass, DKIM pass, DMARC pass | PENDING |
| 3.9 | Rate limit evidence | Cloud Logs showing "rate-limit hit" after 3+ requests for same email | PENDING |
| 3.10 | Anti-enumeration | Screenshots comparing UI response for existing vs non-existing email (must be identical) | PENDING |

## 4. Verification Email Evidence

| # | Evidence | Description | Status |
|---|----------|-------------|--------|
| 4.1 | Email received | Screenshot of verification email in inbox | PENDING |
| 4.2 | Sender visible | From field shows `Reco <no-reply@recosac.com>` | PENDING |
| 4.3 | Subject line | Subject is `Verifica tu cuenta en Reco` | PENDING |
| 4.4 | Link functional | Screenshot of successful verification redirect | PENDING |
| 4.5 | Account verified | Firebase Auth showing `emailVerified: true` | PENDING |

## 5. Contact Email Evidence

| # | Evidence | Description | Status |
|---|----------|-------------|--------|
| 5.1 | Email received by owner | Screenshot of contact email in owner's inbox | PENDING |
| 5.2 | Sender visible | From field shows `Reco <no-reply@recosac.com>` | PENDING |
| 5.3 | Subject line | Subject contains property address | PENDING |
| 5.4 | Reply-To correct | Email headers showing Reply-To is the interested party's email | PENDING |
| 5.5 | No duplicates | Inbox showing exactly 1 email per contact request | PENDING |
| 5.6 | ContactRequest in Firestore | Screenshot of the document in Firestore | PENDING |

## 6. Moderation Email Evidence

| # | Evidence | Description | Status |
|---|----------|-------------|--------|
| 6.1 | Approval email received | Screenshot of approval email | PENDING |
| 6.2 | Rejection email received | Screenshot of rejection email (with reason) | PENDING |
| 6.3 | Re-approval after rejection | Screenshot of second approval email after rejection | PENDING |
| 6.4 | Idempotency skip | Cloud Logs showing "already notified, skipping" for duplicate transition | PENDING |
| 6.5 | No duplicate emails | Inbox count matches expected transitions | PENDING |
| 6.6 | `_lastNotifiedStatus` field | Firestore doc showing field set correctly after each notification | PENDING |

## 7. Log Evidence

| # | Evidence | Description | Status |
|---|----------|-------------|--------|
| 7.1 | Function execution logs | Cloud Logs for all 4 email functions during UAT window | PENDING |
| 7.2 | No unexpected errors | Cloud Logs filtered for ERROR level -- should be empty | PENDING |
| 7.3 | Resend delivery logs | Resend dashboard showing all emails as "Delivered" | PENDING |
| 7.4 | adminAuditLog entries | Firestore showing any `mail.contactOwnerFailed` entries (expected: none during successful UAT) | PENDING |

## 8. Absence of Duplicates (cross-flow)

| # | Evidence | Description | Status |
|---|----------|-------------|--------|
| 8.1 | `/mail` collection audit | Firestore query showing exactly 1 mail doc per expected email during UAT window | PENDING |
| 8.2 | Inbox audit | Total emails received matches total expected (no phantom duplicates) | PENDING |

---

## Sign-off

| Role | Name | Date | Verdict |
|------|------|------|---------|
| Tester | ___ | ___ | All evidence captured: YES / NO |
| Reviewer | ___ | ___ | Evidence sufficient to close BUG-06: YES / NO |
