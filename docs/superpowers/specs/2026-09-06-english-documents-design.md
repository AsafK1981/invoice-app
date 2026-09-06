# English documents (per-document language) - design

Date: 2026-09-06. Approved by Asaf in chat the same day ("מאושר כמו שהוא").

## Context

Freelancers with foreign clients need the same document (quote, pro forma, tax invoice,
receipt, tax invoice/receipt, credit note) rendered in English. Multi-currency already
exists (`src/lib/currencies.ts`); only the language is missing. No i18n library exists in
the repo and none is introduced - a typed dictionary is the idiomatic fit.

## Data model

- New column `documents.language text NOT NULL DEFAULT 'he'` with `CHECK (language IN ('he','en'))`.
- `InvoiceDocument.language?: "he" | "en"` in `src/lib/types.ts` (undefined reads as `he`).
- Frozen after issue: add `language` to the immutability trigger body. Canonical current
  definition is `scripts/migrations/20260707-documents-deletable-when-unsent.sql`; write a
  new `CREATE OR REPLACE FUNCTION enforce_document_immutability()` in the new migration that
  is that body plus an `IF NEW.language IS DISTINCT FROM OLD.language THEN RAISE` line.
- `create_document_atomic` gets a `p_language text DEFAULT 'he'` parameter (new
  `CREATE OR REPLACE FUNCTION` migration modelled on
  `scripts/migrations/20260706-create-document-atomic-rounding.sql`, keep the GRANT).
- Migration file: `scripts/migrations/20260906-documents-language.sql`, idempotent, header
  says APPLY BEFORE DEPLOYING, applied with
  `node scripts/run-sql-file.mjs --reason "..." scripts/migrations/20260906-documents-language.sql`.

## Read/write paths to thread `language` through

- `src/lib/document-store.ts`: `mapDocRow()` (~L56) and `createDocument()` (~L162-200, pass `p_language`).
- `src/lib/documents-server.ts` self-invoice insert (~L95-119): `language: "he"`.
- `src/app/api/public-document/[id]/route.ts` column allowlist (~L69): add `language`.
- `src/app/view/[id]/page.tsx` manual mapper (~L132-173).
- `src/lib/draft-storage.ts` `EditorDraft`: optional `language`.

## Dictionary

New file `src/lib/document-strings.ts`:

```ts
export type DocLang = "he" | "en";
export const DOC_STRINGS: Record<DocLang, DocStrings> = { he: {...}, en: {...} };
export function docStrings(lang?: string): DocStrings;
```

`DocStrings` covers every literal currently hardcoded in `src/components/document-body.tsx`
(original/copy, "to", "no client selected", allocation-number line, "re:", "details",
table headers, "no items yet", subtotal/discount/VAT/zero-rated/rounding lines, "total in ILS
(rate ...)", withholding, "paid", "net received", payment method, payment details, bank
transfer, notes, footer lines, "(auto)" placeholder, check/branch/account/last-4/approval/
reference parts) plus English twins of `DOCUMENT_TYPE_LABELS`, `DOC_SUM_LABEL`,
`PAYMENT_METHOD_LABELS`, `BUSINESS_TYPE_LABELS`. English document type names: Receipt,
Quote, Pro Forma Invoice, Tax Invoice, Tax Invoice / Receipt, Credit Note. Business types:
Exempt Dealer, Licensed Dealer, Ltd. Company. The Hebrew values must stay byte-identical to
today's literals (tests and pixels depend on them).

## Rendering

- `DocumentBody` gets a `language` prop; every literal reads from `docStrings(language)`.
- `formatDate` in `src/lib/format.ts` gets an optional `lang` argument: `en` renders
  `D MMM YYYY` ("5 Sep 2026"); default unchanged.
- `formatCurrency` unchanged (the `₪` prefix is already LTR-stable). Foreign currency uses
  `formatMoney` as today.
- `dir={language === "en" ? "ltr" : "rtl"}` on the paper wrapper in
  `src/components/receipt-view.tsx` (~L76) and both places in
  `src/components/document-preview.tsx` (~L185, ~L246).
- `src/app/document-paper.css`: convert the 15 physical `text-align: right/left` rules
  (header ident L175/L222, table th/td L328-370, paid block L490, fluid ident L1034) to
  `start`/`end`, and the `.doc-glabel::after` gradient (L130) to a direction-aware form.
  Logo-position rules (`[data-logo-pos]`, L214-238) keep their meaning relative to the
  reading direction; document that in a comment.
- Print-fit (`src/lib/print-fit.ts`) needs nothing.

## Editor

- `src/components/receipt-editor.tsx`: `language` state next to `currency` (~L264);
  a `<select>` next to the currency select inside the advanced Expander (~L2042-2123)
  labelled "שפת המסמך" with options עברית / English; threaded into `previewProps`
  (~L1524-1550) and both save paths (~L1238, ~L1387).
- Per-client default: `getClientDefaults` in `src/lib/client-defaults.ts` returns
  `language` = language of the client's most recent document; editor prefill (~L873-894)
  applies it when a client is picked and the user has not touched the select.

## Customer-facing surfaces follow the document language

- Public page `src/app/view/[id]/page.tsx` chrome (title, buttons, approval block, footer)
  reads from a small `VIEW_STRINGS` he/en map and sets `dir`/`lang` on its wrapper.
- Email `src/app/api/send-email/template.ts`: `lang`/`dir` on the html + wrapper and an
  English `docWording()` branch when the document is English.
- PDF filename `src/app/api/documents/[id]/pdf/route.ts` `buildFilename` uses the English
  type label for English documents.
- Assistant `prepare_document_draft` may pass `language` when the user asks for an English
  document (optional enum input); default he.

## Out of scope

App chrome (tables, reports, settings) stays Hebrew. WhatsApp channel stays Hebrew.
Client-level stored language column: not added (inferred from history instead).

## Verification

- `npx vitest run` green; new tests: `tests/document-strings.test.ts` (every key present in
  both languages, Hebrew values equal the previous literals for the type/sum maps),
  `tests/format.test.ts` addition for `formatDate(date, "en")`.
- `npx tsc --noEmit` green.
- Screenshot an English tax invoice and an English quote in the editor preview and on
  `/view/<id>` at desktop and mobile widths (Vercel preview branch); read the PNGs: LTR
  flow, table columns aligned start/end, gradient fades correctly, nothing clipped.
- Screenshot a Hebrew document too: pixel-identical to before.
- PDF of an English document opens with English filename and English content.
