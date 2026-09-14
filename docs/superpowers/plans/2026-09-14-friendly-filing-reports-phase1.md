# Friendly Filing Reports - Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user on `/reports/vat` is only stopped by something that would make the PCN874 file rejected or wrong, fixes it inline without leaving the report, and a nightly guard tells us first when a check starts blocking people.

**Architecture:** One strict `normalizeBusinessNumber` decides for both the PCN874 builder and its preflight. Every PCN874 finding carries a stable `code`; a pure model (`src/lib/filing-fix-items.ts`) turns the builder result into grouped "what's left" items, rendered by a focused `FilingFixPanel` with inline saves over narrow, error-surfacing update functions. A `node --import tsx` guard script reuses the exact builder and pushes only `{ code, businessesAffected }` to Gaya when a code is new or grew.

**Tech Stack:** Next.js 16 (non-standard, see AGENTS.md), React 19, Supabase JS, Vitest 4 (`vmForks`, node env), TypeScript, tsx, puppeteer-core for E2E.

**Spec:** `docs/superpowers/specs/2026-09-14-friendly-filing-reports-design.md`

**Coordinator decisions (2026-09-14, these override the tasks below where they differ)**

1. Unallocated supplier invoice: excluded from header and records (Task 6). Approved.
2. Layer 4: credit note button for in-app issued documents, support button for imported / foreign-currency-without-shekels (Tasks 13, 16). Approved.
3. Narrow throwing saves (Task 11). Approved.
4. Guard via `node --import tsx` with pure row mappers (Tasks 7, 19). Approved. Do NOT register a scheduled task.
5. KEEP "שנה נוכחית" in the period picker (Task 15 keeps `this_year`); only the default changes to the last ended bi-monthly period. When the selected period cannot produce a PCN874 file (a year or longer range), the panel shows ONE friendly item with a button that switches to the last ended bi-monthly period instead of a blocker list (Tasks 13, 16, 17: control `{ kind: "period" }`, panel prop `onUseFilingPeriod`).
6. Keep-previous-data refetch (Task 14). Approved.
7. NEW Task 6a: a non-Israeli customer number on a zero-rated export does not block (the builder writes Y / 999999999). Block only when the document is NOT zero-rated and the number is invalid.
8. Sales-side allocation warning stays a collapsed note. Approved.
9. Expense form: only the checksum and "missing a leading zero" hints (Tasks 9, 10: `businessNumberHint(raw, { digitsOnlyField: true })`, component prop `digitsOnlyField`).
10. `*_ils` fix as planned (Task 8).
11. Task 20: the guard runs in `--dry-run` only. No real Gaya push. The E2E still seeds and restores the QA business, and the restore is verified.

**Working rules for the executor**

