# Friendly Filing Reports - Phases 2 and 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The מבנה אחיד export writes correct shekel amounts, padded business numbers, collision-free accounts and capped rounding lines, and fixes what is left inline on `/reports`; the invoices-period report never blocks the accountant's download but shows and stamps every finding that can change its totals.

**Architecture:** Pure helpers (`amounts.ts`, `account-keys.ts`, `issues.ts`) feed both the uniform builder and its preflight, so the file and the check cannot disagree. One `checkUniformExport` entry point serves the route and the nightly guard. Both reports render the Phase 1 `FilingFixPanel` over small pure models built on a shared `createFixCollector`. The invoices-period report gets a pure rows/stamp/sheet module so the screen, the Excel file and the PDF say the same thing.

**Tech Stack:** Next.js 16 (non-standard, see AGENTS.md), React 19, Supabase JS, Vitest 4 (`vmForks`, node env), TypeScript, iconv-lite, exceljs, jszip, tsx, puppeteer-core for E2E.

**Spec:** `docs/superpowers/specs/2026-09-15-friendly-filing-reports-phase2-3-design.md`

**Working rules for the executor**

- Work only in `C:\wtp2` (detached worktree). Its `node_modules` is a junction to the main checkout: never delete, move or `rm -rf` it, and never run `npm install` here.
- Tests: `cd /c/wtp2 && npx vitest run <file>`. Typecheck: `cd /c/wtp2 && npx tsc --noEmit`.
- The Bash tool blocks commands containing the words "credit" or "checkout" (money-guard false positive). Use Read/Grep/Edit for code that mentions credit notes, keep those words out of commit messages and shell commands, and use `git switch` / `git restore` instead of the blocked git verb.
- Never type an em dash or en dash anywhere (code, comments, commit messages). Plain hyphen only.
- Commit after every task. Never push. Every commit message ends with the trailer shown in the task.
- Operator privacy: scripts that touch production print codes and counts only, never tenant content. Service-role scripts take `--reason`.
- `tsc` is expected to fail ONLY in `src/app/(app)/reports/invoices-period/page.tsx` between Task 12 and Task 15 (the page moves to the new issue type in Task 15). Every other task ends with a clean `tsc`.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/uniform-structure/issues.ts` | create | uniform issue codes, `UniformIssue`, Hebrew titles, download gate, blocking codes |
| `src/lib/uniform-structure/account-keys.ts` | create | one id-to-key map for every B110 row and B100 posting |
| `src/lib/uniform-structure/amounts.ts` | create | shekel amounts, converted lines, capped journal rounding |
| `src/lib/uniform-structure/records.ts` | modify | C100 1215/1217-1224, D110 1265/1267, D120 1312, B100 1367/1369, B110 1419 |
| `src/lib/uniform-structure/builder.ts` | modify | padded dealer, shared keys, shekel lines, rounding account and line |
| `src/lib/uniform-structure/preflight.ts` | modify | codes on every finding, normalizer, foreign currency unblocked, notes for foreign ids |
| `src/lib/uniform-structure/rows.ts` | create | pure row mappers shared by the route and the guard |
| `src/lib/uniform-structure/folder.ts` | create | `OPENFRMT/<dealer>.<YY>/<stamp>` with the padded number |
| `src/lib/uniform-structure/check.ts` | create | `checkUniformExport`: input checks, build, output checks |
| `src/app/api/uniform-structure/export/route.ts` | modify | uses rows, folder and check |
| `src/lib/support-link.ts` | modify | `FilingReportKind`, per-report support message |
| `src/lib/filing-fix-items.ts` | modify | `FixCode`, `open_client`, support `report`, `createFixCollector`, `splitFixTiers` |
| `src/lib/uniform-fix-items.ts` | create | uniform issues to panel model |
| `src/components/filing-fix-panel.tsx` | modify | `open_client`, `onSaved`, `advisory`, `data-fix-tier` |
| `src/app/(app)/reports/page.tsx` | modify | uniform check renders the panel, re-checks after saves |
| `src/lib/invoice-report-preflight.ts` | modify | invoices-period codes and levels |
| `src/lib/invoice-period-report.ts` | create | rows with shekel amounts or null, totals, stamp lines, Excel sheet |
| `src/lib/invoice-period-fix-items.ts` | create | invoices-period issues to panel model |
| `src/lib/csv-export.ts` | modify | `exportInvoicesPeriod` uses the stamped sheet |
| `src/app/(app)/reports/invoices-period/page.tsx` | modify | advisory panel, enabled exports, partial totals, print stamp |
| `src/components/report-preflight.tsx` | delete | replaced by the panel |
| `src/lib/filing-guard.ts` | modify | `prefixCodes`, generic push header |
| `scripts/filing-preflight-guard.mjs` | modify | `invoices:` and `uniform:` sections |
| `scripts/qa-seed-uniform-invoices.mjs` | create | QA seed/clean with verified restore |
| `scripts/qa-uniform-invoices-e2e.mjs` | create | puppeteer E2E + screenshots |
| `.gitignore` | modify | QA snapshot file |
| tests: `uniform-structure-issues`, `uniform-structure-account-keys`, `uniform-structure-amounts`, `uniform-structure-records`, `uniform-structure-builder`, `uniform-structure-preflight`, `uniform-structure-rows`, `uniform-structure-export-route`, `filing-fix-items`, `support-link`, `uniform-fix-items`, `invoice-report-preflight`, `invoice-period-report`, `invoice-period-fix-items`, `filing-guard` | create/modify | |

---

### Task 1: Uniform issue codes and titles

**Files:**
- Create: `src/lib/uniform-structure/issues.ts`
- Test: `tests/uniform-structure-issues.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/uniform-structure-issues.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { UNIFORM_FIX_TITLES, uniformBlockingCodes, uniformCanDownload, type UniformIssue } from "@/lib/uniform-structure/issues";

