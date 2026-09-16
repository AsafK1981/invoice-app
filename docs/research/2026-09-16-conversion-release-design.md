# Releasing a converted source after a full credit note

**Status: REJECTED on 2026-09-16 after a T3 council review. Do not build it.**
What shipped instead is an explanation on the locked document plus the
existing duplicate action. `src/lib/conversion-reversal.ts` holds the rule and
`tests/conversion-reversal.test.ts` pins the measurement. The design below is
kept because the research behind it stands and because the reasons it failed
are the reasons not to try again.

## Why it was rejected

Releasing the source back to `status = 'sent'` invents a debt. Credit notes
are keyed to the document they name (the successor), so nothing can ever net
them against the reopened source. Measured on the only reachable case, a
proforma converted into a tax-invoice-receipt that is then fully credited:

```
as shipped (stays locked):  billed 0     paid 0   balance 0
if released:                billed 1000  paid 0   balance 1000
```

That 1000 flows into the aging report, the cash-flow forecast as a certain
inflow, the client statement, and `src/lib/portal-totals.ts`, which is what
the customer sees in their own portal. Worse, `dunning-plan.isOpenReceivable`
matches it, so the daily cron would email a late-payment demand to a customer
who was just refunded, at the harshest stage, because a document converted
before any reminder ran has no `dunning_log` rows to dedupe against.

Three further findings from the council, all verified:

- **Deadlock.** The proposed source-then-successor lock order is the reverse
  of `cancel_document_atomic`, which locks the successor first and then its
  sources. Cancelling the successor in one tab while releasing the source in
  another would abort with 40P01.
- **The gate does not hold.** A credit note is outside the 23א cancel guard,
  so it can be cancelled after the release, leaving the source released and
  the successor standing: the same work billable twice.
- **The premise was wrong.** The claim below that cancelling the successor
  "destroys the only evidence" is false. The audit action
  `document.conversion_unlinked` already exists and `cancelDocument` writes
  one row per released source. Its real weakness is that the write is
  client-side and fire-and-forget.

Also worth recording: `converted_to_id`, `status` and `paid_at` are not on the
immutability trigger's block list, so an owner can write them directly through
PostgREST. An RPC-side gate would not have been an enforcement boundary
anyway.

## Scope, which is much smaller than it looks

Conversion allows quote/proforma -> receipt | tax_invoice_receipt and
tax_invoice -> receipt, while a credit note may only name a tax_invoice or a
tax_invoice_receipt. A receipt cannot be credited, so the only successors that
can be fully credited are tax-invoice-receipts, which means the source is
always a quote or a proforma, and neither is a revenue type. That is why no
turnover figure moves either way.

---

Everything below is the original design, kept for the research it carries.

Status: superseded.

## The problem

Document A is converted into document B (quote -> tax invoice, proforma ->
tax invoice, tax invoice -> receipt). `create_document_atomic` then sets, in
one transaction:

```
A.converted_to_id = B.id
A.status          = 'paid'
A.paid_at         = now()
```

A can never be converted again, on purpose: that is what stops the same work
being billed twice.

Now B is fully reversed by a credit note (`credit_note.original_document_id =
B.id`, amounts stored negative). B is dead for tax purposes, but A stays
converted forever, so the owner cannot re-issue against A.

## What the law says (researched 2026-09-16)

Verified against primary sources:

- חוק מע"מ §49: liability under an issued invoice stands until it is
  cancelled or corrected in the manner the regulations prescribe.
- הוראות ניהול פנקסי חשבונות §9(ה): a credit note must carry the number and
  date of the invoice it reverses. The credit-note-to-invoice link is legally
  required.
- §18(א)(3): a serial number is never reused. §18(ג): a cancelled document's
  copy is preserved, never deleted.

The law regulates ISSUED TAX DOCUMENTS. It has no concept of "conversion"
between an internal quote and an invoice. `converted_to_id` is an application
workflow flag, not a tax record, and nothing found requires it to stay set
forever. Releasing it is permitted provided nothing is deleted or renumbered
and the history survives.

Not verified from a primary source: the text of תקנה 23א, and the claim that a
new document may be issued after a full credit (documented practice at several
vendors, no statutory citation found).

## What competitors do

Nothing to copy. Every Israeli vendor documents the locking direction
(conversion closes the source); not one documents the reverse. Xero's void is
one-way. Zoho has no reverse. FreshBooks only frees the estimate by DELETING
the invoice, which Israeli bookkeeping rules forbid us from doing.

## Design

### The column-move, not a new flag

The obvious design is a `conversion_released_at` flag that every reader must
now consider. It was rejected: `converted_to_id` / `convertedToId` is read in
66 places across 31 files, including turnover (`income-tax-advances`),
profit and loss, the uniform-structure export and the filing rows. Teaching
all of them a second condition is a large money-path risk for no gain, and
any reader that forgot the new flag would silently keep A out of the books.

So `converted_to_id` keeps its exact present meaning, "currently superseded",
and the history moves to a new column instead:

```sql
alter table public.documents
  add column previous_conversion_id uuid references public.documents(id) on delete set null,
  add column conversion_released_at timestamptz;
```

Release is then a move, not a delete:

```
previous_conversion_id = converted_to_id
converted_to_id        = null
conversion_released_at = now()
status                 = 'sent'
paid_at                = null
```

Every existing reader keeps working untouched, and the trail A -> B is
preserved with the date it was released.

### Why this also fixes an existing hole

`cancel_document_atomic` already releases sources today, and it does it by
setting `converted_to_id = NULL` with no record at all. Since a converted
successor carries NO back-pointer to its source (`original_document_id` is
only written for credit notes, never on a convert), cancelling B destroys the
only evidence that A ever became B. The same column-move fixes that path, so
there is one release mechanism instead of two that disagree.

### New RPC

`release_conversion_atomic(p_source_document_id uuid)`, SECURITY INVOKER so
RLS applies, `EXECUTE` revoked from anon.

Refuses unless all hold:
1. the source exists, belongs to the caller's business, and is not a draft;
2. `converted_to_id` is not null (there is something to release);
3. the successor is fully credited: the sum of its non-draft, non-cancelled
   credit notes (stored negative) covers its `total_ils ?? total` in full.
   A partial credit releases nothing.

Locks the source `FOR UPDATE` first, then the successor, in id order, to keep
the lock order it shares with `create_document_atomic`.

### Re-conversion afterwards

No change needed. `create_document_atomic` already guards on
`converted_to_id IS NULL`, which is true again after a release, and it
overwrites nothing else.

### UI

On A, only when its successor is fully credited: a button, plus a line that
states what happened. After release A shows "הומר למסמך X, שבוטל בזיכוי Y,
ושוחרר להמרה מחדש בתאריך Z" built from `previous_conversion_id` and
`conversion_released_at`. Never automatic: a full credit note usually means
the deal died, not that the work is about to be re-billed.

## Open questions for the council

1. Should `enforce_document_immutability` block clearing
   `previous_conversion_id` / back-dating `conversion_released_at`, so the
   trail is tamper-evident through PostgREST? Owners can update issued
   documents for any field not on the trigger's block list.
2. Is "fully credited" the right gate, or should any credit note release?
3. Does releasing A back to `status = 'sent'` reopen it as an open receivable
   while B still exists as a cancelled-by-credit document, and can that
   double-count anywhere? B plus its credit note net to zero in
   `computeClientAccount`, but this needs checking against the aging report,
   the dunning plan and the cash-flow forecast.
