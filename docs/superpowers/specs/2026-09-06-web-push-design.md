# Web push for existing notifications (per-kind toggles) - design

Date: 2026-09-06. Approved by Asaf: "מאושר, אבל עם מתג לכל סוג התרעה".

## Context

Eight in-app notification kinds exist (`src/lib/notifications.ts`), written server-side
through one helper (`createNotificationForBusiness` in `src/lib/notifications-server.ts`,
6 callers) and client-side by one producer (bank import -> `payment_matched` via
`src/lib/notifications-client.ts` / `notifications-store.ts`). A service worker is
registered (`public/sw.js`, cache only) and the PWA manifest is standalone. Nothing pushes
to the device. Standard Web Push (VAPID) is free and vendor-neutral.

VAPID keys already exist: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` are set on Vercel (production/preview/development) and in `.env.local`.
`web-push` + `@types/web-push` are installed (package.json in this worktree).

## Data

Migration `scripts/migrations/20260906-push-subscriptions.sql` (house style, idempotent,
APPLY BEFORE DEPLOYING):

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
-- RLS on; SELECT/INSERT/DELETE policies scoped business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()); no UPDATE policy.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS push_kinds text[] NOT NULL DEFAULT '{}';
```

`push_kinds` is the per-kind opt-in list (empty = push off). Stored on `businesses` next to
the other channel settings (`monthly_reminder_channels`). Write it through a narrow
single-column saver (pattern: `saveIncomeTaxAdvanceRate` in `src/lib/business-store.ts`),
never through the whole-row `saveBusiness` (see the comment there about clobbering).
`Business.pushKinds?: NotificationKind[]` in `src/lib/types.ts`; read in `useBusiness`.

Endpoints are capability URLs: never rendered, never returned by any API. The whole
`push_subscriptions` row set for a business is deleted by `/api/danger/delete-all` and
cascades on account deletion.

## Server

- `src/lib/push-server.ts` (service role): `sendPushForNotification({ businessId, kind,
  title, body, href, notificationId })`: read `businesses.push_kinds`; return early unless
  `kind` is in it; load the business's subscriptions; `webpush.sendNotification` each with
  payload `{ title, body, url: href (isSafeHref-checked, else "/notifications"), kind,
  id }` and `TTL: 60*60*24`; on 404/410 delete that subscription; on other errors
  `console.warn` and continue; set `last_used_at` on success. Configure `webpush.setVapidDetails`
  lazily from env; if env is missing, log once and no-op (never throw into a producer).
- `createNotificationForBusiness` calls `sendPushForNotification` after a successful
  insert (fire-and-forget with `await` inside its own try/catch, so the producer's result
  is unchanged).
- `src/app/api/push/subscribe/route.ts` (POST, Bearer auth + `auth.getUser()`): body
  `{ endpoint, keys: { p256dh, auth }, userAgent? }`; validate shapes (endpoint must be an
  `https://` URL, keys base64url strings 1-512 chars); upsert by endpoint for the caller's
  business. DELETE with `{ endpoint }` removes it (scoped to the caller). Rate limit like
  the other routes.
- `src/app/api/push/send/route.ts` (POST, Bearer auth): `{ notificationId }`; loads the
  notification row scoped to the caller's user_id and calls `sendPushForNotification`. This
  is for the one client-side producer (bank import); call it from
  `src/lib/notifications-client.ts` after a successful insert, fire-and-forget.
- `src/app/api/push/test/route.ts` (POST, Bearer auth): sends a "ההתרעות פועלות" push
  to the caller's subscriptions, ignoring `push_kinds`, so the settings screen can prove
  the device works. Rate limit 5/hour/user.

## Browser

- `public/sw.js`: add `push` (parse JSON, `showNotification(title, { body, data: { url },
  icon: "/logo-192.png", badge: "/logo-192.png", dir: "rtl", lang: "he", tag: id })`) and
  `notificationclick` (close; focus an open client on the same origin and navigate it to
  `data.url`, else `clients.openWindow(url)`). Same-origin guard on the url. Bump `CACHE`
  to `v2` so the new worker activates.
- `src/lib/push-client.ts`: `isPushSupported()`, `getPermissionState()`,
  `subscribeToPush(accessToken)` (registers/awaits the SW, `pushManager.subscribe({
  userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(NEXT_PUBLIC_VAPID_PUBLIC_KEY) })`,
  POSTs to `/api/push/subscribe`), `unsubscribeFromPush(accessToken)`, and
  `isInstalledIos()` (iOS Safari not in standalone mode = push unavailable until installed).
- **Permission is requested only from a click.** Never on load.

## Settings UI

`src/components/push-settings-section.tsx`, rendered in `src/app/(app)/settings/page.tsx`
next to the reminders/recurring cards (anchor `id="push"`, `scroll-mt-6`), modelled on
`src/components/recurring-suggestions-settings-section.tsx`:

- Heading "התרעות בדפדפן", one-line explanation.
- Primary state line: not supported / blocked in browser (with how to unblock) / iPhone
  not installed (hint: שתפו -> הוסיפו למסך הבית, then return here) / not subscribed on this
  device (button "הפעילו במכשיר הזה") / subscribed (button "כבו במכשיר הזה" + "שלחו התרעת
  בדיקה").
- Per-kind toggles, one row per `NotificationKind` with `NOTIFICATION_KIND_LABELS`, saved
  immediately through the narrow saver (toast on save). Default when the user first
  subscribes: all kinds on (write the full list once on first subscribe if `push_kinds` is
  empty), so the switch set is meaningful from the start.
- A short entry point on `/notifications` page header: a small link "התרעות בדפדפן" to
  `/settings#push` when push is supported and no subscription exists on this device.

## Copy rules

Hebrew, plain hyphen only (no em dash), never "נשלח לבד" style claims. The assistant's app
guide in `src/lib/assistant-system.ts` gets one line: "התרעות בדפדפן: /settings#push".

## Out of scope

Push for WhatsApp/email reminder channels (they stay as they are), per-device kind
settings, notification grouping, sound.

## Verification

- `tests/push-server.test.ts`: kind not in `push_kinds` sends nothing; 410 deletes the
  subscription; unsafe href falls back to `/notifications`; missing env is a no-op.
- `tests/push-subscribe-route.test.ts` (if the repo has route tests; otherwise validate the
  shape validator in a unit test): rejects non-https endpoint, oversize keys.
- `npx tsc --noEmit`, `npx vitest run`, eslint on touched files.
- Manual on the Vercel preview with headless Chrome: grant permission via CDP
  (`Browser.grantPermissions` notifications), click "הפעילו במכשיר הזה", confirm a row lands
  in `push_subscriptions`, POST `/api/push/test`, and assert the SW `showNotification` was
  called (Chrome `--enable-logging` or a `Notification` counter exposed on `self`).
- Screenshots of the settings section at desktop + mobile.