describe("uniform issue codes", () => {
  it("has a plain Hebrew title for every code", () => {
    const titles = Object.entries(UNIFORM_FIX_TITLES);
    expect(titles.length).toBeGreaterThan(30);
    for (const [code, title] of titles) {
      expect(code).toMatch(/^[a-z0-9_]+$/);
      expect(title.trim().length).toBeGreaterThan(0);
      expect([...title].some((ch) => ch === "\u2013" || ch === "\u2014")).toBe(false);
    }
  });

  it("downloads only without errors and reports each blocking code once", () => {
    const issues: UniformIssue[] = [
      { code: "record_invalid", level: "error", message: "a" },
      { code: "record_invalid", level: "error", message: "b" },
      { code: "text_truncated", level: "warning", message: "c" },
    ];
    expect(uniformCanDownload(issues)).toBe(false);
    expect(uniformBlockingCodes(issues)).toEqual(["record_invalid"]);
    expect(uniformCanDownload(issues.filter((i) => i.level === "warning"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-issues.test.ts`
Expected: FAIL, cannot resolve `@/lib/uniform-structure/issues`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/uniform-structure/issues.ts`:

```ts
// Stable identifiers for every מבנה אחיד (OPENFORMAT 1.31) finding. Pure on
// purpose: the reports page imports the titles, the export route and the
// nightly guard import the codes, and none of them may pull iconv-lite in.
// Codes are never renamed once shipped: guard state and support messages
// carry them.

export type UniformIssueCode =
  // input: business and period
  | "dealer_number_invalid"
  | "business_name_missing"
  | "period_invalid"
  | "text_truncated"
  // input: clients, documents, expenses
  | "client_number_not_israeli"
  | "customer_number_not_israeli"
  | "client_missing"
  | "date_invalid"
  | "document_number_invalid"
  | "duplicate_document_number"
  | "foreign_currency_missing_ils"
  | "foreign_currency_invalid"
  | "ils_mismatch"
  | "amount_invalid"
  | "total_mismatch"
  | "too_many_lines"
  | "items_mismatch"
  | "item_amount_invalid"
  | "check_details_invalid"
  | "check_due_date_invalid"
  | "expense_amount_invalid"
  // the built file
  | "file_dealer_invalid"
  | "file_envelope_mismatch"
  | "envelope_duplicate"
  | "ini_header_mismatch"
  | "ini_summary_mismatch"
  | "record_count_mismatch"
  | "record_invalid"
  | "record_date_invalid"
  | "record_amount_invalid"
  | "document_link_invalid"
  | "detail_link_invalid"
  | "detail_item_missing"
  | "journal_missing_account"
  | "journal_side_invalid"
  | "journal_unbalanced"
  | "account_key_duplicate"
  | "doc_summary_mismatch"
  | "sample_too_small"
  // the export route
  | "software_registration_missing"
  | "data_load_failed"
  | "rate_limited";

export type UniformIssueSource = "business" | "client" | "document" | "expense";

export interface UniformIssue {
  /** Stable identifier: wording may change, codes may not. */
  code: UniformIssueCode;
  /** "error" blocks the download; "warning" is a note. */
  level: "error" | "warning";
  message: string;
  source?: UniformIssueSource;
  sourceId?: string;
  sourceLabel?: string;
  /** The stored value an inline fix starts from (business number, a document's customer number, an expense date). */
  current?: string;
  /** The document came from a data import. */
  imported?: boolean;
}

export const UNIFORM_FIX_TITLES: Record<UniformIssueCode, string> = {
  dealer_number_invalid: "מספר העוסק של העסק בהגדרות לא תקין",
  business_name_missing: "חסר שם העסק בהגדרות",
  period_invalid: "שנת המס או תאריכי הדוח לא תקינים",
  text_truncated: "טקסט ארוך או תווים שלא נתמכים בקובץ",
  client_number_not_israeli: "מספר הזיהוי של הלקוח אינו מספר עוסק ישראלי",
  customer_number_not_israeli: "מספר הלקוח במסמך אינו מספר עוסק ישראלי",
  client_missing: "הלקוח המקושר למסמך חסר",
  date_invalid: "תאריך חסר או לא תקין",
  document_number_invalid: "סוג או מספר המסמך לא תקינים",
  duplicate_document_number: "מספר מסמך כפול",
  foreign_currency_missing_ils: "חסרים סכומים בשקלים למסמך במטבע חוץ",
  foreign_currency_invalid: "חסר שער המרה או קוד מטבע למסמך במטבע חוץ",
  ils_mismatch: "סכומי השקל השמורים לא תואמים למסמך",
  amount_invalid: "סכום חסר או גדול מדי לשדות הקובץ",
  total_mismatch: "הסכום הכולל לא תואם לסכום לפני מע״מ, המע״מ והעיגול",
  too_many_lines: "יותר מדי שורות במסמך",
  items_mismatch: "סכום השורות לא תואם לסכום המסמך",
  item_amount_invalid: "כמות או סכום לא תקינים בשורת מסמך",
  check_details_invalid: "חסרים פרטי המחאה",
  check_due_date_invalid: "תאריך פירעון ההמחאה לא תקין",
  expense_amount_invalid: "סכום ההוצאה חסר או גדול מדי",
  file_dealer_invalid: "מספר העוסק בקובץ שנבנה לא תקין",
  file_envelope_mismatch: "רשומות הפתיחה והסיום לא תואמות",
  envelope_duplicate: "רשומת פתיחה או סיום כפולה",
  ini_header_mismatch: "כותרת קובץ INI לא תואמת לקובץ הנתונים",
  ini_summary_mismatch: "סיכומי קובץ INI לא תואמים לקובץ הנתונים",
  record_count_mismatch: "ספירת הרשומות לא תואמת",
  record_invalid: "רשומה במבנה לא תקין",
  record_date_invalid: "תאריך לא תקין ברשומה",
  record_amount_invalid: "סכום או סימן לא תקינים ברשומה",
  document_link_invalid: "קישור כותרת מסמך חסר או כפול",
  detail_link_invalid: "שורת פירוט שלא מקושרת לכותרת המסמך",
  detail_item_missing: "שורת פירוט שמפנה לפריט חסר",
  journal_missing_account: "תנועת יומן שמפנה לחשבון חסר",
  journal_side_invalid: "צד חובה או זכות לא תקין",
  journal_unbalanced: "פקודת יומן לא מאוזנת",
  account_key_duplicate: "מפתח חשבון כפול בקובץ",
  doc_summary_mismatch: "סיכום המסמכים לא תואם לכותרות המסמכים",
  sample_too_small: "קובץ הדוגמה קטן מדי לסימולטור",
  software_registration_missing: "מספר רישום התוכנה עוד לא הוזן",
  data_load_failed: "טעינת נתוני הדוח נכשלה",
  rate_limited: "יותר מדי בדיקות ברצף",
};

/** The one download gate: nothing at level "error". */
export function uniformCanDownload(issues: readonly Pick<UniformIssue, "level">[]): boolean {
  return !issues.some((issue) => issue.level === "error");
}

/** Distinct codes of everything that blocks the download. The nightly guard counts these. */
export function uniformBlockingCodes(issues: readonly Pick<UniformIssue, "level" | "code">[]): UniformIssueCode[] {
  return [...new Set(issues.filter((issue) => issue.level === "error").map((issue) => issue.code))];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-issues.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/wtp2 && git add src/lib/uniform-structure/issues.ts tests/uniform-structure-issues.test.ts && git commit -m "feat(uniform): stable issue codes and titles" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: One account key map

**Files:**
- Create: `src/lib/uniform-structure/account-keys.ts`
- Test: `tests/uniform-structure-account-keys.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/uniform-structure-account-keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assignAccountKeys, buildAccountKeys } from "@/lib/uniform-structure/account-keys";

describe("account keys", () => {
  it("keeps today's natural keys when nothing collides", () => {
    const keys = buildAccountKeys(["9bbd3d8a-d7d0-4a00", "sc00000001-sample-client"], ["תוכנה", ""], ["CASH"]);
    expect(keys.client("9bbd3d8a-d7d0-4a00")).toBe("CLI-9bbd3d8a-d");
    expect(keys.client("sc00000001-sample-client")).toBe("CLI-sc00000001");
    expect(keys.expense("תוכנה")).toBe("EXP-תוכנה");
    expect(keys.expense("")).toBe("EXP-");
  });

  it("resolves clients that share 10 characters without merging them", () => {
    const keys = buildAccountKeys(["abcdefghij-2", "abcdefghij-1", "abcdefghij-3"], [], []);
    const all = ["abcdefghij-1", "abcdefghij-2", "abcdefghij-3"].map((id) => keys.client(id));
    expect(all).toEqual(["CLI-abcdefghij", "CLI-abcdefgh~01", "CLI-abcdefgh~02"]);
    expect(all.every((k) => k.length <= 15)).toBe(true);
  });

  it("is independent of input order", () => {
    const ids = ["abcdefghij-1", "abcdefghij-2", "x"];
    const a = assignAccountKeys("CLI-", ids, 10);
    const b = assignAccountKeys("CLI-", [...ids].reverse(), 10);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("resolves long expense categories that share 11 characters", () => {
    const keys = buildAccountKeys([], ["הוצאות משרד כלליות", "הוצאות משרד מיוחדות"], []);
    const a = keys.expense("הוצאות משרד כלליות");
    const b = keys.expense("הוצאות משרד מיוחדות");
    expect(a).not.toBe(b);
    expect([a.length, b.length].every((n) => n <= 15)).toBe(true);
  });

  it("never hands out a reserved or already used key", () => {
    expect(assignAccountKeys("CLI-", ["abc"], 10, ["CLI-abc"]).get("abc")).toBe("CLI-abc~01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-account-keys.test.ts`
Expected: FAIL, cannot resolve `@/lib/uniform-structure/account-keys`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/uniform-structure/account-keys.ts`:

```ts
// One id-to-key map for every B110 account row and every B100 posting that
// names it. Fields 1403 / 1364 / 1365 are X(15): keys are at most 15
// characters, unique, never a reserved standard account, and the same between
// runs of the same data. Before this map the client and expense keys were
// built separately at each site and two long names silently became one account.

export const ACCOUNT_KEY_WIDTH = 15;

/**
 * Natural key first (`prefix` + the first `rawWidth` characters, which is what
 * every file carried before), so a file that never collided keeps its keys.
 * When several values share a natural key, the first by sort order keeps it and
 * the rest get the key cut to 12 characters plus "~NN" (base 36).
 */
export function assignAccountKeys(prefix: string, raws: Iterable<string>, rawWidth: number, reserved: Iterable<string> = []): Map<string, string> {
  const used = new Set(reserved);
  const keys = new Map<string, string>();
  const groups = new Map<string, string[]>();
  for (const raw of [...new Set(raws)].sort()) {
    const natural = `${prefix}${raw.slice(0, rawWidth)}`.slice(0, ACCOUNT_KEY_WIDTH);
    groups.set(natural, [...(groups.get(natural) ?? []), raw]);
  }
  for (const [natural, group] of groups) {
    if (used.has(natural)) continue;
    keys.set(group[0], natural);
    used.add(natural);
  }
  for (const [natural, group] of groups) {
    for (const raw of group) {
      if (keys.has(raw)) continue;
      for (let n = 1; n < 36 * 36; n++) {
        const candidate = `${natural.slice(0, ACCOUNT_KEY_WIDTH - 3)}~${n.toString(36).padStart(2, "0")}`;
        if (used.has(candidate)) continue;
        keys.set(raw, candidate);
        used.add(candidate);
        break;
      }
    }
  }
  return keys;
}

export interface AccountKeys {
  client(id: string): string;
  expense(category: string): string;
}

/** Clients first, then expense categories, each avoiding the reserved codes and each other. */
export function buildAccountKeys(clientIds: Iterable<string>, categories: Iterable<string>, reserved: Iterable<string>): AccountKeys {
  const reservedList = [...reserved];
  const clients = assignAccountKeys("CLI-", clientIds, 10, reservedList);
  const expenses = assignAccountKeys("EXP-", [...categories].map((c) => c ?? ""), 11, [...reservedList, ...clients.values()]);
  return {
    client: (id) => clients.get(id) ?? `CLI-${id.slice(0, 10)}`,
    expense: (category) => expenses.get(category ?? "") ?? `EXP-${String(category ?? "").slice(0, 11)}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-account-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/wtp2 && git add src/lib/uniform-structure/account-keys.ts tests/uniform-structure-account-keys.test.ts && git commit -m "feat(uniform): one collision-free account key map" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Shekel amounts, converted lines, capped rounding

**Files:**
- Create: `src/lib/uniform-structure/amounts.ts`
- Test: `tests/uniform-structure-amounts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/uniform-structure-amounts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { journalRounding, uniformAmounts, uniformLineAmounts } from "@/lib/uniform-structure/amounts";
import type { InvoiceDocument } from "@/lib/types";

const item = (id: string, total: number, quantity = 1) => ({ id, description: "שירות", quantity, unitPrice: total / quantity, total });
function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return { id: "d", type: "tax_invoice", number: 1, date: "2026-01-15", status: "paid", clientId: "", clientName: "לקוח", subtotal: 100, vat: 18, total: 118, items: [item("a", 100)], ...over };
}

describe("uniform shekel amounts", () => {
  it("passes a shekel document through unchanged", () => {
    expect(uniformAmounts(doc({ discountAmount: 5, withholdingAmount: 2, rounding: 0.4, total: 118.4 }))).toEqual({
      foreign: false, currency: "ILS", rate: 1, subtotal: 100, vat: 18, total: 118.4, discount: 5, withholding: 2, roundingCap: 0.4,
    });
    expect(uniformLineAmounts(doc())).toEqual([{ unitPrice: 100, total: 100 }]);
  });

  it("uses the stored shekel amounts and converts discount and withholding with the rate", () => {
    expect(uniformAmounts(doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, vatIls: 66.6, totalIls: 436.6, discountAmount: 10 }))).toEqual({
      foreign: true, currency: "USD", rate: 3.7, subtotal: 370, vat: 66.6, total: 436.6, discount: 37, withholding: 0, roundingCap: 0,
    });
  });

  it("leaves missing shekel amounts as NaN so nothing is invented", () => {
    const a = uniformAmounts(doc({ currency: "EUR", exchangeRate: 4 }));
    expect([a.subtotal, a.vat, a.total].every(Number.isNaN)).toBe(true);
  });

  it("converts lines and lets the last line absorb the agorot", () => {
    const lines = uniformLineAmounts(doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, items: [item("a", 33.33), item("b", 33.33), item("c", 33.34)] }));
    expect(lines.map((l) => l.total)).toEqual([123.32, 123.32, 123.36]);
    expect(Math.round(lines.reduce((s, l) => s + l.total, 0) * 100)).toBe(37000);
  });

  it("adds the converted discount back so the lines match 1221 + 1220", () => {
    const lines = uniformLineAmounts(doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, discountAmount: 10, items: [item("a", 60), item("b", 50)] }));
    expect(lines.map((l) => l.total)).toEqual([222, 185]);
  });

  it("caps the journal rounding at the stored rounding", () => {
    expect(journalRounding(uniformAmounts(doc({ rounding: 0.4, total: 118.4 })))).toBe(0.4);
    expect(journalRounding(uniformAmounts(doc({ type: "credit_note", subtotal: -100, vat: -18, rounding: -0.3, total: -118.3 })))).toBe(-0.3);
    expect(journalRounding(uniformAmounts(doc({ currency: "USD", exchangeRate: 3.5, rounding: 0.4, total: 118.4, subtotalIls: 350, vatIls: 63, totalIls: 415 })))).toBe(1.4);
    expect(journalRounding(uniformAmounts(doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, vatIls: 66.6, totalIls: 436.59 })))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-amounts.test.ts`
Expected: FAIL, cannot resolve `@/lib/uniform-structure/amounts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/uniform-structure/amounts.ts`:

```ts
// Amounts as the מבנה אחיד file carries them. The leading currency is ILS
// (field 1032), so C100 1219-1224, D110 1265/1267, D120 1312 and B100 1368 are
// shekels (horaot_131_raw.txt 2109-2118, 2978-2997, 3708-3717). A shekel
// document passes through untouched, so files of shekel-only businesses stay
// byte-identical. A foreign-currency document uses the shekel snapshots stored
// at issue; anything the snapshots do not cover is converted with the stored
// rate and rounded to agorot. Missing snapshots stay NaN: the preflight blocks
// them, nothing here invents a number.
import type { InvoiceDocument } from "../types";

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface UniformAmounts {
  foreign: boolean;
  /** ISO 4217 code, "ILS" for a shekel document. */
  currency: string;
  rate: number;
  subtotal: number;
  vat: number;
  total: number;
  discount: number;
  withholding: number;
  /** The stored document rounding in shekels, as a magnitude: the most a journal rounding line may post. */
  roundingCap: number;
}

export function isForeignCurrency(doc: Pick<InvoiceDocument, "currency">): boolean {
  return Boolean(doc.currency) && doc.currency !== "ILS";
}

export function uniformAmounts(doc: InvoiceDocument): UniformAmounts {
  if (!isForeignCurrency(doc)) {
    return {
      foreign: false,
      currency: "ILS",
      rate: 1,
      subtotal: doc.subtotal,
      vat: doc.vat,
      total: doc.total,
      discount: doc.discountAmount ?? 0,
      withholding: doc.withholdingAmount ?? 0,
      roundingCap: Math.abs(doc.rounding ?? 0),
    };
  }
  const rate = doc.exchangeRate ?? NaN;
  const convert = (value: number | undefined) => (value ? round2(value * rate) : 0);
  return {
    foreign: true,
    currency: String(doc.currency),
    rate,
    subtotal: doc.subtotalIls ?? NaN,
    vat: doc.vatIls ?? NaN,
    total: doc.totalIls ?? NaN,
    discount: convert(doc.discountAmount),
    withholding: convert(doc.withholdingAmount),
    roundingCap: Math.abs(convert(doc.rounding)),
  };
}

/**
 * D110 unit price and line total per item. Foreign lines are converted with the
 * rate and the last line absorbs the agorot, so the lines add up to
 * 1221 (after discount) + 1220 (discount) exactly.
 */
export function uniformLineAmounts(doc: InvoiceDocument, amounts: UniformAmounts = uniformAmounts(doc)): { unitPrice: number; total: number }[] {
  if (!amounts.foreign) return doc.items.map((item) => ({ unitPrice: item.unitPrice, total: item.total }));
  const totals = doc.items.map((item) => round2(item.total * amounts.rate));
  if (totals.length > 0) {
    const others = totals.slice(0, -1).reduce((sum, value) => sum + value, 0);
    totals[totals.length - 1] = round2(amounts.subtotal + amounts.discount - others);
  }
  return doc.items.map((item, index) => ({ unitPrice: round2(item.unitPrice * amounts.rate), total: totals[index] }));
}

/**
 * The shekel gap between the total and net + VAT, capped at the stored
 * rounding. The journal posts exactly this to the rounding account, so any gap
 * the stored rounding does not explain still unbalances the journal and blocks.
 */
export function journalRounding(amounts: UniformAmounts): number {
  const gap = round2(amounts.total - amounts.subtotal - amounts.vat);
  const posted = round2(Math.sign(gap) * Math.min(Math.abs(gap), amounts.roundingCap));
  return posted === 0 ? 0 : posted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-amounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/wtp2 && git add src/lib/uniform-structure/amounts.ts tests/uniform-structure-amounts.test.ts && git commit -m "feat(uniform): shekel amounts, converted lines, capped rounding" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Records write shekels, normalized numbers and the foreign-currency fields

**Files:**
- Modify: `src/lib/uniform-structure/records.ts` (imports 18-27, `buildC100` 180-210, `buildD110` 227-258, `buildD120` 300, `buildB100` 315-354, `buildB110` 399)
- Test: `tests/uniform-structure-records.test.ts` (new), `tests/uniform-structure-parse.test.ts` (unchanged, must stay green)

- [ ] **Step 1: Write the failing test**

Create `tests/uniform-structure-records.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildB100, buildB110, buildC100, buildD110, buildD120, type FileMeta } from "@/lib/uniform-structure/records";
import type { Business, Client, InvoiceDocument } from "@/lib/types";

const business = { taxId: "512345679", name: "עסק בדיקה" } as unknown as Business;
const meta = { business, taxYear: 2026, generatedAt: new Date("2026-08-25T10:00:00Z"), softwareName: "test" } as unknown as FileMeta;
/** 1-based inclusive positions, exactly as horaot_131 lists them. */
const field = (line: string, from: number, to: number) => line.slice(from - 1, to);

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return { id: "d1", type: "tax_invoice", number: 7, date: "2026-03-15T12:00:00", clientId: "", clientName: "לקוח", status: "paid", items: [], subtotal: 100, vat: 18, total: 118, ...over } as InvoiceDocument;
}
const usd = doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, vatIls: 66.6, totalIls: 436.6, discountAmount: 10, withholdingAmount: 5 });

describe("C100 amounts and numbers", () => {
  it("keeps a shekel document as it was: native amounts, no foreign fields", () => {
    const line = buildC100({ recordNum: 2, meta, doc: doc(), client: null, linkField: 1 });
    expect(line.length).toBe(446);
    expect(field(line, 270, 284)).toBe("+00000000000000");
    expect(field(line, 285, 287)).toBe("   ");
    expect(field(line, 348, 362)).toBe("+00000000011800");
  });

  it("writes a foreign-currency document in shekels with its own total and ISO code", () => {
    const line = buildC100({ recordNum: 2, meta, doc: usd, client: null, linkField: 1 });
    expect(field(line, 270, 284)).toBe("+00000000011800");
    expect(field(line, 285, 287)).toBe("USD");
    expect(field(line, 288, 302)).toBe("+00000000040700");
    expect(field(line, 303, 317)).toBe("+00000000003700");
    expect(field(line, 318, 332)).toBe("+00000000037000");
    expect(field(line, 333, 347)).toBe("+00000000006660");
    expect(field(line, 348, 362)).toBe("+00000000043660");
    expect(field(line, 363, 374)).toBe("+00000001850");
    expect(line.length).toBe(446);
  });

  it("writes the document's own customer number padded, falls back to the client, blanks a foreign id", () => {
    const client = { id: "c1", name: "x", taxId: "034567891", createdAt: "" } as Client;
    const vat = (d: InvoiceDocument, c: Client | null) => field(buildC100({ recordNum: 2, meta, doc: d, client: c, linkField: 1 }), 253, 261);
    expect(vat(doc({ clientTaxId: "13333331" }), client)).toBe("013333331");
    expect(vat(doc(), client)).toBe("034567891");
    expect(vat(doc({ clientTaxId: "DE123456789" }), client)).toBe("         ");
    expect(vat(doc(), null)).toBe("         ");
  });
});

describe("D110, D120, B100, B110", () => {
  const item = { id: "i", description: "שירות", quantity: 2, unitPrice: 50, total: 100 };

  it("D110 takes converted line amounts when given, the item's own otherwise", () => {
    const own = buildD110({ recordNum: 3, meta, doc: doc(), item, lineNumber: 1, linkField: 1, itemCode: "ITM-000001" });
    expect(field(own, 241, 255)).toBe("+00000000005000");
    expect(field(own, 271, 285)).toBe("+00000000010000");
    const converted = buildD110({ recordNum: 3, meta, doc: usd, item, lineNumber: 1, linkField: 1, itemCode: "ITM-000001", amounts: { unitPrice: 185, total: 407 } });
    expect(field(converted, 241, 255)).toBe("+00000000018500");
    expect(field(converted, 271, 285)).toBe("+00000000040700");
    expect(converted.length).toBe(341);
  });

  it("D120 writes the shekel total", () => {
    const line = buildD120({ recordNum: 4, meta, doc: { ...usd, type: "tax_invoice_receipt" }, lineNumber: 1, linkField: 1 });
    expect(field(line, 104, 118)).toBe("+00000000043660");
  });

  it("B100 carries the foreign code and native amount only when given", () => {
    const base = { recordNum: 5, meta, transactionNum: 1, transactionLine: 1, docRefNum: "7", date: "2026-03-15T12:00:00", valueDate: "2026-03-15T12:00:00", accountKey: "CASH", side: "1" as const, amount: 436.6 };
    const shekel = buildB100(base);
    expect(field(shekel, 204, 206)).toBe("   ");
    expect(field(shekel, 222, 236)).toBe("+00000000000000");
    const foreign = buildB100({ ...base, foreignCurrency: "USD", foreignAmount: 118 });
    expect(field(foreign, 204, 206)).toBe("USD");
    expect(field(foreign, 207, 221)).toBe("+00000000043660");
    expect(field(foreign, 222, 236)).toBe("+00000000011800");
    expect(foreign.length).toBe(319);
  });

  it("B110 1419 is the normalized number or blank", () => {
    const row = (vat?: string) =>
      field(buildB110({ recordNum: 6, meta, accountKey: "CLI-x", accountName: "x", trialBalanceCode: "CUSTOMERS", trialBalanceDesc: "לקוחות", customerSupplierVat: vat }), 327, 335);
    expect(row("13333331")).toBe("013333331");
    expect(row("DE123456789")).toBe("         ");
    expect(row(undefined)).toBe("         ");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-records.test.ts`
Expected: FAIL (1217 is zero for USD, 1215 is `13333331 `, D110 ignores `amounts`, B100 has no foreign fields, 1419 is unpadded).

- [ ] **Step 3: Implement - imports**

In `src/lib/uniform-structure/records.ts` replace:

```ts
import type { Business, Client, DocumentItem, Expense, InvoiceDocument, PaymentMethod } from "../types";
```

with:

```ts
import type { Business, Client, DocumentItem, Expense, InvoiceDocument, PaymentMethod } from "../types";
import { normalizeBusinessNumber } from "../israeli-id";
import { uniformAmounts } from "./amounts";
```

- [ ] **Step 4: Implement - C100**

Replace:

```ts
  const docType = DOC_TYPE_CODE[doc.type];
  const cancelled = doc.status === "cancelled" ? "1" : "";

  return buildLine([
```

with:

```ts
  const docType = DOC_TYPE_CODE[doc.type];
  const cancelled = doc.status === "cancelled" ? "1" : "";
  // Leading currency is ILS (1032): 1219-1224 are shekels. A foreign-currency
  // document also carries its own total and ISO code in 1217 / 1218.
  const amounts = uniformAmounts(doc);
  // 1215: the number on the document itself (snapshot at issue), else the
  // linked client's. The shared normalizer pads an 8-digit number; a value it
  // refuses (a foreign id) is written blank, never stripped into another number.
  const customerVat = normalizeBusinessNumber(doc.clientTaxId || client?.taxId).value ?? "";

  return buildLine([
```

Replace:

```ts
    padStr(client?.taxId || "", 9), // 1215: customer VAT, pos 253-261
    formatDate(doc.date), // 1216: value date, pos 262-269
    formatSignedAmount(0, 12, 2), // 1217: foreign-currency total (15), pos 270-284
    padStr("", 3), // 1218: foreign-currency code, pos 285-287
    // Document-level discount (הנחה): the stored subtotal is already the
    // DISCOUNTED subtotal, so "amount before discount" = subtotal + discount.
    formatSignedAmount(doc.subtotal + (doc.discountAmount ?? 0), 12, 2), // 1219: amount before discount (15), pos 288-302
    formatSignedAmount(doc.discountAmount ?? 0, 12, 2), // 1220: doc discount (15), pos 303-317
    formatSignedAmount(doc.subtotal, 12, 2), // 1221: amount after discount, before VAT (15), pos 318-332
    formatSignedAmount(doc.vat, 12, 2), // 1222: VAT amount (15), pos 333-347
    formatSignedAmount(doc.total, 12, 2), // 1223: amount inc. VAT (15), pos 348-362
    // ניכוי מס במקור (withholding tax) deducted at source by the customer.
    formatSignedAmount(doc.withholdingAmount ?? 0, 9, 2), // 1224: source deduction (12), pos 363-374
```

with:

```ts
    padStr(customerVat, 9), // 1215: customer VAT, pos 253-261
    formatDate(doc.date), // 1216: value date, pos 262-269
    formatSignedAmount(amounts.foreign ? doc.total : 0, 12, 2), // 1217: foreign-currency total (15), pos 270-284
    padStr(amounts.foreign ? amounts.currency : "", 3), // 1218: foreign-currency code (ISO 4217), pos 285-287
    // Document-level discount (הנחה): the stored subtotal is already the
    // DISCOUNTED subtotal, so "amount before discount" = subtotal + discount.
    formatSignedAmount(amounts.subtotal + amounts.discount, 12, 2), // 1219: amount before discount (15), pos 288-302
    formatSignedAmount(amounts.discount, 12, 2), // 1220: doc discount (15), pos 303-317
    formatSignedAmount(amounts.subtotal, 12, 2), // 1221: amount after discount, before VAT (15), pos 318-332
    formatSignedAmount(amounts.vat, 12, 2), // 1222: VAT amount (15), pos 333-347
    formatSignedAmount(amounts.total, 12, 2), // 1223: amount inc. VAT (15), pos 348-362
    // ניכוי מס במקור (withholding tax) deducted at source by the customer.
    formatSignedAmount(amounts.withholding, 9, 2), // 1224: source deduction (12), pos 363-374
```

- [ ] **Step 5: Implement - D110 and D120**

Replace:

```ts
  /** The M100 internal SKU this line refers to; the simulator's integrity
   *  check wants every D110 1259 to resolve to an M100 1455. */
  itemCode: string;
}): string {
  const { recordNum, meta, doc, item, lineNumber, linkField, itemCode } = args;
```

with:

```ts
  /** The M100 internal SKU this line refers to; the simulator's integrity
   *  check wants every D110 1259 to resolve to an M100 1455. */
  itemCode: string;
  /** Shekel unit price and line total (uniformLineAmounts). Defaults to the item's own amounts. */
  amounts?: { unitPrice: number; total: number };
}): string {
  const { recordNum, meta, doc, item, lineNumber, linkField, itemCode } = args;
  const line = args.amounts ?? { unitPrice: item.unitPrice, total: item.total };
```

Replace:

```ts
    formatSignedAmount(item.unitPrice, 12, 2), // 1265: price w/o VAT, pos 241-255
    formatSignedAmount(0, 12, 2), // 1266: line discount, pos 256-270
    formatSignedAmount(item.total, 12, 2), // 1267: line total before VAT, pos 271-285
```

with:

```ts
    formatSignedAmount(line.unitPrice, 12, 2), // 1265: price w/o VAT in shekels, pos 241-255
    formatSignedAmount(0, 12, 2), // 1266: line discount, pos 256-270
    formatSignedAmount(line.total, 12, 2), // 1267: line total before VAT, pos 271-285
```

Replace:

```ts
    formatSignedAmount(doc.total, 12, 2), // 1312: row amount, pos 104-118
```

with:

```ts
    formatSignedAmount(uniformAmounts(doc).total, 12, 2), // 1312: row amount in shekels, pos 104-118
```

- [ ] **Step 6: Implement - B100 and B110**

Replace:

```ts
  amount: number;
  details?: string;
}): string {
  const { recordNum, meta } = args;
  return buildLine([
    "B100", // 1350, pos 1-4
```

with:

```ts
  amount: number;
  details?: string;
  /** ISO 4217 code of a foreign-currency document (1367). */
  foreignCurrency?: string;
  /** The same line in that currency (1369). */
  foreignAmount?: number;
}): string {
  const { recordNum, meta } = args;
  return buildLine([
    "B100", // 1350, pos 1-4
```

Replace:

```ts
    padStr("", 3), // 1367: foreign currency code, pos 204-206
    formatSignedAmount(args.amount, 12, 2), // 1368: operation amount, pos 207-221
    formatSignedAmount(0, 12, 2), // 1369: foreign-currency amount, pos 222-236
```

with:

```ts
    padStr(args.foreignCurrency ?? "", 3), // 1367: foreign currency code, pos 204-206
    formatSignedAmount(args.amount, 12, 2), // 1368: operation amount in shekels, pos 207-221
    formatSignedAmount(args.foreignAmount ?? 0, 12, 2), // 1369: foreign-currency amount, pos 222-236
```

Replace:

```ts
    padStr(args.customerSupplierVat || "", 9), // 1419: customer/supplier VAT, pos 327-335
```

with:

```ts
    // Padded by the shared normalizer; a foreign id is left blank.
    padStr(normalizeBusinessNumber(args.customerSupplierVat).value ?? "", 9), // 1419: customer/supplier VAT, pos 327-335
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-records.test.ts tests/uniform-structure-parse.test.ts tests/uniform-structure-preflight.test.ts && npx tsc --noEmit`
Expected: PASS (the parse round-trip still reads `34567891` through the client fallback), tsc exits 0.

- [ ] **Step 8: Commit**

```bash
cd /c/wtp2 && git add src/lib/uniform-structure/records.ts tests/uniform-structure-records.test.ts && git commit -m "feat(uniform): records write shekels, padded numbers and foreign-currency fields" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Builder - padded dealer, shared keys, shekel lines, rounding line

**Files:**
- Modify: `src/lib/uniform-structure/builder.ts` (whole file)
- Modify: `tests/uniform-structure-preflight.test.ts:31-35`
- Test: `tests/uniform-structure-builder.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/uniform-structure-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildUniformStructure, type UniformInput } from "@/lib/uniform-structure/builder";
import { validateUniformOutput } from "@/lib/uniform-structure/preflight";
import type { Client, Expense, InvoiceDocument } from "@/lib/types";

const item = (total: number) => ({ id: `i${total}`, description: "שירות", quantity: 1, unitPrice: total, total });
function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return { id: "doc1", type: "tax_invoice", number: 1, date: "2026-01-15", status: "paid", clientId: "", clientName: "לקוח", subtotal: 100, vat: 18, total: 118, items: [item(100)], ...over };
}
function input(over: Partial<UniformInput> = {}): UniformInput {
  return { business: { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized", address: "רחוב" }, documents: [doc()], clients: [], expenses: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31", ...over };
}
const lines = (text: string, type: string) => text.split("\r\n").filter((l) => l.startsWith(type));
const signed = (s: string) => Number(s) / 100;

describe("uniform builder", () => {
  it("writes an 8-digit dealer number padded in every record and in the INI header", () => {
    const out = buildUniformStructure(input({ business: { id: "biz", name: "עסק", taxId: "13333331", businessType: "authorized", address: "" } }));
    const all = out.bkmvdataText.split("\r\n").filter(Boolean);
    expect(all.every((l) => l.slice(13, 22) === "013333331")).toBe(true);
    expect(out.iniText.slice(24, 33)).toBe("013333331");
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("gives clients whose ids share 10 characters their own accounts and postings", () => {
    const clients: Client[] = [{ id: "abcdefghij-1", name: "א", createdAt: "" }, { id: "abcdefghij-2", name: "ב", createdAt: "" }];
    const out = buildUniformStructure(input({ clients, documents: [doc({ id: "d1", clientId: "abcdefghij-1" }), doc({ id: "d2", number: 2, clientId: "abcdefghij-2" })] }));
    const keys = lines(out.bkmvdataText, "B110").map((l) => l.slice(22, 37).trim());
    expect(keys.filter((k) => k.startsWith("CLI-"))).toEqual(["CLI-abcdefghij", "CLI-abcdefgh~01"]);
    const customerDebits = lines(out.bkmvdataText, "B100").filter((l) => l[202] === "1").map((l) => l.slice(172, 187).trim());
    expect(customerDebits).toEqual(["CLI-abcdefghij", "CLI-abcdefgh~01"]);
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("gives two long expense categories that share 11 characters their own accounts", () => {
    const expenses: Expense[] = [
      { id: "e1", date: "2026-02-01", category: "הוצאות משרד כלליות", supplier: "ספק", amount: 50 },
      { id: "e2", date: "2026-02-02", category: "הוצאות משרד מיוחדות", supplier: "ספק", amount: 70 },
    ];
    const out = buildUniformStructure(input({ expenses }));
    const expenseKeys = lines(out.bkmvdataText, "B110").map((l) => l.slice(22, 37).trim()).filter((k) => k.startsWith("EXP-"));
    expect(new Set(expenseKeys).size).toBe(2);
    expect(expenseKeys.every((k) => k.length <= 15)).toBe(true);
    const debits = lines(out.bkmvdataText, "B100").filter((l) => l.slice(172, 187).startsWith("EXP-")).map((l) => l.slice(172, 187).trim());
    expect(new Set(debits)).toEqual(new Set(expenseKeys));
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("writes a foreign-currency document in shekels, balanced, summarized in shekels", () => {
    const usd = doc({ currency: "USD", exchangeRate: 3.6, subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 });
    const out = buildUniformStructure(input({ documents: [usd] }));
    const [c100] = lines(out.bkmvdataText, "C100");
    expect(signed(c100.slice(347, 362))).toBe(424.8);
    expect(c100.slice(284, 287)).toBe("USD");
    const [d110] = lines(out.bkmvdataText, "D110");
    expect(signed(d110.slice(270, 285))).toBe(360);
    const [customer] = lines(out.bkmvdataText, "B100");
    expect(signed(customer.slice(206, 221))).toBe(424.8);
    expect(customer.slice(203, 206)).toBe("USD");
    expect(signed(customer.slice(221, 236))).toBe(118);
    expect(out.docTypeSummary.find((r) => r.code === "305")).toMatchObject({ count: 1, total: 424.8 });
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("posts a stored rounding to the declared rounding account and balances", () => {
    const out = buildUniformStructure(input({ documents: [doc({ rounding: 0.4, total: 118.4 })] }));
    expect(lines(out.bkmvdataText, "B110").map((l) => l.slice(22, 37).trim())).toContain("ROUNDING");
    const rounding = lines(out.bkmvdataText, "B100").find((l) => l.slice(172, 187).trim() === "ROUNDING");
    expect(rounding && signed(rounding.slice(206, 221))).toBe(0.4);
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("writes no rounding account when no document needs one", () => {
    const out = buildUniformStructure(input());
    expect(lines(out.bkmvdataText, "B110").some((l) => l.slice(22, 37).trim() === "ROUNDING")).toBe(false);
  });

  it("caps the rounding line at the stored rounding, so a larger gap still unbalances the journal", () => {
    const gap = doc({ currency: "USD", exchangeRate: 3.5, total: 118.4, rounding: 0.4, subtotalIls: 350, vatIls: 63, totalIls: 415 });
    expect(validateUniformOutput(buildUniformStructure(input({ documents: [gap] }))).some((i) => i.message.includes("מאוזנת"))).toBe(true);
    const ok = doc({ currency: "USD", exchangeRate: 3.5, total: 118.4, rounding: 0.4, subtotalIls: 350, vatIls: 63, totalIls: 414.4 });
    expect(validateUniformOutput(buildUniformStructure(input({ documents: [ok] })))).toEqual([]);
  });
});
```

In `tests/uniform-structure-preflight.test.ts` replace lines 31-35:

```ts
  it("accepts source rounding but blocks an unbalanced generated journal", () => {
    const data = input({ rounding: 0.4, total: 118.4 });
    expect(validateUniformInput(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data)).some(i => i.message.includes("מאוזנת"))).toBe(true);
  });
```

with:

```ts
  it("accepts source rounding and balances the journal through the rounding account", () => {
    const data = input({ rounding: 0.4, total: 118.4 });
    expect(validateUniformInput(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-builder.test.ts tests/uniform-structure-preflight.test.ts`
Expected: FAIL (unpadded dealer, merged/colliding keys, native amounts, no ROUNDING, unbalanced rounding journal).

- [ ] **Step 3: Write the implementation**

Replace the whole content of `src/lib/uniform-structure/builder.ts` with:

```ts
// Orchestrator that assembles a complete מבנה אחיד export from raw
// app data (documents, items, clients, expenses, business profile).
//
// Returns the two file contents as Windows-1255 Buffers ready to ship
// in a ZIP archive: INI.txt (header / counts) + BKMVDATA.txt (data).
//
// Field positions and record layouts are governed by horaot_131.pdf
// (the official OPENFORMAT 1.31 spec, see docs/uniform-structure/).

import { toWindows1255 } from "./encode";
import { UNIFORM_SOFTWARE } from "./software";
import {
  buildA000,
  buildA100,
  buildB100,
  buildB110,
  buildC100,
  buildD110,
  buildD120,
  buildM100,
  buildSummary,
  buildZ900,
  DOC_TYPE_CODE,
  type FileMeta,
  type RecordCounts,
} from "./records";
import { buildAccountKeys } from "./account-keys";
import { journalRounding, uniformAmounts, uniformLineAmounts } from "./amounts";
import { normalizeBusinessNumber } from "../israeli-id";
import { isCountableRevenue, type Business, type Client, type Expense, type InvoiceDocument } from "../types";

export interface UniformInput {
  business: Business;
  documents: InvoiceDocument[];
  clients: Client[];
  expenses: Expense[];
  taxYear: number;
  fromDate: string;
  toDate: string;
  softwareName?: string;
  softwareVersion?: string;
  softwareVendorName?: string;
  softwareVendorTaxId?: string;
  softwareRegistrationNumber?: string;
}

export interface UniformOutput {
  ini: Buffer;
  bkmvdata: Buffer;
  iniText: string;
  bkmvdataText: string;
  counts: RecordCounts;
  /** Section 2.6 of the spec: count + money total per נספח 1 document type. */
  docTypeSummary: DocTypeSummaryRow[];
  generatedAt: Date;
}

export interface DocTypeSummaryRow {
  /** נספח 1 document code ("305", "400", ...). */
  code: string;
  label: string;
  count: number;
  /** Money total in shekels (the C100 1223 amounts), 0 for unmanaged types. */
  total: number;
}

/**
 * נספח 1 of the spec, in its order. Section 2.6 wants a row for EVERY type
 * listed there, with zeros for the ones the software does not manage, so
 * the auditor sees "not managed" rather than "forgot to report".
 */
export const APPENDIX_1_DOC_TYPES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "100", label: "הזמנה" },
  { code: "200", label: "תעודת משלוח" },
  { code: "205", label: "תעודת משלוח סוכן" },
  { code: "210", label: "תעודת החזרה" },
  { code: "300", label: "חשבונית / חשבונית עסקה" },
  { code: "305", label: "חשבונית מס" },
  { code: "310", label: "חשבונית ריכוז" },
  { code: "320", label: "חשבונית מס / קבלה" },
  { code: "330", label: "חשבונית מס זיכוי" },
  { code: "340", label: "חשבונית שריון" },
  { code: "345", label: "חשבונית סוכן" },
  { code: "400", label: "קבלה" },
  { code: "405", label: "קבלה על תרומות" },
  { code: "410", label: "יציאה מקופה" },
  { code: "420", label: "הפקדת בנק" },
  { code: "500", label: "הזמנת רכש" },
  { code: "600", label: "תעודת משלוח רכש" },
  { code: "610", label: "החזרת רכש" },
  { code: "700", label: "חשבונית מס רכש" },
  { code: "710", label: "זיכוי רכש" },
  { code: "800", label: "יתרת פתיחה" },
  { code: "810", label: "כניסה כללית למלאי" },
  { code: "820", label: "יציאה כללית מהמלאי" },
  { code: "830", label: "העברה בין מחסנים" },
  { code: "840", label: "עדכון בעקבות ספירה" },
  { code: "900", label: "כניסה - דוח ייצור" },
  { code: "910", label: "יציאה - דוח ייצור" },
];

/**
 * Minimal synthetic chart of accounts. Each account becomes a B110
 * record and gets referenced by B100 journal entries.
 */
const STANDARD_ACCOUNTS = [
  { code: "SALES-000", name: "הכנסות ממכירות", tbCode: "INCOME", tbDesc: "הכנסות" },
  { code: "VAT-COL", name: "מע״מ עסקאות", tbCode: "VAT-OUT", tbDesc: "מע״מ עסקאות" },
  { code: "VAT-INP", name: "מע״מ תשומות", tbCode: "VAT-IN", tbDesc: "מע״מ תשומות" },
  { code: "CASH", name: "מזומן", tbCode: "ASSETS", tbDesc: "מזומנים ושווי מזומנים" },
  { code: "BANK", name: "בנק", tbCode: "ASSETS", tbDesc: "מזומנים ושווי מזומנים" },
];

/**
 * The declared account for a stored הפרש עיגול. Written only when some
 * document posts to it, and every posting is capped at that document's stored
 * rounding (journalRounding), so it can never hide any other gap.
 */
export const ROUNDING_ACCOUNT = { code: "ROUNDING", name: "הפרשי עיגול", tbCode: "ROUNDING", tbDesc: "הפרשי עיגול" };

export function buildUniformStructure(input: UniformInput): UniformOutput {
  // The dealer number goes into every record. The preflight blocks a number
  // the shared normalizer refuses, so this is the padded 9-digit form (an
  // 8-digit עוסק is 0XXXXXXXX in the file, exactly as in PCN874).
  const dealerVat = normalizeBusinessNumber(input.business.taxId).value ?? input.business.taxId;
  const meta: FileMeta = {
    business: { ...input.business, taxId: dealerVat },
    taxYear: input.taxYear,
    generatedAt: new Date(),
    // Software identity as registered at רשות המסים - see software.ts for
    // why the name is not the consumer brand and where the version comes from.
    softwareName: input.softwareName ?? UNIFORM_SOFTWARE.name,
    softwareVersion: input.softwareVersion ?? UNIFORM_SOFTWARE.version,
    softwareVendorName: input.softwareVendorName ?? UNIFORM_SOFTWARE.vendorName,
    softwareVendorTaxId: input.softwareVendorTaxId ?? UNIFORM_SOFTWARE.vendorTaxId,
    softwareRegistrationNumber: input.softwareRegistrationNumber ?? UNIFORM_SOFTWARE.registrationNumber,
    fromDate: input.fromDate,
    toDate: input.toDate,
  };

  // Filter to the requested year window.
  const fromMs = new Date(input.fromDate).getTime();
  const toMs = new Date(input.toDate).getTime() + 86_400_000 - 1;
  const docs = input.documents.filter((d) => {
    const t = new Date(d.date).getTime();
    return t >= fromMs && t <= toMs;
  });
  const expenses = input.expenses.filter((e) => {
    const t = new Date(e.date).getTime();
    return t >= fromMs && t <= toMs;
  });

  const clientById = new Map(input.clients.map((c) => [c.id, c]));

  // Fields 1234 / 1273 / 1323 tie D110 and D120 rows to their C100 header.
  // The document NUMBER is not unique across types (receipt 1001 and quote
  // 1001 coexist), so every document gets its own sequential link id.
  const docLinkId = new Map<string, number>();
  docs.forEach((d, i) => docLinkId.set(d.id, i + 1));
  const linkOf = (d: InvoiceDocument) => docLinkId.get(d.id) ?? 0;

  // Collect unique items across all docs for M100 master records.
  const uniqueItems = new Map<string, { code: string; description: string }>();
  for (const doc of docs) {
    for (const item of doc.items) {
      const key = item.description.trim();
      if (!uniqueItems.has(key)) {
        const code = item.productId
          ? item.productId.slice(0, 20)
          : `ITM-${(uniqueItems.size + 1).toString().padStart(6, "0")}`;
        uniqueItems.set(key, { code, description: key });
      }
    }
  }

  // One id-to-key map feeds every B110 row and every B100 posting below.
  const accountKeys = buildAccountKeys(
    input.clients.map((c) => c.id),
    expenses.map((e) => e.category ?? ""),
    [...STANDARD_ACCOUNTS.map((a) => a.code), ROUNDING_ACCOUNT.code],
  );

  // B100 journal documents, decided up front: whether any of them posts a
  // rounding line decides whether the rounding account row exists.
  //
  // isCountableRevenue() excludes documents with convertedToId set (e.g. a
  // quote/proforma marked "paid" on conversion into the receipt/tax invoice
  // that actually represents the revenue) - without it this ledger would
  // book the same money twice, once under the source doc and once under the
  // converted target. C100/D110 below intentionally do NOT apply this
  // filter: they're a registry of every document number issued, not a
  // revenue ledger, so converted docs still belong there.
  const journalDocs = docs.filter((d) => d.status === "paid" && isCountableRevenue(d));
  const roundingByDoc = new Map(journalDocs.map((d) => [d.id, journalRounding(uniformAmounts(d))]));
  const needsRoundingAccount = [...roundingByDoc.values()].some((value) => Math.abs(value) >= 0.005);

  // Sequence numbers are monotonic across the entire BKMVDATA file.
  let recordNum = 2; // 1 = A100

  // ── B110 chart of accounts (standard + per-client + per-category) ───
  const b110Lines: string[] = [];
  for (const acct of needsRoundingAccount ? [...STANDARD_ACCOUNTS, ROUNDING_ACCOUNT] : STANDARD_ACCOUNTS) {
    b110Lines.push(
      buildB110({
        recordNum: recordNum++,
        meta,
        accountKey: acct.code,
        accountName: acct.name,
        trialBalanceCode: acct.tbCode,
        trialBalanceDesc: acct.tbDesc,
      }),
    );
  }
  for (const c of input.clients) {
    b110Lines.push(
      buildB110({
        recordNum: recordNum++,
        meta,
        accountKey: accountKeys.client(c.id),
        accountName: c.name,
        trialBalanceCode: "CUSTOMERS",
        trialBalanceDesc: "לקוחות",
        customerSupplierVat: c.taxId,
      }),
    );
  }
  // One expense account per category, never merged: every B100 account key
  // (field 1364) must resolve to its own B110 row.
  for (const category of new Set(expenses.map((e) => e.category ?? ""))) {
    b110Lines.push(
      buildB110({
        recordNum: recordNum++,
        meta,
        accountKey: accountKeys.expense(category),
        accountName: `הוצאות ${category}`.slice(0, 50),
        trialBalanceCode: "EXPENSES",
        trialBalanceDesc: "הוצאות",
      }),
    );
  }
  const b110Count = b110Lines.length;

  // ── M100 inventory items ───────────────────────────────────────────
  const m100Lines: string[] = [];
  for (const item of uniqueItems.values()) {
    m100Lines.push(
      buildM100({
        recordNum: recordNum++,
        meta,
        itemCode: item.code,
        itemDescription: item.description,
      }),
    );
  }
  const m100Count = m100Lines.length;

  // ── C100 document headers ──────────────────────────────────────────
  const c100Lines: string[] = [];
  // Section 2.6 printout: one row per נספח 1 type, over the SAME documents
  // that became C100 records, so the printed totals reconcile with the file.
  const perType = new Map<string, { count: number; total: number }>();
  for (const doc of docs) {
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;
    c100Lines.push(buildC100({ recordNum: recordNum++, meta, doc, client, linkField: linkOf(doc) }));
    const code = DOC_TYPE_CODE[doc.type];
    const row = perType.get(code) ?? { count: 0, total: 0 };
    row.count += 1;
    row.total += uniformAmounts(doc).total;
    perType.set(code, row);
  }
  const c100Count = c100Lines.length;
  const docTypeSummary: DocTypeSummaryRow[] = APPENDIX_1_DOC_TYPES.map((t) => ({
    code: t.code,
    label: t.label,
    count: perType.get(t.code)?.count ?? 0,
    total: Math.round((perType.get(t.code)?.total ?? 0) * 100) / 100,
  }));

  // ── D110 document line items ───────────────────────────────────────
  const d110Lines: string[] = [];
  for (const doc of docs) {
    // A plain receipt (400) records money received, not goods or services
    // sold, so its detail rows are D120 payment lines only. The simulator
    // treats a D110 under a 400 header as an orphan ("לא נמצאה רשומת
    // כותרת מסמך"). A tax-invoice-receipt (320) keeps both kinds of rows.
    if (doc.type === "receipt") continue;
    const lineAmounts = uniformLineAmounts(doc);
    doc.items.forEach((item, idx) => {
      d110Lines.push(
        buildD110({
          recordNum: recordNum++,
          meta,
          doc,
          item,
          lineNumber: idx + 1,
          linkField: linkOf(doc),
          itemCode: uniqueItems.get(item.description.trim())?.code ?? "",
          amounts: lineAmounts[idx],
        }),
      );
    });
  }
  const d110Count = d110Lines.length;

  // ── D120 payment lines ─────────────────────────────────────────────
  const d120Lines: string[] = [];
  for (const doc of docs) {
    if (doc.type === "receipt" || doc.type === "tax_invoice_receipt") {
      d120Lines.push(buildD120({ recordNum: recordNum++, meta, doc, lineNumber: 1, linkField: linkOf(doc) }));
    }
  }
  const d120Count = d120Lines.length;

  // ── B100 journal entries ───────────────────────────────────────────
  // Each paid document: dr customer / cr sales / [cr vat] / [cr rounding]
  // Each expense: dr expense / cr cash
  const b100Lines: string[] = [];
  let txNum = 1;

  for (const doc of journalDocs) {
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;
    const docTypeCode = DOC_TYPE_CODE[doc.type];
    const customerAcct = client ? accountKeys.client(client.id) : "CASH";
    const amounts = uniformAmounts(doc);
    const details = `${doc.clientName} ${doc.subject ?? ""}`.slice(0, 50);
    let transactionLine = 1;
    // 1368 is in shekels. A foreign-currency document also carries its
    // currency (1367) and the same line in that currency (1369).
    const post = (accountKey: string, counterAccountKey: string, side: "1" | "2", amount: number, native: number, lineDetails = details) => {
      b100Lines.push(
        buildB100({
          recordNum: recordNum++,
          meta,
          transactionNum: txNum,
          transactionLine: transactionLine++,
          docRefNum: String(doc.number),
          docTypeRef: docTypeCode,
          date: doc.date,
          valueDate: doc.date,
          accountKey,
          counterAccountKey,
          details: lineDetails,
          amount,
          side,
          ...(amounts.foreign ? { foreignCurrency: amounts.currency, foreignAmount: native } : {}),
        }),
      );
    };
    post(customerAcct, "SALES-000", "1", amounts.total, doc.total);
    post("SALES-000", customerAcct, "2", amounts.subtotal, doc.subtotal);
    if (Math.abs(amounts.vat) > 0.001) post("VAT-COL", customerAcct, "2", amounts.vat, doc.vat, "מע״מ עסקאות");
    const rounding = roundingByDoc.get(doc.id) ?? 0;
    if (Math.abs(rounding) >= 0.005) post(ROUNDING_ACCOUNT.code, customerAcct, "2", rounding, doc.rounding ?? 0, "הפרש עיגול");
    txNum++;
  }

  for (const e of expenses) {
    const expenseAcct = accountKeys.expense(e.category ?? "");
    b100Lines.push(
      buildB100({
        recordNum: recordNum++,
        meta,
        transactionNum: txNum,
        transactionLine: 1,
        docRefNum: e.id.slice(0, 20),
        docTypeRef: "800",
        date: e.date,
        valueDate: e.date,
        accountKey: expenseAcct,
        counterAccountKey: "CASH",
        details: `${e.supplier} ${e.description ?? ""}`.slice(0, 50),
        amount: e.amount,
        side: "1",
      }),
    );
    b100Lines.push(
      buildB100({
        recordNum: recordNum++,
        meta,
        transactionNum: txNum,
        transactionLine: 2,
        docRefNum: e.id.slice(0, 20),
        docTypeRef: "800",
        date: e.date,
        valueDate: e.date,
        accountKey: "CASH",
        counterAccountKey: expenseAcct,
        details: `${e.supplier} ${e.description ?? ""}`.slice(0, 50),
        amount: e.amount,
        side: "2",
      }),
    );
    txNum++;
  }
  const b100Count = b100Lines.length;

  // ── Z900 footer ────────────────────────────────────────────────────
  const totalIncludingZ900 = recordNum; // recordNum is the next free slot = Z900's number
  const z900Line = buildZ900({
    recordNum: recordNum++,
    meta,
    totalRecords: totalIncludingZ900,
  });

  // ── Final BKMVDATA assembly ────────────────────────────────────────
  const bkmvdataText =
    buildA100({ recordNum: 1, meta }) +
    b110Lines.join("") +
    m100Lines.join("") +
    c100Lines.join("") +
    d110Lines.join("") +
    d120Lines.join("") +
    b100Lines.join("") +
    z900Line;

  const counts: RecordCounts = {
    total: totalIncludingZ900,
    c100: c100Count,
    d110: d110Count,
    d120: d120Count,
    b100: b100Count,
    b110: b110Count,
    m100: m100Count,
  };

  // ── INI.txt: A000 + summary records (one per type in BKMVDATA) ─────
  const summaries = [
    c100Count > 0 ? buildSummary({ recordType: "C100", count: c100Count }) : "",
    d110Count > 0 ? buildSummary({ recordType: "D110", count: d110Count }) : "",
    d120Count > 0 ? buildSummary({ recordType: "D120", count: d120Count }) : "",
    m100Count > 0 ? buildSummary({ recordType: "M100", count: m100Count }) : "",
    b100Count > 0 ? buildSummary({ recordType: "B100", count: b100Count }) : "",
    b110Count > 0 ? buildSummary({ recordType: "B110", count: b110Count }) : "",
  ].filter(Boolean).join("");
  const iniText = buildA000(meta, counts) + summaries;

  return {
    iniText,
    bkmvdataText,
    ini: toWindows1255(iniText),
    bkmvdata: toWindows1255(bkmvdataText),
    counts,
    docTypeSummary,
    generatedAt: meta.generatedAt,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-builder.test.ts tests/uniform-structure-preflight.test.ts tests/uniform-structure-records.test.ts tests/uniform-structure-parse.test.ts tests/uniform-structure-export-route.test.ts && npx tsc --noEmit`
Expected: PASS (the sample dataset still validates), tsc exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/wtp2 && git add src/lib/uniform-structure/builder.ts tests/uniform-structure-builder.test.ts tests/uniform-structure-preflight.test.ts && git commit -m "feat(uniform): padded dealer, shared account keys, shekel lines, capped rounding line" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Preflight - codes, shared normalizer, foreign currency unblocked

**Files:**
- Modify: `src/lib/uniform-structure/preflight.ts` (whole file)
- Modify: `src/app/api/uniform-structure/export/route.ts:204` and `:247` (keep compiling; the route is rewritten in Task 7)
- Test: `tests/uniform-structure-preflight.test.ts` (whole file)

- [ ] **Step 1: Write the failing test**

Replace the whole content of `tests/uniform-structure-preflight.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { buildUniformStructure, type UniformInput } from "@/lib/uniform-structure/builder";
import { validateUniformInput, validateUniformOutput } from "@/lib/uniform-structure/preflight";
import { generateSampleDataset } from "@/lib/uniform-structure/sample-data";
import { loadUniformPages } from "@/lib/uniform-structure/load-pages";
import type { Expense, InvoiceDocument } from "@/lib/types";

const doc: InvoiceDocument = { id: "doc1", type: "tax_invoice", number: 1, date: "2026-01-15", status: "paid", clientId: "", clientName: "לקוח", subtotal: 100, vat: 18, total: 118, items: [{ id: "item1", description: "שירות", quantity: 1, unitPrice: 100, total: 100 }] };
const input = (over: Partial<InvoiceDocument> = {}): UniformInput => ({ business: { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized", address: "רחוב" }, documents: [{ ...doc, ...over }], clients: [], expenses: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31" });
const errors = (data: UniformInput) => validateUniformInput(data).filter((i) => i.level === "error").map((i) => i.code);
const warnings = (data: UniformInput) => validateUniformInput(data).filter((i) => i.level === "warning").map((i) => i.code);

describe("uniform preflight", () => {
  it("validates the actual synthetic registration sample", () => {
    const data = input(); Object.assign(data, generateSampleDataset({ business: data.business, taxYear: 2026 }));
    expect(errors(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data), true)).toEqual([]);
  });

  it("accepts a consistent synthetic export without imposing simulator minimums", () => {
    const data = input();
    expect(validateUniformInput(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data), true).map((i) => i.code)).toContain("sample_too_small");
  });

  it.each([
    [{ total: NaN }, "amount_invalid"],
    [{ subtotal: Infinity }, "amount_invalid"],
    [{ total: 1e12 }, "amount_invalid"],
    [{ date: "2026-02-30" }, "date_invalid"],
    [{ currency: "USD", subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 }, "foreign_currency_invalid"],
    [{ currency: "USD", exchangeRate: 3.6 }, "foreign_currency_missing_ils"],
    [{ total: 119 }, "total_mismatch"],
    [{ paymentMethod: "check" as const }, "check_details_invalid"],
    [{ subtotalIls: 90 }, "ils_mismatch"],
  ] as Array<[Partial<InvoiceDocument>, string]>)("blocks bad original data %j with %s", (over, code) => {
    expect(errors(input(over))).toContain(code);
  });

  it("accepts a foreign-currency document with stored shekel amounts and a rate", () => {
    const data = input({ currency: "USD", exchangeRate: 3.6, subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 });
    expect(errors(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
  });

  it("accepts an 8-digit dealer number and blocks letters or a bad checksum with the stored value", () => {
    const short = input(); short.business = { ...short.business, taxId: "13333331" };
    expect(errors(short)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(short))).toEqual([]);
    for (const taxId of ["51234567X", "512345678", ""]) {
      const bad = input(); bad.business = { ...bad.business, taxId };
      expect(validateUniformInput(bad)).toContainEqual(expect.objectContaining({ code: "dealer_number_invalid", level: "error", source: "business", current: taxId }));
    }
  });

  it("writes a foreign id as a note, never a blocker, on the client and on the document", () => {
    const data = input({ clientId: "c1" });
    data.clients = [{ id: "c1", name: "Acme GmbH", taxId: "DE123456789", createdAt: "2026-01-01" }];
    expect(errors(data)).toEqual([]);
    expect(warnings(data)).toEqual(expect.arrayContaining(["client_number_not_israeli", "customer_number_not_israeli"]));
    const onDoc = input({ clientTaxId: "DE123456789" });
    expect(validateUniformInput(onDoc)).toContainEqual(expect.objectContaining({ code: "customer_number_not_israeli", sourceId: "doc1", current: "DE123456789" }));
  });

  it("blocks a missing linked client", () => {
    expect(errors(input({ clientId: "missing" }))).toContain("client_missing");
  });

  it("no longer blocks clients or categories whose short keys used to collide", () => {
    const data = input();
    data.clients = [{ id: "abcdefghij1", name: "א", createdAt: "2026-01-01" }, { id: "abcdefghij2", name: "ב", createdAt: "2026-01-01" }];
    const expenses: Expense[] = [
      { id: "e1", date: "2026-03-01", category: "הוצאות משרד כלליות", supplier: "ספק", amount: 10 },
      { id: "e2", date: "2026-03-02", category: "הוצאות משרד מיוחדות", supplier: "ספק", amount: 20 },
    ];
    data.expenses = expenses;
    expect(errors(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
  });

  it("accepts source rounding and balances the journal through the rounding account", () => {
    const data = input({ rounding: 0.4, total: 118.4 });
    expect(validateUniformInput(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
  });

  it("blocks a journal whose gap is larger than the stored rounding", () => {
    const data = input({ currency: "USD", exchangeRate: 3.5, total: 118.4, rounding: 0.4, subtotalIls: 350, vatIls: 63, totalIls: 415 });
    expect(errors(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data)).map((i) => i.code)).toContain("journal_unbalanced");
  });

  it("gives an expense date problem the stored value for the inline fix", () => {
    const data = input();
    data.expenses = [{ id: "e1", date: "2026-02-30", category: "x", supplier: "ספק", amount: 10 }];
    expect(validateUniformInput(data)).toContainEqual(expect.objectContaining({ code: "date_invalid", source: "expense", sourceId: "e1", current: "2026-02-30" }));
  });

  it("reports a duplicate account key in a built file", () => {
    const data = input(); data.clients = [{ id: "c1", name: "א", createdAt: "" }, { id: "c2", name: "ב", createdAt: "" }];
    const out = buildUniformStructure(data);
    const lines = out.bkmvdataText.split("\r\n").filter(Boolean);
    const b110 = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith("B110"));
    const [firstLine] = b110[0];
    const [secondLine, secondIndex] = b110[1];
    lines[secondIndex] = secondLine.slice(0, 22) + firstLine.slice(22, 37) + secondLine.slice(37);
    expect(validateUniformOutput({ ...out, bkmvdataText: lines.join("\r\n") + "\r\n" }).map((i) => i.code)).toContain("account_key_duplicate");
  });

  it("detects malformed date, orphan detail and altered footer with their codes", () => {
    const cases = [["date", 296, "20260230", "record_date_invalid"], ["link", 304, "9999999", "detail_link_invalid"], ["footer", 45, "999999999999999", "record_count_mismatch"]] as const;
    for (const [change, start, value, code] of cases) {
      const out = buildUniformStructure(input());
      const lines = out.bkmvdataText.split("\r\n").filter(Boolean);
      const index = change === "footer" ? lines.length - 1 : lines.findIndex((l) => l.startsWith("D110"));
      lines[index] = lines[index].slice(0, start) + value + lines[index].slice(start + value.length);
      expect(validateUniformOutput({ ...out, bkmvdataText: lines.join("\r\n") + "\r\n" }).map((i) => i.code)).toContain(code);
    }
  });

  it("gives every finding a code", () => {
    const data = input({ total: NaN, date: "2026-02-30" });
    expect(validateUniformInput(data).every((i) => typeof i.code === "string" && i.code.length > 0)).toBe(true);
  });
});

describe("uniform complete pagination", () => {
  it("reads beyond the default server cap", async () => {
    const rows = Array.from({ length: 1201 }, (_, n) => ({ id: String(n) }));
    expect(await loadUniformPages(async (from, to) => ({ data: rows.slice(from, to + 1), error: null, count: rows.length }))).toHaveLength(1201);
  });
  it("rejects failed, truncated and drifting pages", async () => {
    await expect(loadUniformPages(async () => ({ data: [], error: Error(), count: 0 }))).rejects.toThrow();
    await expect(loadUniformPages(async () => ({ data: [], error: null, count: 1 }))).rejects.toThrow();
    await expect(loadUniformPages(async from => ({ data: Array.from({ length: 500 }, (_, n) => ({ id: String(n + from) })), error: null, count: from ? 1001 : 1000 }))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-preflight.test.ts`
Expected: FAIL (no `code` on issues, 8-digit dealer rejected, foreign currency blocked, foreign ids blocking, collisions blocking).

- [ ] **Step 3: Write the implementation**

Replace the whole content of `src/lib/uniform-structure/preflight.ts` with:

```ts
import iconv from "iconv-lite";
import { normalizeBusinessNumber } from "../israeli-id";
import { validPcnDate, validPcnVatId } from "../ita/pcn874";
import { isForeignCurrency, uniformAmounts } from "./amounts";
import type { UniformInput, UniformOutput } from "./builder";
import type { UniformIssue, UniformIssueCode } from "./issues";
import { DOC_TYPE_CODE } from "./records";

const fits = (value: number, digits = 12, decimals = 2) => Number.isFinite(value) &&
  Math.round(Math.abs(value) * 10 ** decimals) < 10 ** (digits + decimals);
const compactDate = (v: string) => /^\d{8}$/.test(v) && validPcnDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

type Where = Pick<UniformIssue, "source" | "sourceId" | "sourceLabel" | "current" | "imported">;

/**
 * Checks the unmodified snapshot. Never convert malformed values into zero here.
 * Uses the same normalizer and amount helpers the builder writes with, so a
 * value passes here exactly when the file carries it correctly.
 */
export function validateUniformInput(input: UniformInput): UniformIssue[] {
  const issues: UniformIssue[] = [];
  const add = (code: UniformIssueCode, message: string, where: Where = {}, level: UniformIssue["level"] = "error") =>
    issues.push({ code, level, message, ...where });
  const business: Where = { source: "business" };

  // Same decision as the builder: an 8-digit עוסק without its leading zero is valid and padded in the file.
  if (!normalizeBusinessNumber(input.business.taxId).value)
    add("dealer_number_invalid", "מספר העוסק בהגדרות אינו תקין: ספרות בלבד, עד 9 ספרות, עם ספרת ביקורת תקינה.", { ...business, current: input.business.taxId ?? "" });
  if (!input.business.name?.trim()) add("business_name_missing", "חסר שם העסק בהגדרות.", business);
  if (!validPcnDate(input.fromDate) || !validPcnDate(input.toDate) || input.fromDate > input.toDate || !Number.isInteger(input.taxYear) || input.taxYear < 1900 || input.taxYear > 9999)
    add("period_invalid", "שנת המס או תאריכי הדוח אינם תקינים.");
  const text = (value: string | undefined, width: number, where: Where) => {
    if (value && (value.length > width || iconv.decode(iconv.encode(value, "windows-1255"), "windows-1255") !== value))
      add("text_truncated", "טקסט ארוך או תווים שאינם נתמכים יתקצרו או יוחלפו בקובץ. מומלץ לבדוק את הפרטים.", where, "warning");
  };
  text(input.business.name, 50, business);
  text(input.business.address, 50, business);

  const clientById = new Map(input.clients.map((c) => [c.id, c]));
  for (const c of input.clients) {
    const where: Where = { source: "client", sourceId: c.id, sourceLabel: c.name };
    // B110 1419 is written blank for a number the normalizer refuses: a note, never a blocker.
    if (c.taxId && !normalizeBusinessNumber(c.taxId).value)
      add("client_number_not_israeli", "מספר הזיהוי של הלקוח אינו מספר עוסק ישראלי, ולכן שדה מספר העוסק בכרטיס הלקוח בקובץ יישאר ריק. אם זה לקוח מחו״ל אין צורך לעשות דבר.", where, "warning");
    text(c.name, 50, where);
    text(c.address, 50, where);
  }

  const docKeys = new Set<string>();
  for (const d of input.documents) {
    const where: Where = { source: "document", sourceId: d.id, sourceLabel: `מסמך ${d.number}`, imported: Boolean(d.importBatchId) };
    if (!validPcnDate(d.date)) { add("date_invalid", "תאריך המסמך חסר או אינו תקין; לא ניתן לשייך אותו לשנת הדוח.", where); continue; }
    if (d.date < input.fromDate || d.date > input.toDate) continue;
    if (!(d.type in DOC_TYPE_CODE) || !Number.isSafeInteger(d.number) || d.number <= 0) add("document_number_invalid", "סוג או מספר המסמך אינו תקין.", where);
    const key = `${d.type}:${d.number}`;
    if (docKeys.has(key)) add("duplicate_document_number", "מספר מסמך כפול באותו סוג מסמך. בדוק את המסמכים לפני הייצוא.", where);
    docKeys.add(key);

    const foreign = isForeignCurrency(d);
    if (foreign) {
      // The file is in shekels (1032 = ILS): the document needs its stored
      // shekel amounts, and the rate its lines, discount and withholding are
      // converted with.
      if (![d.subtotalIls, d.vatIls, d.totalIls].every(finite))
        add("foreign_currency_missing_ils", "במסמך במטבע חוץ חסרים סכומי שקל שמורים, ולכן אי אפשר לכתוב אותו בקובץ בשקלים. נדרש תיקון נתונים.", where);
      const rate = d.exchangeRate;
      if (!/^[A-Z]{3}$/.test(String(d.currency)) || !finite(rate) || rate <= 0)
        add("foreign_currency_invalid", "במסמך במטבע חוץ חסר שער ההמרה או שקוד המטבע אינו תקין. נדרש תיקון נתונים.", where);
    } else if ([[d.subtotalIls, d.subtotal], [d.vatIls, d.vat], [d.totalIls, d.total]].some(([ils, original]) => ils != null && (!Number.isFinite(ils) || Math.abs(ils - original!) > 0.01))) {
      add("ils_mismatch", "סכומי השקל השמורים אינם תואמים לסכומי המסמך. נדרש תיקון הנתונים לפני הייצוא.", where);
    }
    const amounts = uniformAmounts(d);
    const shekelValues = foreign ? [amounts.subtotal, amounts.vat, amounts.total, amounts.discount, amounts.subtotal + amounts.discount].filter(Number.isFinite) : [];
    if (![d.subtotal, d.vat, d.total, d.discountAmount ?? 0, d.rounding ?? 0, d.subtotal + (d.discountAmount ?? 0), ...shekelValues].every((v) => fits(v)) || !fits(d.withholdingAmount ?? 0, 9))
      add("amount_invalid", "סכום חסר, לא מספרי או חורג מגודל השדה בקובץ.", where);
    // Stays blocking: the journal may post only the stored rounding, never a larger gap.
    if (Math.abs(d.subtotal + d.vat + (d.rounding ?? 0) - d.total) > 0.03) add("total_mismatch", "הסכום לפני מע״מ בתוספת המע״מ והעיגול אינו תואם לסכום הכולל.", where);
    if (d.clientId && !clientById.has(d.clientId)) add("client_missing", "הלקוח המקושר למסמך חסר בנתוני הדוח. יש לבדוק את קישור הלקוח.", where);
    if (d.items.length > 9999) add("too_many_lines", "מספר שורות המסמך חורג מגודל השדה בקובץ.", where);
    if (d.type !== "receipt" && Math.abs(d.items.reduce((sum, item) => sum + item.total, 0) - (d.discountAmount ?? 0) - d.subtotal) > 0.03)
      add("items_mismatch", "סכום שורות המסמך בניכוי ההנחה אינו תואם לסכום לפני מע״מ. בדוק את שורות המסמך.", where);
    for (const item of d.items) {
      if (!fits(item.quantity, 12, 4) || !fits(item.unitPrice) || !fits(item.total)) add("item_amount_invalid", "כמות או סכום בשורת המסמך חסרים או חורגים מגודל השדה.", where);
      text(item.description, 30, where);
    }
    text(d.clientName, 50, where);
    // C100 1215: the document's own number, else the linked client's (records.ts). Refused values are written blank.
    const customer = String(d.clientTaxId || (d.clientId ? clientById.get(d.clientId)?.taxId : "") || "").trim();
    if (customer && !normalizeBusinessNumber(customer).value)
      add("customer_number_not_israeli", "מספר הלקוח במסמך אינו מספר עוסק ישראלי, ולכן שדה מספר העוסק של הלקוח במסמך יישאר ריק בקובץ. אם זה לקוח מחו״ל אין צורך לעשות דבר.", { ...where, current: d.clientTaxId ?? "" }, "warning");
    if (d.paymentMethod === "check") {
      const pd = d.paymentDetails;
      const parts = [[pd?.checkBank, 10], [pd?.checkBranch, 10], [pd?.checkAccount, 15], [pd?.checkNumber, 10]] as const;
      if (parts.some(([value, width]) => !value || !new RegExp(`^\\d{1,${width}}$`).test(String(value))))
        add("check_details_invalid", "חסרים פרטי המחאה מספריים תקינים: בנק, סניף, חשבון ומספר המחאה.", where);
      if (pd?.checkDueDate && !validPcnDate(pd.checkDueDate)) add("check_due_date_invalid", "תאריך פירעון ההמחאה אינו תקין.", where);
    }
  }

  for (const e of input.expenses) {
    const where: Where = { source: "expense", sourceId: e.id, sourceLabel: e.supplier };
    if (!validPcnDate(e.date)) { add("date_invalid", "תאריך ההוצאה אינו תקין; לא ניתן לשייך אותה לשנת הדוח.", { ...where, current: e.date ?? "" }); continue; }
    if (e.date < input.fromDate || e.date > input.toDate) continue;
    if (!fits(e.amount)) add("expense_amount_invalid", "סכום ההוצאה חסר או חורג מגודל השדה בקובץ.", where);
  }
  return issues;
}

/** OPENFORMAT 1.31 field positions from records.ts and the local authority specification. */
export function validateUniformOutput(output: UniformOutput, sample = false): UniformIssue[] {
  const issues: UniformIssue[] = [];
  const add = (code: UniformIssueCode, message: string) => issues.push({ code, level: "error", message });
  const lines = output.bkmvdataText.split("\r\n").filter(Boolean);
  const ini = output.iniText.split("\r\n").filter(Boolean);
  const lengths: Record<string, number> = { A100: 95, Z900: 110, C100: 444, D110: 339, D120: 222, B100: 317, B110: 376, M100: 298 };
  const counts = new Map<string, number>();
  const recordNumbers = new Set<string>();
  const headers = new Map<string, string>();
  const accountKeyList = lines.filter(l => l.startsWith("B110")).map(l => l.slice(22, 37));
  const accounts = new Set(accountKeyList);
  const items = new Set(lines.filter(l => l.startsWith("M100")).map(l => l.slice(62, 82)));
  const journal = new Map<string, number>();
  const documentTotals = new Map<string, { count: number; total: number }>();
  const first = lines[0] ?? "", last = lines.at(-1) ?? "";
  if (!validPcnVatId(first.slice(13, 22))) add("file_dealer_invalid", "מספר העוסק בקובץ אינו תקין.");
  if (!first.startsWith("A100") || !last.startsWith("Z900") || first.slice(13, 45) !== last.slice(13, 45) || first.slice(37, 45) !== "&OF1.31&") add("file_envelope_mismatch", "רשומות הפתיחה והסיום או מזהי הקובץ אינם תואמים.");
  if (ini[0]?.length !== 466 || ini[0]?.slice(0, 4) !== "A000" || ini[0]?.slice(24, 56) !== first.slice(13, 45)) add("ini_header_mismatch", "כותרת INI אינה תואמת לקובץ הנתונים.");
  if (Number(last.slice(45, 60)) !== lines.length || Number(ini[0]?.slice(9, 24)) !== lines.length || output.counts.total !== lines.length) add("record_count_mismatch", "ספירת הרשומות בפתיחה או בסיום אינה תואמת לקובץ.");
  const signed = (s: string) => /^[+-]\d+$/.test(s) ? Number(s) : NaN;
  lines.forEach((line, index) => {
    const type = line.slice(0, 4);
    counts.set(type, (counts.get(type) ?? 0) + 1);
    if (line.length !== lengths[type] || Number(line.slice(4, 13)) < 1 || recordNumbers.has(line.slice(4, 13)) || !/^\d{9}$/.test(line.slice(4, 13)) || line.slice(13, 22) !== first.slice(13, 22)) add("record_invalid", `מבנה, מונה או מזהה עוסק לא תקין ברשומה ${index + 1}.`);
    recordNumbers.add(line.slice(4, 13));
    const dateOffsets: Record<string, number[]> = { C100: [45, 261, 400], D110: [296], D120: [95, 147], B100: [156, 164, 275] };
    if ((dateOffsets[type] ?? []).some(start => !compactDate(line.slice(start, start + 8)))) add("record_date_invalid", `תאריך לא תקין ברשומה ${index + 1}.`);
    const amounts: Record<string, Array<[number, number]>> = { C100: [[269,15],[287,15],[302,15],[317,15],[332,15],[347,15],[362,12]], D110: [[223,17],[240,15],[255,15],[270,15]], D120: [[103,15]], B100: [[206,15],[221,15],[236,12]], B110: [[277,15],[292,15],[307,15],[342,15]], M100: [[192,12],[204,12],[216,12]] };
    if ((amounts[type] ?? []).some(([start, width]) => !Number.isFinite(signed(line.slice(start, start + width))))) add("record_amount_invalid", `סכום או סימן לא תקין ברשומה ${index + 1}.`);
    if (type === "C100") {
      const link = line.slice(424, 431);
      if (!/^\d{7}$/.test(link) || Number(link) === 0 || headers.has(link)) add("document_link_invalid", "קישור כותרת מסמך חסר או כפול.");
      headers.set(link, line.slice(22, 45));
      const code = line.slice(22, 25), total = documentTotals.get(code) ?? { count: 0, total: 0 };
      total.count += 1; total.total += signed(line.slice(347, 362)); documentTotals.set(code, total);
    }
    if (type === "B100") {
      if (!accounts.has(line.slice(172, 187)) || !accounts.has(line.slice(187, 202))) add("journal_missing_account", "תנועת יומן מפנה לחשבון חסר.");
      const key = line.slice(22, 32), side = line[202];
      if (!"12".includes(side)) add("journal_side_invalid", "צד חובה או זכות אינו תקין בתנועת יומן.");
      journal.set(key, (journal.get(key) ?? 0) + signed(line.slice(206, 221)) * (side === "1" ? 1 : -1));
    }
    if (type === "D110" && !items.has(line.slice(73, 93))) add("detail_item_missing", "שורת פירוט מפנה לפריט חסר ברשימת הפריטים.");
  });
  for (const line of lines) {
    const type = line.slice(0, 4), offset = type === "D110" ? 304 : 155;
    if ((type === "D110" || type === "D120") && headers.get(line.slice(offset, offset + 7)) !== line.slice(22, 45)) add("detail_link_invalid", "שורת פירוט או תשלום אינה מקושרת לכותרת המסמך המתאימה.");
  }
  // Strict to 1 agora. The builder posts only the stored rounding (capped), so any other gap lands here.
  if ([...journal.values()].some(value => !Number.isFinite(value) || Math.abs(value) > 1))
    add("journal_unbalanced", "פקודת יומן אינה מאוזנת: הסכום הכולל אינו שווה לסכום לפני מע״מ, המע״מ והעיגול השמור במסמך. נדרש תיקון נתונים לפני הורדה.");
  if (accounts.size !== accountKeyList.length) add("account_key_duplicate", "שני חשבונות בקובץ קיבלו אותו מפתח. נדרש תיקון ייצוא לפני הורדה.");
  for (const [type, count] of counts) {
    if (type === "A100" || type === "Z900") { if (count !== 1) add("envelope_duplicate", "רשומת פתיחה או סיום כפולה."); continue; }
    const summaries = ini.slice(1).filter(l => l.slice(0, 4) === type);
    if (summaries.length !== 1 || summaries[0].length !== 19 || Number(summaries[0].slice(4)) !== count) add("ini_summary_mismatch", `סיכום ${type} בקובץ INI אינו תואם לספירה בפועל.`);
  }
  for (const summary of ini.slice(1)) {
    if (!counts.has(summary.slice(0, 4))) add("ini_summary_mismatch", "קובץ INI כולל סיכום לרשומות שאינן בקובץ הנתונים.");
  }
  for (const [code, value] of documentTotals) {
    const summary = output.docTypeSummary.find(row => row.code === code);
    if (!summary || summary.count !== value.count || Math.abs(Math.round(summary.total * 100) - value.total) > 1) add("doc_summary_mismatch", "סיכום המסמכים אינו תואם לסכומי כותרות המסמכים בקובץ.");
  }
  if (sample && (lines.length < 2000 || output.bkmvdata.length > 4 * 1024 * 1024)) add("sample_too_small", "קובץ הדוגמה לסימולטור הרישום חייב לכלול לפחות 2,000 רשומות וגודלו עד 4MB.");
  return issues;
}
```

- [ ] **Step 4: Keep the route compiling**

In `src/app/api/uniform-structure/export/route.ts` replace:

```ts
  if (!useSampleData && !software.registrationNumber) issues.push({ level: "warning", message: "מספר תעודת רישום התוכנה טרם הוזן. הבדיקה המקומית אינה אישור רישום או אישור קבלה מרשות המסים." });
```

with:

```ts
  if (!useSampleData && !software.registrationNumber) issues.push({ code: "software_registration_missing", level: "warning", message: "מספר תעודת רישום התוכנה טרם הוזן. הבדיקה המקומית אינה אישור רישום או אישור קבלה מרשות המסים." });
```

and replace:

```ts
    return NextResponse.json({ ok: false, error: "טעינת נתוני הדוח או בדיקת הקובץ נכשלה. לא הופק קובץ חלקי. נסה שוב.", issues: [{ level: "error", message: "לא ניתן לוודא שכל נתוני הדוח נטענו. נסה שוב לפני הורדה." }] }, { status: 503 });
```

with:

```ts
    return NextResponse.json({ ok: false, error: "טעינת נתוני הדוח או בדיקת הקובץ נכשלה. לא הופק קובץ חלקי. נסה שוב.", issues: [{ code: "data_load_failed", level: "error", message: "לא ניתן לוודא שכל נתוני הדוח נטענו. נסה שוב לפני הורדה." }] }, { status: 503 });
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-preflight.test.ts tests/uniform-structure-builder.test.ts tests/uniform-structure-export-route.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
cd /c/wtp2 && git add src/lib/uniform-structure/preflight.ts src/app/api/uniform-structure/export/route.ts tests/uniform-structure-preflight.test.ts && git commit -m "feat(uniform): coded preflight on the shared normalizer, foreign currency unblocked" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Row mappers, folder path and one check entry point for the route

**Files:**
- Create: `src/lib/uniform-structure/rows.ts`, `src/lib/uniform-structure/folder.ts`, `src/lib/uniform-structure/check.ts`
- Modify: `src/app/api/uniform-structure/export/route.ts` (whole file)
- Test: `tests/uniform-structure-rows.test.ts` (new), `tests/uniform-structure-export-route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/uniform-structure-rows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupUniformItems, mapUniformBusiness, mapUniformDocument, mapUniformExpense } from "@/lib/uniform-structure/rows";
import { uniformFolderPath } from "@/lib/uniform-structure/folder";
import { checkUniformExport } from "@/lib/uniform-structure/check";

describe("uniform rows", () => {
  it("maps the fields the export needs, including rate, customer number and import batch", () => {
    const d = mapUniformDocument({ id: "d", type: "tax_invoice", number: "12", date: "2026-03-01", client_id: null, client_name: "x", client_tax_id: "13333331", status: "sent", subtotal: "100", vat: "0", total: "100", currency: "USD", exchange_rate: "3.6", subtotal_ils: "360", vat_ils: null, total_ils: "360", rounding: null, import_batch_id: "b1" }, []);
    expect(d).toMatchObject({ number: 12, clientId: "", clientTaxId: "13333331", currency: "USD", exchangeRate: 3.6, subtotalIls: 360, totalIls: 360, rounding: 0, importBatchId: "b1" });
    expect(d.vatIls).toBeUndefined();
  });

  it("groups items per document in stored order", () => {
    const items = groupUniformItems([
      { id: "b", document_id: "d", sort_order: 2, description: "שני", quantity: "1", unit_price: "5", total: "5" },
      { id: "a", document_id: "d", sort_order: 1, description: "ראשון", quantity: 1, unit_price: 10, total: 10 },
    ]);
    expect(items.get("d")!.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("maps business and expense rows without inventing values", () => {
    expect(mapUniformBusiness({ id: "biz", name: null, business_type: "authorized", tax_id: null, address: null })).toMatchObject({ name: "", taxId: "", address: "" });
    expect(mapUniformExpense({ id: "e", date: "2026-01-02", category: null, supplier: "s", amount: "7", vat_amount: null })).toMatchObject({ category: "", amount: 7, vatAmount: 0 });
  });
});

describe("uniform folder path", () => {
  it("names the folder with the padded dealer number without its check digit", () => {
    const at = new Date(2026, 0, 5, 9, 7);
    expect(uniformFolderPath("512345679", at)).toBe("OPENFRMT/51234567.26/01050907");
    expect(uniformFolderPath("13333331", at)).toBe("OPENFRMT/01333333.26/01050907");
  });
});

describe("checkUniformExport", () => {
  const business = { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized" as const, address: "" };
  const input = { business, documents: [], clients: [], expenses: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31" };

  it("builds and checks a clean export, noting a missing registration number", () => {
    const check = checkUniformExport(input, { sample: false, registrationNumber: "" });
    expect(check.ok).toBe(true);
    expect(check.result).not.toBeNull();
    expect(check.issues.map((i) => i.code)).toEqual(["software_registration_missing"]);
  });

  it("does not build when the input blocks", () => {
    const check = checkUniformExport({ ...input, business: { ...business, taxId: "1" } }, { registrationNumber: "12345678" });
    expect(check).toMatchObject({ ok: false, result: null });
    expect(check.issues.map((i) => i.code)).toContain("dealer_number_invalid");
  });
});
```

Note: `"1"` pads to `000000001`, whose checksum fails, so it is refused.

In `tests/uniform-structure-export-route.test.ts`, inside `describe("uniform export endpoint enforcement", ...)`, after the "blocks direct download with 422" test, add:

```ts
  it("accepts an 8-digit dealer number and names the folder and file with the padded number", async () => {
    state.taxId = "13333331";
    expect((await (await GET(request("&preflight=true"))).json()).ok).toBe(true);
    const download = await GET(request());
    expect(download.status).toBe(200);
    expect(JSON.parse(download.headers.get("X-Uniform-Report")!).path).toMatch(/^OPENFRMT\/01333333\.\d{2}\/\d{8}$/);
    expect(download.headers.get("content-disposition")).toContain("OPENFRMT-013333331-2026.zip");
  });
  it("gives every issue a stable code", async () => {
    state.taxId = "123";
    const body = await (await GET(request("&preflight=true"))).json();
    expect(body.issues.every((i: { code?: string }) => typeof i.code === "string" && i.code.length > 0)).toBe(true);
    expect(body.issues.map((i: { code: string }) => i.code)).toContain("dealer_number_invalid");
  });
```

And replace the last test:

```ts
  it("refuses to turn failed data requests into empty exports", async () => {
    state.fail = true;
    expect((await GET(request())).status).toBe(503);
  });
```

with:

```ts
  it("refuses to turn failed data requests into empty exports", async () => {
    state.fail = true;
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect((await response.json()).issues[0].code).toBe("data_load_failed");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-rows.test.ts tests/uniform-structure-export-route.test.ts`
Expected: FAIL (modules missing; the route names the folder `13333331.YY` and the file `OPENFRMT-13333331-2026.zip`).

- [ ] **Step 3: Create `src/lib/uniform-structure/rows.ts`**

```ts
// Pure row mappers for the מבנה אחיד export. Shared by the export route and
// the nightly guard, so both check exactly the same values. No Supabase here.
import type { Business, Client, DocumentItem, Expense, InvoiceDocument } from "../types";

type Row = Record<string, unknown>;

const numeric = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
const optionalNumber = (value: unknown) => (value == null ? undefined : numeric(value));
const optionalText = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const text = (value: unknown) => (typeof value === "string" ? value : "");

export function mapUniformBusiness(row: Row): Business {
  return {
    id: String(row.id),
    name: text(row.name),
    businessType: row.business_type as Business["businessType"],
    taxId: text(row.tax_id),
    address: text(row.address),
    phone: optionalText(row.phone),
    email: optionalText(row.email),
  };
}

/** Items grouped per document, in their stored order. */
export function groupUniformItems(rows: readonly Row[]): Map<string, DocumentItem[]> {
  const byDoc = new Map<string, DocumentItem[]>();
  for (const row of [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order))) {
    const documentId = String(row.document_id);
    if (!byDoc.has(documentId)) byDoc.set(documentId, []);
    byDoc.get(documentId)!.push({
      id: String(row.id),
      productId: optionalText(row.product_id),
      description: text(row.description),
      quantity: numeric(row.quantity),
      unitPrice: numeric(row.unit_price),
      total: numeric(row.total),
    });
  }
  return byDoc;
}

export function mapUniformClient(row: Row): Client {
  return {
    id: String(row.id),
    name: text(row.name),
    taxId: optionalText(row.tax_id),
    address: optionalText(row.address),
    phone: optionalText(row.phone),
    email: optionalText(row.email),
    createdAt: text(row.created_at).slice(0, 10),
  };
}

export function mapUniformDocument(row: Row, items: DocumentItem[]): InvoiceDocument {
  return {
    id: String(row.id),
    type: row.type as InvoiceDocument["type"],
    number: numeric(row.number),
    date: text(row.date),
    clientId: text(row.client_id),
    clientName: text(row.client_name),
    clientTaxId: optionalText(row.client_tax_id),
    subject: optionalText(row.subject),
    status: (row.status as InvoiceDocument["status"]) || "draft",
    items,
    subtotal: numeric(row.subtotal),
    vat: numeric(row.vat),
    total: numeric(row.total),
    // Shekel snapshots stay undefined when missing: the preflight blocks them,
    // nothing falls back to native amounts.
    currency: optionalText(row.currency),
    exchangeRate: optionalNumber(row.exchange_rate),
    subtotalIls: optionalNumber(row.subtotal_ils),
    vatIls: optionalNumber(row.vat_ils),
    totalIls: optionalNumber(row.total_ils),
    rounding: row.rounding == null ? 0 : numeric(row.rounding),
    discountAmount: optionalNumber(row.discount_amount),
    withholdingAmount: optionalNumber(row.withholding_amount),
    convertedToId: optionalText(row.converted_to_id),
    paymentDetails: row.payment_details as InvoiceDocument["paymentDetails"],
    paymentMethod: (row.payment_method as InvoiceDocument["paymentMethod"]) || undefined,
    notes: optionalText(row.notes),
    allocationNumber: optionalText(row.allocation_number),
    importBatchId: optionalText(row.import_batch_id),
  };
}

export function mapUniformExpense(row: Row): Expense {
  return {
    id: String(row.id),
    date: text(row.date),
    category: text(row.category),
    supplier: text(row.supplier),
    amount: numeric(row.amount),
    description: optionalText(row.description),
    vatAmount: row.vat_amount != null ? Number(row.vat_amount) : 0,
  };
}
```

- [ ] **Step 4: Create `src/lib/uniform-structure/folder.ts`**

```ts
import { normalizeBusinessNumber } from "../israeli-id";

/**
 * `OPENFRMT/<dealer number without its check digit>.<YY>/<MMDDhhmm>`, section 2.2.
 * The dealer number is the padded 9-digit form the file carries, so an 8-digit
 * עוסק gets its leading zero here too. Lives outside the route file because a
 * Next.js route file may export only its handlers.
 */
export function uniformFolderPath(taxId: string, at: Date): string {
  const dealer = (normalizeBusinessNumber(taxId).value ?? taxId.replace(/\D/g, "").slice(-9).padStart(9, "0")).slice(0, 8);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = String(at.getFullYear()).slice(-2);
  const stamp = `${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `OPENFRMT/${dealer}.${yy}/${stamp}`;
}
```

- [ ] **Step 5: Create `src/lib/uniform-structure/check.ts`**

```ts
// The one entry point for "can this מבנה אחיד export be downloaded": input
// checks, build, output checks. The export route and the nightly guard both
// call it, so the guard counts exactly what users are stopped by.
import { buildUniformStructure, type UniformInput, type UniformOutput } from "./builder";
import type { UniformIssue } from "./issues";
import { validateUniformInput, validateUniformOutput } from "./preflight";

export interface UniformCheck {
  issues: UniformIssue[];
  /** Null when the input already blocks: nothing is built from bad data. */
  result: UniformOutput | null;
  ok: boolean;
}

export function checkUniformExport(input: UniformInput, options: { sample?: boolean; registrationNumber?: string } = {}): UniformCheck {
  const sample = options.sample ?? false;
  const issues = validateUniformInput(input);
  if (!sample && !options.registrationNumber)
    issues.push({ code: "software_registration_missing", level: "warning", message: "מספר תעודת רישום התוכנה טרם הוזן. הבדיקה המקומית אינה אישור רישום או אישור קבלה מרשות המסים." });
  if (issues.some((issue) => issue.level === "error")) return { issues, result: null, ok: false };
  const result = buildUniformStructure(input);
  issues.push(...validateUniformOutput(result, sample));
  return { issues, result, ok: !issues.some((issue) => issue.level === "error") };
}
```

- [ ] **Step 6: Rewrite the route**

Replace the whole content of `src/app/api/uniform-structure/export/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { checkUniformExport } from "@/lib/uniform-structure/check";
import { uniformFolderPath } from "@/lib/uniform-structure/folder";
import { loadUniformPages } from "@/lib/uniform-structure/load-pages";
import { groupUniformItems, mapUniformBusiness, mapUniformClient, mapUniformDocument, mapUniformExpense } from "@/lib/uniform-structure/rows";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { normalizeBusinessNumber } from "@/lib/israeli-id";
import { generateSampleDataset } from "@/lib/uniform-structure/sample-data";
import { UNIFORM_SOFTWARE } from "@/lib/uniform-structure/software";
import type { Client, Expense, InvoiceDocument } from "@/lib/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type ExportRow = Record<string, unknown> & { id: string };

/**
 * "מבנה אחיד" / OPENFORMAT 1.31 export. Bundles INI.txt + BKMVDATA.txt
 * (both in Windows-1255) into a single ZIP for download. Used by Tax
 * Authority auditors and by Asaf to feed the official simulator when
 * registering the software in מרשם תוכנות.
 *
 * Query params:
 *   year: 4-digit tax year (defaults to current year)
 *   preflight=true: JSON issues only (every issue carries a stable code)
 *   sample=true: synthetic 2000+ record dataset for the registry simulator
 *
 * Auth: Bearer token; resolves to user → business owned by that user.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const preflight = searchParams.get("preflight") === "true";
  const ip = clientIp(req);
  const rl = checkRate({ key: `uniform:${preflight ? "preflight" : "download"}:${user.id}:${ip}`, max: preflight ? 12 : 3, windowMs: 5 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "המתן 5 דקות בין הורדות." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

  const yearStr = searchParams.get("year");
  const taxYear = yearStr && /^\d{4}$/.test(yearStr)
    ? parseInt(yearStr, 10)
    : new Date().getFullYear();
  if (yearStr && (!/^\d{4}$/.test(yearStr) || taxYear < 1900)) return NextResponse.json({ ok: false, error: "שנת מס לא תקינה" }, { status: 400 });
  try {
  const fromDate = `${taxYear}-01-01`;
  const toDate = `${taxYear}-12-31`;
  // sample=true → synthesize 2000+ records for the Tax Authority's
  // software-registry simulator (which rejects files <2000 records).
  const useSampleData = searchParams.get("sample") === "true";

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: bizRows, error: bizError } = await sb
    .from("businesses")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);
  if (bizError) throw new Error("Business lookup failed");
  const bizRow = bizRows?.[0];
  if (!bizRow) {
    return NextResponse.json({ ok: false, error: "אין עסק פעיל" }, { status: 400 });
  }

  const business = mapUniformBusiness(bizRow);

  let clients: Client[];
  let documents: InvoiceDocument[];
  let expenses: Expense[];

  if (useSampleData) {
    const sample = generateSampleDataset({ business, taxYear });
    clients = sample.clients;
    documents = sample.documents;
    expenses = sample.expenses;
  } else {
    const [clientRows, docRows, expenseRows] = await Promise.all([
      loadUniformPages<ExportRow>((from, to) => sb.from("clients").select("*", { count: "exact" }).eq("business_id", business.id).order("id").range(from, to)),
      loadUniformPages<ExportRow>((from, to) => sb.from("documents").select("*", { count: "exact" }).eq("business_id", business.id).order("id").range(from, to)),
      loadUniformPages<ExportRow>((from, to) => sb.from("expenses").select("*", { count: "exact" }).eq("business_id", business.id).order("id").range(from, to)),
    ]);
    const docIds = docRows.map(d => d.id);
    const itemRows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < docIds.length; offset += 100) {
      const ownedIds = docIds.slice(offset, offset + 100);
      itemRows.push(...await loadUniformPages<ExportRow>((from, to) => sb.from("document_items").select("*", { count: "exact" }).in("document_id", ownedIds).order("id").range(from, to)));
    }
    const itemsByDoc = groupUniformItems(itemRows);
    clients = clientRows.map(mapUniformClient);
    documents = docRows.map((row) => mapUniformDocument(row, itemsByDoc.get(row.id) ?? []));
    expenses = expenseRows.map(mapUniformExpense);
  }

  // The printed 5.4 report quotes the software identity too, so it travels
  // in the header rather than being retyped on the client.
  const software = {
    name: UNIFORM_SOFTWARE.name,
    version: UNIFORM_SOFTWARE.version,
    registrationNumber: UNIFORM_SOFTWARE.registrationNumber,
  };
  const { issues, result, ok } = checkUniformExport(
    { business, documents, clients, expenses, taxYear, fromDate, toDate },
    { sample: useSampleData, registrationNumber: software.registrationNumber },
  );
  if (preflight || !ok || !result) return NextResponse.json({ ok, issues, counts: result?.counts, error: ok ? undefined : "יש לתקן את השגיאות לפני הורדת הקובץ." }, { status: preflight ? 200 : 422 });

  // Section 2.2 of the spec fixes the folder the files live in:
  //   OPENFRMT\<dealer number without check digit>.<YY>\<MMDDhhmm>
  // so the ZIP mirrors it. Unzipping gives the auditor the exact tree the
  // desktop products produce, and the printed 5.4 report names the same path.
  const dealerVat = normalizeBusinessNumber(business.taxId).value ?? business.taxId;
  const openfrmtPath = uniformFolderPath(business.taxId, result.generatedAt);
  const zip = new JSZip();
  zip.file(`${openfrmtPath}/INI.TXT`, result.ini);
  zip.file(`${openfrmtPath}/BKMVDATA.TXT`, result.bkmvdata);
  const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  // Everything the on-screen "דוח הפקה" (sections 2.6 + 5.4) needs, as one
  // ASCII-only header - labels are added client-side, header values cannot
  // carry Hebrew.
  const report = {
    generatedAt: result.generatedAt.toISOString(),
    path: openfrmtPath,
    fromDate,
    toDate,
    taxYear,
    sample: useSampleData,
    software,
    counts: result.counts,
    docTypes: result.docTypeSummary.map((r) => [r.code, r.count, r.total]),
  };

  const filename = `OPENFRMT-${dealerVat}-${taxYear}${useSampleData ? "-SAMPLE" : ""}.zip`;
  return new NextResponse(blob as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Record-Count": String(result.counts.total),
      "X-Doc-Count": String(result.counts.c100),
      "X-Uniform-Report": JSON.stringify(report),
    },
  });
  } catch {
    return NextResponse.json({ ok: false, error: "טעינת נתוני הדוח או בדיקת הקובץ נכשלה. לא הופק קובץ חלקי. נסה שוב.", issues: [{ code: "data_load_failed", level: "error", message: "לא ניתן לוודא שכל נתוני הדוח נטענו. נסה שוב לפני הורדה." }] }, { status: 503 });
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-structure-rows.test.ts tests/uniform-structure-export-route.test.ts tests/uniform-structure-preflight.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 8: Commit**

```bash
cd /c/wtp2 && git add src/lib/uniform-structure/rows.ts src/lib/uniform-structure/folder.ts src/lib/uniform-structure/check.ts src/app/api/uniform-structure/export/route.ts tests/uniform-structure-rows.test.ts tests/uniform-structure-export-route.test.ts && git commit -m "refactor(uniform): shared row mappers, padded folder path, one check entry point" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Shared fix-model plumbing and a support message per report

**Files:**
- Modify: `src/lib/support-link.ts` (whole file)
- Modify: `src/lib/filing-fix-items.ts` (imports 4-5, `FixControl` 7-20, `FilingFixItem` 24-33, new helpers after `documentRepairControl`, `buildFilingFixModel` 115-132, 214, 224)
- Test: `tests/support-link.test.ts`, `tests/filing-fix-items.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("support link", ...)` in `tests/support-link.test.ts`:

```ts
  it("names the report the fix is for, PCN874 by default", () => {
    expect(filingDataFixMessage("d", "journal_unbalanced", "uniform")).toContain("מבנה אחיד");
    expect(filingDataFixMessage("d", "duplicate_number", "invoices_period")).toContain("דוח החשבוניות");
    expect(filingDataFixMessage("d", "sign_mismatch")).toContain("הדיווח המפורט");
  });
```

In `tests/filing-fix-items.test.ts` change line 3 to:

```ts
import { buildFilingFixModel, createFixCollector, splitFixTiers } from "@/lib/filing-fix-items";
```

and append at the end of the file:

```ts
describe("createFixCollector", () => {
  it("merges findings under one key, escalates to blocking and keeps messages and labels unique", () => {
    const c = createFixCollector((code) => `title:${code}`);
    c.put("k", "note", "text_truncated", { kind: "none" }, "a", "L1");
    c.put("k", "blocking", "record_invalid", { kind: "none" }, "b", "L1");
    c.put("k", "note", "text_truncated", { kind: "none" }, "a", "L2");
    const [item] = c.items();
    expect(item).toMatchObject({ tier: "blocking", code: "text_truncated", title: "title:text_truncated", messages: ["a", "b"], labels: ["L1", "L2"] });
    expect(splitFixTiers(c.items())).toEqual({ blocking: [item], actions: [], notes: [], periodOnly: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/wtp2 && npx vitest run tests/support-link.test.ts tests/filing-fix-items.test.ts`
Expected: FAIL (`createFixCollector` is not exported; the message ignores the report).

- [ ] **Step 3: Implement - support link**

Replace the whole content of `src/lib/support-link.ts` with:

```ts
/** Asaf's WhatsApp, the app's support channel (same number as the sidebar bug button). */
export const SUPPORT_WHATSAPP_PHONE = "972549000684";

/** Which filing report a support request is about. */
export type FilingReportKind = "pcn874" | "uniform" | "invoices_period";

const PURPOSE: Record<FilingReportKind, string> = {
  pcn874: "כדי להגיש את הדיווח המפורט למע״מ",
  uniform: "כדי להפיק קובץ מבנה אחיד",
  invoices_period: "כדי שדוח החשבוניות התקופתי יהיה מלא",
};

export function supportWhatsappHref(text: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(text)}`;
}

/**
 * The prefilled request for a data fix on a locked document. Deliberately
 * only the document id and the error code: never amounts or names.
 */
export function filingDataFixMessage(documentId: string | undefined, code: string, report: FilingReportKind = "pcn874"): string {
  return [
    `היי, צריך תיקון נתונים ${PURPOSE[report]}.`,
    ...(documentId ? [`מזהה מסמך: ${documentId}`] : []),
    `קוד: ${code}`,
  ].join("\n");
}
```

- [ ] **Step 4: Implement - fix items**

In `src/lib/filing-fix-items.ts` replace:

```ts
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
  | { kind: "period" }
  | { kind: "settings" }
  | { kind: "none" };
```

with:

```ts
import type { Expense, InvoiceDocument } from "./types";
import { referenceDigits, sourceVatIdForPcn, type Pcn874Result, type PcnIssueCode, type PcnWarning } from "./ita/pcn874";
import type { FilingReportKind } from "./support-link";
import type { UniformIssueCode } from "./uniform-structure/issues";

/** Every code a filing panel can show: PCN874, uniform structure, invoices-period. */
export type FixCode = PcnIssueCode | UniformIssueCode;

export type FixControl =
  | { kind: "supplier_tax_id"; expenseIds: string[]; current: string }
  | { kind: "supplier_reference"; expenseId: string; current: string }
  | { kind: "expense_allocation"; expenseId: string; current: string }
  | { kind: "expense_date"; expenseId: string; current: string }
  | { kind: "business_tax_id"; current: string }
  | { kind: "customer_tax_id"; documentId: string; current: string }
  | { kind: "credit_note"; documentId: string }
  /** `report` names the report in the support message; omitted means PCN874. */
  | { kind: "support"; documentId?: string; code: FixCode; report?: FilingReportKind }
  | { kind: "open_expense"; expenseId: string }
  | { kind: "open_document"; documentId: string }
  | { kind: "open_client"; clientId: string }
  | { kind: "period" }
  | { kind: "settings" }
  | { kind: "none" };
```

Replace:

```ts
export interface FilingFixItem {
  key: string;
  tier: FixTier;
  code: PcnIssueCode;
```

with:

```ts
export interface FilingFixItem {
  key: string;
  tier: FixTier;
  code: FixCode;
```

Directly after the closing `}` of `documentRepairControl` add:

```ts
export interface FixCollector {
  put(key: string, tier: FixTier, code: FixCode, control: FixControl, message: string, label?: string, excludedVat?: number): void;
  items(): FilingFixItem[];
}

/**
 * Items keyed by the fix. A second finding under the same key adds its
 * message and label, escalates the tier to blocking when it blocks, and merges
 * grouped supplier expenses. Shared by every filing report's panel model.
 */
export function createFixCollector(titleOf: (code: FixCode) => string): FixCollector {
  const items = new Map<string, FilingFixItem>();
  return {
    put(key, tier, code, control, message, label, excludedVat) {
      const existing = items.get(key);
      if (!existing) {
        items.set(key, { key, tier, code, title: titleOf(code), messages: [message], labels: label ? [label] : [], control, excludedVat });
        return;
      }
      if (tier === "blocking") existing.tier = "blocking";
      if (!existing.messages.includes(message)) existing.messages.push(message);
      if (label && !existing.labels.includes(label)) existing.labels.push(label);
      if (control.kind === "supplier_tax_id" && existing.control.kind === "supplier_tax_id") {
        for (const id of control.expenseIds) if (!existing.control.expenseIds.includes(id)) existing.control.expenseIds.push(id);
      }
    },
    items: () => [...items.values()],
  };
}

export function splitFixTiers(all: readonly FilingFixItem[]): FilingFixModel {
  return {
    blocking: all.filter((i) => i.tier === "blocking"),
    actions: all.filter((i) => i.tier === "action"),
    notes: all.filter((i) => i.tier === "note"),
    periodOnly: false,
  };
}
```

In `buildFilingFixModel` replace:

```ts
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
```

with:

```ts
  const collector = createFixCollector((code) => FIX_TITLES[code as PcnIssueCode] ?? code);
  const put = collector.put;
  const suppliers = new Map<string, { name: string; hasNumber: boolean }>();
```

Replace `  for (const item of items.values()) {` with `  for (const item of collector.items()) {` and replace `  const all = [...items.values()];` with `  const all = collector.items();`.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd /c/wtp2 && npx vitest run tests/support-link.test.ts tests/filing-fix-items.test.ts && npx tsc --noEmit`
Expected: PASS (every Phase 1 fix-items case unchanged), tsc exits 0.

- [ ] **Step 6: Commit**

```bash
cd /c/wtp2 && git add src/lib/support-link.ts src/lib/filing-fix-items.ts tests/support-link.test.ts tests/filing-fix-items.test.ts && git commit -m "refactor(filing): shared fix collector, open-client control, per-report support message" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Uniform issues to the panel model

**Files:**
- Create: `src/lib/uniform-fix-items.ts`
- Test: `tests/uniform-fix-items.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/uniform-fix-items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildUniformFixModel } from "@/lib/uniform-fix-items";
import { validateUniformInput } from "@/lib/uniform-structure/preflight";
import type { UniformIssue } from "@/lib/uniform-structure/issues";

const base = { business: { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized" as const, address: "" }, clients: [], expenses: [], documents: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31" };

describe("buildUniformFixModel", () => {
  it("routes an invalid business number to the inline business-number field", () => {
    const m = buildUniformFixModel(validateUniformInput({ ...base, business: { ...base.business, taxId: "51234567X" } }));
    expect(m.blocking.map((i) => [i.code, i.control])).toEqual([["dealer_number_invalid", { kind: "business_tax_id", current: "51234567X" }]]);
  });

  it("fixes an expense date inline", () => {
    const m = buildUniformFixModel([{ code: "date_invalid", level: "error", message: "m", source: "expense", sourceId: "e1", sourceLabel: "ספק", current: "2026-02-30" }]);
    expect(m.blocking[0].control).toEqual({ kind: "expense_date", expenseId: "e1", current: "2026-02-30" });
  });

  it("sends one support request per locked document, with every message", () => {
    const issues: UniformIssue[] = [
      { code: "total_mismatch", level: "error", message: "a", source: "document", sourceId: "d1", sourceLabel: "מסמך 7" },
      { code: "items_mismatch", level: "error", message: "b", source: "document", sourceId: "d1", sourceLabel: "מסמך 7" },
    ];
    const m = buildUniformFixModel(issues);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0]).toMatchObject({ messages: ["a", "b"], labels: ["מסמך 7"], control: { kind: "support", documentId: "d1", code: "total_mismatch", report: "uniform" } });
  });

  it("shows a built-file problem once, however many records hit it", () => {
    const issues: UniformIssue[] = [1, 2, 3].map((n) => ({ code: "record_invalid", level: "error", message: `רשומה ${n}` }));
    const m = buildUniformFixModel(issues);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0].control).toEqual({ kind: "support", code: "record_invalid", report: "uniform" });
  });

  it("keeps foreign ids and other notes collapsed, with the right controls", () => {
    const m = buildUniformFixModel([
      { code: "customer_number_not_israeli", level: "warning", message: "m", source: "document", sourceId: "d1", current: "DE1" },
      { code: "client_number_not_israeli", level: "warning", message: "m", source: "client", sourceId: "c1" },
      { code: "software_registration_missing", level: "warning", message: "m" },
    ]);
    expect(m.blocking).toEqual([]);
    expect(m.notes.map((i) => i.control)).toEqual([
      { kind: "customer_tax_id", documentId: "d1", current: "DE1" },
      { kind: "open_client", clientId: "c1" },
      { kind: "none" },
    ]);
  });

  it("an empty list is ready", () => {
    expect(buildUniformFixModel([])).toEqual({ blocking: [], actions: [], notes: [], periodOnly: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-fix-items.test.ts`
Expected: FAIL, cannot resolve `@/lib/uniform-fix-items`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/uniform-fix-items.ts`:

```ts
// The "what's left before the download" model for the מבנה אחיד export on
// /reports. Pure: takes the route's coded issues and returns grouped items,
// each with the one control that fixes it. The panel only renders this.
import { createFixCollector, splitFixTiers, type FilingFixModel, type FixControl, type FixTier } from "./filing-fix-items";
import { UNIFORM_FIX_TITLES, type UniformIssue, type UniformIssueCode } from "./uniform-structure/issues";

function controlFor(issue: UniformIssue): FixControl {
  const support: FixControl = {
    kind: "support",
    ...(issue.source === "document" && issue.sourceId ? { documentId: issue.sourceId } : {}),
    code: issue.code,
    report: "uniform",
  };
  switch (issue.code) {
    case "dealer_number_invalid":
      return { kind: "business_tax_id", current: issue.current ?? "" };
    case "business_name_missing":
      return { kind: "settings" };
    case "period_invalid":
    case "software_registration_missing":
    case "data_load_failed":
    case "rate_limited":
      return { kind: "none" };
    case "client_number_not_israeli":
      return issue.sourceId ? { kind: "open_client", clientId: issue.sourceId } : { kind: "none" };
    case "customer_number_not_israeli":
      // The document's own number, written through the path the immutability trigger allows.
      return issue.sourceId ? { kind: "customer_tax_id", documentId: issue.sourceId, current: issue.current ?? "" } : { kind: "none" };
    case "text_truncated":
      if (issue.source === "business") return { kind: "settings" };
      if (issue.source === "client" && issue.sourceId) return { kind: "open_client", clientId: issue.sourceId };
      if (issue.source === "document" && issue.sourceId) return { kind: "open_document", documentId: issue.sourceId };
      return { kind: "none" };
    case "date_invalid":
      return issue.source === "expense" && issue.sourceId ? { kind: "expense_date", expenseId: issue.sourceId, current: issue.current ?? "" } : support;
    case "expense_amount_invalid":
      return issue.sourceId ? { kind: "open_expense", expenseId: issue.sourceId } : { kind: "none" };
    default:
      // Everything else is data on a locked document or a problem in the built
      // file: a data fix, requested with the document id and the code only.
      return support;
  }
}

export function buildUniformFixModel(issues: readonly UniformIssue[]): FilingFixModel {
  const collector = createFixCollector((code) => UNIFORM_FIX_TITLES[code as UniformIssueCode] ?? code);
  for (const issue of issues) {
    const tier: FixTier = issue.level === "error" ? "blocking" : "note";
    const control = controlFor(issue);
    // One support request per document and one per file-level code; every other finding on its own.
    const key = control.kind === "support" ? `support:${control.documentId ?? issue.code}` : `${tier}:${issue.code}:${issue.sourceId ?? ""}`;
    collector.put(key, tier, issue.code, control, issue.message, issue.sourceLabel);
  }
  return splitFixTiers(collector.items());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtp2 && npx vitest run tests/uniform-fix-items.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/wtp2 && git add src/lib/uniform-fix-items.ts tests/uniform-fix-items.test.ts && git commit -m "feat(uniform): what-is-left model for the uniform export" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 10: Panel - open client, re-check after save, advisory mode

No component test harness exists (vitest runs in node); this task is verified by `tsc`, by the E2E in Task 18 and by the screenshots.

**Files:**
- Modify: `src/components/filing-fix-panel.tsx` (context/props 32-56, `FixItemCard` 109, `FixControlView` 124-228, `InlineSave` 261-291, `DateSave` 318-327)

- [ ] **Step 1: Props, headline and tier attribute**

Replace:

```tsx
  /** Switches the report to the last ended bi-monthly period. */
  onUseFilingPeriod?: () => void;
}

interface Props extends Context {
  model: FilingFixModel;
}

/** The single "what's left before the download" panel on /reports/vat. */
export function FilingFixPanel({ model, ...context }: Props) {
  const [notesOpen, setNotesOpen] = useState(false);
  const count = model.blocking.length;
  const headline = model.periodOnly
    ? "את הקובץ המפורט מורידים לתקופת דיווח"
    : count === 0
      ? "הכל מוכן"
      : count === 1
        ? "נשאר דבר אחד לפני ההורדה"
        : `נשארו ${count} דברים לפני ההורדה`;
  const tone = model.periodOnly ? "text-stone-800" : count ? "text-rose-800" : "text-emerald-800";
  const Icon = model.periodOnly ? CalendarRange : count ? AlertCircle : CheckCircle2;
```

with:

```tsx
  /** Switches the report to the last ended bi-monthly period. */
  onUseFilingPeriod?: () => void;
  /**
   * Called after an inline save lands. Reports whose check runs on the server
   * (the uniform export) re-check here; client-side reports refresh from the
   * store events and leave it out.
   */
  onSaved?: () => void;
}

interface Props extends Context {
  model: FilingFixModel;
  /**
   * An advisory report (the invoices-period listing) never blocks its
   * download: "action" items are findings that change its totals, and the
   * headline says so instead of "ready".
   */
  advisory?: boolean;
}

/** The single "what's left" panel shared by the filing reports. */
export function FilingFixPanel({ model, advisory = false, ...context }: Props) {
  const [notesOpen, setNotesOpen] = useState(false);
  const count = model.blocking.length;
  const affecting = advisory ? model.actions.length : 0;
  const headline = model.periodOnly
    ? "את הקובץ המפורט מורידים לתקופת דיווח"
    : count === 1
      ? "נשאר דבר אחד לפני ההורדה"
      : count > 1
        ? `נשארו ${count} דברים לפני ההורדה`
        : affecting === 1
          ? "דבר אחד משפיע על הסכומים בדוח"
          : affecting > 1
            ? `${affecting} דברים משפיעים על הסכומים בדוח`
            : "הכל מוכן";
  const tone = model.periodOnly ? "text-stone-800" : count ? "text-rose-800" : affecting ? "text-amber-800" : "text-emerald-800";
  const Icon = model.periodOnly ? CalendarRange : count || affecting ? AlertCircle : CheckCircle2;
```

Replace:

```tsx
    <li data-fix-code={item.code} className={`rounded-xl border p-3 text-sm ${style}`}>
```

with:

```tsx
    <li data-fix-code={item.code} data-fix-tier={item.tier} className={`rounded-xl border p-3 text-sm ${style}`}>
```

- [ ] **Step 2: Controls pass `onSaved`, open a client, name the report in support**

Replace `  const { businessId, returnTo, onUseFilingPeriod } = context;` with:

```tsx
  const { businessId, returnTo, onUseFilingPeriod, onSaved } = context;
```

Replace each of these five lines (one per `InlineSave`) with the same line followed by `          onSaved={onSaved}` on its own line:

```tsx
          onSave={(value) => updateExpenseFilingFields(control.expenseIds, { supplierTaxId: value })}
```
```tsx
          onSave={(value) => updateExpenseFilingFields([control.expenseId], { reference: value })}
```
```tsx
          onSave={(value) => updateExpenseFilingFields([control.expenseId], { allocationNumber: value })}
```
```tsx
          onSave={(value) => saveBusinessTaxId(businessId, value)}
```
```tsx
          onSave={(value) => updateDocumentClientTaxId(control.documentId, value)}
```

For example the first becomes:

```tsx
          onSave={(value) => updateExpenseFilingFields(control.expenseIds, { supplierTaxId: value })}
          onSaved={onSaved}
```

Replace:

```tsx
      return <DateSave initial={control.current} onSave={(value) => updateExpenseFilingFields([control.expenseId], { date: value })} />;
```

with:

```tsx
      return <DateSave initial={control.current} onSave={(value) => updateExpenseFilingFields([control.expenseId], { date: value })} onSaved={onSaved} />;
```

Replace:

```tsx
          href={supportWhatsappHref(filingDataFixMessage(control.documentId, control.code))}
```

with:

```tsx
          href={supportWhatsappHref(filingDataFixMessage(control.documentId, control.code, control.report))}
```

Replace:

```tsx
      return <Link href={withReturn(`/documents/${control.documentId}`, returnTo)} className={LINK_BUTTON}>פתח את המסמך</Link>;
```

with:

```tsx
      return <Link href={withReturn(`/documents/${control.documentId}`, returnTo)} className={LINK_BUTTON}>פתח את המסמך</Link>;
    case "open_client":
      return <Link href={withReturn(`/clients/${control.clientId}`, returnTo)} className={LINK_BUTTON}>פתח את הלקוח</Link>;
```

- [ ] **Step 3: The save components call `onSaved` after a successful save**

In `InlineSave` replace:

```tsx
  validate,
  onSave,
}: {
```

with:

```tsx
  validate,
  onSave,
  onSaved,
}: {
```

Replace:

```tsx
  validate: (value: string) => string | null;
  onSave: (value: string) => Promise<void>;
}) {
```

with:

```tsx
  validate: (value: string) => string | null;
  onSave: (value: string) => Promise<void>;
  onSaved?: () => void;
}) {
```

Replace `    void run(() => onSave(next));` with:

```tsx
    void run(async () => {
      await onSave(next);
      onSaved?.();
    });
```

Replace:

```tsx
function DateSave({ initial, onSave }: { initial: string; onSave: (value: string) => Promise<void> }) {
```

with:

```tsx
function DateSave({ initial, onSave, onSaved }: { initial: string; onSave: (value: string) => Promise<void>; onSaved?: () => void }) {
```

Replace `    void run(() => onSave(value));` with:

```tsx
    void run(async () => {
      await onSave(value);
      onSaved?.();
    });
```

- [ ] **Step 4: Typecheck and run the fix-model tests**

Run: `cd /c/wtp2 && npx tsc --noEmit && npx vitest run tests/filing-fix-items.test.ts tests/uniform-fix-items.test.ts`
Expected: tsc exits 0 (the `switch` over `FixControl` is exhaustive again with `open_client`), tests PASS. `/reports/vat` passes neither `advisory` nor `onSaved`, so it renders exactly as before.

- [ ] **Step 5: Commit**

```bash
cd /c/wtp2 && git add src/components/filing-fix-panel.tsx && git commit -m "feat(filing-panel): open-client link, re-check after save, advisory headline" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The uniform check on /reports renders the panel

**Files:**
- Modify: `src/app/(app)/reports/page.tsx` (imports 32-33, state 72-73, `downloadUniformStructure` 194-231, preflight block 309-318)

- [ ] **Step 1: Imports and state**

Replace:

```tsx
import { ReportPreflight } from "@/components/report-preflight";
import type { ReportIssue } from "@/lib/invoice-report-preflight";
```

with:

```tsx
import { FilingFixPanel } from "@/components/filing-fix-panel";
import { buildUniformFixModel } from "@/lib/uniform-fix-items";
import { uniformCanDownload, type UniformIssue } from "@/lib/uniform-structure/issues";
```

Replace:

```tsx
  const [uniformCheck, setUniformCheck] = useState<{ year: number; sample: boolean; issues: ReportIssue[] } | null>(null);
  const [uniformBusy, setUniformBusy] = useState(false);
```

with:

```tsx
  const [uniformCheck, setUniformCheck] = useState<{ year: number; sample: boolean; issues: UniformIssue[] } | null>(null);
  const [uniformBusy, setUniformBusy] = useState(false);
  const uniformModel = useMemo(() => (uniformCheck ? buildUniformFixModel(uniformCheck.issues) : null), [uniformCheck]);
```

- [ ] **Step 2: Re-check without clearing, coded client-side failures**

Replace the whole `downloadUniformStructure` function (from `  async function downloadUniformStructure(sample = false, download = false) {` through its closing `  }` before `  /* ---------- the report cards ---------- */`) with:

```tsx
  /**
   * `recheck`: run the check again (after an inline fix) and keep the current
   * panel on screen until the new result lands, instead of clearing it.
   */
  async function downloadUniformStructure(sample = false, download = false, recheck = false) {
    if (uniformBusy) return;
    setMenuOpen(false);
    setUniformBusy(true);
    const checkedYear = exportYear;
    if (!download && !recheck) setUniformCheck(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("פג תוקף ההתחברות, התחבר מחדש");
      const qs = `year=${checkedYear}${sample ? "&sample=true" : ""}${download ? "" : "&preflight=true"}`;
      const res = await fetch(`/api/uniform-structure/export?${qs}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok || !download) {
        const result = await res.json();
        if (res.status === 429) {
          setUniformCheck({ year: checkedYear, sample, issues: [{ code: "rate_limited", level: "error", message: friendlyError(result, "יותר מדי בדיקות ברצף. המתן כמה דקות ונסה שוב.") }] });
          return;
        }
        if (Array.isArray(result.issues)) {
          const issues: UniformIssue[] = result.issues;
          if (!res.ok && !issues.some((issue) => issue.level === "error")) issues.push({ code: "data_load_failed", level: "error", message: friendlyError(result, "הבדיקה נכשלה. נסו שוב.") });
          setUniformCheck({ year: checkedYear, sample, issues });
          if (!download && !recheck) requestAnimationFrame(() => document.getElementById("uniform-preflight")?.scrollIntoView({ block: "start", behavior: "smooth" }));
        } else throw new Error(friendlyError(result, "בדיקת הקובץ נכשלה. נסו שוב."));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `OPENFRMT-${business.taxId}-${checkedYear}${sample ? "-SAMPLE" : ""}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setUniformReport(parseUniformReport(res.headers.get("X-Uniform-Report")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "הבדיקה נכשלה. נסו שוב.";
      setUniformCheck({ year: checkedYear, sample, issues: [{ code: "data_load_failed", level: "error", message }] });
    } finally {
      setUniformBusy(false);
    }
  }
```

- [ ] **Step 3: Render the panel**

Replace:

```tsx
      {(uniformBusy || uniformCheck?.year === exportYear) && <div id="uniform-preflight" className="space-y-3 no-print">
        <h2 className="text-lg font-bold">בדיקה לפני הורדת מבנה אחיד לשנת {exportYear}</h2>
        {uniformBusy ? <p role="status">טוען את כל הנתונים ובודק את הקובץ...</p> : uniformCheck && <>
          <ReportPreflight issues={uniformCheck.issues} description={uniformCheck.sample ? "קובץ דוגמה עם נתונים מלאכותיים לבדיקת תוכנה בלבד. אין להגישו כדיווח של העסק." : "קובץ מבנה אחיד מיועד לביקורת או להעברה לפי דרישה. הוא אינו דוח מע״מ תקופתי. הבדיקה המקומית אינה אישור קליטה או אישור רישום תוכנה של רשות המסים."} />
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary disabled:opacity-50" disabled={uniformCheck.issues.some((issue) => issue.level === "error")} onClick={() => downloadUniformStructure(uniformCheck.sample, true)}>הורד קובץ לאחר בדיקה</button>
            <button type="button" className="btn-secondary" onClick={() => downloadUniformStructure(uniformCheck.sample)}>בדוק שוב</button>
          </div>
        </>}
      </div>}
```

with:

```tsx
      {(uniformBusy || uniformCheck?.year === exportYear) && <div id="uniform-preflight" className="card-soft p-4 space-y-3 no-print">
        <h2 className="text-lg font-bold">בדיקה לפני הורדת מבנה אחיד לשנת {exportYear}</h2>
        {uniformBusy && <p className="text-sm text-stone-600">טוען את כל הנתונים ובודק את הקובץ...</p>}
        {uniformCheck && uniformModel && <>
          <p className="text-sm text-stone-600 leading-relaxed">{uniformCheck.sample ? "קובץ דוגמה עם נתונים מלאכותיים לבדיקת תוכנה בלבד. אין להגישו כדיווח של העסק." : "קובץ מבנה אחיד מיועד לביקורת או להעברה לפי דרישה. הוא אינו דוח מע״מ תקופתי. הבדיקה המקומית אינה אישור קליטה או אישור רישום תוכנה של רשות המסים."}</p>
          <FilingFixPanel
            model={uniformModel}
            businessId={business.id}
            returnTo="/reports"
            onSaved={() => downloadUniformStructure(uniformCheck.sample, false, true)}
          />
          <div className="flex flex-wrap gap-3">
            <button type="button" data-testid="uniform-download" className="btn-primary disabled:opacity-50" disabled={uniformBusy || !uniformCanDownload(uniformCheck.issues)} onClick={() => downloadUniformStructure(uniformCheck.sample, true)}>הורד קובץ לאחר בדיקה</button>
            <button type="button" className="btn-secondary disabled:opacity-50" disabled={uniformBusy} onClick={() => downloadUniformStructure(uniformCheck.sample, false, true)}>בדוק שוב</button>
          </div>
        </>}
      </div>}
```

- [ ] **Step 4: Typecheck**

Run: `cd /c/wtp2 && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/wtp2 && git add "src/app/(app)/reports/page.tsx" && git commit -m "feat(reports): uniform export check uses the what-is-left panel and re-checks after fixes" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Invoices-period preflight - codes and levels

From here to Task 15, `npx tsc --noEmit` reports errors only in `src/app/(app)/reports/invoices-period/page.tsx`; Task 15 clears them.

**Files:**
- Modify: `src/lib/invoice-report-preflight.ts` (whole file)
- Modify: `src/lib/filing-fix-items.ts` (`FixCode`)
- Test: `tests/invoice-report-preflight.test.ts` (whole file)

- [ ] **Step 1: Write the failing test**

Replace the whole content of `tests/invoice-report-preflight.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { INVOICE_LIST_TITLES, invoiceListAffectingCodes, invoiceReportPreflight } from "../src/lib/invoice-report-preflight";
import { mapFilingDocument, mapFilingExpense } from "../src/lib/filing-report-data";
import type { InvoiceDocument } from "../src/lib/types";

const doc = (extra: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ id: "example", number: 101, type: "tax_invoice", status: "sent", date: "2026-08-05", clientId: "client", clientName: "לקוח בדיקה", items: [], subtotal: 100, vat: 18, total: 118, ...extra });
const check = (docs: InvoiceDocument[]) => invoiceReportPreflight(docs, "2026-08-01", "2026-08-31");

describe("accountant listing integrity", () => {
  it("accepts a legitimate anonymous invoice without imposing PCN ID requirements", () => expect(check([doc()])).toEqual([]));
  it("excludes drafts, cancelled documents, quotes and other periods", () => expect(check([doc({ status: "draft", total: NaN }), doc({ status: "cancelled", total: NaN }), doc({ type: "quote", total: NaN }), doc({ date: "2026-07-05", total: NaN })])).toEqual([]));
  it("reports a broken date as affecting the totals, never silently", () =>
    expect(check([doc({ date: "2026-02-30" })])).toEqual([expect.objectContaining({ code: "date_invalid", level: "totals", documentId: "example", sourceLabel: "חשבונית מס 101" })]));
  it("an invalid or reversed period is the only error", () =>
    expect(invoiceReportPreflight([], "2026-08-31", "2026-08-01")).toEqual([expect.objectContaining({ code: "period_invalid", level: "error" })]));
  it("nonfinite amounts and mismatched totals affect the totals", () => {
    for (const invalid of [NaN, Infinity]) expect(check([doc({ total: invalid })])).toContainEqual(expect.objectContaining({ code: "amount_invalid", level: "totals" }));
    expect(check([doc({ total: 117 })])).toContainEqual(expect.objectContaining({ code: "total_mismatch", level: "totals" }));
  });
  it("accepts stored rounding and negative credits", () => {
    expect(check([doc({ subtotal: 100.1, vat: 18.02, total: 118, rounding: -0.12 })])).toEqual([]);
    expect(check([doc({ type: "credit_note", subtotal: -100, vat: -18, total: -118 })])).toEqual([]);
  });
  it("missing FX snapshots affect the totals; complete ILS amounts are fine", () => {
    expect(check([doc({ currency: "USD" })])).toEqual([expect.objectContaining({ code: "foreign_currency_missing_ils", level: "totals" })]);
    expect(check([doc({ currency: "USD", subtotalIls: 350, vatIls: 63, totalIls: 413 })])).toEqual([]);
  });
  it("a duplicate number in one series affects the totals; a credit is a separate series", () => {
    expect(check([doc(), doc({ id: "credit", type: "credit_note", subtotal: -100, vat: -18, total: -118 })])).toEqual([]);
    expect(check([doc(), doc({ id: "duplicate" })])).toEqual([expect.objectContaining({ code: "duplicate_number", level: "totals", documentId: "duplicate" })]);
  });
  it("a foreign customer id is a note carrying the document's own number; an 8-digit Israeli number is fine", () => {
    expect(check([doc({ clientTaxId: "FOREIGN-123" })])).toEqual([expect.objectContaining({ code: "customer_number_not_israeli", level: "note", current: "FOREIGN-123" })]);
    expect(check([doc({ clientTaxId: "13333331" })])).toEqual([]);
  });
  it("lists only codes that change the totals or stop the report, once each", () => {
    const issues = check([doc({ currency: "USD" }), doc({ id: "b", currency: "USD", clientName: " " })]);
    expect(invoiceListAffectingCodes(issues)).toEqual(["foreign_currency_missing_ils", "duplicate_number"]);
  });
  it("has a title for every code", () => expect(Object.values(INVOICE_LIST_TITLES).every((t) => t.trim().length > 0)).toBe(true));
  it("preserves missing source amounts and FX snapshots before preflight", () => {
    const mapped = mapFilingDocument({ id: "example", type: "tax_invoice", status: "sent", date: "2026-08-01", currency: "USD", total: "bad", vat: null, subtotal: "", number: "101" });
    expect(Number.isNaN(mapped.total)).toBe(true);
    expect(Number.isNaN(mapped.vat)).toBe(true);
    expect(Number.isNaN(mapped.subtotal)).toBe(true);
    expect(mapped.totalIls).toBeUndefined();
    expect(mapped.subtotalIls).toBeUndefined();
  });
  it("preserves expense descriptions in the report dataset", () => expect(mapFilingExpense({ id: "expense", amount: 100, description: "תיאור בדיקה" }).description).toBe("תיאור בדיקה"));
});
```

Note on the "once each" case: the first USD document yields `foreign_currency_missing_ils`; the second (same type and number) yields `duplicate_number` first and then `foreign_currency_missing_ils` again, and its blank client name is a note, so the distinct non-note codes in order are exactly those two.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/invoice-report-preflight.test.ts`
Expected: FAIL (`INVOICE_LIST_TITLES` / `invoiceListAffectingCodes` missing, no `code` on issues).

- [ ] **Step 3: Write the implementation**

Replace the whole content of `src/lib/invoice-report-preflight.ts` with:

```ts
import type { DocumentType, InvoiceDocument } from "./types";
import { DOCUMENT_TYPE_LABELS } from "./types";
import { validPcnDate } from "./ita/pcn874";
import { normalizeBusinessNumber } from "./israeli-id";

/** Kept for `report-preflight.tsx` until Task 16 removes it. */
export interface ReportIssue { level: "error" | "warning"; message: string; href?: string; sourceLabel?: string }

export const invoiceReportTypes: readonly DocumentType[] = ["tax_invoice", "tax_invoice_receipt", "credit_note"];

export type InvoiceListIssueCode =
  | "period_invalid"
  | "date_invalid"
  | "number_invalid"
  | "duplicate_number"
  | "foreign_currency_missing_ils"
  | "amount_invalid"
  | "total_mismatch"
  | "customer_number_not_israeli"
  | "client_name_missing";

/**
 * "error": the listing cannot be built (an unusable period).
 * "totals": the totals may be wrong or incomplete. Downloads stay allowed;
 * the panel shows it above the table and the file carries it as a note.
 * "note": worth a look, collapsed.
 */
export type InvoiceListIssueLevel = "error" | "totals" | "note";

export interface InvoiceListIssue {
  code: InvoiceListIssueCode;
  level: InvoiceListIssueLevel;
  message: string;
  documentId?: string;
  sourceLabel?: string;
  /** The document's own customer number, for the inline fix. */
  current?: string;
  imported?: boolean;
}

export const INVOICE_LIST_TITLES: Record<InvoiceListIssueCode, string> = {
  period_invalid: "יש לבחור תקופה תקינה",
  date_invalid: "מסמך בלי תאריך תקין",
  number_invalid: "מספר מסמך חסר או לא תקין",
  duplicate_number: "מספר מסמך כפול",
  foreign_currency_missing_ils: "מסמך במטבע חוץ בלי סכומים בשקלים",
  amount_invalid: "סכום חסר או לא מספרי",
  total_mismatch: "הסכום הכולל לא תואם לסכום לפני מע״מ והמע״מ",
  customer_number_not_israeli: "מספר הלקוח אינו מספר עוסק ישראלי",
  client_name_missing: "חסר שם לקוח",
};

/** Integrity checks for an accountant's listing, not a statutory upload format. */
export function invoiceReportPreflight(documents: readonly InvoiceDocument[], start: string, end: string): InvoiceListIssue[] {
  if (!validPcnDate(start) || !validPcnDate(end) || start > end) {
    return [{ code: "period_invalid", level: "error", message: "יש לבחור תאריך התחלה וסיום תקינים, כשהסיום אינו קודם להתחלה." }];
  }
  const issues: InvoiceListIssue[] = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    if (!invoiceReportTypes.includes(doc.type) || doc.status === "draft" || doc.status === "cancelled") continue;
    const add = (code: InvoiceListIssueCode, level: InvoiceListIssueLevel, message: string, extra: Partial<InvoiceListIssue> = {}) =>
      issues.push({ code, level, message, documentId: doc.id, sourceLabel: `${DOCUMENT_TYPE_LABELS[doc.type]} ${doc.number}`, imported: Boolean(doc.importBatchId), ...extra });
    if (!validPcnDate(doc.date)) {
      add("date_invalid", "totals", "תאריך המסמך חסר או לא תקין, ולכן הוא לא מופיע באף תקופה בדוח. ייתכן שחסר מסמך בסכומים.");
      continue;
    }
    if (doc.date < start || doc.date > end) continue;
    if (!Number.isSafeInteger(doc.number) || doc.number <= 0) add("number_invalid", "note", "מספר המסמך חסר או לא תקין.");
    const key = `${doc.type}:${doc.number}`;
    if (seen.has(key)) add("duplicate_number", "totals", "נמצא מסמך נוסף מאותו סוג עם אותו מספר. בדוק שהמסמך לא נספר פעמיים בסכומים.");
    seen.add(key);
    const foreign = !!doc.currency && doc.currency !== "ILS";
    if (foreign && ![doc.subtotalIls, doc.vatIls, doc.totalIls].every((value) => typeof value === "number" && Number.isFinite(value))) {
      add("foreign_currency_missing_ils", "totals", "למסמך במטבע חוץ חסרים סכומים שמורים בשקלים, ולכן הוא לא נכלל בשורת הסיכום.");
    } else {
      const values = [doc.subtotalIls ?? doc.subtotal, doc.vatIls ?? doc.vat, doc.totalIls ?? doc.total];
      if (!values.every(Number.isFinite)) {
        add("amount_invalid", "totals", "סכום לפני מע״מ, מע״מ או סכום כולל חסר או לא מספרי, ולכן המסמך לא נכלל בשורת הסיכום.");
      } else {
        const originalRounding = doc.rounding ?? 0;
        const rounding = originalRounding === 0 ? 0 : originalRounding * (foreign ? (doc.exchangeRate && doc.exchangeRate > 0 ? doc.exchangeRate : NaN) : 1);
        if (!Number.isFinite(rounding) || Math.abs(values[0] + values[1] + rounding - values[2]) > 0.03)
          add("total_mismatch", "totals", "הסכום לפני מע״מ בתוספת המע״מ והעיגול אינו תואם לסכום הכולל, ולכן עמודות הסיכום לא יתאימו זו לזו.");
      }
    }
    if (doc.clientTaxId && !normalizeBusinessNumber(doc.clientTaxId).value)
      add("customer_number_not_israeli", "note", "מספר הזיהוי של הלקוח אינו מספר עוסק ישראלי תקין. אם זה לקוח מחו״ל אין צורך לעשות דבר.", { current: doc.clientTaxId });
    if (!doc.clientName.trim()) add("client_name_missing", "note", "חסר שם לקוח במסמך. מומלץ לבדוק לפני העברה לרואה החשבון.");
  }
  return issues;
}

/** Distinct codes that stop the listing or change its totals. The nightly guard counts these. */
export function invoiceListAffectingCodes(issues: readonly Pick<InvoiceListIssue, "code" | "level">[]): InvoiceListIssueCode[] {
  return [...new Set(issues.filter((issue) => issue.level !== "note").map((issue) => issue.code))];
}
```

- [ ] **Step 4: Widen `FixCode`**

In `src/lib/filing-fix-items.ts` replace:

```ts
import type { UniformIssueCode } from "./uniform-structure/issues";

/** Every code a filing panel can show: PCN874, uniform structure, invoices-period. */
export type FixCode = PcnIssueCode | UniformIssueCode;
```

with:

```ts
import type { UniformIssueCode } from "./uniform-structure/issues";
import type { InvoiceListIssueCode } from "./invoice-report-preflight";

/** Every code a filing panel can show: PCN874, uniform structure, invoices-period. */
export type FixCode = PcnIssueCode | UniformIssueCode | InvoiceListIssueCode;
```

- [ ] **Step 5: Run tests**

Run: `cd /c/wtp2 && npx vitest run tests/invoice-report-preflight.test.ts tests/filing-fix-items.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /c/wtp2 && git add src/lib/invoice-report-preflight.ts src/lib/filing-fix-items.ts tests/invoice-report-preflight.test.ts && git commit -m "feat(invoices-period): coded findings that inform instead of block" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 13: Invoices-period rows, partial totals, stamp lines and the Excel sheet

**Files:**
- Create: `src/lib/invoice-period-report.ts`
- Modify: `src/lib/csv-export.ts:298-338` (`exportInvoicesPeriod`)
- Test: `tests/invoice-period-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/invoice-period-report.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildInvoicePeriodReport, invoicePeriodStampLines, invoicesPeriodSheet } from "@/lib/invoice-period-report";
import { invoiceReportPreflight } from "@/lib/invoice-report-preflight";
import { buildWorkbook } from "@/lib/xlsx-export";
import type { InvoiceDocument } from "@/lib/types";

const doc = (extra: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ id: "a", number: 101, type: "tax_invoice", status: "sent", date: "2026-08-05", clientId: "c", clientName: "לקוח", items: [], subtotal: 100, vat: 18, total: 118, ...extra });
const START = "2026-08-01";
const END = "2026-08-31";
const noLongDashes = (text: string) => [...text].every((ch) => ch.charCodeAt(0) < 0x2010 || ch.charCodeAt(0) > 0x2015);

describe("invoices-period report", () => {
  it("sums shekel amounts of the period's tax documents, sorted by date then number", () => {
    const r = buildInvoicePeriodReport([doc({ id: "b", number: 2, date: "2026-08-09" }), doc({ id: "a", number: 1 }), doc({ id: "q", type: "quote" }), doc({ id: "old", date: "2026-07-31" })], START, END);
    expect(r.rows.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r).toMatchObject({ totals: { net: 200, vat: 36, total: 236 }, missingAmounts: 0, incomplete: false });
  });

  it("uses stored shekel amounts for a foreign-currency document", () => {
    const r = buildInvoicePeriodReport([doc({ currency: "USD", subtotalIls: 350, vatIls: 63, totalIls: 413 })], START, END);
    expect(r.rows[0]).toMatchObject({ net: 350, vat: 63, total: 413 });
  });

  it("leaves a document without shekel amounts out of the totals and marks them partial", () => {
    const r = buildInvoicePeriodReport([doc(), doc({ id: "usd", number: 3, currency: "USD", vat: 0, total: 100 })], START, END);
    expect(r.rows.find((x) => x.id === "usd")).toMatchObject({ net: null, vat: null, total: null });
    expect(r).toMatchObject({ totals: { net: 100, vat: 18, total: 118 }, missingAmounts: 1, incomplete: true });
  });

  it("returns no rows for an unusable period", () => {
    expect(buildInvoicePeriodReport([doc()], "", END).rows).toEqual([]);
  });

  it("stamps the partial total first, then every finding with its documents", () => {
    const docs = [doc(), doc({ id: "b" }), doc({ id: "usd", number: 7, currency: "USD", clientTaxId: "FOREIGN" })];
    const issues = invoiceReportPreflight(docs, START, END);
    const lines = invoicePeriodStampLines(issues, buildInvoicePeriodReport(docs, START, END));
    expect(lines[0]).toBe("שורת הסיכום חלקית: מסמך אחד בלי סכומים בשקלים לא נכלל בה.");
    expect(lines).toContain("משפיע על הסכומים: מספר מסמך כפול (חשבונית מס 101)");
    expect(lines).toContain("משפיע על הסכומים: מסמך במטבע חוץ בלי סכומים בשקלים (חשבונית מס 7)");
    expect(lines).toContain("לבדיקה: מספר הלקוח אינו מספר עוסק ישראלי (חשבונית מס 7)");
    expect(noLongDashes(lines.join("\n"))).toBe(true);
  });

  it("stamps nothing when nothing was found", () => {
    const docs = [doc()];
    expect(invoicePeriodStampLines(invoiceReportPreflight(docs, START, END), buildInvoicePeriodReport(docs, START, END))).toEqual([]);
  });

  it("writes the partial total label and the notes into the Excel sheet", async () => {
    const docs = [doc(), doc({ id: "usd", number: 7, currency: "USD" })];
    const report = buildInvoicePeriodReport(docs, START, END);
    const stamp = invoicePeriodStampLines(invoiceReportPreflight(docs, START, END), report);
    const s = invoicesPeriodSheet({ rows: report.rows, periodLabel: "אוגוסט 2026", businessName: "עסק", stamp, incomplete: report.incomplete });
    expect(s.totalLabel).toBe("סה״כ (חלקי)");
    expect(s.subtitle).toBe("אוגוסט 2026 · הסכומים חלקיים, ראו הערות מתחת לטבלה");
    expect(s.notes).toEqual(["הערות לדוח:", ...stamp]);
    const wb = await buildWorkbook([s]);
    const values: string[] = [];
    wb.getWorksheet("חשבוניות")!.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value))));
    expect(values).toContain("סה״כ (חלקי)");
    expect(values).toContain("הערות לדוח:");
  });

  it("keeps a clean sheet exactly as before", () => {
    const report = buildInvoicePeriodReport([doc()], START, END);
    const s = invoicesPeriodSheet({ rows: report.rows, periodLabel: "אוגוסט 2026", stamp: [], incomplete: false });
    expect([s.totalLabel, s.subtitle, s.notes]).toEqual(["סה״כ", "אוגוסט 2026", []]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/invoice-period-report.test.ts`
Expected: FAIL, cannot resolve `@/lib/invoice-period-report`.

- [ ] **Step 3: Create `src/lib/invoice-period-report.ts`**

```ts
// The invoices-period listing as one pure model, so the table on screen, the
// Excel file and the PDF say the same thing. Amounts are shekels. A document
// without usable shekel amounts gets empty cells and stays out of the totals,
// which are then marked partial, instead of silently adding foreign-currency
// numbers as if they were shekels.
import { validPcnDate } from "./ita/pcn874";
import { INVOICE_LIST_TITLES, invoiceReportTypes, type InvoiceListIssue, type InvoiceListIssueCode } from "./invoice-report-preflight";
import { DOCUMENT_TYPE_LABELS, type DocumentType, type InvoiceDocument } from "./types";
import { sheet } from "./xlsx-export";

export interface InvoicePeriodRow {
  id: string;
  type: DocumentType;
  number: number;
  date: string;
  customerTaxId: string;
  clientName: string;
  net: number | null;
  vat: number | null;
  total: number | null;
  allocation: string;
}

export interface InvoicePeriodReport {
  rows: InvoicePeriodRow[];
  totals: { net: number; vat: number; total: number };
  /** Rows left out of the totals for missing shekel amounts. */
  missingAmounts: number;
  incomplete: boolean;
}

function shekelAmounts(doc: InvoiceDocument): { net: number; vat: number; total: number } | null {
  const foreign = Boolean(doc.currency) && doc.currency !== "ILS";
  const values = foreign
    ? [doc.subtotalIls, doc.vatIls, doc.totalIls]
    : [doc.subtotalIls ?? doc.subtotal, doc.vatIls ?? doc.vat, doc.totalIls ?? doc.total];
  if (!values.every((value): value is number => typeof value === "number" && Number.isFinite(value))) return null;
  return { net: values[0], vat: values[1], total: values[2] };
}

export function buildInvoicePeriodReport(documents: readonly InvoiceDocument[], start: string, end: string): InvoicePeriodReport {
  const usable = validPcnDate(start) && validPcnDate(end) && start <= end;
  const rows = usable
    ? documents
        .filter((d) => invoiceReportTypes.includes(d.type) && d.status !== "draft" && d.status !== "cancelled" && validPcnDate(d.date) && d.date >= start && d.date <= end)
        .map((d): InvoicePeriodRow => {
          const amounts = shekelAmounts(d);
          return {
            id: d.id,
            type: d.type,
            number: d.number,
            date: d.date,
            customerTaxId: d.clientTaxId || "",
            clientName: d.clientName,
            net: amounts?.net ?? null,
            vat: amounts?.vat ?? null,
            total: amounts?.total ?? null,
            allocation: d.allocationNumber || "",
          };
        })
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number))
    : [];
  const totals = { net: 0, vat: 0, total: 0 };
  let missingAmounts = 0;
  for (const row of rows) {
    if (row.net == null || row.vat == null || row.total == null) {
      missingAmounts += 1;
      continue;
    }
    totals.net += row.net;
    totals.vat += row.vat;
    totals.total += row.total;
  }
  return { rows, totals, missingAmounts, incomplete: missingAmounts > 0 };
}

const LEVEL_PREFIX: Record<"totals" | "note", string> = {
  totals: "משפיע על הסכומים",
  note: "לבדיקה",
};
const MAX_LABELS = 10;

/** Plain lines written into the Excel file and printed above the table in the PDF. */
export function invoicePeriodStampLines(issues: readonly InvoiceListIssue[], report: Pick<InvoicePeriodReport, "missingAmounts">): string[] {
  const lines: string[] = [];
  if (report.missingAmounts === 1) lines.push("שורת הסיכום חלקית: מסמך אחד בלי סכומים בשקלים לא נכלל בה.");
  else if (report.missingAmounts > 1) lines.push(`שורת הסיכום חלקית: ${report.missingAmounts} מסמכים בלי סכומים בשקלים לא נכללו בה.`);
  const groups = new Map<string, { level: "totals" | "note"; code: InvoiceListIssueCode; labels: string[] }>();
  for (const issue of issues) {
    if (issue.level === "error") continue;
    const key = `${issue.level}:${issue.code}`;
    const group = groups.get(key) ?? { level: issue.level, code: issue.code, labels: [] };
    if (issue.sourceLabel && !group.labels.includes(issue.sourceLabel)) group.labels.push(issue.sourceLabel);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === "totals" ? -1 : 1));
  for (const group of ordered) {
    const shown = group.labels.slice(0, MAX_LABELS).join(", ");
    const more = group.labels.length > MAX_LABELS ? ` ועוד ${group.labels.length - MAX_LABELS}` : "";
    lines.push(`${LEVEL_PREFIX[group.level]}: ${INVOICE_LIST_TITLES[group.code]}${shown ? ` (${shown}${more})` : ""}`);
  }
  return lines;
}

/** The styled sheet behind the "ייצוא Excel" button, with the stamp and a partial total label. */
export function invoicesPeriodSheet(params: { rows: InvoicePeriodRow[]; periodLabel: string; businessName?: string; stamp: string[]; incomplete: boolean }) {
  const { rows, periodLabel, businessName, stamp, incomplete } = params;
  return sheet<InvoicePeriodRow>({
    name: "חשבוניות",
    title: "דוח חשבוניות לתקופה",
    subtitle: incomplete
      ? `${periodLabel} · הסכומים חלקיים, ראו הערות מתחת לטבלה`
      : stamp.length > 0
        ? `${periodLabel} · יש הערות מתחת לטבלה`
        : periodLabel,
    businessName,
    countLabel: `${rows.length} מסמכים`,
    rows,
    totalLabel: incomplete ? "סה״כ (חלקי)" : "סה״כ",
    notes: stamp.length > 0 ? ["הערות לדוח:", ...stamp] : [],
    columns: [
      { header: "ת.ז / ח.פ", value: (r) => r.customerTaxId },
      { header: "מספר חשבונית", value: (r) => r.number, kind: "int", width: 13 },
      { header: "סוג", value: (r) => DOCUMENT_TYPE_LABELS[r.type] },
      { header: "לקוח", value: (r) => r.clientName },
      { header: "תאריך", value: (r) => r.date, kind: "date" },
      { header: "סכום ללא מע״מ", value: (r) => r.net, kind: "money", total: "sum" },
      { header: "מע״מ", value: (r) => r.vat, kind: "money", total: "sum" },
      { header: "סכום כולל מע״מ", value: (r) => r.total, kind: "money", total: "sum" },
      { header: "מספר הקצאה", value: (r) => r.allocation },
    ],
  });
}
```

- [ ] **Step 4: Point the Excel export at the stamped sheet**

In `src/lib/csv-export.ts` add below `import { downloadXlsx, sheet } from "./xlsx-export";`:

```ts
import { invoicesPeriodSheet, type InvoicePeriodRow } from "./invoice-period-report";
```

and replace the whole `exportInvoicesPeriod` function (from `/** /reports/invoices-period: the accountant's VAT-document listing for a period. */` through its closing `}`) with:

```ts
/** /reports/invoices-period: the accountant's VAT-document listing for a period, stamped with what the check found. */
export function exportInvoicesPeriod(params: {
  rows: InvoicePeriodRow[];
  periodLabel: string;
  fileTag: string;
  businessName?: string;
  stamp: string[];
  incomplete: boolean;
}) {
  return downloadXlsx(`דוח-חשבוניות-${params.fileTag}.xlsx`, [invoicesPeriodSheet(params)]);
}
```

- [ ] **Step 5: Run tests**

Run: `cd /c/wtp2 && npx vitest run tests/invoice-period-report.test.ts tests/xlsx-export.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /c/wtp2 && git add src/lib/invoice-period-report.ts src/lib/csv-export.ts tests/invoice-period-report.test.ts && git commit -m "feat(invoices-period): partial totals and a stamped Excel sheet" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Invoices-period issues to the panel model

**Files:**
- Create: `src/lib/invoice-period-fix-items.ts`
- Test: `tests/invoice-period-fix-items.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/invoice-period-fix-items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildInvoicePeriodFixModel } from "@/lib/invoice-period-fix-items";
import { invoiceReportPreflight } from "@/lib/invoice-report-preflight";
import type { InvoiceDocument } from "@/lib/types";

const doc = (extra: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ id: "a", number: 101, type: "tax_invoice", status: "sent", date: "2026-08-05", clientId: "c", clientName: "לקוח", items: [], subtotal: 100, vat: 18, total: 118, ...extra });
const model = (docs: InvoiceDocument[], start = "2026-08-01") => buildInvoicePeriodFixModel(invoiceReportPreflight(docs, start, "2026-08-31"));

describe("buildInvoicePeriodFixModel", () => {
  it("shows findings that change the totals as visible actions with a support request", () => {
    const m = model([doc({ id: "usd", currency: "USD" })]);
    expect(m.blocking).toEqual([]);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]).toMatchObject({ code: "foreign_currency_missing_ils", labels: ["חשבונית מס 101"], control: { kind: "support", documentId: "usd", code: "foreign_currency_missing_ils", report: "invoices_period" } });
  });

  it("offers the inline customer-number field as a collapsed note", () => {
    const m = model([doc({ clientTaxId: "FOREIGN" })]);
    expect(m.actions).toEqual([]);
    expect(m.notes.map((i) => i.control)).toEqual([{ kind: "customer_tax_id", documentId: "a", current: "FOREIGN" }]);
  });

  it("links a missing client name or number to the document", () => {
    const m = model([doc({ clientName: " ", number: 0 })]);
    expect(m.notes.map((i) => [i.code, i.control])).toEqual([
      ["number_invalid", { kind: "open_document", documentId: "a" }],
      ["client_name_missing", { kind: "open_document", documentId: "a" }],
    ]);
  });

  it("an unusable period is the only blocking item", () => {
    const m = model([doc()], "");
    expect(m.blocking.map((i) => [i.code, i.control])).toEqual([["period_invalid", { kind: "none" }]]);
  });

  it("a clean period is ready", () => {
    expect(model([doc()])).toEqual({ blocking: [], actions: [], notes: [], periodOnly: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/invoice-period-fix-items.test.ts`
Expected: FAIL, cannot resolve `@/lib/invoice-period-fix-items`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/invoice-period-fix-items.ts`:

```ts
// Panel model for /reports/invoices-period. Advisory: only an unusable period
// blocks; findings that change the totals are visible "action" items, the
// rest are collapsed notes.
import { createFixCollector, splitFixTiers, type FilingFixModel, type FixControl, type FixTier } from "./filing-fix-items";
import { INVOICE_LIST_TITLES, type InvoiceListIssue, type InvoiceListIssueCode } from "./invoice-report-preflight";

function controlFor(issue: InvoiceListIssue, tier: FixTier): FixControl {
  if (!issue.documentId) return { kind: "none" };
  if (issue.code === "customer_number_not_israeli") return { kind: "customer_tax_id", documentId: issue.documentId, current: issue.current ?? "" };
  // Everything that changes the totals is data on an issued document: a data fix.
  if (tier === "action") return { kind: "support", documentId: issue.documentId, code: issue.code, report: "invoices_period" };
  return { kind: "open_document", documentId: issue.documentId };
}

export function buildInvoicePeriodFixModel(issues: readonly InvoiceListIssue[]): FilingFixModel {
  const collector = createFixCollector((code) => INVOICE_LIST_TITLES[code as InvoiceListIssueCode] ?? code);
  for (const issue of issues) {
    const tier: FixTier = issue.level === "error" ? "blocking" : issue.level === "totals" ? "action" : "note";
    collector.put(`${tier}:${issue.code}:${issue.documentId ?? ""}`, tier, issue.code, controlFor(issue, tier), issue.message, issue.sourceLabel);
  }
  return splitFixTiers(collector.items());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtp2 && npx vitest run tests/invoice-period-fix-items.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/wtp2 && git add src/lib/invoice-period-fix-items.ts tests/invoice-period-fix-items.test.ts && git commit -m "feat(invoices-period): panel model for findings" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Invoices-period page - panel above the table, exports never blocked by findings

**Files:**
- Modify: `src/app/(app)/reports/invoices-period/page.tsx` (whole file)

- [ ] **Step 1: Rewrite the page**

Replace the whole content of `src/app/(app)/reports/invoices-period/page.tsx` with:

```tsx
"use client";

import { IsraeliDateInput, IsraeliMonthInput } from "@/components/israeli-date-input";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileSpreadsheet, Download, Printer } from "lucide-react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { FilingFixPanel } from "@/components/filing-fix-panel";
import { useFilingReportData } from "@/lib/filing-report-data";
import { invoiceReportPreflight } from "@/lib/invoice-report-preflight";
import { buildInvoicePeriodReport, invoicePeriodStampLines } from "@/lib/invoice-period-report";
import { buildInvoicePeriodFixModel } from "@/lib/invoice-period-fix-items";
import { formatCurrencyWhole } from "@/lib/format";
import { todayInIsrael } from "@/lib/date";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { useBusiness } from "@/lib/business-store";
import { exportInvoicesPeriod } from "@/lib/csv-export";

const LENGTHS: { months: number; label: string }[] = [
  { months: 1, label: "חודש" },
  { months: 2, label: "חודשיים" },
  { months: 3, label: "שלושה חודשים" },
  { months: 6, label: "חצי שנה" },
];

const MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function ym(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** First day (YYYY-MM-01) of the month `back` months before `endYm` (YYYY-MM). */
function startOfRange(endYm: string, lengthMonths: number): string {
  const [y, m] = endYm.split("-").map(Number);
  const d = new Date(y, m - 1 - (lengthMonths - 1), 1);
  return `${ym(d)}-01`;
}

/** First day of the month AFTER `endYm`, exclusive upper bound for the range. */
function afterEnd(endYm: string): string {
  const [y, m] = endYm.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${ym(d)}-01`;
}

function endOfRange(endYm: string): string {
  const date = new Date(`${afterEnd(endYm)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - 86400000).toISOString().slice(0, 10) : "";
}

function rangeLabel(endYm: string, lengthMonths: number): string {
  const [ey, em] = endYm.split("-").map(Number);
  const end = `${MONTH_NAMES[em - 1]} ${ey}`;
  if (lengthMonths === 1) return end;
  const s = new Date(ey, em - 1 - (lengthMonths - 1), 1);
  return `${MONTH_NAMES[s.getMonth()]} ${s.getFullYear()} עד ${end}`;
}

/** A cell whose document has no usable shekel amounts: visible, never a fake zero. */
function MissingAmount() {
  return <span className="text-amber-700 font-semibold">חסר בשקלים</span>;
}

export default function InvoicesPeriodReportPage() {
  const { business, ready: businessReady } = useBusiness();
  // Keep the table on screen while an inline customer-number fix refetches.
  const { data, error, retry, refreshing } = useFilingReportData(business.id, false, true);
  const documents = data?.documents;

  const [rangeMode, setRangeMode] = useState<"preset" | "custom">("preset");
  const [lengthMonths, setLengthMonths] = useState<number>(2);
  const [endMonth, setEndMonth] = useState<string>(() => todayInIsrael().slice(0, 7));
  const [fromDate, setFromDate] = useState<string>(() => `${todayInIsrael().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState<string>(() => todayInIsrael());

  const reportStart = rangeMode === "custom" ? fromDate : startOfRange(endMonth, lengthMonths);
  const reportEnd = rangeMode === "custom" ? toDate : endOfRange(endMonth);
  const report = useMemo(() => buildInvoicePeriodReport(documents ?? [], reportStart, reportEnd), [documents, reportStart, reportEnd]);
  const { rows, totals } = report;
  const issues = useMemo(() => invoiceReportPreflight(documents ?? [], reportStart, reportEnd), [documents, reportStart, reportEnd]);
  const fixModel = useMemo(() => buildInvoicePeriodFixModel(issues), [issues]);
  const stamp = useMemo(() => invoicePeriodStampLines(issues, report), [issues, report]);
  // Only an unusable period stops the exports. Every other finding is shown
  // above the table and written into the Excel file and the PDF.
  const canExport = Boolean(data) && businessReady && !error && !refreshing && rows.length > 0 && !issues.some((issue) => issue.level === "error");

  const currentLabel =
    rangeMode === "custom"
      ? `${fromDate ? fmtDate(fromDate) : "?"} עד ${toDate ? fmtDate(toDate) : "?"}`
      : rangeLabel(endMonth, lengthMonths);

  function fmtDate(iso: string): string {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  // Styled .xlsx with a total row and the stamp (invoice-period-report.ts).
  function exportXlsx() {
    if (!canExport) return;
    void exportInvoicesPeriod({
      rows,
      periodLabel: currentLabel,
      fileTag: rangeMode === "custom" ? `${fromDate}_עד_${toDate}` : `${endMonth}-${lengthMonths}ח`,
      businessName: business.name,
      stamp,
      incomplete: report.incomplete,
    });
  }

  if (error) return <div role="alert" className="card-soft p-6 space-y-3"><p>{error}</p><button onClick={retry} className="btn-primary">טען שוב</button></div>;
  if (!data || !businessReady) return <div className="text-center py-16 text-stone-500">טוען ובודק את נתוני הדוח...</div>;

  const money = (value: number | null) => (value == null ? <MissingAmount /> : formatCurrencyWhole(value));

  return (
    <div className="space-y-6">
      <div className="no-print">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לדוחות
        </Link>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="min-w-0 max-w-full">
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 shrink-0 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </span>
            <span className="min-w-0 break-words">דוח חשבוניות תקופתי</span>
          </h1>
          <p className="text-sm text-stone-600 mt-2 mr-14">
            כל חשבוניות המס בתקופה: ת.ז/ח.פ, מספר, תאריך, סכום לפני ואחרי מע״מ, ומספר הקצאה.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            onClick={exportXlsx}
            disabled={!canExport}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-emerald-200 text-stone-800 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            ייצוא Excel
          </button>
          <DownloadPdfButton
            filename="דוח-חשבוניות-תקופתי"
            landscape
            disabled={!canExport}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
            iconClassName="w-4 h-4 text-orange-600"
          />
          <button
            onClick={() => { if (canExport) window.print(); }}
            disabled={!canExport}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4 text-orange-600" />
            הדפסה
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="card-soft p-4 space-y-3 no-print">
        <div className="flex flex-wrap items-center gap-1 bg-stone-100 rounded-xl p-1 w-max max-w-full">
          {LENGTHS.map((l) => (
            <button
              key={l.months}
              onClick={() => {
                setRangeMode("preset");
                setLengthMonths(l.months);
              }}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                rangeMode === "preset" && lengthMonths === l.months
                  ? "bg-white text-orange-700 shadow-sm"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {l.label}
            </button>
          ))}
          <button
            onClick={() => setRangeMode("custom")}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              rangeMode === "custom"
                ? "bg-white text-orange-700 shadow-sm"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            טווח מותאם
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-stone-100">
          {rangeMode === "preset" ? (
            <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
              חודש סיום:
              <IsraeliMonthInput
                value={endMonth}
                onChange={setEndMonth}
                className="input-warm py-2 px-3 text-sm w-auto"
              />
            </label>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
                מתאריך:
                <IsraeliDateInput
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="input-warm py-2 px-3 text-sm w-auto"
                  dir="ltr"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
                עד תאריך:
                <IsraeliDateInput
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="input-warm py-2 px-3 text-sm w-auto"
                  dir="ltr"
                />
              </label>
            </>
          )}
          <span className="text-sm text-stone-500 sm:mr-auto">
            מציג: <span className="font-bold text-orange-700">{currentLabel}</span>
          </span>
        </div>
      </div>

      <section aria-label="בדיקת הדוח" className="card-soft p-4 no-print">
        <p className="text-sm text-stone-600 leading-relaxed">
          דוח זה מיועד לעיון ולהעברה לרואה החשבון. קובצי Excel ו-PDF אלה אינם קובץ העלאה לשירות הדיווח המפורט של מע״מ. טיוטות ומסמכים מבוטלים אינם נכללים. מה שנמצא בבדיקה לא חוסם את ההורדה, והוא נכתב גם בתוך הקובץ.
        </p>
        <FilingFixPanel model={fixModel} businessId={business.id} returnTo="/reports/invoices-period" advisory />
      </section>
      <p className="text-sm no-print"><Link href="/reports/vat" className="font-semibold text-orange-700 underline inline-flex min-h-[44px] items-center">להכנת דיווח מע״מ וקובץ PCN874</Link></p>

      {/* Report */}
      <div className="card-soft overflow-hidden">
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-baseline justify-between">
          <h2 className="font-bold text-stone-900 text-lg">{currentLabel}</h2>
          <span className="text-sm text-stone-500">{rows.length} חשבוניות{report.incomplete ? " · סכומים חלקיים" : ""}</span>
        </div>
        {stamp.length > 0 && (
          // The PDF and the printout carry what the panel shows on screen.
          <div data-testid="invoice-report-stamp" className="hidden print:block px-5 py-3 border-b border-amber-200 bg-amber-50 text-sm text-amber-950">
            <p className="font-bold">הערות לדוח</p>
            <ul className="mt-1 space-y-0.5">
              {stamp.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            אין חשבוניות מס בתקופה שנבחרה.
          </div>
        ) : (
          <div className="p-5 overflow-x-auto">
            <table className="gk-rtable w-full text-sm border-separate border-spacing-0 rounded-xl overflow-hidden shadow-sm">
              <thead>
                <tr className="bg-gradient-to-l from-orange-500 to-orange-700 text-white">
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">ת.ז / ח.פ</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מספר חשבונית</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">תאריך</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">סכום ללא מע״מ</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מע״מ</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">סכום כולל מע״מ</th>
                  <th scope="col" className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap">מספר הקצאה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={`${i % 2 ? "bg-orange-50/40" : "bg-white"} hover:bg-amber-50/40 transition-colors`}>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{r.customerTaxId || <span className="text-stone-300">-</span>}</td>
                    <td className="px-4 py-3.5 text-center align-middle whitespace-nowrap border-b border-l border-stone-200">
                      <Link href={`/documents/${r.id}`} className="text-orange-700 hover:underline font-bold">
                        {DOCUMENT_TYPE_LABELS[r.type]} #{r.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{money(r.net)}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{money(r.vat)}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums font-extrabold text-stone-900 whitespace-nowrap border-b border-l border-stone-200">{money(r.total)}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-stone-200">{r.allocation || <span className="text-stone-300">-</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-orange-50 text-stone-900 font-black">
                  <td className="px-4 py-4 text-center border-t-2 border-l border-orange-200" colSpan={3}>סה״כ{report.incomplete ? " חלקי" : ""} · {rows.length} חשבוניות</td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrencyWhole(totals.net)}</td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrencyWhole(totals.vat)}</td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrencyWhole(totals.total)}</td>
                  <td className="px-4 py-4 border-t-2 border-orange-200"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and the related tests**

Run: `cd /c/wtp2 && npx tsc --noEmit && npx vitest run tests/invoice-report-preflight.test.ts tests/invoice-period-report.test.ts tests/invoice-period-fix-items.test.ts`
Expected: tsc exits 0 (the page errors from Task 12 are gone), tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/wtp2 && git add "src/app/(app)/reports/invoices-period/page.tsx" && git commit -m "feat(invoices-period): findings above the table and in the files, exports never blocked" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Remove the old preflight list

**Files:**
- Delete: `src/components/report-preflight.tsx`
- Modify: `src/lib/invoice-report-preflight.ts` (drop `ReportIssue`)

- [ ] **Step 1: Confirm nothing imports it**

Use the Grep tool with pattern `ReportPreflight|ReportIssue` over `C:\wtp2\src` and `C:\wtp2\tests`.
Expected: matches only in `src/components/report-preflight.tsx` and the `ReportIssue` declaration in `src/lib/invoice-report-preflight.ts`. If anything else matches, STOP and report it.

- [ ] **Step 2: Delete and clean up**

Run: `cd /c/wtp2 && git rm src/components/report-preflight.tsx`

In `src/lib/invoice-report-preflight.ts` delete these two lines:

```ts
/** Kept for `report-preflight.tsx` until Task 16 removes it. */
export interface ReportIssue { level: "error" | "warning"; message: string; href?: string; sourceLabel?: string }
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/wtp2 && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
cd /c/wtp2 && git add -A src/components/report-preflight.tsx src/lib/invoice-report-preflight.ts && git commit -m "chore(reports): remove the old preflight list" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 17: Guard - invoices-period and uniform sections (dry run only)

**Files:**
- Modify: `src/lib/filing-guard.ts` (`formatGuardPush`, new `prefixCodes`)
- Modify: `scripts/filing-preflight-guard.mjs` (whole file)
- Test: `tests/filing-guard.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/filing-guard.test.ts` change line 2 to:

```ts
import { countAffectedBusinesses, formatGuardPush, formatGuardTable, newOrGrownCodes, prefixCodes } from "@/lib/filing-guard";
```

and add inside the `describe`:

```ts
  it("keeps report families apart with a prefix and a generic push header", () => {
    expect(prefixCodes("uniform", ["journal_unbalanced", "record_invalid"])).toEqual(["uniform:journal_unbalanced", "uniform:record_invalid"]);
    const text = formatGuardPush([{ code: "uniform:journal_unbalanced", before: 0, after: 1 }], "יולי-אוגוסט 2026, מבנה אחיד 2025");
    expect(text.split("\n")[0]).toContain("בדיקות דוחות ההגשה");
    expect(text).toContain("uniform:journal_unbalanced: 0 -> 1");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/wtp2 && npx vitest run tests/filing-guard.test.ts`
Expected: FAIL, `prefixCodes is not a function`.

- [ ] **Step 3: Implement the pure half**

In `src/lib/filing-guard.ts` replace:

```ts
    `דיווח מפורט PCN874, ${periodLabel}: בדיקה חוסמת חדשה או מתרחבת`,
```

with:

```ts
    `בדיקות דוחות ההגשה, ${periodLabel}: בדיקה חוסמת חדשה או מתרחבת`,
```

and append at the end of the file:

```ts
/**
 * Keeps report families apart in one state file. PCN874 codes stay bare (the
 * existing state keeps comparing); the others are "invoices:<code>" and
 * "uniform:<code>".
 */
export function prefixCodes(prefix: string, codes: readonly string[]): string[] {
  return codes.map((code) => `${prefix}:${code}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/wtp2 && npx vitest run tests/filing-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the guard script**

Replace the whole content of `scripts/filing-preflight-guard.mjs` with:

```js
#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Nightly filing preflight guard.
 *
 * PCN874: for every VAT-filing business, builds the file for the last ended
 * bi-monthly period with the SAME exported builder /reports/vat uses.
 * Invoices-period ("invoices:" codes): the same documents through the SAME
 * preflight /reports/invoices-period uses, counting findings that stop the
 * listing or change its totals.
 * Uniform structure ("uniform:" codes): for every business with activity in
 * the previous tax year, the SAME check the export route runs.
 *
 * Only { code, businessesAffected } ever leaves this process: messages can
 * embed amounts, so they are never printed, pushed or stored.
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
import { invoiceListAffectingCodes, invoiceReportPreflight } from "../src/lib/invoice-report-preflight.ts";
import { checkUniformExport } from "../src/lib/uniform-structure/check.ts";
import { uniformBlockingCodes } from "../src/lib/uniform-structure/issues.ts";
import { groupUniformItems, mapUniformBusiness, mapUniformClient, mapUniformDocument, mapUniformExpense } from "../src/lib/uniform-structure/rows.ts";
import { UNIFORM_SOFTWARE } from "../src/lib/uniform-structure/software.ts";
import { countAffectedBusinesses, formatGuardPush, formatGuardTable, newOrGrownCodes, prefixCodes } from "../src/lib/filing-guard.ts";

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

/** PCN874 + invoices-period for the last ended bi-monthly period. */
async function filingPeriodSection(range, now, perBusiness) {
  const businesses = await readAll(
    () => sb.from("businesses").select("id,tax_id,business_type").in("business_type", ["authorized", "company"]).order("id", { ascending: true }),
    "businesses",
  );
  let active = 0;
  let failures = 0;
  for (const b of businesses) {
    try {
      const [docRows, expenseRows] = await Promise.all([
        readAll(() => sb.from("documents").select(FILING_COLUMNS.documents).eq("business_id", b.id).order("id", { ascending: true }), "documents"),
        readAll(() => sb.from("expenses").select(FILING_COLUMNS.expenses).eq("business_id", b.id).order("id", { ascending: true }), "expenses"),
      ]);
      const documents = docRows.map(mapFilingDocument);
      const invoiceCodes = prefixCodes("invoices", invoiceListAffectingCodes(invoiceReportPreflight(documents, range.start, range.end)));
      const result = buildPcn874({
        business: { taxId: b.tax_id ?? "", businessType: b.business_type },
        documents,
        expenses: expenseRows.map(mapFilingExpense),
        range,
        generatedOn: now,
      });
      // A business with nothing in the period would only report its settings; skip it.
      const pcnActive = result.transactions.length > 0 || result.warnings.length > 0;
      if (!pcnActive && invoiceCodes.length === 0) continue;
      active += 1;
      perBusiness.push([...(pcnActive ? pcnBlockingCodes(result) : []), ...invoiceCodes]);
    } catch {
      failures += 1;
    }
  }
  return { active, failures };
}

/** Uniform structure for the previous tax year, every business type. */
async function uniformSection(year, perBusiness) {
  const businesses = await readAll(
    () => sb.from("businesses").select("id,name,business_type,tax_id,address,phone,email").order("id", { ascending: true }),
    "businesses",
  );
  const inYear = (row) => typeof row.date === "string" && row.date.startsWith(`${year}-`);
  let active = 0;
  let failures = 0;
  for (const b of businesses) {
    try {
      const [clientRows, docRows, expenseRows] = await Promise.all([
        readAll(() => sb.from("clients").select("*").eq("business_id", b.id).order("id", { ascending: true }), "clients"),
        readAll(() => sb.from("documents").select("*").eq("business_id", b.id).order("id", { ascending: true }), "documents"),
        readAll(() => sb.from("expenses").select("*").eq("business_id", b.id).order("id", { ascending: true }), "expenses"),
      ]);
      if (!docRows.some(inYear) && !expenseRows.some(inYear)) continue;
      const itemRows = [];
      const ids = docRows.map((d) => d.id);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        itemRows.push(...await readAll(() => sb.from("document_items").select("*").in("document_id", chunk).order("id", { ascending: true }), "document_items"));
      }
      const items = groupUniformItems(itemRows);
      const { issues } = checkUniformExport(
        {
          business: mapUniformBusiness(b),
          clients: clientRows.map(mapUniformClient),
          documents: docRows.map((row) => mapUniformDocument(row, items.get(row.id) ?? [])),
          expenses: expenseRows.map(mapUniformExpense),
          taxYear: year,
          fromDate: `${year}-01-01`,
          toDate: `${year}-12-31`,
        },
        { sample: false, registrationNumber: UNIFORM_SOFTWARE.registrationNumber },
      );
      active += 1;
      perBusiness.push(prefixCodes("uniform", uniformBlockingCodes(issues)));
    } catch {
      failures += 1;
    }
  }
  return { active, failures };
}

async function main() {
  const now = new Date();
  const range = biMonthlyRange(now, -1);
  const year = now.getFullYear() - 1;
  const perBusiness = [];

  const filing = await filingPeriodSection(range, now, perBusiness);
  const uniform = await uniformSection(year, perBusiness);

  const counts = countAffectedBusinesses(perBusiness);
  const loadFailures = filing.failures + uniform.failures;
  if (loadFailures) counts.guard_load_failed = loadFailures;
  console.log(`PCN874 + invoices-period guard, period ${range.start}..${range.end}, businesses with activity: ${filing.active}`);
  console.log(`uniform structure guard, tax year ${year}, businesses with activity: ${uniform.active}`);
  console.log(formatGuardTable(counts));
  if (dryRun) return;

  const previous = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")).counts ?? {} : {};
  const changes = newOrGrownCodes(previous, counts);
  const saveState = () => writeFileSync(STATE, JSON.stringify({ updatedAt: now.toISOString(), periodEnd: range.end, uniformYear: year, counts }, null, 2) + "\n");

  if (changes.length === 0) {
    saveState();
    console.log("no new or grown codes, staying quiet");
    return;
  }
  const text = formatGuardPush(changes, `${range.label}, מבנה אחיד ${year}`);
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

- [ ] **Step 6: Dry run against production (codes and counts only)**

Run: `cd /c/wtp2 && node --import tsx scripts/filing-preflight-guard.mjs --dry-run`
Expected: two "businesses with activity" lines and a `code\tbusinessesAffected` table with bare PCN codes, `invoices:` and `uniform:` codes (or `(none)`), exit 0. The output must contain no names, numbers or amounts. Do NOT run it without `--dry-run`. If `guard_load_failed` appears, report its count to the planner; do not print errors.

- [ ] **Step 7: Commit**

```bash
cd /c/wtp2 && git add src/lib/filing-guard.ts scripts/filing-preflight-guard.mjs tests/filing-guard.test.ts && git commit -m "feat(guard): invoices-period and uniform structure codes join the nightly guard" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: E2E on the QA tenant with desktop and mobile screenshots

Uses the Lynkeus QA user (`C:/Users/asafk/agents/lynkeus/state/keys.json`: `email`, `password`, `businessId`) by session injection, like Phase 1. Issued documents are never seeded (a numbered document can never be deleted); the invoices-period findings are injected into the browser's documents response instead.

**Files:**
- Create: `scripts/qa-seed-uniform-invoices.mjs`, `scripts/qa-uniform-invoices-e2e.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write the seed script**

Create `scripts/qa-seed-uniform-invoices.mjs`:

```js
// QA helper for the uniform structure + invoices-period E2E. Lynkeus QA tenant only.
//   seed:  snapshot and empty the QA business number (the E2E fixes it inline
//          with an 8-digit number without its leading zero) and add one
//          synthetic client with a foreign id (a note, never a blocker).
//   clean: delete that client, restore the business number, verify the
//          restore, print counts only.
//
//   node scripts/qa-seed-uniform-invoices.mjs --reason "QA: uniform + invoices-period E2E" seed
//   node scripts/qa-seed-uniform-invoices.mjs --reason "QA: uniform + invoices-period E2E" clean
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { supabase } from "./admin.mjs";

const mode = process.argv.includes("clean") ? "clean" : "seed";
const keys = JSON.parse(fs.readFileSync("C:/Users/asafk/agents/lynkeus/state/keys.json", "utf8"));
const SNAPSHOT = new URL("../.qa-uniform-invoices-snapshot.json", import.meta.url);
const TAG = "qa-uniform-invoices";

const { data: biz, error: bizError } = await supabase.from("businesses").select("id, tax_id").eq("id", keys.businessId).maybeSingle();
if (bizError) throw bizError;
if (!biz) throw new Error("QA business not found");

const { error: removeError } = await supabase.from("clients").delete().eq("business_id", biz.id).eq("notes", TAG);
if (removeError) throw removeError;

if (mode === "clean") {
  if (fs.existsSync(SNAPSHOT)) {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    const { error } = await supabase.from("businesses").update({ tax_id: snap.tax_id }).eq("id", biz.id);
    if (error) throw error;
    const { data: back } = await supabase.from("businesses").select("tax_id").eq("id", biz.id).maybeSingle();
    const ok = (back?.tax_id ?? "") === snap.tax_id;
    console.log(`restore verified: business number ${ok}`);
    if (!ok) process.exit(1);
    fs.rmSync(SNAPSHOT);
  }
  const { count } = await supabase.from("clients").select("id", { count: "exact", head: true }).eq("business_id", biz.id).eq("notes", TAG);
  console.log(`seeded clients left: ${count}`);
  process.exit(0);
}

if (fs.existsSync(SNAPSHOT)) throw new Error("a previous seed was not cleaned: run clean first");
fs.writeFileSync(SNAPSHOT, JSON.stringify({ tax_id: biz.tax_id ?? "" }));

const { error: bizUpdateError } = await supabase.from("businesses").update({ tax_id: "" }).eq("id", biz.id);
if (bizUpdateError) throw bizUpdateError;
const { error: clientError } = await supabase.from("clients").insert({ id: randomUUID(), business_id: biz.id, name: "לקוח חו״ל QA", tax_id: "DE123456789", notes: TAG });
if (clientError) throw clientError;
console.log("QA business number emptied; one foreign-id client added");
```

- [ ] **Step 2: Write the E2E driver**

Create `scripts/qa-uniform-invoices-e2e.mjs`:

```js
// E2E for Phases 2 and 3 of the friendly filing reports on the Lynkeus QA tenant.
//   Uniform structure (/reports): run the check, fix the business number
//   inline with an 8-digit number (no leading zero), see the foreign client as
//   a collapsed note, download the ZIP when nothing blocks and check the
//   padded dealer number in INI.TXT and in the folder name.
//   Invoices-period: synthetic rows (a USD document without shekel amounts and
//   a duplicate number) injected into the browser's documents response through
//   CDP Fetch, no database write. Panel above the table, partial total, Excel
//   with the stamp, print stamp, PDF produced.
//   Desktop + mobile screenshots of both screens for reading.
//
//   BASE=http://localhost:3107 OUT=C:/Users/asafk/AppData/Local/Temp/filing-e2e-2 node scripts/qa-uniform-invoices-e2e.mjs
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { loadEnv } from "./lib/admin-core.mjs";

const BASE = process.env.BASE || "http://localhost:3107";
const OUT = process.env.OUT;
if (!OUT) {
  console.error("usage: OUT=<dir> [BASE=http://localhost:3107] node scripts/qa-uniform-invoices-e2e.mjs");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

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
  console.error("watchdog: E2E ran longer than 15 minutes");
  process.exit(2);
}, 900_000);

const DESKTOP = { width: 1440, height: 1000, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const PANEL = '[data-testid="filing-fix-panel"]';
const UNIFORM = `#uniform-preflight ${PANEL}`;

// Synthetic invoices-period rows, dated the first of the current Israeli month
// (inside the page's default two-month preset). Ids are not UUIDs on purpose:
// they can never collide with a real row.
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const base = { date: `${month}-01`, type: "tax_invoice", status: "sent", client_id: null, client_tax_id: "", converted_to_id: null, allocation_number: null, rounding: 0, import_batch_id: null };
const synthetic = [
  { ...base, id: "qa-e2e-usd", number: 990001, client_name: "QA E2E USD", subtotal: 100, vat: 0, total: 100, currency: "USD", exchange_rate: 3.7, subtotal_ils: null, vat_ils: null, total_ils: null, zero_rated: true },
  { ...base, id: "qa-e2e-dup-a", number: 990002, client_name: "QA E2E", subtotal: 100, vat: 18, total: 118, currency: "ILS", exchange_rate: 1, subtotal_ils: 100, vat_ils: 18, total_ils: 118, zero_rated: false },
  { ...base, id: "qa-e2e-dup-b", number: 990002, client_name: "QA E2E", subtotal: 100, vat: 18, total: 118, currency: "ILS", exchange_rate: 1, subtotal_ils: 100, vat_ils: 18, total_ils: 118, zero_rated: false },
];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  userDataDir: path.join(OUT, `profile-${process.pid}`),
  args: ["--no-first-run", "--disable-extensions"],
});

try {
  const page = await browser.newPage();

  // Every download in this app goes through URL.createObjectURL: keep the blobs to read them back.
  await page.evaluateOnNewDocument(() => {
    window.__blobs = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob) window.__blobs.push(blob);
      return original(blob);
    };
  });
  async function captureBlob(typePrefix, click) {
    await page.evaluate(() => { window.__blobs = []; });
    await click();
    await page.waitForFunction((t) => window.__blobs.some((b) => b.type.startsWith(t)), { timeout: 120_000 }, typePrefix);
    const base64 = await page.evaluate(async (t) => {
      const blob = window.__blobs.find((b) => b.type.startsWith(t));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }, typePrefix);
    return Buffer.from(base64, "base64");
  }

  async function settle(viewport, selector) {
    await page.waitForFunction((w) => window.innerWidth === w, { timeout: 10_000 }, viewport.width);
    await page.$eval(selector, (el) => el.scrollIntoView({ block: "start" }));
    await sleep(1200);
  }
  const itemCodes = (scope) => page.$$eval(`${scope} [data-fix-code]`, (els) => els.map((el) => `${el.getAttribute("data-fix-code")}/${el.getAttribute("data-fix-tier")}`));
  async function fixInline(scope, code, label, value) {
    const selector = `${scope} [data-fix-code="${code}"] input[aria-label="${label}"]`;
    const input = await page.waitForSelector(selector, { timeout: 30_000 });
    // Clear by keyboard, not triple-click (puppeteer 25 renamed clickCount).
    await input.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await input.type(value);
    await (await page.$(`${scope} [data-fix-code="${code}"] [data-fix-save]`)).click();
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 120_000 }, selector);
  }
  async function step(label, fn) {
    try {
      await fn();
      check(true, label);
    } catch (err) {
      check(false, `${label}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.evaluate((key, value) => localStorage.setItem(key, value), storageKey, JSON.stringify(auth.session));

  // ---------- uniform structure ----------
  async function openUniform(viewport) {
    await page.setViewport(viewport);
    await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    const card = await page.waitForFunction(() => [...document.querySelectorAll("button.rpt-rc")].find((b) => b.textContent.includes("OPENFORMAT")), { timeout: 240_000 });
    await card.asElement().click();
    await page.waitForSelector(UNIFORM, { timeout: 240_000 });
    await settle(viewport, "#uniform-preflight");
  }

  await openUniform(DESKTOP);
  const before = await itemCodes("#uniform-preflight");
  console.log("uniform items before:", before.join(","));
  check(before.includes("dealer_number_invalid/blocking"), "an empty business number is a blocking item with an inline field");
  await page.screenshot({ path: path.join(OUT, "uniform-desktop-before.png") });
  await openUniform(MOBILE);
  await page.screenshot({ path: path.join(OUT, "uniform-mobile-before.png") });

  await openUniform(DESKTOP);
  await step("business number fixed inline with 8 digits re-checks and unblocks it", () => fixInline("#uniform-preflight", "dealer_number_invalid", "מספר העוסק של העסק", "13333331"));
  await sleep(1500);
  const after = await itemCodes("#uniform-preflight");
  console.log("uniform items after:", after.join(","));
  check(!after.some((c) => c.startsWith("dealer_number_invalid")), "an 8-digit business number no longer blocks");
  await step("the foreign-id client is a collapsed note", async () => {
    await (await page.waitForSelector(`${UNIFORM} button[aria-expanded]`, { timeout: 15_000 })).click();
    await page.waitForSelector(`${UNIFORM} [data-fix-code="client_number_not_israeli"][data-fix-tier="note"]`, { timeout: 15_000 });
  });
  await page.$eval("#uniform-preflight", (el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(OUT, "uniform-desktop-after.png") });

  const blocking = (await itemCodes("#uniform-preflight")).filter((c) => c.endsWith("/blocking"));
  if (blocking.length === 0) {
    await step("ZIP downloads with the padded dealer number", async () => {
      const zipBytes = await captureBlob("application/zip", async () => {
        await (await page.waitForSelector('[data-testid="uniform-download"]:not([disabled])', { timeout: 30_000 })).click();
      });
      const zip = await JSZip.loadAsync(zipBytes);
      const iniName = Object.keys(zip.files).find((name) => /^OPENFRMT\/01333333\.\d{2}\/\d{8}\/INI\.TXT$/.test(name));
      if (!iniName) throw new Error(`no INI.TXT under OPENFRMT/01333333.YY (${Object.keys(zip.files).length} entries)`);
      const ini = Buffer.from(await zip.file(iniName).async("uint8array")).toString("latin1");
      if (ini.slice(24, 33) !== "013333331") throw new Error("INI dealer field is not the padded number");
    });
  } else {
    check(false, `uniform check still blocks on QA data, codes: ${blocking.join(",")}`);
  }
  await openUniform(MOBILE);
  await page.screenshot({ path: path.join(OUT, "uniform-mobile-after.png") });

  // ---------- invoices-period ----------
  const fetchSession = await page.target().createCDPSession();
  let injected = 0;
  fetchSession.on("Fetch.requestPaused", async (event) => {
    try {
      const status = event.responseStatusCode ?? 0;
      const select = new URL(event.request.url).searchParams.get("select") ?? "";
      if (event.request.method !== "GET" || !select.includes("import_batch_id") || (status !== 200 && status !== 206)) {
        await fetchSession.send("Fetch.continueRequest", { requestId: event.requestId });
        return;
      }
      const { body, base64Encoded } = await fetchSession.send("Fetch.getResponseBody", { requestId: event.requestId });
      const rows = JSON.parse(base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body);
      const original = event.responseHeaders ?? [];
      const range = original.find((h) => h.name.toLowerCase() === "content-range")?.value ?? "";
      const total = Number(/\/(\d+)$/.exec(range)?.[1] ?? rows.length);
      // Single page only (the report pages by 500 and the QA tenant has fewer rows).
      const next = total === rows.length ? [...rows, ...synthetic] : rows;
      if (next !== rows) injected += 1;
      const headers = original.filter((h) => !["content-range", "content-length", "content-encoding"].includes(h.name.toLowerCase()));
      headers.push({ name: "Content-Range", value: next.length ? `0-${next.length - 1}/${total === rows.length ? next.length : total}` : "*/0" });
      await fetchSession.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: status, responseHeaders: headers, body: Buffer.from(JSON.stringify(next)).toString("base64") });
    } catch {
      await fetchSession.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => {});
    }
  });
  await fetchSession.send("Fetch.enable", { patterns: [{ urlPattern: "*/rest/v1/documents*", requestStage: "Response" }] });

  async function openInvoices(viewport) {
    await page.setViewport(viewport);
    await page.goto(`${BASE}/reports/invoices-period`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await page.waitForSelector(PANEL, { timeout: 240_000 });
    await settle(viewport, PANEL);
  }

  await openInvoices(DESKTOP);
  check(injected > 0, "synthetic rows were injected into the documents response");
  const invoiceItems = await itemCodes("body");
  console.log("invoices-period items:", invoiceItems.join(","));
  check(invoiceItems.includes("foreign_currency_missing_ils/action"), "a USD document without shekel amounts is a visible item");
  check(invoiceItems.includes("duplicate_number/action"), "a duplicate document number is a visible item");
  const headline = await page.$eval(`${PANEL} [role="status"]`, (el) => el.textContent.trim());
  check(headline.includes("משפיע"), `the headline says the totals are affected (got "${headline}")`);
  check((await page.$eval("tfoot", (el) => el.textContent)).includes("חלקי"), "the total row is marked partial");
  check((await page.$eval("tbody", (el) => el.textContent)).includes("חסר בשקלים"), "the missing amounts are shown, not zero");
  await page.screenshot({ path: path.join(OUT, "invoices-desktop.png"), fullPage: true });

  await step("Excel downloads with the partial total and the notes", async () => {
    const bytes = await captureBlob("application/vnd.openxmlformats", async () => {
      const button = await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("ייצוא Excel") && !b.disabled), { timeout: 30_000 });
      await button.asElement().click();
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const values = [];
    wb.getWorksheet("חשבוניות").eachRow((row) => row.eachCell((cell) => values.push(String(cell.value?.result ?? cell.value ?? ""))));
    if (!values.includes("סה״כ (חלקי)")) throw new Error("no partial total label");
    if (!values.includes("הערות לדוח:")) throw new Error("no notes section");
  });
  await step("the stamp is visible in print media", async () => {
    await page.emulateMediaType("print");
    const shown = await page.$eval('[data-testid="invoice-report-stamp"]', (el) => getComputedStyle(el).display !== "none");
    await page.emulateMediaType("screen");
    if (!shown) throw new Error("stamp hidden in print");
  });
  await step("PDF is produced", async () => {
    const bytes = await captureBlob("application/pdf", async () => {
      const button = await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("הורדת PDF") && !b.disabled), { timeout: 30_000 });
      await button.asElement().click();
    });
    if (bytes.length < 1000 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("not a PDF");
  });
  await openInvoices(MOBILE);
  await page.screenshot({ path: path.join(OUT, "invoices-mobile.png"), fullPage: true });
} finally {
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS");
process.exitCode = failures.length ? 1 : 0;
```

- [ ] **Step 3: Ignore the QA snapshot**

In `.gitignore` replace:

```
.qa-filing-fix-snapshot.json
```

with:

```
.qa-filing-fix-snapshot.json
.qa-uniform-invoices-snapshot.json
```

- [ ] **Step 4: Build and start a local production server**

Run: `cd /c/wtp2 && npx next build --webpack`
Expected: exit 0.

Then start the server in the background (Bash tool with `run_in_background: true`): `cd /c/wtp2 && npx next start -p 3107`
Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:3107/login` prints `200`.

- [ ] **Step 5: Seed, run, clean (clean runs even if the E2E fails)**

```bash
cd /c/wtp2 && node scripts/qa-seed-uniform-invoices.mjs --reason "QA: uniform + invoices-period E2E" seed
cd /c/wtp2 && BASE=http://localhost:3107 OUT=C:/Users/asafk/AppData/Local/Temp/filing-e2e-2 node scripts/qa-uniform-invoices-e2e.mjs; echo "e2e exit $?"
cd /c/wtp2 && node scripts/qa-seed-uniform-invoices.mjs --reason "QA: uniform + invoices-period E2E" clean
```

Expected: seed prints "QA business number emptied; one foreign-id client added"; the E2E prints PASS lines and `ALL PASS` (exit 0); clean prints `restore verified: business number true` and `seeded clients left: 0`. If the only FAIL is "uniform check still blocks on QA data", report the printed codes to the planner (that is real QA tenant data, not a bug to paper over). If clean does not verify, STOP and report.

- [ ] **Step 6: Read the screenshots**

Read with the Read tool: `C:/Users/asafk/AppData/Local/Temp/filing-e2e-2/uniform-desktop-before.png`, `uniform-mobile-before.png`, `uniform-desktop-after.png`, `uniform-mobile-after.png`, `invoices-desktop.png`, `invoices-mobile.png`.
Check each: text sharp (no transform blur), nothing clipped, overlapping or invisible, RTL intact, the inline field and its save button on one line at 390px, the panel above the table on the invoices page, "חסר בשקלים" readable in the table. Fix any defect in the component, commit it separately with the trailer, and re-run Step 5.

- [ ] **Step 7: Stop the server and commit**

Stop the background `next start` process.

```bash
cd /c/wtp2 && git add scripts/qa-seed-uniform-invoices.mjs scripts/qa-uniform-invoices-e2e.mjs .gitignore && git commit -m "test(reports): QA seed and E2E for the uniform export and invoices-period panels" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Full verification and production build

**Files:** none new (fixes only if something fails)

- [ ] **Step 1: Whole test suite**

Run: `cd /c/wtp2 && npx vitest run`
Expected: all test files pass.

- [ ] **Step 2: Typecheck and lint (same gates as the pre-push hook)**

Run: `cd /c/wtp2 && npx tsc --noEmit && npx eslint src/`
Expected: both exit 0.

- [ ] **Step 3: Dash scan of everything this plan touched**

Use the Grep tool with pattern `[\x{2013}\x{2014}]` over `C:\wtp2\src`, `C:\wtp2\tests`, `C:\wtp2\scripts\filing-preflight-guard.mjs`, `C:\wtp2\scripts\qa-seed-uniform-invoices.mjs`, `C:\wtp2\scripts\qa-uniform-invoices-e2e.mjs` and `C:\wtp2\docs\superpowers`.
Expected: no matches in files changed by this plan (replace any hit with a plain hyphen).

- [ ] **Step 4: Production build**

Run: `cd /c/wtp2 && npx next build --webpack`
Expected: exit 0, `/reports`, `/reports/invoices-period` and `/api/uniform-structure/export` listed in the route table.

- [ ] **Step 5: Review passes required by AGENTS.md**

Run the `simplify` skill on the diff of this plan's commits (`git diff 77af687..HEAD`), and the `desktop-polish` and `mobile-polish` skills on `/reports` (with the uniform check open) and `/reports/invoices-period`. Apply only findings that keep all tests green; commit each fix separately with the trailer.

- [ ] **Step 6: Final state, then stop (no push)**

```bash
cd /c/wtp2 && git status --short && git log --oneline 63399dd..HEAD
```

Expected: clean tree (if `next build` rewrote `AGENTS.md`, restore it with `git restore AGENTS.md`), the two design-doc commits and one commit per task above them.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Field semantics from `horaot_131_raw.txt`: C100 1219-1224 shekels, 1217/1218 native total and ISO code | 3, 4 |
| D110 1265/1267 converted, last line absorbs agorot; D120 1312 shekels | 3, 4, 5 |
| B100 1368 shekels plus 1367/1369 for foreign documents; doc-type summary in shekels | 4, 5 |
| Foreign documents block only without shekel snapshots or a usable rate/code | 6 |
| Dealer number normalized in preflight, every record, INI, folder and file name (council 5) | 5, 6, 7 |
| C100 1215 and B110 1419 normalized, refused values blank plus note, inline customer field (council 2) | 4, 6, 9 |
| One shared id-to-key map for every B110 and B100 site, 15 chars, stable, no merge (council 3) | 2, 5 |
| `account_key_duplicate` output safety net; old collision checks removed | 6 |
| Rounding line capped at stored rounding, declared ROUNDING account, strict journal check, input total check stays blocking (council 4) | 3, 5, 6 |
| Stable code on every uniform finding, route codes, one check entry point (council 6) | 1, 6, 7 |
| Guard runs uniform preflight for the previous year, dry run only (council 6) | 17 |
| Panel pattern on /reports: what's left, inline fixes, notes collapsed, re-check after save (council 7) | 8, 9, 10, 11 |
| Invoices-period: downloads allowed, only an unusable period blocks | 12, 15 |
| Invoices-period: visible panel above the table | 14, 15 |
| Invoices-period: stamp in Excel (notes, partial label) and in the PDF/print | 13, 15 |
| Invoices-period: totals marked partial when shekel amounts are missing | 13, 15 |
| Invoices-period guard codes | 17 |
| E2E + desktop/mobile screenshots read | 18 |
| Full vitest + `npx next build --webpack` | 19 |

Known gaps, deliberately not in this plan: fields 1013 and 1225 unchanged, real guard pushes and scheduling, seeding issued documents on the QA tenant (see the spec's out of scope and open questions).
