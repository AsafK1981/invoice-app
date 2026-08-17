# Information Security Procedures — MyFriendlyInvoiceApp

This document fulfils sections §9–§22 of the Israel Tax Authority
information-security appendix that every approved software house signs
(`Service_Pages_shaam_appen-info-security-for-software-house.pdf`).
It also serves as Asaf's living checklist — every entry maps to a
specific appendix section.

**Owner:** Asaf Kotler (ת.ז 049040686)
**Last reviewed:** 2026-05-25
**Next scheduled review:** 2027-05-25 (annual per §10)

---

## 1. Roles and access (§1–§3)

The software house is a one-person operation. Asaf is the only
person with operational access to the application's production
environment and to the Supabase project hosting customer data.

If/when employees or contractors are hired:
- They sign an NDA before any access is granted.
- Access is granted per the Need-to-Know principle (§2).
- Each new role is added to this document with a description of the
  data it touches.

Third-party processors currently used:
- **Supabase** (database + auth) — GDPR-compliant, SOC 2 certified.
- **Vercel** (hosting + edge runtime) — GDPR-compliant.
- **Resend / Gmail SMTP** (outbound email).
- **Sentry** (error monitoring).
- **Polar.sh** (payments).
- **Anthropic** (receipt OCR, in-app assistant, WhatsApp intent parsing) - API data not used for training per commercial terms.
- **Meta** (WhatsApp Business channel).
- **Groq** (Whisper transcription of WhatsApp voice notes, added 2026-08-17; free tier; audio is sent for transcription only, not stored by us).

All of the above are bound by their own DPAs; Asaf is responsible for
ensuring his use of them complies with this appendix (§3).

## 2. Data confidentiality (§4–§5)

- All sensitive data (customer business records, OAuth tokens, etc.) is
  stored in Supabase Postgres with Row-Level Security policies that
  scope rows to the owning business.
- Public document views (`/view/[id]`) are served from a dedicated API
  route that uses the service role and performs its own ownership +
  UUID-shape validation — anonymous Postgres access via RLS `USING
  (true)` is **prohibited** (a pre-push gate enforces this).
- Sensitive secrets (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
  `GMAIL_APP_PASSWORD`, Polar keys, Tax Authority client credentials,
  `COLUMN_ENCRYPTION_KEY`) live in Vercel environment variables and
  `.env.local` (gitignored) only — never committed to the repository.

## 3. Personal-data handling (§6–§8)

- Customer personal data (clients, invoices, contact info) is
  accessible only to the owning business via authenticated requests.
- Asaf does not access individual customer data outside of legitimate
  support requests initiated by the customer.
- Customer data is never disclosed to third parties without an
  explicit power of attorney from the customer (§8). Marketing /
  analytics use only aggregate, non-identifying signals.

## 4. Security incident response (§9–§11)

**Definition of a security incident:**
1. Unauthorised access to customer records.
2. Compromise of a credential (service-role key, OAuth token, admin
   password, encryption key).
3. Disclosure of customer data outside the consent boundary.
4. Successful injection / RCE / data-exfiltration attempt confirmed
   in logs.

**Logging:** All API requests are logged by Vercel (function logs) and
Supabase (Postgres + Auth logs). Sensitive payloads (tokens,
passwords) are never logged. Long-term retention (12 months per §19)
is provided by **Axiom** — see `docs/security-procedures.md#5`.

**Response steps:**
1. **Contain.** Rotate the affected credentials immediately
   (`SUPABASE_SERVICE_ROLE_KEY` regenerated in Supabase dashboard,
   OAuth tokens revoked, `COLUMN_ENCRYPTION_KEY` rotated, affected
   user passwords forced to reset).
2. **Document.** Record the incident timeline, scope of affected data,
   technical root cause, and remediation steps in `docs/incidents/`.
3. **Notify.** Email the Tax Authority within 24 hours of detection at
   `lakohot-bt@taxes.gov.il` (per §11), citing software-house file
   number 4257104.
4. **Notify affected customers** if their personal data was involved
   (per Privacy Protection Law 1981 + Amendment 13).
5. **Post-mortem.** Within 7 days, produce a blameless write-up and
   add follow-up actions to the engineering backlog.

**Annual review (§10):** This document is reviewed and updated every
12 months, on or before the date noted at the top. The review covers
new threat surface, new third-party processors, new regulations.

## 5. Long-term log retention (§19)

Vercel's built-in log retention is 30 days. To meet the 12-month
requirement, all production function logs are shipped to **Axiom** via
the Vercel Log Drain integration. Axiom's free tier provides 500MB /
month of ingestion which is sufficient for this app's traffic.

