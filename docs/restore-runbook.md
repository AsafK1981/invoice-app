# Restore runbook - bringing a backup back to life

Companion to `.github/workflows/db-backup.yml` and `scripts/backup-db.mjs`.
Read this BEFORE you need it. Practise it once a quarter (see the checklist
at the bottom).

## What we have

- **Where:** private repo `AsafK1981/invoice-app-backups`
  - `daily/invoice-app-<UTC stamp>.tar.gz.enc` - newest 35 nights
  - `monthly/` - first archive of every month, kept forever
  - `status.json` - last verified success (watched by `scripts/health-check.mjs`,
    which alerts via Gaya when it is older than 36h)
  - second copy: each run also uploads the archive as a 90-day GitHub Actions
    artifact on `AsafK1981/invoice-app` (Actions -> "Nightly DB + Storage Backup")
- **What is inside** (after decrypt + untar):
  - `db.dump` - `pg_dump -Fc` of schemas `public`, `auth`, `storage`
    (tables, data, functions, triggers, RLS policies, sequences)
  - `schema.sql` - same DDL as plain SQL
  - `public-data.sql` - plain `COPY` data of `public` (fallback if `pg_restore`
    is unavailable)
  - `storage/<bucket>/<path>` - every Storage object
  - `manifest.json` - row counts per table + object counts (compare after restore)
- **Every archive was restore-verified** in CI against a scratch Postgres 17
  before it landed in the repo (row counts must match the manifest).
- **The passphrase** (`BACKUP_PASSPHRASE`) lives in: repo Actions secrets,
  `.env.local` on Asaf's PC, and Asaf's password manager. Without it the
  archive is noise. Losing all three copies = losing the backups.

## Prerequisites on the machine doing the restore

- `git` + `gh` (authenticated as AsafK1981) or a browser download of the archive
- `openssl`, `tar`
- PostgreSQL 17 client tools (`pg_restore`, `psql`)
- Node 20+ and this repo (`npm ci`) for the storage re-upload helper

## Step 1 - fetch and decrypt

```bash
NAME=invoice-app-2026-08-16T184900Z          # pick from daily/ or monthly/
gh api repos/AsafK1981/invoice-app-backups/contents/daily/$NAME.tar.gz.enc \
   -H "Accept: application/vnd.github.raw" > $NAME.tar.gz.enc
export BACKUP_PASSPHRASE='<from password manager>'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
   -in $NAME.tar.gz.enc -out $NAME.tar.gz
tar -xzf $NAME.tar.gz
cat $NAME/manifest.json | head -40
```

## Step 2 - decide the target

| Scenario | Target |
|---|---|
| Someone deleted rows / a bad migration, project still alive | Restore into a **new** Supabase project first, inspect, then copy the needed rows back with `scripts/admin.mjs` or SQL. Never `pg_restore` straight over production. |
| Supabase project paused / deleted / account lost | New Supabase project (free tier is fine at this size) **or** self-hosted Postgres + Supabase stack. |
| Just need one document / one business's data | Restore into local Postgres (Docker `postgres:17`) and query it. |

## Step 3 - restore the database

Target = a fresh Supabase project (recommended path):

1. Create the project (region eu-west-2 to keep the privacy page truthful),
   set a DB password, copy the **session pooler** URL (port 5432).
2. Supabase already ships schemas `auth` and `storage` and the roles
   `anon`/`authenticated`/`service_role`. Restore public objects + data:
   ```bash
   export PGSSLMODE=verify-full PGSSLROOTCERT=scripts/supabase-root-2021-ca.crt
   TARGET='postgresql://postgres.<newref>:<pw>@aws-1-eu-west-2.pooler.supabase.com:5432/postgres'
   # DDL first (tables, functions, triggers, policies)
   pg_restore --no-owner --no-privileges -n public --schema-only -d "$TARGET" $NAME/db.dump
   # then data, triggers disabled so immutability triggers can't reject rows
   pg_restore --no-owner --no-privileges -n public --data-only --disable-triggers -d "$TARGET" $NAME/db.dump
   ```
   `--disable-triggers` needs superuser; on Supabase use
   `set session_replication_role = replica;` via psql before the data pass instead
   if it complains.
3. Users: `auth.users` + `auth.identities` are in the dump. Restore data only:
   ```bash
   pg_restore --no-owner --no-privileges -n auth --data-only \
     -t users -t identities -t mfa_factors -d "$TARGET" $NAME/db.dump
   ```
   Password hashes travel with the rows, so email/password logins keep working.
   Google sign-in keeps working as long as the same GCP OAuth client is used
   (memory: GCP project "for my website"). TOTP factors restore too.
4. Storage metadata (`storage.buckets`, `storage.objects`) is in the dump, but
   the **files** must be re-uploaded (step 4). Recreate the buckets with the
   same names/visibility (`business-logos` public; the rest private) and re-apply
   the storage policies from `scripts/migrations/2026*-*storage*.sql` and
   `supabase-storage-policies-fix.sql`.
5. Compare counts against `manifest.json`:
   ```bash
   VERIFY_DB_URL="$TARGET" node scripts/backup-db.mjs --verify $NAME
   ```
   (The verify mode creates roles/schemas if missing and tolerates
   "already exists" errors; it fails loudly on any row-count mismatch.)
6. Re-grant/revoke per `scripts/migrations/20260809-revoke-usage-rpc-from-public.sql`
   and re-run the newest immutability + RLS migrations to be sure nothing was
   lost in `--no-privileges`. Then re-run `npm run` pre-push checks
   (`anon-read security check` must show 0 rows for every table).

Target = local Docker (inspection only):
```bash
docker run -d --name restore -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:17
export VERIFY_DB_URL=postgresql://postgres:x@localhost:5433/postgres
node scripts/backup-db.mjs --verify $NAME     # restores + compares counts
psql "$VERIFY_DB_URL" -c 'select number,total,status from public.documents order by created_at desc limit 20'
```

## Step 4 - re-upload storage objects

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<newref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<new service role> \
node -e '
import("@supabase/supabase-js").then(async ({createClient})=>{
  const fs=await import("node:fs"), path=await import("node:path");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const root=process.argv[1];
  const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
  for (const bucket of fs.readdirSync(root)) {
    for (const f of walk(path.join(root,bucket))) {
      const key=path.relative(path.join(root,bucket),f).split(path.sep).join("/");
      const {error}=await sb.storage.from(bucket).upload(key,fs.readFileSync(f),{upsert:true});
      console.log(error?"✗":"✓",bucket,key,error?.message||"");
    }
  }
});' $NAME/storage
```

## Step 5 - point the app at the new project

Vercel env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF`), then the same in
`.env.local`, then redeploy. Update `SUPABASE_DB_URL` secret so the nightly
backup follows the new project. Re-run `scripts/health-check.mjs`.
Google OAuth: add the new `https://<newref>.supabase.co/auth/v1/callback`
to the GCP client if Supabase-side Google auth is used (the app's own GIS
redirect flow goes through `/api/auth/google-redirect`, unaffected).

## Quarterly drill (15 minutes)

- [ ] `status.json` in the backups repo is < 36h old and `verified: true`
- [ ] Decrypt the newest archive on Asaf's PC with the password-manager copy
      of the passphrase (proves the passphrase copy is right, not only the
      Actions secret)
- [ ] `node scripts/backup-db.mjs --verify` against a local/scratch Postgres
      passes
- [ ] Note the date in `docs/security-procedures.md` §11 ("Backups")

Last drill: 2026-08-16 (first archive; CI verify + local decrypt both passed).