- Work only in `C:\wtpcn` (detached worktree). Its `node_modules` is a junction to the main checkout: never delete, move or `rm -rf` it, and never run `npm install` here.
- Tests: `cd /c/wtpcn && npx vitest run <file>`. Typecheck: `cd /c/wtpcn && npx tsc --noEmit`.
- The Bash tool blocks commands containing the words "credit" or "checkout" (money-guard false positive). Use Read/Grep/Edit for code that mentions credit notes, keep those words out of commit messages and shell commands, and use `git switch` / `git restore` instead of the blocked git verb.
- Never type an em dash or en dash anywhere (code, comments, commit messages). Plain hyphen only.
- Commit after every task. Never push. Every commit message ends with the trailer shown in the task.
- Operator privacy: scripts that touch production print codes and counts only, never tenant content.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/israeli-id.ts` | modify | add `normalizeBusinessNumber` (strict, shared) |
| `src/lib/client-picker.ts` | modify | `normalizeTaxId` pads valid Israeli numbers via the normalizer |
| `src/lib/ita/pcn874.ts` | modify | issue codes, `PcnBlocker`, strict numbers in builder, Layer 2 repairs, allocation exclusion, `pcnCanDownload`, `pcnBlockingCodes` |
| `src/lib/profit-loss-rows.ts` | create | pure profit-loss row mappers (moved, no supabase import) |
| `src/lib/profit-loss-data.ts` | modify | re-export the moved mappers |
| `src/lib/filing-rows.ts` | create | pure filing columns + row mappers (usable from node scripts), `importBatchId` |
| `src/lib/filing-report-data.ts` | modify | import from `filing-rows`, opt-in keep-previous-while-refreshing |
| `src/lib/types.ts` | modify | `InvoiceDocument.importBatchId` |
| `src/lib/document-store.ts` | modify | `*_ils` stay `undefined` when null; export `mapDocRow` |
| `src/components/document-body.tsx` | modify | hide the ILS line when there is no stored shekel total |
| `src/lib/business-number-hint.ts` | create | Layer 1 hint text + save-time normalization rule |
| `src/components/business-number-hint.tsx` | create | live hint paragraph |
| `src/components/client-form-modal.tsx` | modify | hint + save normalization |
| `src/components/expense-form-modal.tsx` | modify | hint + save normalization |
| `src/lib/expense-store.ts` | modify | `updateExpenseFilingFields` (throws on error / partial write) |
| `src/lib/business-store.ts` | modify | `saveBusinessTaxId` |
| `src/lib/support-link.ts` | create | WhatsApp support link + data-fix message |
| `src/components/layout/sidebar.tsx` | modify | reuse `supportWhatsappHref` |
| `src/lib/filing-fix-items.ts` | create | pure "what's left" model: grouping, controls, Layer 4 routing |
| `src/lib/vat-report-period.ts` | create | period modes (no current year), default last ended bi-month, resolution |
| `src/app/(app)/reports/vat/page.tsx` | modify | default period, localStorage, keep report mounted on refetch |
| `src/components/filing-fix-panel.tsx` | create | the panel UI with inline controls |
| `src/components/vat-period-report.tsx` | modify | replace mixed list with the panel, one download gate |
| `src/lib/filing-guard.ts` | create | pure aggregation / diff / text for the guard |
| `scripts/filing-preflight-guard.mjs` | create | nightly guard |
| `scripts/qa-seed-filing-fix.mjs` | create | QA tenant seed/clean for E2E |
| `scripts/qa-filing-fix-e2e.mjs` | create | puppeteer E2E + screenshots |
| `.gitignore` | modify | guard state + QA snapshot files |
| tests: `tests/israeli-id.test.ts`, `tests/client-picker.test.ts`, `tests/pcn874.test.ts`, `tests/document-store-ils.test.ts`, `tests/business-number-hint.test.ts`, `tests/filing-inline-saves.test.ts`, `tests/support-link.test.ts`, `tests/filing-fix-items.test.ts`, `tests/vat-report-period.test.ts`, `tests/filing-guard.test.ts` | create/modify | |

---

### Task 1: Strict shared business-number normalizer

**Files:**
- Modify: `src/lib/israeli-id.ts` (append after line 47)
- Test: `tests/israeli-id.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/israeli-id.test.ts` and change the import on line 2 to `import { isValidIsraeliIdNumber, normalizeBusinessNumber } from "@/lib/israeli-id";`

```ts
describe("normalizeBusinessNumber", () => {
  it("accepts a 9-digit valid number as is", () => {
    expect(normalizeBusinessNumber("514993666")).toEqual({ value: "514993666", reason: "ok", digitCount: 9 });
  });

  it("pads a short valid number and reports the original digit count", () => {
    expect(normalizeBusinessNumber("13333331")).toEqual({ value: "013333331", reason: "ok", digitCount: 8 });
  });

  it.each(["51-333333-6", "513.333.336", " 513 333 336 ", "\u200F513333336\u200E", "\u2066513333336\u2069", "\u200B513333336\uFEFF"])(
    "strips separators, bidi and zero-width marks in %j",
    (raw) => {
      expect(normalizeBusinessNumber(raw)).toMatchObject({ value: "513333336", reason: "ok" });
    },
  );

  it.each(["", "   ", "--", null, undefined])("reports empty for %j", (raw) => {
    expect(normalizeBusinessNumber(raw)).toEqual({ value: null, reason: "empty", digitCount: 0 });
  });

  it.each(["51333333X", "ABC515555550", "513/333/336", "A513333336"])("never strips letters or other characters: %j", (raw) => {
    expect(normalizeBusinessNumber(raw)).toMatchObject({ value: null, reason: "letters" });
  });

  it("never truncates more than 9 digits", () => {
    expect(normalizeBusinessNumber("5133333360")).toEqual({ value: null, reason: "too_long", digitCount: 10 });
  });

  it.each(["513333337", "000000000", "1234567"])("reports a checksum failure for %j", (raw) => {
    expect(normalizeBusinessNumber(raw)).toMatchObject({ value: null, reason: "checksum" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/israeli-id.test.ts`
Expected: FAIL, `normalizeBusinessNumber is not a function` (or export missing).

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/israeli-id.ts`:

```ts
export type BusinessNumberReason = "ok" | "empty" | "letters" | "too_long" | "checksum";

export interface NormalizedBusinessNumber {
  /** The 9-digit form, only when reason is "ok". */
  value: string | null;
  reason: BusinessNumberReason;
  /** Digits the raw value held before padding (Layer 1 uses it to tell "missing a leading zero" apart). */
  digitCount: number;
}

/**
 * Characters a pasted business number may legitimately carry around its
 * digits: whitespace, hyphens, dots, bidi controls (LRM/RLM, embeddings,
 * isolates) and zero-width marks. Anything else makes the value "letters".
 */
const ALLOWED_BUSINESS_NUMBER = /^[\d\s.\-\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]*$/;

/**
 * The ONE decision about an Israeli business number, shared by the PCN874
 * builder, its preflight, the form hints and client matching. Strict on
 * purpose: letters are never stripped and extra digits are never truncated,
 * because a "repaired" wrong number in a filed report is worse than a
 * visible question.
 */
export function normalizeBusinessNumber(raw: unknown): NormalizedBusinessNumber {
  const text = String(raw ?? "");
  const digits = text.replace(/\D/g, "");
  if (!ALLOWED_BUSINESS_NUMBER.test(text)) return { value: null, reason: "letters", digitCount: digits.length };
  if (digits.length === 0) return { value: null, reason: "empty", digitCount: 0 };
  if (digits.length > 9) return { value: null, reason: "too_long", digitCount: digits.length };
  const padded = digits.padStart(9, "0");
  if (!isValidIsraeliIdNumber(padded)) return { value: null, reason: "checksum", digitCount: digits.length };
  return { value: padded, reason: "ok", digitCount: digits.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtpcn && npx vitest run tests/israeli-id.test.ts`
Expected: PASS (all old and new cases).

- [ ] **Step 5: Commit**

```bash
cd /c/wtpcn && git add src/lib/israeli-id.ts tests/israeli-id.test.ts && git commit -m "feat(israeli-id): strict shared business-number normalizer" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Client matching pads valid Israeli numbers

**Files:**
- Modify: `src/lib/client-picker.ts:1-10`
- Test: `tests/client-picker.test.ts`

- [ ] **Step 1: Write the failing test**

Inside the existing `describe("normalizeTaxId", ...)` block in `tests/client-picker.test.ts`, after the "returns empty string for missing input" case, add:

```ts
  it("pads a valid Israeli number so a padded client matches an unpadded document", () => {
    expect(normalizeTaxId("13333331")).toBe("013333331");
    expect(normalizeTaxId("13333331")).toBe(normalizeTaxId("013333331"));
  });

  it("leaves foreign or invalid numbers as plain digits", () => {
    expect(normalizeTaxId("1234567")).toBe("1234567");
    expect(normalizeTaxId("GB 123456789012")).toBe("123456789012");
  });
```

And append at the end of the file:

```ts
describe("documentBelongsToClient with padded numbers", () => {
  it("matches an unlinked document carrying the unpadded number", () => {
    const client = makeClient({ id: "c1", taxId: "013333331" });
    expect(documentBelongsToClient({ clientId: "", clientName: "x", clientTaxId: "13333331" }, client)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/client-picker.test.ts`
Expected: FAIL, `expected '13333331' to be '013333331'`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/client-picker.ts` replace lines 1-10:

```ts
import type { Client, InvoiceDocument } from "./types";

/**
 * Normalizes a tax id for comparison purposes: strips everything but
 * digits, so "514-123-456" and "514 123 456" and "514123456" all compare
 * equal. Returns "" for missing/blank input (never treated as a match).
 */
export function normalizeTaxId(taxId: string | undefined | null): string {
  return (taxId || "").replace(/\D/g, "");
}
```

with:

```ts
import type { Client, InvoiceDocument } from "./types";
import { normalizeBusinessNumber } from "./israeli-id";

/**
 * Normalizes a tax id for comparison purposes. A valid Israeli number is
 * compared in its padded 9-digit form (shared normalizer), so a client saved
 * as "013333331" still owns a locked document that carries "13333331".
 * Anything else (foreign ids, typos) compares as plain digits, exactly as
 * before. Returns "" for missing/blank input (never treated as a match).
 */
export function normalizeTaxId(taxId: string | undefined | null): string {
  return normalizeBusinessNumber(taxId).value ?? (taxId || "").replace(/\D/g, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtpcn && npx vitest run tests/client-picker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/wtpcn && git add src/lib/client-picker.ts tests/client-picker.test.ts && git commit -m "feat(client-picker): match padded and unpadded Israeli business numbers" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Stable codes on every PCN874 finding (no behaviour change)

**Files:**
- Modify: `src/lib/ita/pcn874.ts` (types at 124-133 and 159, `validateSources` 259-305, `classifyInputs` warnings 419-441, `buildPcn874` 482-503, 557-594, 656-666, new helpers after 685)
- Modify: `src/components/vat-period-report.tsx:146-149` (keep compiling)
- Test: `tests/pcn874.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/pcn874.test.ts` change the import block (lines 2-10) to:

```ts
import {
  buildPcn874,
  headerLine,
  transactionLine,
  footerLine,
  validatePcn874Content,
  roundShekel,
  signedDigits,
  pcnCanDownload,
  pcnBlockingCodes,
} from "@/lib/ita/pcn874";
```

Replace lines 291, 293 and 295 (blockers are now objects):

```ts
    expect(open.blockers.some((b) => b.message.includes("לא הסתיימה"))).toBe(true);
```
```ts
    expect(year.blockers.some((b) => b.message.includes("חודשיים"))).toBe(true);
```
```ts
    expect(badDealer.blockers.some((b) => b.message.includes("9 ספרות"))).toBe(true);
```

Append at the end of the file:

```ts
describe("PCN874 issue codes", () => {
  it("gives every blocker and warning a stable code", () => {
    const r = buildPcn874({
      business: { taxId: "1234", businessType: "authorized" },
      documents: [doc({ id: "d", clientTaxId: "515555554", allocationNumber: "123456789" })],
      expenses: [expense({ id: "e", supplierTaxId: undefined, amount: 2360, vatAmount: 360 })],
      range,
      generatedOn: new Date("2026-02-20T12:00:00+02:00"),
    });
    const blockerCodes = r.blockers.map((b) => b.code);
    expect(blockerCodes).toEqual(expect.arrayContaining(["dealer_number_invalid", "period_open", "file_structure"]));
    expect(r.warnings.find((w) => w.sourceId === "d")?.code).toBe("customer_number_invalid");
    expect(r.warnings.find((w) => w.sourceId === "e")?.code).toBe("input_missing_supplier_details");
    expect(r.warnings.every((w) => typeof w.code === "string" && w.code.length > 0)).toBe(true);
    expect(pcnCanDownload(r)).toBe(false);
    expect(pcnBlockingCodes(r)).toEqual(expect.arrayContaining(["dealer_number_invalid", "customer_number_invalid", "input_missing_supplier_details"]));
  });

  it("marks notes with their own codes and lets a clean file download", () => {
    const dup = build([sale(), sale()], []);
    expect(dup.warnings.map((w) => w.code)).toContain("possible_duplicate");
    expect(pcnCanDownload(dup)).toBe(true);
    expect(pcnBlockingCodes(dup)).toEqual([]);
    expect(build([doc({ subtotal: 12000, vat: 2160, total: 14160 })], []).warnings[0].code).toBe("sale_allocation_missing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts`
Expected: FAIL (`pcnCanDownload is not a function`, `b.message` undefined).

- [ ] **Step 3: Implement - types**

In `src/lib/ita/pcn874.ts` replace lines 124-133 (from `export type PcnWarningLevel` through the closing `}` of `PcnWarning`) with:

```ts
/**
 * "error" blocks the download. "action" does not block but changes the file
 * (an input left out) and is shown above the button, never collapsed.
 * "warning" is a note for the collapsed "כדאי לבדוק" section.
 */
export type PcnWarningLevel = "error" | "action" | "warning";

/** Stable identifiers for every preflight finding. The nightly guard reports these, never the messages. */
export type PcnIssueCode =
  | "dealer_number_invalid"
  | "period_invalid"
  | "period_not_whole_months"
  | "generation_date_invalid"
  | "exempt_business"
  | "period_length"
  | "period_open"
  | "field_overflow"
  | "file_structure"
  | "date_invalid"
  | "amount_invalid"
  | "expense_amount_invalid"
  | "sign_mismatch"
  | "type_sign_mismatch"
  | "zero_rated_with_vat"
  | "foreign_currency_missing_ils"
  | "customer_number_invalid"
  | "customer_number_missing"
  | "supplier_number_invalid"
  | "input_missing_supplier_details"
  | "refund_input_missing_supplier_details"
  | "reference_invalid"
  | "reference_multiple_groups"
  | "allocation_invalid"
  | "possible_duplicate"
  | "zero_vat_not_zero_rated"
  | "sale_allocation_missing"
  | "supplier_allocation_missing";

export interface PcnWarning {
  /** Stable identifier: wording may change, codes may not. */
  code: PcnIssueCode;
  level: PcnWarningLevel;
  message: string;
  /** "document" rows link to /documents/<id>, "expense" rows to /expenses. */
  source: "document" | "expense";
  sourceId: string;
  sourceLabel: string;
  /** Input VAT left out of the file, set on supplier_allocation_missing. */
  excludedVat?: number;
}

export interface PcnBlocker {
  code: PcnIssueCode;
  message: string;
}
```

In the `Pcn874Result` interface replace `  blockers: string[];` with `  blockers: PcnBlocker[];`.

- [ ] **Step 4: Implement - validateSources with codes**

Replace the whole `validateSources` function (from the line `/** Inspect original values before filtering dates or lossy numeric formatting. */` through its closing `}` before `// ── record builders`) with:

```ts
/** Inspect original values before filtering dates or lossy numeric formatting. */
function validateSources(documents: InvoiceDocument[], expenses: Expense[], range: BuildPcn874Args["range"]): PcnWarning[] {
  const warnings: PcnWarning[] = [];
  const seen = new Set<string>();
  const check = (row: InvoiceDocument | Expense, source: PcnWarning["source"]) => {
    const isDoc = source === "document";
    const d = row as InvoiceDocument;
    const e = row as Expense;
    const add = (code: PcnIssueCode, message: string, level: PcnWarningLevel = "error") =>
      warnings.push({ code, level, message, source, sourceId: row.id, sourceLabel: isDoc ? docLabel(d) : expenseLabel(e) });
    if (!validPcnDate(row.date)) {
      add("date_invalid", "התאריך חסר או אינו תקין. פתח את הרשומה ותקן את התאריך כדי שנוכל לשייך אותה לתקופת הדיווח.");
      return;
    }
    if (row.date < range.start || row.date > range.end) return;
    const net = isDoc ? (d.subtotalIls ?? d.subtotal) : e.amount - (e.vatAmount ?? 0);
    const vat = isDoc ? (d.vatIls ?? d.vat) : (e.vatAmount ?? 0);
    if (!withinField(net, 10) || !withinField(vat, 9) || !Number.isFinite(isDoc ? d.total : e.amount))
      add("amount_invalid", "סכום חסר, לא מספרי או גדול מדי לשדות קובץ הדיווח. בדוק את הסכום לפני מע״מ ואת המע״מ ברשומה.");
    if (!isDoc && (e.amount < 0 || vat < 0 || vat > e.amount))
      add("expense_amount_invalid", "סכום ההוצאה או המע״מ אינו תקין: המע״מ חייב להיות בין אפס לסכום ההוצאה. זיכוי ספק דורש טיפול נפרד לפני הייצוא.");
    if (isDoc && ((net < 0 && vat > 0) || (net > 0 && vat < 0) || (net === 0 && vat !== 0)))
      add("sign_mismatch", "סימני הסכום והמע״מ אינם תואמים. בדוק את נתוני החשבונית או הזיכוי.");
    if (isDoc && ((d.type === "credit_note" && (net > 0 || vat > 0)) || (d.type !== "credit_note" && (net < 0 || vat < 0))))
      add("type_sign_mismatch", "סימן הסכום אינו תואם את סוג המסמך. זיכוי חייב לכלול סכומים שליליים וחשבונית רגילה סכומים חיוביים.");
    if (isDoc && d.zeroRated && vat !== 0) add("zero_rated_with_vat", "המסמך סומן בשיעור אפס אך כולל מע״מ. בדוק את הסיווג והסכומים לפני הייצוא.");
    if (isDoc && d.currency && d.currency !== "ILS" && (!Number.isFinite(d.subtotalIls) || !Number.isFinite(d.vatIls)))
      add("foreign_currency_missing_ils", "במסמך במטבע חוץ חסרים סכומי שקל שמורים. השלם את ההמרה לשקלים לפני הדיווח.");
    if (!isDoc && vat === 0) return;
    const id = String((isDoc ? d.clientTaxId : e.supplierTaxId) ?? "").trim();
    if (id && !sourceVatIdForPcn(id))
      add(isDoc ? "customer_number_invalid" : "supplier_number_invalid", "מספר העוסק אינו תקין: הוא כולל תווים שאינם ספרות, יותר מ-9 ספרות, או שספרת הביקורת שגויה. בדוק מול החשבונית ותקן את המספר.");
    const reference = isDoc ? String(d.number) : referenceDigits(e.reference);
    if ((isDoc || e.reference) && (!/^\d{1,9}$/.test(reference) || Number(reference) === 0))
      add("reference_invalid", "מספר החשבונית חייב להיות מספר חיובי של עד 9 ספרות בשדה הדיווח. בדוק את האסמכתא; לא ניתן לקצר אותה אוטומטית.");
    if (!isDoc && (String(e.reference ?? "").match(/\d+/g)?.length ?? 0) > 1)
      add("reference_multiple_groups", "האסמכתא כוללת כמה קבוצות ספרות. ודא שמספר החשבונית לדיווח הוא קבוצת הספרות האחרונה, או תקן את האסמכתא.", "warning");
    const allocation = String(row.allocationNumber ?? "").trim();
    if (allocation && (!/^\d{9}$/.test(allocation) || /^0+$/.test(allocation)))
      add("allocation_invalid", "מספר ההקצאה חייב להיות 9 ספרות ואינו יכול להיות אפסים בלבד. העתק את המספר המקורי ללא קיצור.");
    // Distinct invoice series/types and suppliers may legitimately reuse numbers.
    const key = isDoc ? `document:${d.type}:${d.number}:${d.date.slice(0, 4)}` : `expense:${id}:${String(e.reference)}:${e.date}:${e.amount}:${vat}`;
    if ((isDoc || (id && reference)) && seen.has(key)) add("possible_duplicate", "נמצאה רשומה נוספת עם אותם פרטי חשבונית. בדוק שלא נכלל כאן דיווח כפול.", "warning");
    seen.add(key);
  };
  documents.filter(d => SALES_TYPES.has(d.type) && d.status !== "draft" && d.status !== "cancelled").forEach(d => check(d, "document"));
  expenses.forEach(e => check(e, "expense"));
  return warnings;
}
```

- [ ] **Step 5: Implement - codes in classifyInputs and sales**

In `classifyInputs`, in the first `warnings.push({` (the one whose message starts with `allowPetty`), insert as its first property:

```ts
        code: allowPetty ? "input_missing_supplier_details" : "refund_input_missing_supplier_details",
```

In the second `warnings.push({` in `classifyInputs` (message `"חשבונית ספק מעל סף חשבונית ישראל בלי מספר הקצאה..."`), insert as its first property:

```ts
        code: "supplier_allocation_missing",
```

In `buildPcn874`, add `code` as the first property of the three sales `warnings.push({` objects:
- message starting `"מסמך מס בלי מע״מ שלא סומן"`: `        code: "zero_vat_not_zero_rated",`
- message starting `` `עסקה של `` : `        code: "customer_number_missing",`
- message starting `"מסמך מס מעל סף חשבונית ישראל בלי מספר הקצאה. קבל"`: `        code: "sale_allocation_missing",`

- [ ] **Step 6: Implement - coded blockers and helpers**

Replace the whole-file blockers block (from `  // ── whole-file blockers ──` through the closing `}` of `if (range.end >= isoDateInIsrael(generatedOn)) {...}`) with:

```ts
  // ── whole-file blockers ──
  const blockers: PcnBlocker[] = [];
  const block = (code: PcnIssueCode, message: string) => blockers.push({ code, message });
  if (!sourceVatIdForPcn(business.taxId)) {
    block("dealer_number_invalid", "מספר העוסק של העסק בהגדרות חייב להיות 9 ספרות עם ספרת ביקורת תקינה. תקן אותו לפני הדיווח.");
  }
  if (!validPcnDate(range.start) || !validPcnDate(range.end) || range.start > range.end) {
    block("period_invalid", "תקופת הדיווח אינה תקינה. בחר תאריכי התחלה וסיום תקינים לפי הסדר.");
  } else {
    const next = new Date(range.end + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    if (!range.start.endsWith("-01") || next.getUTCDate() !== 1)
      block("period_not_whole_months", "בחר חודשים מלאים: מהיום הראשון בחודש ועד היום האחרון בחודש הסיום.");
  }
  if (!Number.isFinite(generatedOn.getTime())) block("generation_date_invalid", "תאריך הפקת הקובץ אינו תקין.");
  if (business.businessType === "exempt") block("exempt_business", "עוסק פטור אינו מגיש דוח מע״מ מפורט. בדוק את סוג העסק בהגדרות.");
  const months = monthsInRange(range);
  if (months !== 1 && months !== 2) {
    block("period_length", "קובץ PCN874 מוגש לחודש אחד או לחודשיים. בחר תקופת דיווח חודשית או דו-חודשית.");
  }
  if (range.end >= isoDateInIsrael(generatedOn)) {
    block("period_open", "תקופת הדיווח עוד לא הסתיימה. הקובץ מופק אחרי סוף התקופה, כשכל המסמכים בפנים.");
  }
```

Replace the block from `  for (const [field, value] of Object.entries(header)) {` through `  blockers.push(...validatePcn874Content(lines.join("\r\n") + "\r\n"));` with:

```ts
  for (const [field, value] of Object.entries(header)) {
    if (typeof value === "number" && !withinField(value, ["taxableSalesAmount", "zeroOrExemptSales", "totalVat"].includes(field) ? 11 : 9))
      block("field_overflow", "סכום או מונה חורג מגודל השדה בקובץ: " + field + ". יש לבדוק את נתוני הדוח.");
  }
  for (const t of sorted) {
    if (!withinField(t.invoiceSum, 10) || !withinField(t.totalVat, 9))
      block("field_overflow", "סכום רשומה חורג מגודל השדה בקובץ. בדוק את הרשומות המרוכזות: " + t.entryType + " " + t.refNumber);
  }
  const lines = [headerLine(header), ...sorted.map(transactionLine), footerLine(dealerVatId)];

  for (const problem of validatePcn874Content(lines.join("\r\n") + "\r\n")) block("file_structure", problem);
```

Directly after the closing `}` of `buildPcn874` (before the `validatePcn874Content` doc comment) add:

```ts
/** The one download gate: no whole-file blocker, no blocking row, something to report. */
export function pcnCanDownload(result: Pick<Pcn874Result, "blockers" | "warnings" | "transactions">): boolean {
  return result.blockers.length === 0 && result.transactions.length > 0 && !result.warnings.some((w) => w.level === "error");
}

/** Distinct codes of everything that blocks the download. The nightly guard counts these. */
export function pcnBlockingCodes(result: Pick<Pcn874Result, "blockers" | "warnings">): PcnIssueCode[] {
  return [...new Set([...result.blockers.map((b) => b.code), ...result.warnings.filter((w) => w.level === "error").map((w) => w.code)])];
}
```

- [ ] **Step 7: Keep the report compiling**

In `src/components/vat-period-report.tsx` replace:

```tsx
    () => [...new Set([...pcn.blockers, ...validatePcn874Content(pcn.content)])],
```

with:

```tsx
    () => [...new Set([...pcn.blockers.map((b) => b.message), ...validatePcn874Content(pcn.content)])],
```

- [ ] **Step 8: Run tests and typecheck**

Run: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc exits 0.

- [ ] **Step 9: Commit**

```bash
cd /c/wtpcn && git add src/lib/ita/pcn874.ts src/components/vat-period-report.tsx tests/pcn874.test.ts && git commit -m "feat(pcn874): stable codes on every preflight finding" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Builder uses the strict normalizer for supplier and customer numbers

**Files:**
- Modify: `src/lib/ita/pcn874.ts` (imports 60-64, `sourceVatIdForPcn` 234-247, `classifyInputs` supplierVat line, sales customerVat line)
- Test: `tests/pcn874.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/pcn874.test.ts`:

```ts
describe("PCN874 builder and preflight share one strict normalizer", () => {
  const tLines = (content: string) => content.split("\r\n").filter((l) => l[0] === "T");
  const sLines = (content: string) => content.split("\r\n").filter((l) => l[0] === "S");

  it.each(["513333336", "13333331", "51-333333-6", "513.333.336", " 513 333 336 ", "‏513333336‎", "⁦513333336⁩"])(
    "a supplier number typed as %j builds, pads and passes",
    (supplierTaxId) => {
      const r = build([sale()], [expense({ id: "ok", supplierTaxId })]);
      const expected = supplierTaxId.replace(/\D/g, "").padStart(9, "0");
      expect(r.warnings.filter((w) => w.sourceId === "ok" && w.level === "error")).toEqual([]);
      expect(tLines(r.content).map((l) => l.slice(1, 10))).toEqual([expected]);
      expect(validatePcn874Content(r.content)).toEqual([]);
    },
  );

  it.each(["A513333336", "513333336X", "1513333336", "513333337"])(
    "supplier number %j blocks and is never written as a stripped or truncated valid number",
    (supplierTaxId) => {
      const r = build([sale()], [expense({ id: "bad", supplierTaxId })]);
      expect(r.warnings.some((w) => w.sourceId === "bad" && w.level === "error")).toBe(true);
      expect(tLines(r.content).some((l) => l.slice(1, 10) === "513333336")).toBe(false);
      expect(pcnCanDownload(r)).toBe(false);
    },
  );

  it.each(["A515555555", "1515555555"])("customer number %j is never written as 515555555", (clientTaxId) => {
    const r = build([doc({ id: "bad", clientTaxId, allocationNumber: "123456789" })], []);
    expect(r.warnings.some((w) => w.sourceId === "bad" && w.level === "error")).toBe(true);
    expect(sLines(r.content).some((l) => l.slice(1, 10) === "515555555")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts -t "strict normalizer"`
Expected: FAIL on `A513333336` / `1513333336` / `A515555555` / `1515555555` (the old builder writes the stripped or truncated number).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ita/pcn874.ts` replace:

```ts
import { isValidIsraeliIdNumber } from "../israeli-id";
import {
  allocationRequiredThreshold,
  normalizeCustomerVatNumber,
} from "../tax-authority";
```

with:

```ts
import { isValidIsraeliIdNumber, normalizeBusinessNumber } from "../israeli-id";
import { allocationRequiredThreshold } from "../tax-authority";
```

Replace the body of `sourceVatIdForPcn` (the function from `export function sourceVatIdForPcn(value: unknown): string | null {` to its closing `}`) with:

```ts
export function sourceVatIdForPcn(value: unknown): string | null {
  return normalizeBusinessNumber(value).value;
}
```

In `classifyInputs` replace `    const supplierVat = normalizeCustomerVatNumber(e.supplierTaxId);` with:

```ts
    // Same strict decision as the preflight: a number it refuses is never
    // stripped or truncated into a different, valid-looking one.
    const supplierVat = sourceVatIdForPcn(e.supplierTaxId) ?? "";
```

In `buildPcn874` replace `    const customerVat = normalizeCustomerVatNumber(d.clientTaxId);` with:

```ts
    const customerVat = sourceVatIdForPcn(d.clientTaxId) ?? "";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts tests/tax-authority.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/wtpcn && git add src/lib/ita/pcn874.ts tests/pcn874.test.ts && git commit -m "fix(pcn874): builder uses the strict business-number normalizer" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Layer 2 silent repairs

**Files:**
- Modify: `src/lib/ita/pcn874.ts` (`validateSources`)
- Test: `tests/pcn874.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/pcn874.test.ts`:

```ts
describe("PCN874 silent repairs (Layer 2)", () => {
  it("skips an expense without VAT before any amount check, a supplier refund included", () => {
    const r = build([sale()], [expense({ id: "refund", amount: -500, vatAmount: 0, supplierTaxId: "ABC", reference: "x" })]);
    expect(r.warnings.filter((w) => w.sourceId === "refund")).toEqual([]);
    expect(r.transactions.some((t) => t.sourceIds.includes("refund"))).toBe(false);
    expect(pcnCanDownload(r)).toBe(true);
  });

  it("folds a digitless reference with VAT under 300 into petty cash in a non-refund period", () => {
    const r = build([sale()], [expense({ id: "k", reference: "חשבונית", amount: 118, vatAmount: 18 })]);
    expect(r.warnings.filter((w) => w.sourceId === "k")).toEqual([]);
    expect(r.transactions.find((t) => t.entryType === "K")?.sourceIds).toEqual(["k"]);
    expect(pcnCanDownload(r)).toBe(true);
  });

  it("still blocks a digitless reference in a refund period, with the refund code only", () => {
    const r = build(
      [doc({ subtotal: 100, vat: 18, total: 118, allocationNumber: "123456789" })],
      [expense({ id: "big", amount: 5900, vatAmount: 900 }), expense({ id: "k", reference: "חשבונית", amount: 118, vatAmount: 18 })],
    );
    expect(r.refundPeriod).toBe(true);
    const codes = r.warnings.filter((w) => w.sourceId === "k").map((w) => w.code);
    expect(codes).toContain("refund_input_missing_supplier_details");
    expect(codes).not.toContain("reference_invalid");
  });

  it("still blocks a broken date and a 10-digit allocation number", () => {
    expect(build([sale()], [expense({ id: "d", date: "2026-02-30" })]).warnings.find((w) => w.sourceId === "d")?.code).toBe("date_invalid");
    const r = build([sale()], [expense({ id: "a", allocationNumber: "1234567890" })]);
    expect(r.warnings.some((w) => w.sourceId === "a" && w.code === "allocation_invalid" && w.level === "error")).toBe(true);
  });

  it("accepts an allocation number with separators or bidi marks when exactly 9 digits remain", () => {
    const r = build([sale()], [expense({ id: "a", allocationNumber: "‏111-222-333‎" })]);
    expect(r.warnings.filter((w) => w.sourceId === "a")).toEqual([]);
    expect(r.transactions.find((t) => t.entryType === "T")?.allocationNumber).toBe("111222333");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts -t "Layer 2"`
Expected: FAIL on the refund-amount, petty-cash, refund-code and bidi-allocation cases.

- [ ] **Step 3: Write minimal implementation**

In `validateSources` replace:

```ts
    const vat = isDoc ? (d.vatIls ?? d.vat) : (e.vatAmount ?? 0);
    if (!withinField(net, 10) || !withinField(vat, 9) || !Number.isFinite(isDoc ? d.total : e.amount))
```

with:

```ts
    const vat = isDoc ? (d.vatIls ?? d.vat) : (e.vatAmount ?? 0);
    // An expense without VAT never enters the file (a supplier refund with a
    // negative amount included), so nothing about its amounts can make the
    // file wrong. Skip it before the amount and sign checks.
    if (!isDoc && vat === 0) return;
    if (!withinField(net, 10) || !withinField(vat, 9) || !Number.isFinite(isDoc ? d.total : e.amount))
```

Replace:

```ts
    if (!isDoc && vat === 0) return;
    const id = String((isDoc ? d.clientTaxId : e.supplierTaxId) ?? "").trim();
```

with:

```ts
    const id = String((isDoc ? d.clientTaxId : e.supplierTaxId) ?? "").trim();
```

Replace:

```ts
    if ((isDoc || e.reference) && (!/^\d{1,9}$/.test(reference) || Number(reference) === 0))
```

with:

```ts
    // A reference with no digits at all is not a malformed number:
    // classifyInputs folds it into petty cash when that is allowed and
    // reports it (refund period, VAT of 300 and up) when it is not.
    if ((isDoc || reference !== "") && (!/^\d{1,9}$/.test(reference) || Number(reference) === 0))
```

Replace:

```ts
    const allocation = String(row.allocationNumber ?? "").trim();
```

with:

```ts
    // Separators and bidi marks go first; the digit count must then be exactly 9.
    const allocation = String(row.allocationNumber ?? "").replace(/[\s.\-​-‏‪-‮⁦-⁩﻿]/g, "");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts`
Expected: PASS (including the existing "blocks malformed" tables and `{ allocationNumber: "1234567890" }`).

- [ ] **Step 5: Commit**

```bash
cd /c/wtpcn && git add src/lib/ita/pcn874.ts tests/pcn874.test.ts && git commit -m "feat(pcn874): silent repairs for no-VAT expenses and petty-cash references" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Supplier invoice above the allocation threshold without an allocation number

Decision recorded here: the spec says "the T record is still written as today", but `validatePcn874Content` (pcn874.ts, the `מס התשומות בפתיחה ... שונה מסכום הרשומות` check) rejects a header whose input VAT differs from the body, and it mirrors what the ITA simulator rejects. So the input is left out of BOTH the header and the body (no T record); it is simply not claimed. The panel item makes that visible and saving the number restores it. Flagged to the planner.

**Files:**
- Modify: `src/lib/ita/pcn874.ts` (whole `classifyInputs`)
- Test: `tests/pcn874.test.ts:239-246` and `:350-355`

- [ ] **Step 1: Update the two existing tests (they now fail by design)**

Replace the test at lines 239-246 (`it("warns about a supplier invoice above the allocation threshold without an allocation number", ...)`) with:

```ts
  it("leaves a supplier invoice above the allocation threshold out of the file until it has an allocation number", () => {
    // 2026-01: threshold 10,000 before VAT.
    const r = build([sale()], [expense({ id: "noalloc", amount: 14160, vatAmount: 2160 })]);
    const item = r.warnings.find((w) => w.code === "supplier_allocation_missing");
    expect(item).toMatchObject({ level: "action", source: "expense", sourceId: "noalloc", excludedVat: 2160 });
    expect(r.warnings.some((w) => w.level === "error")).toBe(false);
    expect(r.header.otherInputsVat).toBe(0);
    expect(r.transactions.some((t) => t.entryType === "T")).toBe(false);
    expect(r.blockers).toEqual([]);
    expect(pcnCanDownload(r)).toBe(true);

    const ok = build([sale()], [expense({ id: "noalloc", amount: 14160, vatAmount: 2160, allocationNumber: "111222333" })]);
    expect(ok.warnings).toEqual([]);
    expect(ok.header.otherInputsVat).toBe(2160);
    expect(ok.transactions.find((x) => x.entryType === "T")!.allocationNumber).toBe("111222333");
  });

  it("excludes equipment input VAT the same way", () => {
    const r = build([sale()], [expense({ isEquipment: true, amount: 14160, vatAmount: 2160 })]);
    expect(r.header.equipmentInputsVat).toBe(0);
    expect(r.warnings[0]).toMatchObject({ code: "supplier_allocation_missing", excludedVat: 2160 });
  });
```

Replace the test at lines 350-355 (`it("requires supplier allocations strictly above threshold on invoice date", ...)`) with:

```ts
  it("requires supplier allocations strictly above threshold on invoice date", () => {
    const at = build([sale()], [expense({ amount: 11800, vatAmount: 1800 })]);
    expect(at.warnings.some(w => w.code === "supplier_allocation_missing")).toBe(false);
    expect(at.header.otherInputsVat).toBe(1800);
    const above = build([sale()], [expense({ amount: 11800.01, vatAmount: 1800 })]);
    expect(above.warnings.some(w => w.source === "expense" && w.level === "action" && w.code === "supplier_allocation_missing")).toBe(true);
    expect(above.header.otherInputsVat).toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts`
Expected: FAIL (level is still "error", VAT still in header).

- [ ] **Step 3: Write minimal implementation**

Replace the whole `classifyInputs` function (from its doc comment `/**\n * Classify the period's VAT-bearing expenses.` through the closing `}` before `export function buildPcn874`) with:

```ts
/**
 * Classify the period's VAT-bearing expenses. `allowPetty` folds small
 * inputs without supplier details into one K record; a refund period runs
 * this again with it off, so every input is itemised.
 */
function classifyInputs(
  inputs: Expense[],
  periodEnd: string,
  allowPetty: boolean,
): InputsPass {
  const transactions: PcnTransaction[] = [];
  const warnings: PcnWarning[] = [];
  let otherInputsVat = 0;
  let equipmentInputsVat = 0;
  const petty = { sum: 0, vat: 0, ids: [] as string[] };

  for (const e of inputs) {
    const vat = roundShekel(e.vatAmount ?? 0);
    const net = roundShekel(Math.max(0, e.amount - (e.vatAmount ?? 0)));
    if (vat === 0) continue;
    const claim = () => {
      if (e.isEquipment) equipmentInputsVat += vat;
      else otherInputsVat += vat;
    };

    // Same strict decision as the preflight: a number it refuses is never
    // stripped or truncated into a different, valid-looking one.
    const supplierVat = sourceVatIdForPcn(e.supplierTaxId) ?? "";
    const reference = referenceDigits(e.reference);
    const allocation = digitsOnly(e.allocationNumber);

    if (!supplierVat || !reference) {
      if (allowPetty && vat < PETTY_CASH_VAT_THRESHOLD) {
        claim();
        petty.sum += net;
        petty.vat += vat;
        petty.ids.push(e.id);
        continue;
      }
      warnings.push({
        code: allowPetty ? "input_missing_supplier_details" : "refund_input_missing_supplier_details",
        level: "error",
        message: allowPetty
          ? `הוצאה עם מע״מ של ${vat.toLocaleString("he-IL")} ₪ (מעל 300 ₪) חייבת מספר עוסק ומספר חשבונית של הספק. פתח את ההוצאה והשלם את הפרטים.`
          : "בדוח להחזר כל תשומה מדווחת בנפרד, ולכן גם הוצאה קטנה חייבת מספר עוסק ומספר חשבונית של הספק.",
        source: "expense",
        sourceId: e.id,
        sourceLabel: expenseLabel(e),
      });
    }

    // Since 2024 (חשבונית ישראל) input VAT on a supplier invoice above the
    // threshold without an allocation number is not deductible. Claiming it
    // would overstate the deduction, so the input stays out of the header AND
    // the body (the self-check requires them to agree). The file is still
    // valid and downloadable; the visible "action" item restores it.
    if (supplierVat && !allocation && allocationApplies(e.date, e.amount - (e.vatAmount ?? 0))) {
      warnings.push({
        code: "supplier_allocation_missing",
        level: "action",
        message: `מע״מ תשומות של ${vat.toLocaleString("he-IL")} ₪ לא נכלל בדוח כי לחשבונית אין מספר הקצאה. הוסף את מספר ההקצאה כדי לקזז אותו.`,
        excludedVat: vat,
        source: "expense",
        sourceId: e.id,
        sourceLabel: expenseLabel(e),
      });
      continue;
    }

    claim();
    transactions.push({
      entryType: "T",
      vatId: supplierVat || "000000000",
      invoiceDate: isoToYyyymmdd(e.date),
      refGroup: "0000",
      refNumber: reference ? fixedDigits(reference, 9) : "000000000",
      totalVat: vat,
      invoiceSum: net,
      allocationNumber: allocation ? fixedDigits(allocation, 9) : "000000000",
      sourceIds: [e.id],
    });
  }

  if (petty.ids.length > 0) {
    transactions.push({
      entryType: "K",
      vatId: "000000000",
      invoiceDate: periodEnd,
      refGroup: "0000",
      refNumber: fixedDigits(petty.ids.length, 9),
      totalVat: petty.vat,
      invoiceSum: petty.sum,
      allocationNumber: "000000000",
      sourceIds: petty.ids,
    });
  }

  return { transactions, warnings, otherInputsVat, equipmentInputsVat };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts && npx tsc --noEmit`
Expected: PASS (the K test at 186-211 still sees `otherInputsVat` 234), tsc exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/wtpcn && git add src/lib/ita/pcn874.ts tests/pcn874.test.ts && git commit -m "feat(pcn874): leave unallocated supplier input VAT out of the file, visibly" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6a: A foreign customer number on a zero-rated export does not block

**Files:**
- Modify: `src/lib/ita/pcn874.ts` (`validateSources`, the business-number check)
- Test: `tests/pcn874.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("zero-rated exports with a foreign customer number", () => {
  it("does not block a zero-rated export whose customer number is not Israeli, and writes Y", () => {
    const r = build([doc({ id: "exp", zeroRated: true, subtotal: 7000, vat: 0, total: 7000, clientTaxId: "DE123456789" })], []);
    expect(r.warnings.filter((w) => w.sourceId === "exp" && w.level === "error")).toEqual([]);
    expect(r.transactions[0]).toMatchObject({ entryType: "Y", vatId: "999999999" });
    expect(pcnCanDownload(r)).toBe(true);
  });

  it("still blocks the same invalid number on a document that is not zero-rated", () => {
    const r = build([doc({ id: "dom", clientTaxId: "DE123456789", allocationNumber: "123456789" })], []);
    expect(r.warnings.some((w) => w.sourceId === "dom" && w.code === "customer_number_invalid" && w.level === "error")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail**: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts -t "foreign customer number"` (first case FAILS).

- [ ] **Step 3: Implement**: in `validateSources` replace `    if (id && !sourceVatIdForPcn(id))` with:

```ts
    // A zero-rated export to a foreign customer carries a foreign id; the
    // builder reports it as Y / 999999999, so that id cannot break the file.
    if (id && !sourceVatIdForPcn(id) && !(isDoc && d.zeroRated))
```

- [ ] **Step 4: Run**: `cd /c/wtpcn && npx vitest run tests/pcn874.test.ts` (PASS).

- [ ] **Step 5: Commit** `src/lib/ita/pcn874.ts tests/pcn874.test.ts` with message "fix(pcn874): foreign customer number on a zero-rated export no longer blocks" and the trailer.

---

### Task 7: Pure row mappers (node-safe) and `importBatchId`

Why: the guard (Task 19) must run the same mapping as `/reports/vat`, but `filing-report-data.ts` and `profit-loss-data.ts` import `report-rows.ts`, which creates the browser Supabase client at import time.

**Files:**
- Create: `src/lib/profit-loss-rows.ts`, `src/lib/filing-rows.ts`
- Modify: `src/lib/profit-loss-data.ts:14-23`, `src/lib/filing-report-data.ts:1-26`, `src/lib/types.ts` (`InvoiceDocument`)
- Test: `tests/invoice-report-preflight.test.ts` (existing, must stay green), new case in `tests/filing-fix-items.test.ts` is added in Task 13; here add `tests/filing-rows.test.ts`

- [ ] **Step 1: Confirm the column exists in production (schema only, no tenant data)**

Run: `cd /c/wtpcn && node scripts/run-sql.mjs --reason "schema check: documents.import_batch_id for the VAT report" "select column_name from information_schema.columns where table_schema='public' and table_name='documents' and column_name='import_batch_id'"`
Expected: output contains `import_batch_id`. If it does not, STOP and report to the planner (adding the column to the select would break every filing report).

- [ ] **Step 2: Write the failing test**

Create `tests/filing-rows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FILING_COLUMNS, mapFilingDocument, mapFilingExpense } from "@/lib/filing-rows";

describe("filing rows", () => {
  it("selects and maps the import batch so imported documents can be routed to support", () => {
    expect(FILING_COLUMNS.documents.split(",")).toContain("import_batch_id");
    const doc = mapFilingDocument({ id: "d", type: "tax_invoice", status: "sent", date: "2026-08-01", number: "7", subtotal: 100, vat: 18, total: 118, import_batch_id: "batch-1" });
    expect(doc.importBatchId).toBe("batch-1");
    expect(mapFilingDocument({ id: "d", type: "tax_invoice", status: "sent", date: "2026-08-01", number: "7", subtotal: 100, vat: 18, total: 118, import_batch_id: null }).importBatchId).toBeUndefined();
  });

  it("keeps missing shekel amounts undefined", () => {
    const doc = mapFilingDocument({ id: "d", type: "tax_invoice", status: "sent", date: "2026-08-01", number: "7", subtotal: 100, vat: 18, total: 118, currency: "USD", subtotal_ils: null, vat_ils: null, total_ils: null });
    expect([doc.subtotalIls, doc.vatIls, doc.totalIls]).toEqual([undefined, undefined, undefined]);
  });

  it("maps expense filing fields", () => {
    expect(mapFilingExpense({ id: "e", amount: 118, vat_amount: 18, supplier_tax_id: "513333336", reference: "A-1", allocation_number: "" })).toMatchObject({ supplierTaxId: "513333336", reference: "A-1", vatAmount: 18 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/filing-rows.test.ts`
Expected: FAIL, cannot resolve `@/lib/filing-rows`.

- [ ] **Step 4: Create `src/lib/profit-loss-rows.ts`** (lines 14-23 of `profit-loss-data.ts`, moved verbatim)

```ts
// Pure row mappers for the profit-loss and filing reports. No Supabase client
// here on purpose: node scripts (the nightly filing guard) import these.
import type { ProfitLossDocument, ProfitLossExpense } from "./profit-loss";

const number = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
const optionalNumber = (value: unknown) => value == null ? undefined : number(value);
export function mapProfitLossDocument(row: Record<string, unknown>): ProfitLossDocument {
  if (!["receipt", "tax_invoice", "tax_invoice_receipt", "credit_note", "quote", "proforma"].includes(String(row.type)) || !["draft", "sent", "paid", "cancelled"].includes(String(row.status))) throw new Error("נמצא סוג מסמך או סטטוס לא תקין. לא ניתן להפיק דוח מלא.");
  return { id: String(row.id), date: typeof row.date === "string" ? row.date : "", type: row.type as ProfitLossDocument["type"], status: row.status as ProfitLossDocument["status"], total: number(row.total), vat: number(row.vat), currency: row.currency == null ? undefined : String(row.currency), exchangeRate: optionalNumber(row.exchange_rate), totalIls: optionalNumber(row.total_ils), vatIls: optionalNumber(row.vat_ils), convertedToId: typeof row.converted_to_id === "string" ? row.converted_to_id : undefined };
}
export function mapProfitLossExpense(row: Record<string, unknown>): ProfitLossExpense {
  if (row.is_equipment != null && typeof row.is_equipment !== "boolean") throw new Error("סיווג ציוד לא תקין. לא ניתן להפיק דוח מלא.");
  return { id: String(row.id), date: typeof row.date === "string" ? row.date : "", category: typeof row.category === "string" ? row.category : "", amount: number(row.amount), vatAmount: optionalNumber(row.vat_amount), isEquipment: row.is_equipment === true };
}
```

Then in `src/lib/profit-loss-data.ts` delete lines 14-23 (the `number`, `optionalNumber`, `mapProfitLossDocument`, `mapProfitLossExpense` definitions) and replace line 5 `import type { ProfitLossDocument, ProfitLossExpense } from "./profit-loss";` with:

```ts
import type { ProfitLossDocument, ProfitLossExpense } from "./profit-loss";
import { mapProfitLossDocument, mapProfitLossExpense } from "./profit-loss-rows";

export { mapProfitLossDocument, mapProfitLossExpense };
```

- [ ] **Step 5: Create `src/lib/filing-rows.ts`**

```ts
// Columns and pure row mappers for the filing reports (PCN874 on /reports/vat,
// invoices-period, expenses). Shared by the browser hook and the nightly
// guard script, so both judge exactly the same rows.
import { mapProfitLossDocument, mapProfitLossExpense } from "./profit-loss-rows";
import type { Expense, InvoiceDocument } from "./types";

export const FILING_COLUMNS = {
  documents: "id,date,type,status,number,client_id,client_name,client_tax_id,subtotal,vat,total,currency,exchange_rate,subtotal_ils,vat_ils,total_ils,converted_to_id,allocation_number,zero_rated,rounding,import_batch_id",
  expenses: "id,date,category,supplier,description,amount,vat_amount,is_equipment,supplier_tax_id,reference,allocation_number",
} as const;

const numeric = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
const text = (value: unknown) => typeof value === "string" ? value : "";

export function mapFilingDocument(row: Record<string, unknown>): InvoiceDocument {
  return {
    ...mapProfitLossDocument(row), number: numeric(row.number), clientId: text(row.client_id),
    clientName: text(row.client_name), clientTaxId: text(row.client_tax_id), items: [],
    subtotal: numeric(row.subtotal), subtotalIls: row.subtotal_ils == null ? undefined : numeric(row.subtotal_ils),
    allocationNumber: text(row.allocation_number), zeroRated: row.zero_rated === true,
    rounding: row.rounding == null ? 0 : numeric(row.rounding),
    importBatchId: typeof row.import_batch_id === "string" && row.import_batch_id ? row.import_batch_id : undefined,
  };
}

export function mapFilingExpense(row: Record<string, unknown>): Expense {
  return { ...mapProfitLossExpense(row), supplier: text(row.supplier), description: text(row.description), supplierTaxId: text(row.supplier_tax_id), reference: text(row.reference), allocationNumber: text(row.allocation_number) };
}
```

- [ ] **Step 6: Point `filing-report-data.ts` at it**

In `src/lib/filing-report-data.ts` replace lines 1-26 (from `"use client";` through the closing `}` of `mapFilingExpense`) with:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { loadReportRows } from "./report-rows";
import { FILING_COLUMNS, mapFilingDocument, mapFilingExpense } from "./filing-rows";
import type { InvoiceDocument, Expense } from "./types";

export { mapFilingDocument, mapFilingExpense };
```

In the same file replace `columns.documents` with `FILING_COLUMNS.documents` and `columns.expenses` with `FILING_COLUMNS.expenses` (one occurrence each, inside `Promise.all`).

- [ ] **Step 7: Add the type field**

In `src/lib/types.ts`, inside `interface InvoiceDocument`, directly after the `language?: "he" | "en";` property add:

```ts
  /**
   * Set when the document came in through a data import (another system's
   * numbers). The VAT report routes its data errors to support instead of
   * offering a credit note, which would double-report someone else's typo.
   */
  importBatchId?: string;
```

- [ ] **Step 8: Run tests and typecheck**

Run: `cd /c/wtpcn && npx vitest run tests/filing-rows.test.ts tests/invoice-report-preflight.test.ts tests/profit-loss-data.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 9: Commit**

```bash
cd /c/wtpcn && git add src/lib/profit-loss-rows.ts src/lib/filing-rows.ts src/lib/profit-loss-data.ts src/lib/filing-report-data.ts src/lib/types.ts tests/filing-rows.test.ts && git commit -m "refactor(reports): node-safe filing row mappers with import batch" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Document store keeps missing shekel amounts undefined

**Files:**
- Modify: `src/lib/document-store.ts:21` and `:59-61`
- Modify: `src/components/document-body.tsx` (the `currency !== "ILS"` total line, around 447)
- Test: `tests/document-store-ils.test.ts`

Consumer audit (done while planning): every reader of `subtotalIls` / `vatIls` / `totalIls` in `src/` already applies `?? native` locally, except `receipt-view.tsx:124` which passes `doc.totalIls` to `document-body.tsx:451` (`formatMoney(Number(totalIls ?? 0))`). With the fix that line would print 0; it is hidden instead when there is no stored shekel total.

- [ ] **Step 1: Write the failing test**

Create `tests/document-store-ils.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "", onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
import { mapDocRow } from "@/lib/document-store";

const base = { id: "d", type: "tax_invoice", number: 1, date: "2026-08-01", status: "sent", subtotal: 1000, vat: 180, total: 1180, currency: "USD" };

describe("document store shekel snapshots", () => {
  it("keeps missing shekel amounts undefined instead of copying native amounts", () => {
    const doc = mapDocRow({ ...base, subtotal_ils: null, vat_ils: null, total_ils: null }, []);
    expect(doc.subtotalIls).toBeUndefined();
    expect(doc.vatIls).toBeUndefined();
    expect(doc.totalIls).toBeUndefined();
  });

  it("keeps stored shekel amounts, zero included", () => {
    const doc = mapDocRow({ ...base, subtotal_ils: 3700, vat_ils: 0, total_ils: "3700" }, []);
    expect(doc.subtotalIls).toBe(3700);
    expect(doc.vatIls).toBe(0);
    expect(doc.totalIls).toBe(3700);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/document-store-ils.test.ts`
Expected: FAIL, `mapDocRow` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/document-store.ts` replace `function mapDocRow(row: Record<string, unknown>, items: DocumentItem[]): InvoiceDocument {` with:

```ts
export function mapDocRow(row: Record<string, unknown>, items: DocumentItem[]): InvoiceDocument {
```

Replace:

```ts
    subtotalIls: row.subtotal_ils != null ? Number(row.subtotal_ils) : Number(row.subtotal) || 0,
    vatIls: row.vat_ils != null ? Number(row.vat_ils) : Number(row.vat) || 0,
    totalIls: row.total_ils != null ? Number(row.total_ils) : Number(row.total) || 0,
```

with:

```ts
    // Missing shekel snapshots stay undefined. Copying native amounts here
    // made a foreign-currency document without shekels look converted, so the
    // VAT checks could never see it; display code applies `?? native` itself.
    subtotalIls: row.subtotal_ils != null ? Number(row.subtotal_ils) : undefined,
    vatIls: row.vat_ils != null ? Number(row.vat_ils) : undefined,
    totalIls: row.total_ils != null ? Number(row.total_ils) : undefined,
```

In `src/components/document-body.tsx` replace:

```tsx
          {currency !== "ILS" && (
            <div className="doc-note-line">
```

with:

```tsx
          {currency !== "ILS" && totalIls != null && (
            <div className="doc-note-line">
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd /c/wtpcn && npx vitest run tests/document-store-ils.test.ts tests/import-stores.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/wtpcn && git add src/lib/document-store.ts src/components/document-body.tsx tests/document-store-ils.test.ts && git commit -m "fix(document-store): keep missing shekel snapshots undefined" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Layer 1 hint logic and component

**Files:**
- Create: `src/lib/business-number-hint.ts`, `src/components/business-number-hint.tsx`
- Test: `tests/business-number-hint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/business-number-hint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { businessNumberHint, businessNumberForSave } from "@/lib/business-number-hint";

describe("businessNumberHint", () => {
  it("says nothing for an empty field", () => {
    expect(businessNumberHint("")).toBeNull();
    expect(businessNumberHint("  ")).toBeNull();
  });
  it("confirms a valid 9-digit number", () => {
    expect(businessNumberHint("514993666")).toEqual({ tone: "ok", text: "מספר עוסק תקין" });
  });
  it("explains a short valid number without rewriting it", () => {
    const hint = businessNumberHint("13333331");
    expect(hint?.tone).toBe("info");
    expect(hint?.text).toContain("013333331");
  });
  it.each([["51333333X", "אותיות"], ["5149936661", "9 ספרות"], ["514993667", "ספרת הביקורת"]])("warns on %j", (raw, fragment) => {
    const hint = businessNumberHint(raw);
    expect(hint?.tone).toBe("warn");
    expect(hint?.text).toContain(fragment);
    expect(hint?.text).toContain("מספר זר");
  });
});

describe("businessNumberForSave", () => {
  it("rewrites only a valid number that already had 9 digits", () => {
    expect(businessNumberForSave("514-993-666")).toBe("514993666");
    expect(businessNumberForSave("  514993666 ")).toBe("514993666");
  });
  it("never pads a short number and never touches foreign or invalid ids", () => {
    expect(businessNumberForSave("13333331")).toBe("13333331");
    expect(businessNumberForSave("GB 123 456")).toBe("GB 123 456");
    expect(businessNumberForSave("514993667")).toBe("514993667");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/business-number-hint.test.ts`
Expected: FAIL, cannot resolve module.

- [ ] **Step 3: Write `src/lib/business-number-hint.ts`**

```ts
import { normalizeBusinessNumber } from "./israeli-id";

export interface BusinessNumberHint {
  tone: "ok" | "info" | "warn";
  text: string;
}

/**
 * The live line under a business-number field. Never blocks a save: foreign
 * ids are legitimate, so every warning says so.
 */
export function businessNumberHint(raw: string): BusinessNumberHint | null {
  if (!raw.trim()) return null;
  const n = normalizeBusinessNumber(raw);
  switch (n.reason) {
    case "empty":
      return null;
    case "ok":
      return n.digitCount === 9
        ? { tone: "ok", text: "מספר עוסק תקין" }
        : { tone: "info", text: `נראה כמו מספר ישראלי שחסר בו אפס בהתחלה. בדוח למע״מ הוא יירשם כ-${n.value}.` };
    case "letters":
      return { tone: "warn", text: "יש במספר אותיות או סימנים. מספר עוסק ישראלי כולל ספרות בלבד; מספר זר אפשר לשמור כמו שהוא." };
    case "too_long":
      return { tone: "warn", text: "יש יותר מ-9 ספרות. מספר עוסק ישראלי הוא עד 9 ספרות; מספר זר אפשר לשמור כמו שהוא." };
    case "checksum":
      return { tone: "warn", text: "ספרת הביקורת לא מתאימה למספר עוסק ישראלי. בדוק מול החשבונית; מספר זר אפשר לשמור כמו שהוא." };
  }
}

/**
 * Save-time rule: rewrite to the 9-digit form only when the number is valid
 * AND already had 9 digits. A short number is never padded on save, because
 * a numeric foreign id passes the checksum one time in ten.
 */
export function businessNumberForSave(raw: string): string {
  const n = normalizeBusinessNumber(raw);
  return n.reason === "ok" && n.digitCount === 9 && n.value ? n.value : raw.trim();
}
```

- [ ] **Step 4: Write `src/components/business-number-hint.tsx`**

```tsx
"use client";

import { businessNumberHint } from "@/lib/business-number-hint";

const TONE_CLASS = {
  ok: "text-emerald-700",
  info: "text-sky-800",
  warn: "text-amber-800",
} as const;

/** Live hint under a business-number input. Informational only, never blocks. */
export function BusinessNumberHintText({ value }: { value: string }) {
  const hint = businessNumberHint(value);
  if (!hint) return null;
  return (
    <p aria-live="polite" className={`text-xs mt-1 leading-relaxed ${TONE_CLASS[hint.tone]}`}>
      {hint.text}
    </p>
  );
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd /c/wtpcn && npx vitest run tests/business-number-hint.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
cd /c/wtpcn && git add src/lib/business-number-hint.ts src/components/business-number-hint.tsx tests/business-number-hint.test.ts && git commit -m "feat(forms): business-number hint logic and component" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Hints in the client form and the expense form

Note: the expense form's supplier field already strips non-digits and caps at 9 (`expense-form-modal.tsx:595-601`), so there only the ok / leading-zero / checksum hints can appear.

**Files:**
- Modify: `src/components/client-form-modal.tsx` (imports, `handleSubmit`, tax-id field)
- Modify: `src/components/expense-form-modal.tsx` (imports, `handleSubmit`, supplier tax-id field)

- [ ] **Step 1: Client form**

In `src/components/client-form-modal.tsx` replace `import type { Client } from "@/lib/types";` with:

```tsx
import type { Client } from "@/lib/types";
import { BusinessNumberHintText } from "@/components/business-number-hint";
import { businessNumberForSave } from "@/lib/business-number-hint";
```

Replace `      taxId: form.taxId.trim() || undefined,` with:

```tsx
      taxId: businessNumberForSave(form.taxId) || undefined,
```

Replace the tax-id field:

```tsx
          <FormField label="ח.פ / ת.ז">
            <input
              type="text"
              name="tax-id"
              dir="ltr"
              value={form.taxId}
              onChange={(e) => update("taxId", e.target.value)}
              placeholder="514123456"
              autoComplete="on"
              className="input-warm"
            />
          </FormField>
```

with:

```tsx
          <FormField label="ח.פ / ת.ז">
            <div>
              <input
                type="text"
                name="tax-id"
                dir="ltr"
                value={form.taxId}
                onChange={(e) => update("taxId", e.target.value)}
                placeholder="514123456"
                autoComplete="on"
                className="input-warm"
              />
              <BusinessNumberHintText value={form.taxId} />
            </div>
          </FormField>
```

- [ ] **Step 2: Expense form**

In `src/components/expense-form-modal.tsx` replace `import type { Expense } from "@/lib/types";` with:

```tsx
import type { Expense } from "@/lib/types";
import { BusinessNumberHintText } from "@/components/business-number-hint";
import { businessNumberForSave } from "@/lib/business-number-hint";
```

Replace `      supplierTaxId: vatDetails.supplierTaxId.trim() || undefined,` with:

```tsx
      supplierTaxId: businessNumberForSave(vatDetails.supplierTaxId) || undefined,
```

Replace:

```tsx
                  <FormField label="מספר עוסק / ח.פ של הספק">
                    <input
                      type="text"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={9}
                      value={vatDetails.supplierTaxId}
                      onChange={(e) =>
                        setVatDetails((d) => ({
                          ...d,
                          supplierTaxId: e.target.value.replace(/\D/g, "").slice(0, 9),
                        }))
                      }
                      placeholder="123456789"
                      className="input-warm"
                    />
                  </FormField>
```

with:

```tsx
                  <FormField label="מספר עוסק / ח.פ של הספק">
                    <div>
                      <input
                        type="text"
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={9}
                        value={vatDetails.supplierTaxId}
                        onChange={(e) =>
                          setVatDetails((d) => ({
                            ...d,
                            supplierTaxId: e.target.value.replace(/\D/g, "").slice(0, 9),
                          }))
                        }
                        placeholder="123456789"
                        className="input-warm"
                      />
                      <BusinessNumberHintText value={vatDetails.supplierTaxId} />
                    </div>
                  </FormField>
```

- [ ] **Step 3: Typecheck, lint, related tests**

Run: `cd /c/wtpcn && npx tsc --noEmit && npx eslint src/components/client-form-modal.tsx src/components/expense-form-modal.tsx && npx vitest run tests/form-field-labelling.test.ts`
Expected: all exit 0 (FormField still injects the id into the first `<input>` inside the wrapper div).

- [ ] **Step 4: Commit**

```bash
cd /c/wtpcn && git add src/components/client-form-modal.tsx src/components/expense-form-modal.tsx && git commit -m "feat(forms): live business-number hints in client and expense forms" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Narrow authenticated save paths for inline fixes

Existing paths, and why two new functions are needed:
- Customer number on an issued sale: `updateDocumentClientTaxId(id, taxId)` in `src/lib/document-store.ts:549` (the path `DocumentCustomerTaxEditor` uses; the immutability trigger allows `client_tax_id`). Reused as is.
- Expenses: `expenseStore.save` (`src/lib/expense-store.ts:76`) needs a full record and ignores UPDATE errors. New `updateExpenseFilingFields` uses the same RLS client, writes only the named columns to every listed expense, and throws.
- Business number: `saveBusiness` (`src/lib/business-store.ts:170`) writes the whole row from a snapshot. New `saveBusinessTaxId` follows the `saveIncomeTaxAdvanceRate` single-column pattern.

**Files:**
- Modify: `src/lib/expense-store.ts` (append inside module, after `expenseStore`)
- Modify: `src/lib/business-store.ts` (after `saveTaxOfficerNoticeSentAt`)
- Test: `tests/filing-inline-saves.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/filing-inline-saves.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
type Call = { table: string; update?: Record<string, unknown>; in?: [string, string[]]; eq?: [string, string] };
const state = vi.hoisted(() => ({ calls: [] as Call[], rows: 0, error: null as null | { message: string } }));
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "business", onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => {
  const call: Call = { table };
  state.calls.push(call);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    update(row: Record<string, unknown>) { call.update = row; return q; },
    in(column: string, values: string[]) { call.in = [column, values]; return q; },
    eq(column: string, value: string) { call.eq = [column, value]; return q; },
    select: () => q,
    then(resolve: (v: unknown) => void) {
      return Promise.resolve(resolve({ data: state.error ? null : Array.from({ length: state.rows }, (_, i) => ({ id: String(i) })), error: state.error }));
    },
  };
  return q;
} } }));
import { updateExpenseFilingFields } from "@/lib/expense-store";
import { saveBusinessTaxId } from "@/lib/business-store";

beforeEach(() => { state.calls = []; state.rows = 0; state.error = null; window.dispatchEvent = vi.fn(); });

describe("updateExpenseFilingFields", () => {
  it("writes only the named filing columns to every listed expense", async () => {
    state.rows = 2;
    await updateExpenseFilingFields(["a", "b"], { supplierTaxId: "513-333-336" });
    expect(state.calls[0]).toMatchObject({ table: "expenses", update: { supplier_tax_id: "513333336" }, in: ["id", ["a", "b"]] });
    expect(Object.keys(state.calls[0].update!)).toEqual(["supplier_tax_id"]);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("maps reference, allocation and date", async () => {
    state.rows = 1;
    await updateExpenseFilingFields(["a"], { reference: " INV-9 ", allocationNumber: "111-222-333", date: "2026-08-10" });
    expect(state.calls[0].update).toEqual({ reference: "INV-9", allocation_number: "111222333", date: "2026-08-10" });
  });

  it("throws on a partial write and on an error, without broadcasting", async () => {
    state.rows = 1;
    await expect(updateExpenseFilingFields(["a", "b"], { reference: "1" })).rejects.toThrow("חלק מההוצאות");
    state.error = { message: "denied" };
    await expect(updateExpenseFilingFields(["a"], { reference: "1" })).rejects.toThrow("denied");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe("saveBusinessTaxId", () => {
  it("updates only tax_id on the business", async () => {
    state.rows = 1;
    await saveBusinessTaxId("biz", " 512345679 ");
    expect(state.calls[0]).toMatchObject({ table: "businesses", update: { tax_id: "512345679" }, eq: ["id", "biz"] });
    expect(Object.keys(state.calls[0].update!)).toEqual(["tax_id"]);
  });

  it("throws when RLS updated nothing", async () => {
    await expect(saveBusinessTaxId("biz", "512345679")).rejects.toThrow("השמירה לא בוצעה");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/filing-inline-saves.test.ts`
Expected: FAIL, functions not exported.

- [ ] **Step 3: Implement `updateExpenseFilingFields`**

Append at the end of `src/lib/expense-store.ts`:

```ts
/**
 * Inline fixes from the VAT report's "what's left" panel: one narrow UPDATE of
 * only the named filing fields, on every listed expense (a supplier's number
 * belongs to all its expenses; there is no suppliers table). Same RLS client
 * as save(), but it throws on an error or a partial write so the panel can
 * say why nothing changed.
 */
export async function updateExpenseFilingFields(
  ids: readonly string[],
  patch: { supplierTaxId?: string; reference?: string; allocationNumber?: string; date?: string },
): Promise<void> {
  const columns: Record<string, string | null> = {};
  if (patch.supplierTaxId !== undefined) columns.supplier_tax_id = patch.supplierTaxId.replace(/\D/g, "") || null;
  if (patch.reference !== undefined) columns.reference = patch.reference.trim() || null;
  if (patch.allocationNumber !== undefined) columns.allocation_number = patch.allocationNumber.replace(/\D/g, "") || null;
  if (patch.date !== undefined) columns.date = patch.date;
  if (ids.length === 0 || Object.keys(columns).length === 0) return;
  const { data, error } = await supabase.from("expenses").update(columns).in("id", [...ids]).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length !== ids.length) throw new Error("חלק מההוצאות לא עודכנו. רענן את הדף ונסה שוב.");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
```

- [ ] **Step 4: Implement `saveBusinessTaxId`**

In `src/lib/business-store.ts`, directly before `export async function saveBusiness(business: Business): Promise<void> {`, add:

```ts
/**
 * Persist only the business number, from the VAT report's inline fix. Its own
 * UPDATE for the same reason as saveIncomeTaxAdvanceRate: a whole-row
 * saveBusiness() from this screen's snapshot could revert a setting saved in
 * another tab. A zero-row result means RLS refused, so it throws.
 */
export async function saveBusinessTaxId(businessId: string, taxId: string): Promise<void> {
  const { data, error } = await supabase
    .from("businesses")
    .update({ tax_id: taxId.trim() })
    .eq("id", businessId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("השמירה לא בוצעה. רענן את הדף ונסה שוב.");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd /c/wtpcn && npx vitest run tests/filing-inline-saves.test.ts tests/import-stores.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
cd /c/wtpcn && git add src/lib/expense-store.ts src/lib/business-store.ts tests/filing-inline-saves.test.ts && git commit -m "feat(stores): narrow error-surfacing saves for inline filing fixes" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Support link helper

**Files:**
- Create: `src/lib/support-link.ts`
- Modify: `src/components/layout/sidebar.tsx` (import after `use-drawer-focus`, the bug-report `href`)
- Test: `tests/support-link.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/support-link.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filingDataFixMessage, supportWhatsappHref } from "@/lib/support-link";

describe("support link", () => {
  it("builds a wa.me link to the support number with the text encoded", () => {
    expect(supportWhatsappHref("שלום & bye")).toBe(`https://wa.me/972549000684?text=${encodeURIComponent("שלום & bye")}`);
  });
  it("prefills only the document id and the error code", () => {
    const text = filingDataFixMessage("9bbd3d8a-d7d0-4a00-b573-1e16c3338517", "sign_mismatch");
    expect(text).toContain("9bbd3d8a-d7d0-4a00-b573-1e16c3338517");
    expect(text).toContain("sign_mismatch");
    expect(filingDataFixMessage(undefined, "file_structure")).not.toContain("undefined");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/support-link.test.ts`
Expected: FAIL, cannot resolve module.

- [ ] **Step 3: Write `src/lib/support-link.ts`**

```ts
/** Asaf's WhatsApp, the app's support channel (same number as the sidebar bug button). */
export const SUPPORT_WHATSAPP_PHONE = "972549000684";

export function supportWhatsappHref(text: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(text)}`;
}

/**
 * The prefilled request for a data fix on a locked document. Deliberately
 * only the document id and the error code: never amounts or names.
 */
export function filingDataFixMessage(documentId: string | undefined, code: string): string {
  return [
    "היי, צריך תיקון נתונים כדי להגיש את הדיווח המפורט למע״מ.",
    ...(documentId ? [`מזהה מסמך: ${documentId}`] : []),
    `קוד: ${code}`,
  ].join("\n");
}
```

- [ ] **Step 4: Reuse it in the sidebar**

In `src/components/layout/sidebar.tsx` replace `import { useDrawerFocus } from "@/lib/use-drawer-focus";` with:

```tsx
import { useDrawerFocus } from "@/lib/use-drawer-focus";
import { supportWhatsappHref } from "@/lib/support-link";
```

Replace:

```tsx
          href={(() => {
            const PHONE = "972549000684"; // +972 549000684 (international format)
            const where = typeof window !== "undefined" ? window.location.href : "";
            const text = `היי אסף, מצאתי משהו ב-חשבונית ידידותית:\n\n[תאר כאן את הבעיה]\n\nבעמוד: ${where}`;
            return `https://wa.me/${PHONE}?text=${encodeURIComponent(text)}`;
          })()}
```

with:

```tsx
          href={(() => {
            const where = typeof window !== "undefined" ? window.location.href : "";
            return supportWhatsappHref(`היי אסף, מצאתי משהו ב-חשבונית ידידותית:\n\n[תאר כאן את הבעיה]\n\nבעמוד: ${where}`);
          })()}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd /c/wtpcn && npx vitest run tests/support-link.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
cd /c/wtpcn && git add src/lib/support-link.ts src/components/layout/sidebar.tsx tests/support-link.test.ts && git commit -m "feat(support): shared WhatsApp support link and data-fix message" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 13: The "what's left" model

**Files:**
- Create: `src/lib/filing-fix-items.ts`
- Test: `tests/filing-fix-items.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/filing-fix-items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPcn874 } from "@/lib/ita/pcn874";
import { buildFilingFixModel } from "@/lib/filing-fix-items";
import type { Expense, InvoiceDocument } from "@/lib/types";

const business = { taxId: "512345679", businessType: "authorized" as const };
const range = { start: "2026-01-01", end: "2026-02-28" };
const generatedOn = new Date("2026-03-10T09:00:00+02:00");

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return { id: over.id ?? Math.random().toString(36).slice(2), type: "tax_invoice", number: 1001, date: "2026-01-15", clientId: "c1", clientName: "לקוח בע״מ", clientTaxId: "515555555", status: "paid", items: [], subtotal: 10000, vat: 1800, total: 11800, allocationNumber: "123456789", ...over };
}
function expense(over: Partial<Expense> = {}): Expense {
  return { id: over.id ?? Math.random().toString(36).slice(2), date: "2026-01-20", category: "תוכנה", supplier: "ספק", amount: 1180, vatAmount: 180, supplierTaxId: "513333336", reference: "A-7788", ...over };
}
function model(documents: InvoiceDocument[], expenses: Expense[], taxId = business.taxId) {
  const result = buildPcn874({ business: { ...business, taxId }, documents, expenses, range, generatedOn });
  return buildFilingFixModel(result, { business: { taxId }, documents, expenses });
}

describe("buildFilingFixModel", () => {
  it("groups a supplier's invalid number into one item that saves to every expense", () => {
    const m = model([doc()], [
      expense({ id: "e1", supplier: "קנן-סנטר", supplierTaxId: "513333337", reference: "INV-1", amount: 2360, vatAmount: 360 }),
      expense({ id: "e2", supplier: "קנן-סנטר", supplierTaxId: "513333337", reference: "INV-2", amount: 2360, vatAmount: 360, date: "2026-02-03" }),
    ]);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0].title).toBe("מספר העוסק של קנן-סנטר לא תקין (2 הוצאות)");
    expect(m.blocking[0].control).toEqual({ kind: "supplier_tax_id", expenseIds: ["e1", "e2"], current: "513333337" });
    expect(m.blocking.some((i) => i.code === "file_structure")).toBe(false);
  });

  it("groups by supplier name when there is no number", () => {
    const m = model([doc()], [
      expense({ id: "e3", supplier: "קנן-סנטר", supplierTaxId: undefined, reference: "INV-3", amount: 2360, vatAmount: 360 }),
      expense({ id: "e4", supplier: " קנן-סנטר ", supplierTaxId: undefined, reference: "INV-4", amount: 2360, vatAmount: 360, date: "2026-02-04" }),
    ]);
    expect(m.blocking.map((i) => i.title)).toEqual(["חסר מספר עוסק ל-קנן-סנטר (2 הוצאות)"]);
  });

  it("offers one customer-number fix per issued sale, merging both findings", () => {
    const m = model([doc({ id: "d", clientTaxId: "515555554" })], []);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0].control).toEqual({ kind: "customer_tax_id", documentId: "d", current: "515555554" });
    expect(m.blocking[0].messages).toHaveLength(2);
  });

  it("routes an invalid dealer number to the business-number control", () => {
    const m = model([doc()], [], "1234");
    expect(m.blocking.map((i) => i.control)).toEqual([{ kind: "business_tax_id", current: "1234" }]);
  });

  it("shows a supplier invoice without allocation as a non-blocking action with the excluded VAT", () => {
    const m = model([doc()], [expense({ id: "big", amount: 14160, vatAmount: 2160 })]);
    expect(m.blocking).toEqual([]);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]).toMatchObject({ code: "supplier_allocation_missing", excludedVat: 2160, control: { kind: "expense_allocation", expenseId: "big", current: "" } });
  });

  it("asks for the supplier invoice number of a digitless reference in a refund period", () => {
    const m = model(
      [doc({ subtotal: 100, vat: 18, total: 118 })],
      [expense({ id: "big", amount: 5900, vatAmount: 900 }), expense({ id: "r", reference: "חשבונית", amount: 118, vatAmount: 18 })],
    );
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0]).toMatchObject({ title: "חסר מספר חשבונית של הספק", control: { kind: "supplier_reference", expenseId: "r" } });
  });

  it("Layer 4: an in-app document gets a credit note, an imported or unconverted one goes to support", () => {
    const neg = { id: "neg", subtotal: -100, vat: 18, total: -82 };
    expect(model([doc(neg)], []).blocking.map((i) => i.control)).toEqual([{ kind: "credit_note", documentId: "neg" }]);
    expect(model([doc({ ...neg, importBatchId: "batch" })], []).blocking.map((i) => i.control)).toEqual([{ kind: "support", documentId: "neg", code: "sign_mismatch" }]);
    expect(model([doc({ id: "usd", currency: "USD" })], []).blocking.map((i) => i.control)).toEqual([{ kind: "support", documentId: "usd", code: "foreign_currency_missing_ils" }]);
  });

  it("puts non-blocking notes in their own collapsed list", () => {
    const m = model([doc({ id: "a" }), doc({ id: "b" })], []);
    expect(m.blocking).toEqual([]);
    expect(m.notes.map((i) => [i.code, i.control.kind])).toEqual([["possible_duplicate", "open_document"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/filing-fix-items.test.ts`
Expected: FAIL, cannot resolve `@/lib/filing-fix-items`.

- [ ] **Step 3: Write `src/lib/filing-fix-items.ts`**

```ts
// The "what's left before the download" model for /reports/vat. Pure: takes
// the PCN874 result plus the rows it was built from and returns grouped items,
// each with the one control that fixes it. The panel only renders this.
import type { Expense, InvoiceDocument } from "./types";
import { referenceDigits, sourceVatIdForPcn, type Pcn874Result, type PcnIssueCode, type PcnWarning } from "./ita/pcn874";

export type FixControl =
  | { kind: "supplier_tax_id"; expenseIds: string[]; current: string }
  | { kind: "supplier_reference"; expenseId: string; current: string }
  | { kind: "expense_allocation"; expenseId: string; current: string }
  | { kind: "expense_date"; expenseId: string; current: string }
  | { kind: "business_tax_id"; current: string }
  | { kind: "customer_tax_id"; documentId: string; current: string }
  | { kind: "credit_note"; documentId: string }
  | { kind: "support"; documentId?: string; code: PcnIssueCode }
  | { kind: "open_expense"; expenseId: string }
  | { kind: "open_document"; documentId: string }
  | { kind: "settings" }
  | { kind: "none" };

export type FixTier = "blocking" | "action" | "note";

export interface FilingFixItem {
  key: string;
  tier: FixTier;
  code: PcnIssueCode;
  title: string;
  messages: string[];
  labels: string[];
  control: FixControl;
  excludedVat?: number;
}

export interface FilingFixModel {
  blocking: FilingFixItem[];
  actions: FilingFixItem[];
  notes: FilingFixItem[];
}

export const FIX_TITLES: Record<PcnIssueCode, string> = {
  dealer_number_invalid: "מספר העוסק של העסק בהגדרות לא תקין",
  period_invalid: "תקופת הדיווח לא תקינה",
  period_not_whole_months: "יש לבחור חודשים מלאים",
  generation_date_invalid: "תאריך ההפקה לא תקין",
  exempt_business: "עוסק פטור אינו מגיש דיווח מפורט",
  period_length: "קובץ PCN874 מוגש לחודש אחד או לחודשיים",
  period_open: "התקופה עוד לא הסתיימה",
  field_overflow: "סכום גדול מדי לשדות הקובץ",
  file_structure: "הקובץ שנבנה לא עבר את בדיקת המבנה",
  date_invalid: "תאריך חסר או לא תקין",
  amount_invalid: "סכום חסר או לא תקין",
  expense_amount_invalid: "סכום ההוצאה או המע״מ לא תקינים",
  sign_mismatch: "סימני הסכום והמע״מ לא תואמים",
  type_sign_mismatch: "סימן הסכום לא תואם את סוג המסמך",
  zero_rated_with_vat: "מסמך בשיעור אפס שכולל מע״מ",
  foreign_currency_missing_ils: "חסרים סכומים בשקלים למסמך במטבע חוץ",
  customer_number_invalid: "מספר העוסק של הלקוח לא תקין",
  customer_number_missing: "חסר מספר עוסק של הלקוח",
  supplier_number_invalid: "מספר העוסק של הספק לא תקין",
  input_missing_supplier_details: "חסרים פרטי חשבונית הספק",
  refund_input_missing_supplier_details: "בדוח להחזר חסרים פרטי חשבונית הספק",
  reference_invalid: "מספר חשבונית הספק לא תקין",
  reference_multiple_groups: "באסמכתא יש כמה קבוצות ספרות",
  allocation_invalid: "מספר ההקצאה לא תקין",
  possible_duplicate: "ייתכן דיווח כפול",
  zero_vat_not_zero_rated: "מסמך מס בלי מע״מ שלא סומן בשיעור אפס",
  sale_allocation_missing: "מסמך מס מעל הסף בלי מספר הקצאה",
  supplier_allocation_missing: "מע״מ תשומות לא נכלל: חסר מספר הקצאה",
};

const CREDIT_NOTE_CODES = new Set<PcnIssueCode>(["sign_mismatch", "type_sign_mismatch", "zero_rated_with_vat"]);

/**
 * Layer 4. A document issued in this app is corrected with a credit note and a
 * new document. An imported one (another system's data) or one missing its
 * shekel amounts is a data fix, so it goes to support with the code only.
 */
export function documentRepairControl(doc: InvoiceDocument | undefined, documentId: string, code: PcnIssueCode): FixControl {
  const foreignWithoutIls = Boolean(doc?.currency && doc.currency !== "ILS") && (!Number.isFinite(doc?.subtotalIls) || !Number.isFinite(doc?.vatIls));
  if (!doc || doc.importBatchId || foreignWithoutIls || doc.type === "credit_note" || !CREDIT_NOTE_CODES.has(code)) {
    return { kind: "support", documentId, code };
  }
  return { kind: "credit_note", documentId };
}

export function buildFilingFixModel(
  result: Pick<Pcn874Result, "blockers" | "warnings">,
  data: { business: { taxId: string }; documents: readonly InvoiceDocument[]; expenses: readonly Expense[] },
): FilingFixModel {
  const documents = new Map(data.documents.map((d) => [d.id, d]));
  const expenses = new Map(data.expenses.map((e) => [e.id, e]));
  const items = new Map<string, FilingFixItem>();
  const suppliers = new Map<string, { name: string; hasNumber: boolean }>();

  function put(key: string, tier: FixTier, code: PcnIssueCode, control: FixControl, message: string, label?: string, excludedVat?: number) {
    const existing = items.get(key);
    if (!existing) {
      items.set(key, { key, tier, code, title: FIX_TITLES[code], messages: [message], labels: label ? [label] : [], control, excludedVat });
      return;
    }
    if (tier === "blocking") existing.tier = "blocking";
    if (!existing.messages.includes(message)) existing.messages.push(message);
    if (label && !existing.labels.includes(label)) existing.labels.push(label);
    if (control.kind === "supplier_tax_id" && existing.control.kind === "supplier_tax_id") {
      for (const id of control.expenseIds) if (!existing.control.expenseIds.includes(id)) existing.control.expenseIds.push(id);
    }
  }

  /** There is no suppliers table: same number, or same name when the number is empty, is one supplier. */
  function supplierGroup(w: PcnWarning, tier: FixTier) {
    const e = expenses.get(w.sourceId);
    const rawNumber = String(e?.supplierTaxId ?? "").trim();
    const digits = rawNumber.replace(/\D/g, "");
    const name = String(e?.supplier ?? "").replace(/\s+/g, " ").trim();
    const key = `supplier_tax_id:${digits ? `id:${digits}` : name ? `name:${name.toLowerCase()}` : `row:${w.sourceId}`}`;
    const known = suppliers.get(key);
    suppliers.set(key, { name: known?.name || name || "ספק לא ידוע", hasNumber: Boolean(known?.hasNumber || rawNumber) });
    put(key, tier, w.code, { kind: "supplier_tax_id", expenseIds: [w.sourceId], current: rawNumber }, w.message, w.sourceLabel);
  }

  function addExpenseItem(w: PcnWarning, tier: FixTier) {
    const e = expenses.get(w.sourceId);
    switch (w.code) {
      case "supplier_number_invalid":
        supplierGroup(w, tier);
        return;
      case "input_missing_supplier_details":
      case "refund_input_missing_supplier_details":
        if (!e || !sourceVatIdForPcn(e.supplierTaxId)) supplierGroup(w, tier);
        if (!e || !referenceDigits(e.reference))
          put(`supplier_reference:${w.sourceId}`, tier, w.code, { kind: "supplier_reference", expenseId: w.sourceId, current: e?.reference ?? "" }, w.message, w.sourceLabel);
        return;
      case "reference_invalid":
        put(`supplier_reference:${w.sourceId}`, tier, w.code, { kind: "supplier_reference", expenseId: w.sourceId, current: e?.reference ?? "" }, w.message, w.sourceLabel);
        return;
      case "allocation_invalid":
      case "supplier_allocation_missing":
        put(`expense_allocation:${w.sourceId}`, tier, w.code, { kind: "expense_allocation", expenseId: w.sourceId, current: e?.allocationNumber ?? "" }, w.message, w.sourceLabel, w.excludedVat);
        return;
      case "date_invalid":
        put(`expense_date:${w.sourceId}`, tier, w.code, { kind: "expense_date", expenseId: w.sourceId, current: e?.date ?? "" }, w.message, w.sourceLabel);
        return;
      default:
        put(`${tier}:${w.code}:${w.sourceId}`, tier, w.code, { kind: "open_expense", expenseId: w.sourceId }, w.message, w.sourceLabel);
    }
  }

  function addDocumentItem(w: PcnWarning, tier: FixTier) {
    const d = documents.get(w.sourceId);
    switch (w.code) {
      case "customer_number_invalid":
      case "customer_number_missing":
        // The document's own client_tax_id, never the client record: that is
        // the client's number today, not the one on the issued document.
        put(`customer_tax_id:${w.sourceId}`, tier, w.code, { kind: "customer_tax_id", documentId: w.sourceId, current: d?.clientTaxId ?? "" }, w.message, w.sourceLabel);
        return;
      case "sign_mismatch":
      case "type_sign_mismatch":
      case "zero_rated_with_vat":
      case "foreign_currency_missing_ils":
      case "date_invalid":
      case "amount_invalid":
      case "reference_invalid":
      case "allocation_invalid": {
        const control = documentRepairControl(d, w.sourceId, w.code);
        put(`${control.kind}:${w.sourceId}`, tier, w.code, control, w.message, w.sourceLabel);
        return;
      }
      default:
        put(`${tier}:${w.code}:${w.sourceId}`, tier, w.code, { kind: "open_document", documentId: w.sourceId }, w.message, w.sourceLabel);
    }
  }

  for (const blocker of result.blockers) {
    const control: FixControl =
      blocker.code === "dealer_number_invalid" ? { kind: "business_tax_id", current: data.business.taxId }
      : blocker.code === "exempt_business" ? { kind: "settings" }
      : blocker.code === "file_structure" || blocker.code === "field_overflow" ? { kind: "support", code: blocker.code }
      : { kind: "none" };
    put(`blocker:${blocker.code}`, "blocking", blocker.code, control, blocker.message);
  }
  for (const w of result.warnings) {
    const tier: FixTier = w.level === "error" ? "blocking" : w.level === "action" ? "action" : "note";
    if (w.source === "expense") addExpenseItem(w, tier);
    else addDocumentItem(w, tier);
  }

  for (const item of items.values()) {
    if (item.control.kind === "supplier_tax_id") {
      const s = suppliers.get(item.key)!;
      const count = item.control.expenseIds.length;
      item.title = `${s.hasNumber ? `מספר העוסק של ${s.name} לא תקין` : `חסר מספר עוסק ל-${s.name}`}${count > 1 ? ` (${count} הוצאות)` : ""}`;
    } else if (item.control.kind === "supplier_reference" && item.code !== "reference_invalid") {
      item.title = "חסר מספר חשבונית של הספק";
    }
  }

  const all = [...items.values()];
  // The byte-level self-check mostly repeats row problems (a missing number
  // becomes "record N has an invalid number"). Show it only when nothing
  // more specific is left; the download gate still counts it either way.
  const specific = all.filter((i) => i.tier === "blocking" && i.key !== "blocker:file_structure");
  return {
    blocking: all.filter((i) => i.tier === "blocking" && (i.key !== "blocker:file_structure" || specific.length === 0)),
    actions: all.filter((i) => i.tier === "action"),
    notes: all.filter((i) => i.tier === "note"),
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd /c/wtpcn && npx vitest run tests/filing-fix-items.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/wtpcn && git add src/lib/filing-fix-items.ts tests/filing-fix-items.test.ts && git commit -m "feat(vat-report): grouped what-is-left model with one fix per item" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Keep the report mounted while an inline fix refetches

Today `useFilingReportData` sets `data` to `null` on every refetch (`filing-report-data.ts`, first line inside the effect), so after each save `/reports/vat` unmounts into "טוען..." and the live count never shows.

**Files:**
- Modify: `src/lib/filing-report-data.ts` (the hook)

- [ ] **Step 1: Replace the hook**

In `src/lib/filing-report-data.ts` replace everything from `type Data = { businessId: string; includeExpenses: boolean; documents: InvoiceDocument[]; expenses: Expense[] };` to the end of the file with:

```ts
type Data = { businessId: string; includeExpenses: boolean; documents: InvoiceDocument[]; expenses: Expense[] };

/**
 * Reporting must never turn a failed/truncated request into a clean empty return.
 *
 * `keepPreviousWhileRefreshing` (the VAT report's inline fixes): a refetch keeps
 * showing the last complete dataset and reports `refreshing` so the caller can
 * hold the download until the new rows land. A failed refetch still drops the
 * data and surfaces the error.
 */
export function useFilingReportData(businessId: string, includeExpenses = true, keepPreviousWhileRefreshing = false) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const retry = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!keepPreviousWhileRefreshing) setData(null);
    setError("");
    setRefreshing(Boolean(businessId));
    if (businessId) Promise.all([
      loadReportRows("documents", FILING_COLUMNS.documents, businessId, controller.signal),
      includeExpenses ? loadReportRows("expenses", FILING_COLUMNS.expenses, businessId, controller.signal) : Promise.resolve([]),
    ]).then(([documents, expenses]) => {
      if (!active) return;
      setData({ businessId, includeExpenses, documents: documents.map(mapFilingDocument), expenses: expenses.map(mapFilingExpense) });
      setRefreshing(false);
    }).catch((err) => {
      if (!active) return;
      setData(null);
      setRefreshing(false);
      setError(err instanceof Error ? err.message : "טעינת נתוני הדוח נכשלה.");
    });
    return () => { active = false; controller.abort(); };
  }, [businessId, version, includeExpenses, keepPreviousWhileRefreshing]);
  useEffect(() => {
    const events = ["invoice-app:documents-changed", ...(includeExpenses ? ["invoice-app:expenses-changed"] : [])];
    events.forEach((event) => window.addEventListener(event, retry));
    return () => events.forEach((event) => window.removeEventListener(event, retry));
  }, [retry, includeExpenses]);
  return { data: data?.businessId === businessId && data.includeExpenses === includeExpenses ? data : null, error, retry, refreshing };
}
```

- [ ] **Step 2: Typecheck, lint, tests**

Run: `cd /c/wtpcn && npx tsc --noEmit && npx eslint src/lib/filing-report-data.ts && npx vitest run tests/invoice-report-preflight.test.ts tests/filing-rows.test.ts`
Expected: all exit 0.

- [ ] **Step 3: Commit**

```bash
cd /c/wtpcn && git add src/lib/filing-report-data.ts && git commit -m "feat(reports): optional keep-previous data while a filing report refetches" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Default period = last ended bi-month, no "current year"

Note for the planner: the period picker in `vat-period-report.tsx` drives the whole VAT report (tiles, form figures, expense table), not only PCN874, so removing "שנה נוכחית" removes the yearly view of those numbers too. Old `?period=this_year` links fall back to the default.

**Files:**
- Create: `src/lib/vat-report-period.ts`
- Modify: `src/app/(app)/reports/vat/page.tsx` (whole file)
- Modify: `src/components/vat-period-report.tsx` (imports, `Props`, `PeriodMode`/`MODE_LABELS` 38-46, state and range 56-77, `downloadPcn`, select options, download button `disabled`)
- Test: `tests/vat-report-period.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/vat-report-period.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_VAT_PERIOD_MODE, VAT_PERIOD_MODES, resolveVatPeriodMode, vatPeriodRange } from "@/lib/vat-report-period";

describe("VAT report period", () => {
  it("defaults to the last fully ended bi-monthly period and has no current-year mode", () => {
    expect(DEFAULT_VAT_PERIOD_MODE).toBe("last_2m");
    expect(VAT_PERIOD_MODES).not.toContain("this_year");
    expect(vatPeriodRange("last_2m", new Date(2026, 8, 14))).toMatchObject({ start: "2026-07-01", end: "2026-08-31" });
    expect(vatPeriodRange("last_2m", new Date(2026, 0, 5))).toMatchObject({ start: "2025-11-01", end: "2025-12-31" });
    expect(vatPeriodRange("last_month", new Date(2026, 8, 14))).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("prefers the URL, then the stored choice, then the default", () => {
    expect(resolveVatPeriodMode("this_2m", "last_month")).toBe("this_2m");
    expect(resolveVatPeriodMode(null, "last_month")).toBe("last_month");
    expect(resolveVatPeriodMode("this_year", "garbage")).toBe("last_2m");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/vat-report-period.test.ts`
Expected: FAIL, cannot resolve module.

- [ ] **Step 3: Write `src/lib/vat-report-period.ts`**

```ts
import { biMonthlyRange, singleMonthRange, type ReportRange } from "./ita/vat-periods";

// Periods the VAT report offers. No calendar year: PCN874 is a one- or
// two-month file, and a picker that opens on a period that has not ended
// locks the download on the first visit.
export type VatPeriodMode = "last_2m" | "this_2m" | "last_month" | "this_month";

export const VAT_PERIOD_MODES: readonly VatPeriodMode[] = ["last_2m", "this_2m", "last_month", "this_month"];

export const VAT_PERIOD_LABELS: Record<VatPeriodMode, string> = {
  last_2m: "תקופה דו-חודשית קודמת",
  this_2m: "תקופה דו-חודשית נוכחית",
  last_month: "חודש קודם",
  this_month: "חודש נוכחי",
};

/** There is no stored reporting cadence; the last ended bi-month fits most filers, a monthly filer switches once. */
export const DEFAULT_VAT_PERIOD_MODE: VatPeriodMode = "last_2m";

export const VAT_PERIOD_STORAGE_KEY = "invoice-app:vat-report-period";

export function isVatPeriodMode(value: unknown): value is VatPeriodMode {
  return typeof value === "string" && (VAT_PERIOD_MODES as readonly string[]).includes(value);
}

export function resolveVatPeriodMode(fromUrl: string | null, fromStorage: string | null): VatPeriodMode {
  if (isVatPeriodMode(fromUrl)) return fromUrl;
  if (isVatPeriodMode(fromStorage)) return fromStorage;
  return DEFAULT_VAT_PERIOD_MODE;
}

export function vatPeriodRange(mode: VatPeriodMode, today: Date): ReportRange {
  switch (mode) {
    case "last_2m": return biMonthlyRange(today, -1);
    case "this_2m": return biMonthlyRange(today, 0);
    case "last_month": return singleMonthRange(today, -1);
    case "this_month": return singleMonthRange(today, 0);
  }
}
```

- [ ] **Step 4: Rewrite the page**

Replace the whole content of `src/app/(app)/reports/vat/page.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { useFilingReportData } from "@/lib/filing-report-data";
import { useBusiness } from "@/lib/business-store";
import { VatPeriodReport } from "@/components/vat-period-report";
import { ReportPageHeader } from "@/components/report-page-header";
import {
  DEFAULT_VAT_PERIOD_MODE,
  VAT_PERIOD_STORAGE_KEY,
  resolveVatPeriodMode,
  type VatPeriodMode,
} from "@/lib/vat-report-period";

export default function VatReportPage() {
  const [mode, setMode] = useState<VatPeriodMode>(DEFAULT_VAT_PERIOD_MODE);
  // The period lives in the URL (?period=) so coming back from fixing an
  // expense or a document lands on the period the user was working on, and in
  // localStorage so a monthly filer switches once and it sticks.
  // Read from window on mount rather than useSearchParams, which would force a
  // Suspense boundary; the report itself only mounts once data has loaded.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(VAT_PERIOD_STORAGE_KEY);
    } catch {
      stored = null;
    }
    setMode(resolveVatPeriodMode(new URLSearchParams(window.location.search).get("period"), stored));
    setUrlRead(true);
  }, []);
  function changeMode(next: VatPeriodMode) {
    setMode(next);
    try {
      window.localStorage.setItem(VAT_PERIOD_STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode): the URL still carries the choice.
    }
    window.history.replaceState(window.history.state, "", `/reports/vat?period=${next}`);
  }
  const { business, ready: bizReady } = useBusiness();
  // Keep the report mounted while an inline fix refetches, so the panel's
  // count updates in place instead of flashing back to "טוען...".
  const { data, error, retry, refreshing } = useFilingReportData(business.id, true, true);

  if (error) return <div role="alert" className="card-soft p-6 space-y-3"><p>{error}</p><button onClick={retry} className="btn-primary">טען שוב</button></div>;
  if (!data || !bizReady || !urlRead) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  const filesVat = business.businessType === "authorized" || business.businessType === "company";

  return (
    <div className="space-y-6">
      <ReportPageHeader
        icon={Receipt}
        title={filesVat ? "דיווח מע״מ תקופתי" : "הצהרת עוסק פטור שנתית"}
        subtitle={
          filesVat
            ? "מע״מ עסקאות מול מע״מ תשומות לתקופת הדיווח, מוכן להעתקה לדיווח, כולל פירוט כל הוצאה."
            : "המחזור השנתי שמדווחים למע״מ פעם בשנה, מוכן להעתקה."
        }
      />
      <button type="button" onClick={retry} className="btn-secondary no-print">רענן נתונים ובדוק שוב</button>
      <VatPeriodReport headless selectedMode={mode} onPeriodChange={changeMode} business={business} documents={data.documents} expenses={data.expenses} refreshing={refreshing} />
    </div>
  );
}
```

- [ ] **Step 5: Update the report component**

In `src/components/vat-period-report.tsx`:

Replace `import { biMonthlyRange, singleMonthRange, yearRange } from "@/lib/ita/vat-periods";` with:

```tsx
import { DEFAULT_VAT_PERIOD_MODE, VAT_PERIOD_LABELS, VAT_PERIOD_MODES, vatPeriodRange, type VatPeriodMode } from "@/lib/vat-report-period";
```

Replace:

```tsx
  selectedMode?: PeriodMode;
  onPeriodChange?: (mode: PeriodMode) => void;
}

export type PeriodMode = "this_2m" | "last_2m" | "this_month" | "last_month" | "this_year";

const MODE_LABELS: Record<PeriodMode, string> = {
  this_2m: "תקופה דו-חודשית נוכחית",
  last_2m: "תקופה דו-חודשית קודמת",
  this_month: "חודש נוכחי",
  last_month: "חודש קודם",
  this_year: "שנה נוכחית",
};
```

with:

```tsx
  selectedMode?: PeriodMode;
  onPeriodChange?: (mode: PeriodMode) => void;
  /** The page is refetching after an inline fix: hold the download until the new rows land. */
  refreshing?: boolean;
}

export type PeriodMode = VatPeriodMode;
```

Replace `export function VatPeriodReport({ headless = false, business, documents, expenses, selectedMode, onPeriodChange }: Props) {` with:

```tsx
export function VatPeriodReport({ headless = false, business, documents, expenses, selectedMode, onPeriodChange, refreshing = false }: Props) {
```

Replace `  const [mode, setMode] = useState<PeriodMode>(selectedMode ?? "this_2m");` with:

```tsx
  const [mode, setMode] = useState<PeriodMode>(selectedMode ?? DEFAULT_VAT_PERIOD_MODE);
```

Replace:

```tsx
  const range = useMemo(() => {
    switch (mode) {
      case "this_2m": return biMonthlyRange(today, 0);
      case "last_2m": return biMonthlyRange(today, -1);
      case "this_month": return singleMonthRange(today, 0);
      case "last_month": return singleMonthRange(today, -1);
      case "this_year": return yearRange(today);
    }
    // unreachable, satisfies TS
    return biMonthlyRange(today, 0);
  }, [mode, today]);
```

with:

```tsx
  const range = useMemo(() => vatPeriodRange(mode, today), [mode, today]);
```

Replace `    if (pcnErrorCount > 0 || pcn.transactions.length === 0) return;` with:

```tsx
    if (refreshing || pcnErrorCount > 0 || pcn.transactions.length === 0) return;
```

Replace:

```tsx
            {(Object.keys(MODE_LABELS) as PeriodMode[]).map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
```

with:

```tsx
            {VAT_PERIOD_MODES.map((m) => (
              <option key={m} value={m}>{VAT_PERIOD_LABELS[m]}</option>
            ))}
```

Replace `                disabled={pcnErrorCount > 0}` with `                disabled={refreshing || pcnErrorCount > 0}`.

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `cd /c/wtpcn && npx vitest run tests/vat-report-period.test.ts && npx tsc --noEmit && npx eslint "src/app/(app)/reports/vat/page.tsx" src/components/vat-period-report.tsx`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
cd /c/wtpcn && git add src/lib/vat-report-period.ts "src/app/(app)/reports/vat/page.tsx" src/components/vat-period-report.tsx tests/vat-report-period.test.ts && git commit -m "feat(vat-report): open on the last ended bi-monthly period, remember the choice" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 16: `FilingFixPanel` component

There is no DOM test environment in this repo (vitest `environment: "node"`, `include: tests/**/*.test.ts`), so the panel's logic lives in Task 13's tested model and the component is verified by typecheck, lint and the E2E in Task 20.

Save paths used (all authenticated via the browser Supabase client under RLS):
- supplier number / supplier invoice number / allocation number / expense date: `updateExpenseFilingFields` (`src/lib/expense-store.ts`, Task 11), which broadcasts `invoice-app:expenses-changed` so `useFilingReportData` refetches.
- business number: `saveBusinessTaxId` (`src/lib/business-store.ts`, Task 11), which broadcasts `invoice-app:business-changed` so `useBusiness` refetches.
- customer number on an issued sale: `updateDocumentClientTaxId` (`src/lib/document-store.ts:549`, the `DocumentCustomerTaxEditor` path), which broadcasts `invoice-app:documents-changed`.

**Files:**
- Create: `src/components/filing-fix-panel.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronLeft, FileMinus, MessageCircle } from "lucide-react";
import { IsraeliDateInput } from "@/components/israeli-date-input";
import { BusinessNumberHintText } from "@/components/business-number-hint";
import { updateExpenseFilingFields } from "@/lib/expense-store";
import { updateDocumentClientTaxId } from "@/lib/document-store";
import { saveBusinessTaxId } from "@/lib/business-store";
import { normalizeBusinessNumber } from "@/lib/israeli-id";
import { referenceDigits, validPcnDate } from "@/lib/ita/pcn874";
import { formatCurrencyWhole } from "@/lib/format";
import { withReturn } from "@/lib/return-to";
import { filingDataFixMessage, supportWhatsappHref } from "@/lib/support-link";
import type { FilingFixItem, FilingFixModel, FixControl } from "@/lib/filing-fix-items";

const MARKS = /[\s.\-​-‏‪-‮⁦-⁩﻿]/g;
const onlyDigits = (value: string) => value.replace(/\D/g, "");
const israeliNumberProblem = (value: string) =>
  normalizeBusinessNumber(value).value ? null : "זה לא מספר עוסק ישראלי תקין. בדוק מול החשבונית.";

const LINK_BUTTON =
  "no-print inline-flex items-center gap-1.5 mt-2 min-h-[44px] px-3 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50";

interface Props {
  model: FilingFixModel;
  businessId: string;
  /** Where Layer 4 and "open" links come back to (same report, same period). */
  returnTo: string;
}

/** The single "what's left before the download" panel on /reports/vat. */
export function FilingFixPanel({ model, businessId, returnTo }: Props) {
  const [notesOpen, setNotesOpen] = useState(false);
  const count = model.blocking.length;
  const headline = count === 0 ? "הכל מוכן" : count === 1 ? "נשאר דבר אחד לפני ההורדה" : `נשארו ${count} דברים לפני ההורדה`;
  return (
    <div data-testid="filing-fix-panel" className="mt-3 space-y-3">
      <p role="status" className={`flex items-center gap-2 text-base font-bold ${count ? "text-rose-800" : "text-emerald-800"}`}>
        {count ? <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />}
        {headline}
      </p>
      {count > 0 && (
        <ul className="space-y-2">
          {model.blocking.map((item) => <FixItemCard key={item.key} item={item} businessId={businessId} returnTo={returnTo} />)}
        </ul>
      )}
      {model.actions.length > 0 && (
        <ul className="space-y-2">
          {model.actions.map((item) => <FixItemCard key={item.key} item={item} businessId={businessId} returnTo={returnTo} />)}
        </ul>
      )}
      {model.notes.length > 0 && (
        <div className="rounded-xl border border-stone-200 bg-white">
          <button
            type="button"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((open) => !open)}
            className="no-print w-full flex items-center justify-between gap-2 min-h-[44px] px-3 rounded-xl text-sm font-semibold text-stone-800 hover:bg-stone-50"
          >
            <span>כדאי לבדוק ({model.notes.length})</span>
            {notesOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronLeft className="w-4 h-4" aria-hidden="true" />}
          </button>
          {notesOpen && (
            <ul className="px-3 pb-3 space-y-2">
              {model.notes.map((item) => <FixItemCard key={item.key} item={item} businessId={businessId} returnTo={returnTo} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const TIER_STYLE: Record<FilingFixItem["tier"], string> = {
  blocking: "bg-rose-50 border-rose-200 text-rose-950",
  action: "bg-amber-50 border-amber-300 text-amber-950",
  note: "bg-stone-50 border-stone-200 text-stone-900",
};

function FixItemCard({ item, businessId, returnTo }: { item: FilingFixItem; businessId: string; returnTo: string }) {
  const title =
    item.excludedVat != null
      ? `מע״מ תשומות של ${formatCurrencyWhole(item.excludedVat)} לא נכלל בדוח כי לחשבונית אין מספר הקצאה`
      : item.title;
  return (
    <li data-fix-code={item.code} className={`rounded-xl border p-3 text-sm ${TIER_STYLE[item.tier]}`}>
      <p className="font-semibold leading-relaxed">{title}</p>
      {item.labels.length > 0 && <p className="mt-0.5 text-xs text-stone-700">{item.labels.join(" · ")}</p>}
      {item.excludedVat == null &&
        item.messages.map((message) => (
          <p key={message} className="mt-1 text-xs leading-relaxed text-stone-700">{message}</p>
        ))}
      <FixControlView control={item.control} businessId={businessId} returnTo={returnTo} />
    </li>
  );
}

function FixControlView({ control, businessId, returnTo }: { control: FixControl; businessId: string; returnTo: string }) {
  switch (control.kind) {
    case "supplier_tax_id":
      return (
        <InlineSave
          label="מספר עוסק של הספק"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showBusinessHint
          normalize={onlyDigits}
          validate={israeliNumberProblem}
          onSave={(value) => updateExpenseFilingFields(control.expenseIds, { supplierTaxId: value })}
        />
      );
    case "supplier_reference":
      return (
        <InlineSave
          label="מספר חשבונית הספק"
          initial={control.current}
          placeholder="1042"
          validate={(value) => {
            const ref = referenceDigits(value);
            return ref && ref.length <= 9 && Number(ref) > 0 ? null : "מספר החשבונית צריך לכלול מספר של עד 9 ספרות.";
          }}
          onSave={(value) => updateExpenseFilingFields([control.expenseId], { reference: value })}
        />
      );
    case "expense_allocation":
      return (
        <InlineSave
          label="מספר הקצאה"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          normalize={(value) => value.replace(MARKS, "")}
          validate={(value) => (/^\d{9}$/.test(value) && !/^0+$/.test(value) ? null : "מספר הקצאה הוא 9 ספרות בדיוק.")}
          onSave={(value) => updateExpenseFilingFields([control.expenseId], { allocationNumber: value })}
        />
      );
    case "expense_date":
      return <DateSave initial={control.current} onSave={(value) => updateExpenseFilingFields([control.expenseId], { date: value })} />;
    case "business_tax_id":
      return (
        <InlineSave
          label="מספר העוסק של העסק"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showBusinessHint
          normalize={onlyDigits}
          validate={israeliNumberProblem}
          onSave={(value) => saveBusinessTaxId(businessId, value)}
        />
      );
    case "customer_tax_id":
      return (
        <InlineSave
          label="מספר עוסק של הלקוח"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showBusinessHint
          normalize={onlyDigits}
          validate={israeliNumberProblem}
          onSave={(value) => updateDocumentClientTaxId(control.documentId, value)}
        />
      );
    case "credit_note":
      return (
        <Link href={withReturn("/documents/new/credit-note", returnTo, { from: control.documentId })} className={LINK_BUTTON}>
          <FileMinus className="w-4 h-4" aria-hidden="true" />
          הפק זיכוי ומסמך מתוקן
        </Link>
      );
    case "support":
      return (
        <a
          href={supportWhatsappHref(filingDataFixMessage(control.documentId, control.code))}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_BUTTON}
        >
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
          שלח לתמיכה לתיקון הנתונים
        </a>
      );
    case "open_expense":
      return <Link href={withReturn("/expenses", returnTo, { edit: control.expenseId })} className={LINK_BUTTON}>פתח את ההוצאה</Link>;
    case "open_document":
      return <Link href={withReturn(`/documents/${control.documentId}`, returnTo)} className={LINK_BUTTON}>פתח את המסמך</Link>;
    case "settings":
      return <Link href={withReturn("/settings", returnTo)} className={LINK_BUTTON}>פתח את ההגדרות</Link>;
    case "none":
      return null;
  }
}

function useInlineSave() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(task: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה. נסו שוב.");
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, setError, run };
}

function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-fix-save
      onClick={onClick}
      disabled={saving}
      className="no-print inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 hover:shadow-md disabled:opacity-50"
    >
      {saving ? "שומר..." : "שמור"}
    </button>
  );
}

function InlineSave({
  label,
  initial,
  placeholder,
  inputMode = "text",
  showBusinessHint = false,
  normalize = (value: string) => value.trim(),
  validate,
  onSave,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  inputMode?: "text" | "numeric";
  showBusinessHint?: boolean;
  normalize?: (value: string) => string;
  validate: (value: string) => string | null;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const { saving, error, setError, run } = useInlineSave();
  function save() {
    const next = normalize(value);
    const problem = validate(next);
    if (problem) {
      setError(problem);
      return;
    }
    void run(() => onSave(next));
  }
  return (
    <div className="no-print mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={label}
          dir="ltr"
          inputMode={inputMode}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="input-warm w-48 max-w-full text-sm py-2 px-3"
        />
        <SaveButton saving={saving} onClick={save} />
      </div>
      {showBusinessHint && <BusinessNumberHintText value={value} />}
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">{error}</p>}
    </div>
  );
}

function DateSave({ initial, onSave }: { initial: string; onSave: (value: string) => Promise<void> }) {
  const [value, setValue] = useState(validPcnDate(initial) ? initial : "");
  const { saving, error, setError, run } = useInlineSave();
  function save() {
    if (!validPcnDate(value)) {
      setError("הזן תאריך מלא ותקין.");
      return;
    }
    void run(() => onSave(value));
  }
  return (
    <div className="no-print mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <IsraeliDateInput aria-label="תאריך ההוצאה" value={value} onChange={(e) => setValue(e.target.value)} className="input-warm w-40 text-sm py-2 px-3" />
        <SaveButton saving={saving} onClick={save} />
      </div>
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `cd /c/wtpcn && npx tsc --noEmit && npx eslint src/components/filing-fix-panel.tsx`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
cd /c/wtpcn && git add src/components/filing-fix-panel.tsx && git commit -m "feat(vat-report): what-is-left panel with inline fixes" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Put the panel into the VAT report, one download gate

**Files:**
- Modify: `src/components/vat-period-report.tsx` (imports, `pcnProblems`/`pcnErrorCount` block, `downloadPcn`, the PCN874 section body, the download button)

- [ ] **Step 1: Imports**

Replace the lucide import block:

```tsx
import {
  Printer,
  Receipt,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Copy,
  Check,
  FileDown,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
```

with:

```tsx
import {
  Printer,
  Receipt,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Copy,
  Check,
  FileDown,
  ExternalLink,
} from "lucide-react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { FilingFixPanel } from "@/components/filing-fix-panel";
import { buildFilingFixModel } from "@/lib/filing-fix-items";
```

Replace `import { buildPcn874, validatePcn874Content, PCN_ENTRY_LABELS } from "@/lib/ita/pcn874";` with:

```tsx
import { buildPcn874, pcnCanDownload, PCN_ENTRY_LABELS } from "@/lib/ita/pcn874";
```

- [ ] **Step 2: One gate**

Replace:

```tsx
  // Whole-file blockers (dealer number, period shape, period still open) come
  // first; the byte-level self-check only matters once those are clear.
  const pcnProblems = useMemo(
    () => [...new Set([...pcn.blockers.map((b) => b.message), ...validatePcn874Content(pcn.content)])],
    [pcn.blockers, pcn.content],
  );
  const pcnErrorCount = pcnProblems.length + pcn.warnings.filter((warning) => warning.level === "error").length;
```

with:

```tsx
  // What is left before the download, grouped by the fix. The panel and the
  // button read the same result, so the count and the gate cannot disagree.
  const fixModel = useMemo(
    () => buildFilingFixModel(pcn, { business, documents, expenses }),
    [pcn, business, documents, expenses],
  );
  const canDownload = pcnCanDownload(pcn) && !refreshing;
```

Replace `    if (refreshing || pcnErrorCount > 0 || pcn.transactions.length === 0) return;` with:

```tsx
    if (!canDownload) return;
```

- [ ] **Step 3: Replace the mixed list with the panel**

Replace the block that starts with `        <p role="status" className="mt-3 text-sm font-semibold">` and ends with the closing `            )}` of `{pcn.warnings.length > 0 && (` (the whole `<ul>` of warnings, just before `        {pcn.transactions.length === 0 ? (`) with:

```tsx
        <FilingFixPanel model={fixModel} businessId={business.id} returnTo={returnTo} />
        <p className="mt-2 text-xs text-stone-600">הבדיקה אינה אישור קליטה של רשות המסים. הרשאות דיווח, מצב התיק ודיווחים שכבר הוגשו נבדקים באתר הרשות.</p>
```

Delete the "file not available" box:

```tsx
            {pcnProblems.length > 0 && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                <p className="font-semibold">הקובץ אינו זמין להורדה:</p>
                <ul className="list-disc mt-1 pr-5 space-y-0.5">
                  {pcnProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
```

- [ ] **Step 4: The button**

Replace:

```tsx
              <button
                type="button"
                onClick={downloadPcn}
                disabled={refreshing || pcnErrorCount > 0}
```

with:

```tsx
              <button
                type="button"
                data-testid="pcn874-download"
                onClick={downloadPcn}
                disabled={!canDownload}
```

Replace `                {pcnErrorCount > 0 ? "יש לתקן שגיאות לפני ההורדה" : "הורד קובץ PCN874"}` with:

```tsx
                {canDownload ? "הורד קובץ PCN874" : refreshing ? "מעדכן את הבדיקה..." : "יש להשלים את מה שנשאר לפני ההורדה"}
```

- [ ] **Step 5: Confirm nothing stale remains, typecheck, lint, tests**

Run: `cd /c/wtpcn && npx tsc --noEmit && npx eslint src/components/vat-period-report.tsx && npx vitest run tests/pcn874.test.ts tests/filing-fix-items.test.ts`
Expected: exit 0. Then use the Grep tool on `src/components/vat-period-report.tsx` for `pcnProblems|pcnErrorCount|validatePcn874Content|AlertTriangle|AlertCircle`: expected no matches. `Link` and `withReturn` are still used by the empty-expenses link, so their imports stay.

- [ ] **Step 6: Commit**

```bash
cd /c/wtpcn && git add src/components/vat-period-report.tsx && git commit -m "feat(vat-report): replace the mixed warning list with the what-is-left panel" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 18: Guard aggregation logic

**Files:**
- Create: `src/lib/filing-guard.ts`
- Test: `tests/filing-guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/filing-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { countAffectedBusinesses, formatGuardPush, formatGuardTable, newOrGrownCodes } from "@/lib/filing-guard";

describe("filing guard", () => {
  it("counts each code once per business", () => {
    expect(countAffectedBusinesses([["a", "b", "a"], ["a"], []])).toEqual({ a: 2, b: 1 });
  });

  it("reports only codes that are new or grew", () => {
    expect(newOrGrownCodes({ a: 2, b: 1 }, { a: 2, b: 3, c: 1 })).toEqual([
      { code: "b", before: 1, after: 3 },
      { code: "c", before: 0, after: 1 },
    ]);
    expect(newOrGrownCodes({ a: 2 }, { a: 1 })).toEqual([]);
  });

  it("prints codes and counts only", () => {
    expect(formatGuardTable({ b: 1, a: 2 })).toBe("code\tbusinessesAffected\na\t2\nb\t1");
    expect(formatGuardTable({})).toBe("code\tbusinessesAffected\n(none)");
    const text = formatGuardPush([{ code: "supplier_number_invalid", before: 0, after: 2 }], "יולי-אוגוסט 2026");
    expect(text).toContain("supplier_number_invalid: 0 -> 2");
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtpcn && npx vitest run tests/filing-guard.test.ts`
Expected: FAIL, cannot resolve module.

- [ ] **Step 3: Write `src/lib/filing-guard.ts`**

```ts
// Pure half of scripts/filing-preflight-guard.mjs. Only codes and business
// counts pass through here: messages can embed amounts and never leave the
// guard process.

export type GuardCounts = Record<string, number>;

export interface GuardChange {
  code: string;
  before: number;
  after: number;
}

export function countAffectedBusinesses(perBusiness: readonly (readonly string[])[]): GuardCounts {
  const counts: GuardCounts = {};
  for (const codes of perBusiness) for (const code of new Set(codes)) counts[code] = (counts[code] ?? 0) + 1;
  return counts;
}

/** Zero-noise: a code is worth a push only when it is new or more businesses hit it than last time. */
export function newOrGrownCodes(previous: GuardCounts, next: GuardCounts): GuardChange[] {
  return Object.entries(next)
    .filter(([code, after]) => after > (previous[code] ?? 0))
    .map(([code, after]) => ({ code, before: previous[code] ?? 0, after }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function formatGuardTable(counts: GuardCounts): string {
  const rows = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return ["code\tbusinessesAffected", ...(rows.length ? rows.map(([code, n]) => `${code}\t${n}`) : ["(none)"])].join("\n");
}

export function formatGuardPush(changes: readonly GuardChange[], periodLabel: string): string {
  return [
    `דיווח מפורט PCN874, ${periodLabel}: בדיקה חוסמת חדשה או מתרחבת`,
    ...changes.map((c) => `${c.code}: ${c.before} -> ${c.after} עסקים`),
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtpcn && npx vitest run tests/filing-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/wtpcn && git add src/lib/filing-guard.ts tests/filing-guard.test.ts && git commit -m "feat(guard): pure aggregation for the filing preflight guard" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Nightly guard script

**Files:**
- Create: `scripts/filing-preflight-guard.mjs`
- Modify: `.gitignore` (append)

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Nightly PCN874 preflight guard.
 *
 * For every VAT-filing business, builds the PCN874 file for the last ended
 * bi-monthly period with the SAME exported builder /reports/vat uses, and
 * counts which blocking codes hit how many businesses. Only
 * { code, businessesAffected } ever leaves this process: messages can embed
 * amounts, so they are never printed, pushed or stored.
 *
 * Zero-noise: one Gaya push when a code is new or its count grew since the
 * last successful run (state in .filing-preflight-guard-state.json, gitignored).
 *
 * Service role via scripts/admin-unattended.mjs, so every run is logged in
 * admin_access_log as automation.
 *
 *   node --import tsx scripts/filing-preflight-guard.mjs            # real run
 *   node --import tsx scripts/filing-preflight-guard.mjs --dry-run  # table only, no push, no state
 *   node --import tsx scripts/filing-preflight-guard.mjs --no-push  # print the push text, no state
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { adminClientUnattended } from "./admin-unattended.mjs";
import { loadEnv } from "./lib/admin-core.mjs";
import { buildPcn874, pcnBlockingCodes } from "../src/lib/ita/pcn874.ts";
import { biMonthlyRange } from "../src/lib/ita/vat-periods.ts";
import { FILING_COLUMNS, mapFilingDocument, mapFilingExpense } from "../src/lib/filing-rows.ts";
import { countAffectedBusinesses, formatGuardPush, formatGuardTable, newOrGrownCodes } from "../src/lib/filing-guard.ts";

const STATE = new URL("../.filing-preflight-guard-state.json", import.meta.url);
const PAGE = 1000;
const dryRun = process.argv.includes("--dry-run");
const noPush = process.argv.includes("--no-push");
const env = loadEnv();
const sb = adminClientUnattended("filing-preflight-guard.mjs");

async function readAll(build, label) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    // Never echo error details: keep the output to table names and counts.
    if (error || !data) throw new Error(`${label} read failed`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function main() {
  const now = new Date();
  const range = biMonthlyRange(now, -1);
  const businesses = await readAll(
    () => sb.from("businesses").select("id,tax_id,business_type").in("business_type", ["authorized", "company"]).order("id", { ascending: true }),
    "businesses",
  );

  const perBusiness = [];
  let loadFailures = 0;
  for (const b of businesses) {
    try {
      const [docRows, expenseRows] = await Promise.all([
        readAll(() => sb.from("documents").select(FILING_COLUMNS.documents).eq("business_id", b.id).order("id", { ascending: true }), "documents"),
        readAll(() => sb.from("expenses").select(FILING_COLUMNS.expenses).eq("business_id", b.id).order("id", { ascending: true }), "expenses"),
      ]);
      const result = buildPcn874({
        business: { taxId: b.tax_id ?? "", businessType: b.business_type },
        documents: docRows.map(mapFilingDocument),
        expenses: expenseRows.map(mapFilingExpense),
        range,
        generatedOn: now,
      });
      // A business with nothing in the period would only report its settings; skip it.
      if (result.transactions.length === 0 && result.warnings.length === 0) continue;
      perBusiness.push(pcnBlockingCodes(result));
    } catch {
      loadFailures += 1;
    }
  }

  const counts = countAffectedBusinesses(perBusiness);
  if (loadFailures) counts.guard_load_failed = loadFailures;
  console.log(`PCN874 preflight guard, period ${range.start}..${range.end}, businesses with activity: ${perBusiness.length}`);
  console.log(formatGuardTable(counts));
  if (dryRun) return;

  const previous = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")).counts ?? {} : {};
  const changes = newOrGrownCodes(previous, counts);
  const saveState = () => writeFileSync(STATE, JSON.stringify({ updatedAt: now.toISOString(), periodEnd: range.end, counts }, null, 2) + "\n");

  if (changes.length === 0) {
    saveState();
    console.log("no new or grown codes, staying quiet");
    return;
  }
  const text = formatGuardPush(changes, range.label);
  if (noPush) {
    console.log(text);
    return;
  }
  if (!env.GAYA_PUSH_URL || !env.GAYA_PUSH_TOKEN) {
    console.error("GAYA_PUSH_URL / GAYA_PUSH_TOKEN missing in .env.local, cannot push");
    process.exitCode = 1;
    return;
  }
  try {
    const res = await fetch(env.GAYA_PUSH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GAYA_PUSH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, source: "invoice-app-filing-guard" }),
    });
    console.log(`[gaya push] ${res.status}`);
    // State moves only after the push left, so a failed push retries tomorrow.
    if (res.ok) saveState();
    else process.exitCode = 1;
  } catch {
    console.error("[gaya push failed]");
    process.exitCode = 1;
  }
}

// process.exitCode, never process.exit(): exiting while undici holds sockets
// crashes on Windows with a libuv assertion (see check-subscriber-threshold.mjs).
await main();
```

- [ ] **Step 2: Ignore the state files**

Append to `.gitignore`:

```
# nightly filing preflight guard state and the QA E2E snapshot (local only)
.filing-preflight-guard-state.json
.qa-filing-fix-snapshot.json
```

- [ ] **Step 3: Dry run against production (aggregates only)**

Run: `cd /c/wtpcn && node --import tsx scripts/filing-preflight-guard.mjs --dry-run`
Expected: a first line `PCN874 preflight guard, period YYYY-MM-01..YYYY-MM-DD, businesses with activity: N`, then a `code<TAB>businessesAffected` table (or `(none)`), exit code 0, no push, no `.filing-preflight-guard-state.json` created. If tsx fails to resolve an import, report the exact error; do not switch to a different runner without telling the planner.

- [ ] **Step 4: Commit**

```bash
cd /c/wtpcn && git add scripts/filing-preflight-guard.mjs .gitignore && git commit -m "feat(guard): nightly PCN874 preflight guard with zero-noise push" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Scheduling is NOT part of this plan: existing invoice-app tasks run from `C:\Users\asafk\projects\invoice-app`, which will not have this script until the branch lands. After landing, the planner registers it (for example `schtasks /create /tn "invoice-app-filing-guard" /sc daily /st 03:30 /tr "cmd /c cd /d C:\Users\asafk\projects\invoice-app && node --import tsx scripts\filing-preflight-guard.mjs" /f`).

---

### Task 20: E2E on the QA tenant, screenshots, guard push once

Uses the Lynkeus QA user (`C:/Users/asafk/agents/lynkeus/state/keys.json`: `email`, `password`, `businessId`) by session injection. The QA business is normally `exempt` with an empty business number; the seed switches it to `authorized` and the clean step restores it. Everything seeded is synthetic and tagged `description = "qa-filing-fix"`.

**Files:**
- Create: `scripts/qa-seed-filing-fix.mjs`, `scripts/qa-filing-fix-e2e.mjs`

- [ ] **Step 1: Write the seed script**

```js
// QA helper for the friendly filing report E2E. Lynkeus QA tenant only, synthetic rows.
//   seed:  make the QA business a VAT filer with an EMPTY business number and park
//          three expenses in the last ended bi-monthly period:
//          two for one supplier with a bad-checksum number (one grouped fix),
//          one above the allocation threshold without an allocation number.
//   clean: remove those expenses and restore business_type / tax_id.
//
//   node scripts/qa-seed-filing-fix.mjs --reason "QA: filing fix E2E" seed
//   node scripts/qa-seed-filing-fix.mjs --reason "QA: filing fix E2E" clean
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { supabase } from "./admin.mjs";

const mode = process.argv.includes("clean") ? "clean" : "seed";
const keys = JSON.parse(fs.readFileSync("C:/Users/asafk/agents/lynkeus/state/keys.json", "utf8"));
const SNAPSHOT = new URL("../.qa-filing-fix-snapshot.json", import.meta.url);
const TAG = "qa-filing-fix";

const { data: biz, error: bizError } = await supabase.from("businesses").select("id, business_type, tax_id").eq("id", keys.businessId).maybeSingle();
if (bizError) throw bizError;
if (!biz) throw new Error("QA business not found");

const { error: removeError } = await supabase.from("expenses").delete().eq("business_id", biz.id).eq("description", TAG);
if (removeError) throw removeError;

if (mode === "clean") {
  if (fs.existsSync(SNAPSHOT)) {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    const { error } = await supabase.from("businesses").update({ business_type: snap.business_type, tax_id: snap.tax_id }).eq("id", biz.id);
    if (error) throw error;
    fs.rmSync(SNAPSHOT);
  }
  const { data: restored } = await supabase.from("businesses").select("business_type").eq("id", biz.id).maybeSingle();
  console.log(`QA business is ${restored?.business_type}; seeded expenses removed`);
  process.exit(0);
}

if (!fs.existsSync(SNAPSHOT)) fs.writeFileSync(SNAPSHOT, JSON.stringify({ business_type: biz.business_type, tax_id: biz.tax_id ?? "" }));
const { error: bizUpdateError } = await supabase.from("businesses").update({ business_type: "authorized", tax_id: "" }).eq("id", biz.id);
if (bizUpdateError) throw bizUpdateError;

const now = new Date();
let period = Math.floor(now.getMonth() / 2) - 1;
let year = now.getFullYear();
if (period < 0) {
  period += 6;
  year -= 1;
}
const first = period * 2;
const iso = (month0, day) => `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const rows = [
  { date: iso(first, 12), supplier: "ספק בדיקה QA", supplier_tax_id: "513333337", reference: "INV-5001", amount: 2360, vat_amount: 360 },
  { date: iso(first + 1, 8), supplier: "ספק בדיקה QA", supplier_tax_id: "513333337", reference: "INV-5002", amount: 2360, vat_amount: 360 },
  { date: iso(first + 1, 15), supplier: "ספק הקצאה QA", supplier_tax_id: "514993666", reference: "A-9001", amount: 14160, vat_amount: 2160 },
].map((row) => ({ id: randomUUID(), business_id: biz.id, category: "אחר", description: TAG, is_equipment: false, source: "manual", ...row }));

const { error: insertError } = await supabase.from("expenses").insert(rows);
if (insertError) throw insertError;
console.log(`seeded ${rows.length} expenses in ${iso(first, 1)}..${iso(first + 1, 28)}; QA business is authorized with an empty business number`);
```

- [ ] **Step 2: Write the E2E driver**

```js
// E2E for the friendly filing report on the Lynkeus QA tenant: session
// injection, fix the business number and a grouped supplier number inline on
// /reports/vat, download the PCN874 file and check it, save the allocation
// number, and write desktop + mobile screenshots for reading.
//
//   BASE=http://localhost:3107 OUT=C:/Users/asafk/AppData/Local/Temp/filing-e2e node scripts/qa-filing-fix-e2e.mjs
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import { loadEnv } from "./lib/admin-core.mjs";

const BASE = process.env.BASE || "http://localhost:3107";
const OUT = process.env.OUT;
if (!OUT) {
  console.error("usage: OUT=<dir> [BASE=http://localhost:3107] node scripts/qa-filing-fix-e2e.mjs");
  process.exit(1);
}
const downloads = path.join(OUT, "downloads");
fs.mkdirSync(downloads, { recursive: true });

const env = loadEnv();
const keys = JSON.parse(fs.readFileSync("C:/Users/asafk/agents/lynkeus/state/keys.json", "utf8"));
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error: authError } = await anon.auth.signInWithPassword({ email: keys.email, password: keys.password });
if (authError || !auth.session) {
  console.error("QA sign-in failed");
  process.exit(1);
}
const storageKey = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  console.error("watchdog: E2E ran longer than 8 minutes");
  process.exit(2);
}, 480_000);

const DESKTOP = { width: 1440, height: 1000, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const PANEL = '[data-testid="filing-fix-panel"]';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  userDataDir: path.join(OUT, `profile-${process.pid}`),
  args: ["--no-first-run", "--disable-extensions"],
});

try {
  const page = await browser.newPage();
  const cdp = await browser.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });

  async function open(viewport) {
    await page.setViewport(viewport);
    await page.goto(`${BASE}/reports/vat?period=last_2m`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector(PANEL, { timeout: 180_000 });
    // Lynkeus lesson: never shoot before the viewport has really settled.
    await page.waitForFunction((w) => window.innerWidth === w, { timeout: 10_000 }, viewport.width);
    await page.$eval(PANEL, (el) => el.scrollIntoView({ block: "start" }));
    await sleep(800);
  }
  const status = () => page.$eval(`${PANEL} [role="status"]`, (el) => el.textContent.trim());
  async function fixInline(code, label, value) {
    const selector = `[data-fix-code="${code}"] input[aria-label="${label}"]`;
    const input = await page.waitForSelector(selector, { timeout: 30_000 });
    await input.click({ clickCount: 3 });
    await input.type(value);
    const save = await page.$(`[data-fix-code="${code}"] [data-fix-save]`);
    await save.click();
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 90_000 }, selector);
  }
  async function step(label, fn) {
    try {
      await fn();
      check(true, label);
    } catch (err) {
      check(false, `${label}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.evaluate((key, value) => localStorage.setItem(key, value), storageKey, JSON.stringify(auth.session));

  await open(DESKTOP);
  console.log("status before:", await status());
  await page.screenshot({ path: path.join(OUT, "desktop-before.png") });
  const groupText = await page.$eval('[data-fix-code="supplier_number_invalid"]', (el) => el.textContent).catch(() => "");
  check(groupText.includes("2 הוצאות"), "two expenses of one supplier are one item");
  check(Boolean(await page.$('[data-fix-code="supplier_allocation_missing"]')), "input without an allocation number is a visible item");

  await open(MOBILE);
  await page.screenshot({ path: path.join(OUT, "mobile-before.png") });

  await open(DESKTOP);
  await step("business number fixed inline", () => fixInline("dealer_number_invalid", "מספר העוסק של העסק", "512345679"));
  await step("supplier number fixed inline for both expenses", () => fixInline("supplier_number_invalid", "מספר עוסק של הספק", "513333336"));
  const after = await status();
  check(after === "הכל מוכן", `panel reports ready (got "${after}")`);

  await step("PCN874 file downloads with the fixed numbers", async () => {
    const button = await page.waitForSelector('[data-testid="pcn874-download"]:not([disabled])', { timeout: 60_000 });
    await button.click();
    const deadline = Date.now() + 30_000;
    let file;
    while (!file && Date.now() < deadline) {
      file = fs.readdirSync(downloads).find((name) => /^PCN874_\d{9}_\d{6}\.txt$/.test(name));
      if (!file) await sleep(500);
    }
    if (!file) throw new Error("no PCN874 file in downloads");
    const lines = fs.readFileSync(path.join(downloads, file), "latin1").split("\r\n");
    if (!lines[0].startsWith("O512345679")) throw new Error("header does not carry the fixed business number");
    if (!lines.some((l) => l.startsWith("T513333336"))) throw new Error("no T record with the fixed supplier number");
    if (lines.some((l) => l.startsWith("T514993666"))) throw new Error("the input without an allocation number is in the file");
  });

  await page.$eval(PANEL, (el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(OUT, "desktop-after-fixes.png") });
  await step("allocation number restores the input", () => fixInline("supplier_allocation_missing", "מספר הקצאה", "111222333"));
  await page.screenshot({ path: path.join(OUT, "desktop-after-allocation.png") });
  await open(MOBILE);
  await page.screenshot({ path: path.join(OUT, "mobile-after.png") });
} finally {
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS");
process.exitCode = failures.length ? 1 : 0;
```

- [ ] **Step 3: Start a local dev server (webpack, not Turbopack: the node_modules junction breaks Turbopack)**

Run in background: `cd /c/wtpcn && npx next dev --webpack -p 3107`
Then poll until ready: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3107/login` returns `200` (first compile can take a few minutes). If `next dev` rewrites `AGENTS.md`, leave it out of commits (`git restore AGENTS.md` at the end). If the server wedges (no response in 60 s), stop and report; do not push a preview branch.

- [ ] **Step 4: Seed the QA tenant**

Run: `cd /c/wtpcn && node scripts/qa-seed-filing-fix.mjs --reason "QA: filing fix E2E" seed`
Expected: `seeded 3 expenses in ...; QA business is authorized with an empty business number`.

- [ ] **Step 5: Guard sees the seeded codes (dry run only, per coordinator: no real push)**

Run: `cd /c/wtpcn && node --import tsx scripts/filing-preflight-guard.mjs --dry-run`
Expected: the table lists at least `dealer_number_invalid` and `supplier_number_invalid` with a count of 1 or more, no push, no state file. The zero-noise diff logic is covered by `tests/filing-guard.test.ts`.

- [ ] **Step 6: Run the E2E**

Run: `cd /c/wtpcn && BASE=http://localhost:3107 OUT=C:/Users/asafk/AppData/Local/Temp/filing-e2e node scripts/qa-filing-fix-e2e.mjs`
Expected: every line `PASS`, final `ALL PASS`, exit 0. If "panel reports ready" fails because of pre-existing QA data in the period, list the remaining `data-fix-code` values from the screenshot and report them to the planner instead of changing the seed.

- [ ] **Step 7: Read every screenshot**

Use the Read tool on each of `C:/Users/asafk/AppData/Local/Temp/filing-e2e/desktop-before.png`, `mobile-before.png`, `desktop-after-fixes.png`, `desktop-after-allocation.png`, `mobile-after.png`. Check and write down per image: Hebrew text sharp and RTL; headline shows the count before and "הכל מוכן" after; the grouped supplier item and the amber allocation item are fully visible (no clipping or overlap); inline input + "שמור" fit at 390 px (button wraps below the input, not off-screen); download button enabled after fixes; no raw error text. Any defect: fix in `filing-fix-panel.tsx`, commit, re-run from Step 4 (clean first).

- [ ] **Step 8: Clean up the QA tenant and stop the server**

Run: `cd /c/wtpcn && node scripts/qa-seed-filing-fix.mjs --reason "QA: filing fix E2E" clean`
Expected: `QA business is exempt; seeded expenses removed`.
Stop the dev server started in Step 3 (find the PID with `netstat -ano | grep :3107`, then `taskkill //PID <pid> //T //F`).

- [ ] **Step 9: Commit**

```bash
cd /c/wtpcn && git add scripts/qa-seed-filing-fix.mjs scripts/qa-filing-fix-e2e.mjs && git commit -m "test(vat-report): QA seed and E2E for inline filing fixes" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Full verification and production build

**Files:** none new (fixes only if something fails)

- [ ] **Step 1: Whole test suite**

Run: `cd /c/wtpcn && npx vitest run`
Expected: all test files pass.

- [ ] **Step 2: Typecheck and hooks lint (same gates as the pre-push hook)**

Run: `cd /c/wtpcn && npx tsc --noEmit && npx eslint src/`
Expected: both exit 0.

- [ ] **Step 3: Dash scan of everything this plan touched**

Use the Grep tool with pattern `[\u2013\u2014]` over `src/`, `scripts/filing-preflight-guard.mjs`, `scripts/qa-seed-filing-fix.mjs`, `scripts/qa-filing-fix-e2e.mjs` and `tests/`. Expected: no matches in files changed by this plan (replace any hit with a plain hyphen).

- [ ] **Step 4: Production build**

Run: `cd /c/wtpcn && npx next build --webpack`
Expected: exit 0, `/reports/vat` listed in the route table.

- [ ] **Step 5: Review passes required by AGENTS.md**

Run the `simplify` skill on the diff `git diff origin/master...HEAD` (reuse / quality / efficiency) and the `desktop-polish` and `mobile-polish` skills on `/reports/vat` (the panel adds new UI). Apply only findings that keep all tests green; commit each fix separately with the trailer.

- [ ] **Step 6: Final commit if anything changed, then stop (no push)**

```bash
cd /c/wtpcn && git status --short && git log --oneline origin/master..HEAD
```

Expected: clean tree (except an untouched `AGENTS.md` if `next dev` rewrote it; restore it with `git restore AGENTS.md`), and one commit per task above the two design-doc commits.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| `normalizeBusinessNumber` with reasons, strict, pads | 1 |
| `sourceVatIdForPcn` becomes a wrapper; builder supplier/customer sites use it | 4 |
| `client-picker` `normalizeTaxId` pads | 2 |
| Layer 1 hints in client + expense forms, save-time 9-digit-only rewrite, no backfill | 9, 10 |
| Layer 2: no-VAT expenses skipped before amount/sign checks | 5 |
| Layer 2: digitless reference with VAT < 300 in non-refund period to K | 5 |
| Still blocking: broken dates, non-9-digit allocation, refund-period digitless reference | 5 (tests) |
| Supplier allocation missing: VAT excluded, visible item, download allowed, tests 242/354 changed | 6, 13, 16 |
| Default period last ended bi-month, URL + localStorage, no "current year" | 15 |
| "What's left" panel: header count, grouping by supplier number or name, inline controls (supplier number, invoice number, allocation, date, business number, customer number via `updateDocumentClientTaxId`) | 11, 13, 16, 17 |
| Non-blocking notes collapsed | 13, 16 |
| Live count after each save | 14, 16 |
| Layer 4 credit note vs support (imported, foreign without ILS) | 7, 12, 13, 16 |
| Stable `code` on every warning/blocker | 3 |
| Nightly guard, same exported function, aggregates only, zero-noise push | 18, 19, 20 |
| `document-store` `*_ils` fix + consumer | 8 |
| E2E + desktop/mobile screenshots read; guard pushes once then quiet | 20 |
| `npx next build --webpack` | 21 |

Known gaps, deliberately not in this plan (see the planner report): the second half of Layer 4 ("then a new document prefilled with the corrected field highlighted") and registering the scheduled task.
