# Multi-currency invoices — design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — pending implementation plan
**Scope discipline:** Add foreign-currency invoicing without disturbing the
₪-based reports/tax engine. Existing ₪ documents must behave identically.

## Goal

Let users issue client-facing documents (tax invoice, tax-invoice+receipt,
receipt, quote, credit note) in a foreign currency (USD/EUR/…), while the
app's accounting stays correct in ₪ for Israeli tax purposes.

## Decisions (from brainstorming)

1. **VAT:** support BOTH normal VAT (18%) and **zero-rated export** (0%). A
   per-document `zero_rated` flag forces 0% regardless of business type and is
   distinct from עוסק פטור (exempt). Shown on the document as
   "עסקה בשיעור אפס — ייצוא".
2. **Exchange rate:** Bank of Israel representative rate (שער יציג) for the
   document's currency + date, fetched automatically, **editable (override)**,
   and snapshotted onto the document. Manual fallback if the fetch fails.
3. **Model = Approach A:** store the foreign amounts the user works with AND a
   snapshotted ₪ equivalent on the document. Reports read the ₪ columns
   directly — no convert-on-read scattered across dozens of call sites.
4. **Scope:** per-document currency picker, curated currency list, dual
   display (foreign + ₪), all client-facing document types.

## Data model

Add to the `documents` table (one migration, all with safe defaults so
existing rows and all current code are unaffected):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `currency` | TEXT | `'ILS'` | ISO 4217 code |
| `exchange_rate` | NUMERIC | `1` | ₪ per 1 unit of `currency` |
| `subtotal_ils` | NUMERIC | — backfill = `subtotal` | ₪ equivalent of subtotal |
| `vat_ils` | NUMERIC | — backfill = `vat` | ₪ equivalent of VAT |
| `total_ils` | NUMERIC | — backfill = `total` | ₪ equivalent of total |
| `zero_rated` | BOOLEAN | `false` | export / 0%-rated transaction |

- Migration backfills existing rows: `currency='ILS'`, `exchange_rate=1`,
  `*_ils = *`, `zero_rated=false`.
- `subtotal`/`vat`/`total` and `document_items` amounts remain in the
  document's `currency` (foreign for FX docs, ₪ for ILS docs). No per-item ₪
  columns — the header ₪ equivalents are sufficient for reports/allocation.
- Invariants, snapshotted at issue time: `subtotal_ils = round2(subtotal ×
  rate)`, `vat_ils = round2(vat × rate)`, and `total_ils = round2(subtotal_ils
  + vat_ils)` — derive the ₪ total from the ₪ parts (not `round2(total ×
  rate)`) so the ₪ figures reconcile internally, same rule the line/header
  fix uses.

## Exchange-rate service — `src/lib/exchange-rate.ts` (+ API route)

- `getRepresentativeRate(currency, date)` → ₪ per unit, from the Bank of
  Israel representative-rate API (exact endpoint to confirm during
  implementation; e.g. boi.org.il / edge.boi.gov.il SDMX-JSON).
- Cache by `(currency, dateISO)` — daily rates, immutable for past dates — to
  avoid refetching. ILS → returns 1 without a network call.
- Fetched server-side (route) and surfaced to the editor to prefill the rate
  field. Failure path: return null → the editor keeps the manual-entry field
  usable and shows a "couldn't fetch — enter manually" hint.
- The document always persists the **final** rate used (auto or overridden).

## VAT / zero-rated

- `zero_rated=true` ⇒ `vatRate = 0` in the editor's amount computation,
  independent of `getVatRate(business)`. `computeAmounts` is unchanged (it
  already takes a `vatRate`).
- Document display: when `zero_rated`, replace the VAT line with the
  "עסקה בשיעור אפס — ייצוא" note. Distinct wording from the עוסק-פטור case.

## Editor flow — `receipt-editor.tsx`

1. Currency selector (default ILS) + "ייצוא / מע"מ אפס" toggle.
2. When `currency ≠ ILS`: show the exchange-rate field, prefilled from BOI by
   the document date (editable), plus a live "≈ ₪X" preview of the ₪ total.
3. Amounts entered and previewed in the selected currency.
4. On save: compute `*_ils = round2(* × exchange_rate)`; persist `currency`,
   `exchange_rate`, the three `*_ils`, and `zero_rated`.

## Display — `document-body.tsx`, public `/view/[id]`, PDF

- Render amounts with the currency symbol (₪ / $ / € / £ / …).
- For non-ILS documents, add a required ₪-equivalent line:
  "סה"כ ב-₪ (שער X.XXX): ₪Y".
- For `zero_rated`, show the export note instead of a VAT line.

## Read side — reports / tax / allocation

These switch from the foreign `subtotal/vat/total` to the `*_ils` columns
(identical to the originals for ILS docs, so no behavior change there):

- tax-projection (income + VAT), aging report, VAT-period report, client
  statement, dashboard totals, exempt-ceiling tracker.
- **חשבונית ישראל allocation** (`request-allocation`): send the ₪ amounts
  (`subtotal_ils`, `vat_ils`, `total_ils`) — the API is ₪-based.
- `requiresAllocationNumber`: compare `total_ils` (not the foreign total) to
  the threshold.

## Currency list — `src/lib/currencies.ts`

Curated const: `ILS, USD, EUR, GBP, CHF, CAD, AUD`, each `{ code, symbol,
name }`. Easy to extend later.

## Backward compatibility

Existing code that reads `subtotal/vat/total` continues to drive document
**display**. Report/tax/allocation paths move to `*_ils`. Existing rows
backfill to `currency=ILS, rate=1, *_ils=*, zero_rated=false`, so every
current number and behavior is preserved.

## Testing

- `zero_rated` ⇒ 0% VAT in amount computation.
- ₪-equivalent computation + rounding (`* × rate`).
- `requiresAllocationNumber` uses `total_ils` (threshold crossing differs
  between the foreign total and the ₪ equivalent).
- Exchange-rate service: successful fetch, fallback on failure, cache hit, and
  ILS short-circuit (mock the BOI API).
- A USD document computes correct `*_ils`; an ILS document is unchanged.

## Out of scope (explicitly deferred)

- Per-client default currency.
- Per-item ₪ amounts.
- Online payment collection / FX settlement.
- Currencies beyond the curated list.
