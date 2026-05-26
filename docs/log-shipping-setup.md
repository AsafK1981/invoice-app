# Long-Term Log Shipping Setup

Required by info-security appendix §19: logs must be retained for 12
months, encrypted at rest.

## Architecture (two-tier, free)

| Tier | Where | Retention | Source |
| --- | --- | --- | --- |
| **Hot** | Axiom dataset `mysuperfriendlyinvoiceapp` | 30 days (free tier cap) | Direct ingest from app code via `src/lib/axiom-logger.ts` |
| **Cold** | Supabase Storage bucket `axiom-archive` | Indefinite | Weekly cron `/api/cron/axiom-archive` pulls from Axiom |

The Vercel→Axiom marketplace integration is NOT used — it requires
Vercel Pro ($20/mo) because Log Drains aren't on the Hobby plan. We
get equivalent functional coverage via direct ingest from application
code (`logToAxiom` in `src/lib/axiom-logger.ts`), which captures all
the events that actually matter for compliance: security events, auth
attempts, allocation API calls, etc.

## One-time setup (Asaf to do)

### Step 1 — Create Axiom account + dataset

1. Sign up at https://app.axiom.co/ with `asafkotlar@gmail.com`
2. Pick **EU Central 1 (AWS)** as the edge deployment for GDPR
3. Create a dataset:
   - Name: `mysuperfriendlyinvoiceapp`
   - Retention: 30 days (free-tier cap)
   - Edge: EU Central 1

### Step 2 — Create Axiom Ingest token

1. In Axiom: **Settings (gear icon) → API Tokens → + New API Token**
2. Name: `vercel-direct-ingest`
3. Permissions: **Ingest** (write) scoped to dataset
   `mysuperfriendlyinvoiceapp`. No other permissions needed.
4. Save and **copy the token immediately** — shown once only.

### Step 3 — Create Axiom Read token (for the archive cron)

1. Same place: **+ New API Token**
2. Name: `vercel-cron-archive`
3. Permissions: **Read** scoped to the same dataset.
4. Save and copy.

### Step 4 — Set Vercel env vars

Add to the `mysuperfriendlyinvoiceapp` Vercel project, all
environments (Production + Preview + Development):

| Variable | Value |
| --- | --- |
| `AXIOM_INGEST_TOKEN` | The ingest token from Step 2 |
| `AXIOM_API_TOKEN` | The read token from Step 3 |
| `AXIOM_DATASET` | `mysuperfriendlyinvoiceapp` |
| `AXIOM_API_BASE` | `https://api.eu.axiom.co` (only if EU instance) |

Redeploy after setting them so the live runtime picks them up.

### Step 5 — Verify

1. Make any authenticated request to a production route (e.g., load
   `/settings`). Within 30 seconds the Axiom dashboard should show
   `source: "security-events"` events arriving.
2. Force a security event by hitting `/api/tax-authority/callback`
   without a state parameter — should show a
   `kind: "tax_authority_unauthorized"` event.
3. The weekly cron runs Sunday 04:00 UTC — first archive will appear
   in the `axiom-archive` Supabase Storage bucket after the next run.

## Alternative — BetterStack (if Axiom retention is insufficient)

BetterStack (formerly Logtail) offers longer retention on cheaper
tiers. Setup is essentially identical:
1. Sign up at https://betterstack.com/logs
2. Create a source with type "Vercel"
3. Copy the ingest token
4. Add Vercel Log Drain pointing to the BetterStack endpoint

## What gets shipped

Everything from `console.log/warn/error/info` in the Next.js runtime
plus Vercel platform events (build, deploy, function invocation).

Security events emitted via `src/lib/security-events.ts` are mirrored
to `console.warn` precisely so they land in the long-term store as
well as Sentry.

## What does NOT get shipped

- Browser-side `console.*` calls (these never reach Vercel)
- Anything in `console.debug` (filtered by Vercel)
- Anything inside try/catch that swallows the error silently

## Retention policy

**Two-tier retention** chosen because Axiom's free tier caps at 30
days but the appendix requires 12 months:

1. **Hot (queryable, 30 days):** in Axiom. Used for day-to-day
   debugging and Sentry alerting.
2. **Cold (archive, indefinite):** Supabase Storage bucket
   `axiom-archive`. Populated by a Vercel Cron job
   (`/api/cron/axiom-archive`) every Sunday at 04:00 UTC. Each weekly
   snapshot is gzipped NDJSON, named
   `YYYY/MM/YYYY-MM-DD_to_YYYY-MM-DD.ndjson.gz`.

The cold archive is bucket-private (service-role only, no public URL
access, RLS bypass enforced). It satisfies the §19 retention
requirement and the §21 Tax-Authority log-access right. When the Tax
Authority requests logs, generate a short-TTL signed URL from the
bucket and share it.

**Required env vars for the archive cron:**

| Variable | Source |
| --- | --- |
| `AXIOM_API_TOKEN` | Axiom Settings → API Tokens → Create token (read-only on the dataset) |
| `AXIOM_DATASET` | `mysuperfriendlyinvoiceapp` (or whatever you named it) |
| `AXIOM_API_BASE` | `https://api.eu.axiom.co` (EU instance — already the default in code) |
| `CRON_SECRET` | Already set; used to gate the cron endpoint |

Set them on Vercel via the dashboard or via
`node scripts/admin.mjs` env-var helpers.

No PII / customer data is logged — only request metadata, error
messages, and security event tags.

## Operational notes

- **Audit access:** When the Tax Authority requests log access
  (appendix §21), generate a read-only Axiom share link valid for 30
  days and email it to `lakohot-bt@taxes.gov.il`.
- **Cost monitoring:** Set a Vercel billing alert at $25/month so we
  notice if log volume balloons unexpectedly.
- **Failure mode:** If Axiom is down, Vercel keeps its local 30-day
  buffer — drops are very unlikely.
