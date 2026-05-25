# Long-Term Log Shipping Setup

Required by info-security appendix §19: logs must be retained for 12
months, encrypted at rest.

Vercel's built-in log retention is only ~30 days on Hobby/Pro plans.
We ship to **Axiom** via Vercel's native Log Drain integration.

## One-time setup (Asaf to do)

### Step 1 — Create Axiom account

1. Sign up at https://app.axiom.co/ with `asafkotlar@gmail.com`
2. Create a dataset called `mysuperfriendlyinvoiceapp` with retention
   set to **365 days** (free tier limit: 500MB/month ingest, 30 days
   retention — may need a paid plan for 365 days; alternatively use
   BetterStack or set up S3 archival)

### Step 2 — Install Vercel integration

1. Open https://vercel.com/integrations/axiom
2. Click "Add Integration"
3. Select project: `invoice-app`
4. Pick the Axiom dataset created in Step 1
5. Choose what to send: **All logs** (function logs + build logs)
6. Confirm

### Step 3 — Verify

After deploying any change, check the Axiom dashboard to see logs
flowing in. The dataset should populate within 1-2 minutes of a
production request.

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