Logs are stored encrypted at rest (Axiom uses AES-256 at the storage
layer). Retention is set to 365 days.

Setup: Vercel → Project → Settings → Integrations → Log Drain → Axiom.
(One-time configuration; see `docs/log-shipping-setup.md`.)

## 6. Real-time security alerting (§20)

Sentry (`@sentry/nextjs`) captures errors and performance traces in
production. Specific alerts are configured for:
- Spike in `auth/v1/token` 4xx responses (>10 in 5 minutes from a
  single IP) — indicates credential stuffing.
- Any 401 on `/api/tax-authority/*` routes — indicates token leakage
  or replay attempt.
- Any 5xx burst on `/api/uniform-structure/export` — indicates
  exfiltration attempt of the audit file.
- Failed signups with the same email > 3 times — duplicate-account
  abuse pattern.

Alerts route to `asafkotlar@gmail.com`.

## 7. Authentication controls (§17–§18)

**Customer 2FA (§17):**
- Google OAuth sign-in users are protected by Google's own 2FA when
  enabled at Google account level (Something-you-know password +
  Something-you-get phone).
- Email/password users can enrol a TOTP (Time-based One-Time Password)
  via the Settings → Security tab; enrolment is encouraged via a
  persistent banner until completed.
- New business sign-ups are prompted to enable TOTP during onboarding.

**Secrets encryption at rest (§18):**

| Secret | Storage | At-rest encryption |
| --- | --- | --- |
| User passwords | Supabase Auth (`auth.users`) | bcrypt by Supabase |
| Session JWTs | Browser cookie (HttpOnly, Secure, SameSite=Lax) | Signed by Supabase; encrypted in transit |
| Tax Authority `access_token` | `tax_authority_credentials.access_token` | **AES-256-GCM column encryption** (see `src/lib/crypto.ts`) |
| Tax Authority `refresh_token` | Same table | **AES-256-GCM column encryption** |
| Tax Authority `client_secret` | Vercel env var | Encrypted at rest by Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env var | Encrypted at rest by Vercel |
| `COLUMN_ENCRYPTION_KEY` | Vercel env var | Encrypted at rest by Vercel |
| Polar API keys | Vercel env var | Encrypted at rest by Vercel |

The `COLUMN_ENCRYPTION_KEY` is 32 raw bytes / 64 hex chars. Rotated
every 24 months or sooner if compromise is suspected (see incident
response §4).

## 8. Penetration testing (§12–§16)

**Current customer count:** 1 (Asaf himself / pre-launch).

**Required cadence:**
- 10–99 customers: PT every 18 months
- 100+ customers: PT before 2025-09-30 (already past for our case — we
  are still below 100 customers as of 2026-05-25), then every 18
  months.

**Trigger:** First PT will be scheduled when the active-customer count
crosses 10. A calendar reminder is set to re-check this threshold
quarterly (`docs/security-procedures.md`).

**Provider qualifications:** Must have ≥3 years of PT experience and
performed ≥25 PTs/year for organisations with ≥500 customers each.

**High/Critical finding SLA (§16):** Within 30 business days of the
report being delivered, all High and Critical findings must be either
fixed in production or accepted in writing with a documented
compensating control. Asaf personally signs off on the remediation.

## 9. Tax Authority log access (§21)

The Tax Authority reserves the right to inspect logs at the software
house's premises. We honor this by:
1. Maintaining 12-month Axiom log retention (§5 above).
2. Providing a read-only access link or exported archive within 5
   business days of a written request from `lakohot-bt@taxes.gov.il`.

## 10. Legal proceedings declaration (§22)

As of the "Last reviewed" date at the top of this document, the
software house and its representatives have **no** pending privacy /
information-security proceedings, oversight, or enforcement actions
from any regulator including the Privacy Protection Authority.

If any such proceeding is initiated, this document is updated within
5 business days and the Tax Authority is notified at the contact
above.

---

## 11. Backups and data durability

**State before 2026-08-16:** the Supabase organisation is on the Free
plan, which has no automatic backups (Management API on 2026-08-16:
`pitr_enabled: false`, `backups: []`). No copy of production data
existed outside Supabase. Closed the same day.

**Now:**

- `.github/workflows/db-backup.yml` runs nightly at 23:00 UTC:
  `pg_dump` of schemas `public` + `auth` + `storage` and a download of
  every Storage object, packed and encrypted (AES-256-CBC, PBKDF2,
  `BACKUP_PASSPHRASE`). TLS to the database is `verify-full` against the
  pinned Supabase root CA (`scripts/supabase-root-2021-ca.crt`).
- **Every run restore-tests itself**: the archive is decrypted and
  restored into a scratch Postgres 17 in CI and row counts are compared
  with the manifest. A run whose restore does not match fails.
