# Assisted WhatsApp collections (one-tap reminders from the owner's own number) - design

Date: 2026-09-06. Approved by Asaf: "תבנה את א', הגבייה המסייעת".

## Context

Dunning today (`src/app/api/dunning/run/route.ts`, daily GitHub Action) emails the client
3 escalating Hebrew reminders at 3/14/30 days after issue when `businesses.dunning_enabled`
is true, logging each send in `dunning_log`. Israeli clients answer WhatsApp far more than
email, but sending from the app's Meta number is blocked (test number, template approval,
per-message cost, and the recipients never opted in to the app's number).

The assisted path avoids all of that: the app prepares the message and the OWNER sends it
from their own WhatsApp with one tap. It rides on the notifications + web push shipped
today (`src/lib/notifications-server.ts`, `src/lib/push-server.ts`) and on the `wa.me`
link the document page already builds (`src/app/(app)/documents/[id]/page.tsx` ~L391).

## Behaviour

1. **Daily, inside the existing dunning run**, after the email pass: for every business
   with `dunning_whatsapp_enabled` (new column, default true - it sends nothing to clients
   by itself, it only notifies the owner), for every open receivable
   (`tax_invoice | proforma`, `status = 'sent'`, `paid_at IS NULL`, not converted) whose
   days-since-issue reached a bucket (3 / 14 / 30, same `bucketFor`), whose client has a
   phone, and that has no `dunning_log` row for `(document_id, bucket, channel = 'whatsapp_assist')`:
   create ONE notification and log it.
   - kind: new `NotificationKind` `"whatsapp_reminder_ready"`, label
     "תזכורת בוואטסאפ מוכנה לשליחה".
   - title: `חשבונית {number} של {clientName}: {days} ימים בלי תשלום`
   - body: `לחצו כדי לשלוח תזכורת בוואטסאפ מהמספר שלכם`
   - href: `/documents/{id}?remind=whatsapp` (same-origin; `isSafeHref` passes).
   - The push toggles pick the new kind up automatically from `NOTIFICATION_KIND_LABELS`.
     Migration adds the kind to `push_kinds` of every business that already has a
     non-empty list (they opted in to "all kinds" at subscribe time; document this in the
     migration header).
   - No client phone: no notification (the owner cannot send anyway). Never email or
     message the client from this path.
2. **Document page** (`src/app/(app)/documents/[id]/page.tsx`): for an open receivable,
   a "תזכורת בוואטסאפ" action next to the existing share actions, opening
   `https://wa.me/<digits>?text=<prefilled>` in a new tab. Prefilled Hebrew text by stage
   (reuse the 3/14/30 tone copy from the dunning route: extract the three intro/cta
   strings into `src/lib/dunning-copy.ts` so email and WhatsApp share one source), signed
   with the business name, ending with the public view link
   (`/view/<id>` on the canonical origin). Stage = `bucketFor(daysSince(date))`, and before
   day 3 a neutral "שלחתי לך את החשבונית, אשמח לתשלום" text. When the client has no phone,
   the action is disabled with the tooltip "ללקוח אין מספר טלפון".
   - `?remind=whatsapp` in the URL scrolls to and highlights that action (one pulse), and
     is stripped from the URL after (`history.replaceState`).
3. **Settings**: a toggle "תזכורות גבייה בוואטסאפ (אתם שולחים בלחיצה)" next to the
   existing dunning toggle wherever it lives (find `dunning_enabled` in the settings /
   reminders UI); saved through a narrow single-column saver (pattern `savePushKinds` /
   `saveIncomeTaxAdvanceRate` in `src/lib/business-store.ts`), never via `saveBusiness`.
   Copy must say the owner sends; never "נשלח לבד".

## Shared helper

`src/lib/whatsapp-link.ts`: `waDigits(phone)` (Israeli `05x` -> `9725x`, strips spaces,
dashes, `+`; returns "" when fewer than 9 digits) and `whatsappLink(phone, text)`; replace
the inline builder on the document page with it. Unit-tested.

## Data

Migration `scripts/migrations/20260906-assisted-whatsapp-collections.sql`, house style,
idempotent, APPLY BEFORE DEPLOYING:

```sql
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS dunning_whatsapp_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE dunning_log ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';
-- unique (document_id, bucket, channel) if the table's existing dedupe key is (document_id, bucket); inspect the table first (grep scripts/migrations for dunning_log) and keep the old key semantics for email rows
UPDATE businesses SET push_kinds = array_append(push_kinds, 'whatsapp_reminder_ready') WHERE cardinality(push_kinds) > 0 AND NOT ('whatsapp_reminder_ready' = ANY(push_kinds));
```

`Business.dunningWhatsappEnabled?: boolean` in `src/lib/types.ts`, read in `useBusiness`.
The existing email dedupe query in the dunning route must now filter `channel = 'email'`.

## Out of scope

Sending from the app's Meta number, templates, SMS, per-client opt-out (the owner decides
per tap), reminder stages other than 3/14/30.

## Verification

- `tests/whatsapp-link.test.ts`: digits normalisation (05x, +972, spaces/dashes, short
  input -> ""), link encoding of Hebrew text.
- `tests/dunning-copy.test.ts`: the three stages and the pre-3-day text render with the
  variables filled and the view link last; no em dashes.
- If the dunning route has testable pure helpers for the assisted pass (bucket + dedupe
  decision), unit-test them; otherwise keep the pass a small pure function in
  `src/lib/assisted-dunning.ts` (`planAssistedReminders(docs, clients, logRows, today)`)
  and test THAT: creates once per (doc, bucket), skips no-phone clients, skips paid.
- `npx tsc --noEmit`, `npx vitest run`, eslint on touched files.
- Screenshots (desktop + mobile) of the document page action and of the settings toggle.
