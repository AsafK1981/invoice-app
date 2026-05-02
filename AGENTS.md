<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-discipline -->
# Project discipline (read every session)

This is a live SaaS with real users (Israeli עוסק פטור freelancers). Treat every change as production-bound.

## Deploy mechanics — three traps that have all caught us before

1. **Vercel deploys from `master`, not `main`.** After every commit, run `git push origin main:master` too. Pushing only to `main` does nothing for production.
2. **The canonical alias `mysuperfriendlyinvoiceapp.vercel.app` does NOT auto-advance** when a new deployment goes ready. Confirm via `GET /v4/aliases/mysuperfriendlyinvoiceapp.vercel.app` and compare `deploymentId` to the latest production deployment. If different, repoint via `POST /v2/deployments/{depId}/aliases`.
3. **`ssoProtection` should stay `null` on the project.** If it gets enabled, the public URL returns 401. Reset via `PATCH /v9/projects/{id}` with `ssoProtection: null`.

## Required checks before claiming "shipped" or "done"

- `npx next build` exits 0
- After push: production deploy READY at the latest commit AND alias points to it AND key routes return 200 on `mysuperfriendlyinvoiceapp.vercel.app` (NOT just on the deployment-hash URL — they diverge)
- For new strings/components: grep production JS chunks to confirm the new content is actually being served. "Build passes + deploy READY" does not prove the canonical URL serves the new code.
- After ANY CSS edit: run the `desktop-polish` and `mobile-polish` skills in the same commit
- After non-trivial code changes: run `simplify` (3-agent reuse/quality/efficiency review)
- Before any creative work (new feature/component/behavior change): run `brainstorming` first

## Security floor — non-negotiable for this project

- **Public RLS policies must NEVER use `USING (true)`.** Anon-readable data goes through a server-side API route with `SUPABASE_SERVICE_ROLE_KEY`, not RLS. Past incident (CVSS 9.1, AEGIS pentest 2026-04-29) — see commit `43b32ef`.
- All `/api/*` routes that touch sensitive data require auth (Bearer token) and validate with `auth.getUser()`. Public routes (e.g. `/api/public-document/[id]`) must validate input shape (UUID regex) before hitting the DB.
- `next.config.ts` headers stay set: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy.
- Never commit security reports, exploit details, or anything matching `*Security_Report*.pdf` or `AEGIS_*.pdf` (already in .gitignore).
- A weekly remote agent runs every Monday 16:00 UTC re-running the AEGIS exploit + route health + header checks. If it opens a `🚨 SECURITY REGRESSION` issue, drop everything and investigate.

## Admin access (no need to send the user to dashboards)

`.env.local` (gitignored) holds: `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_ACCESS_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF=ddrlnwwuzehatjfachgu`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `RESEND_API_KEY`. Together these cover Vercel project config + deploys, Supabase Management API (auth config / RLS / SQL via `scripts/run-sql.mjs`), and direct DB access via `scripts/admin.mjs`. **The user should not need to click into a dashboard for anything in this project.**

## Communication

The user reads English in the terminal — replying in mixed Hebrew/English breaks rendering. Reply in English even when they write in Hebrew. Be terse: state results and decisions directly, no narration of internal deliberation.
<!-- END:project-discipline -->