- Copies: private repo `AsafK1981/invoice-app-backups` (35 daily +
  monthly forever, single-commit snapshot branch) and a 90-day GitHub
  Actions artifact. Two independent locations, both outside Supabase.
- Alerting: a failed run pushes a WhatsApp via Gaya immediately;
  `scripts/health-check.mjs` (twice weekly) alerts if the last verified
  backup is older than 36h, so a job that silently stops firing is
  caught within days.
- Restore procedure and quarterly drill: `docs/restore-runbook.md`.
- Passphrase custody: Actions secret + `.env.local` + Asaf's password
  manager. Rotating it = re-encrypting nothing (old archives keep the
  old passphrase); record the rotation date here.
- RPO = 24h. RTO for "new Supabase project from the newest archive" is
  about one hour by the runbook. Supabase Pro (daily platform backups,
  no project pausing) was considered and deferred until paying
  subscribers exist.

Last restore drill: 2026-08-16 (CI verify + local decrypt on Asaf's PC).

## 12. Infrastructure account hygiene (lock-out prevention)

Everything runs on Asaf's personal accounts; nobody else can lock him
out, so the real risk is losing an account or a platform action. Checked
2026-08-16 (read-only, via each provider's API where it exposes the fact):

| Account | Owner | MFA | Second owner | Status 2026-08-16 |
| --- | --- | --- | --- | --- |
| Supabase org `Asaf Kotler` | asafkotlar@gmail.com (Owner) + **newcaliconstruction@gmail.com (second Owner since 2026-08-17, email+password login, break-glass only)** | Primary: **ON** (TOTP, Google Authenticator synced to Google account; API `mfa_enabled: true`). Second owner: no MFA (strong password in the recovery doc) | yes | done |
| Vercel team `asafk1981s-projects` | asafkotlar@gmail.com | **ON since 2026-08-16** (TOTP; recovery codes in the recovery doc) | not possible on Hobby (team members need Pro) | done |
| GitHub `AsafK1981` (code + backups repo) | asafkotlar@gmail.com, **backup email newcaliconstruction@gmail.com (verified 2026-08-17)** | **ON since 2026-08-16** (TOTP + GitHub Mobile on iPhone; recovery codes in the recovery doc); account password set 2026-08-16, saved in Google Password Manager | backup email | done |
| Google (Gmail owner of all the above + GCP OAuth client) | asafkotlar@gmail.com | not re-verified (needs Windows Hello on Asaf's PC; Google's own security page shows "recommendations pending") | n/a | ACTION (Asaf, 2 min): myaccount.google.com/security -> review recommendations |
| Domain `friendlyinvoice.co.il` | DomainTheNet, user `asafkotlar` (login = password + SMS code) | registrar login is SMS-gated | n/a | expires **2027-08-05**, status locked, no auto-renew at this registrar; Google Calendar reminder set for 2027-07-05 (email 7 days before + popup) |
| Meta Business (WhatsApp), Polar | asafkotlar@gmail.com | not verified (Meta page needs a re-auth Asaf must do; Polar has no MFA of its own, login via GitHub/Google) | none | low priority |

**Recovery-code custody (2026-08-17):** all recovery codes, the second-owner
Supabase password and a copy of `BACKUP_PASSPHRASE` live in ONE private Google
Doc in Asaf's Drive: "קודי שחזור - חשבונית ידידותית (סודי)" (owner-only,
protected by the Google account). GitHub's codes are also in the Google
Password Manager note of the github.com entry. No plaintext copies remain on
the PC.

Passphrase / recovery-code custody: `BACKUP_PASSPHRASE`, Supabase DB
password, and every provider's recovery codes belong in a password
manager, not only on this PC. Break-glass: a second email address of
Asaf's own added as owner on Supabase org + Vercel team + GitHub repos.

---

## Annual review checklist

Walking through this checklist on the date in the header:

- [ ] Confirm Asaf is still the only access holder; update §1 if
      others have been onboarded.
- [ ] Re-list third-party processors in §1 and check each is still
      DPA-compliant.
- [ ] Verify Axiom log drain is still active and retention is 365 days
      (`docs/security-procedures.md#5`).
- [ ] Verify all Sentry alerts in §6 still resolve to a working
      address.
- [ ] Verify column encryption key is current — if >24 months old,
      rotate.
- [ ] Review customer count — if ≥10, schedule a PT.
- [ ] Verify no legal proceedings (§22).
- [ ] Backups: status.json < 36h, quarterly restore drill done (§11).
- [ ] Bump "Last reviewed" / "Next scheduled review" dates.
- [ ] Commit the updated document.
