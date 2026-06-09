# Multi-currency Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue client-facing documents in a foreign currency (USD/EUR/…) with a snapshotted ₪ equivalent, so the ₪-based reports/tax engine stays correct and existing ₪ documents behave identically.

**Architecture:** Per-document `currency` + `exchange_rate` + snapshotted `subtotal_ils`/`vat_ils`/`total_ils` (Approach A) + a `zero_rated` export flag forcing 0% VAT. The editor works in the foreign currency; reports/tax/allocation read the `*_ils` columns. Bank-of-Israel representative rate is fetched server-side (auto + manual override).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RPC), TypeScript, vitest. Migrations are SQL files run via `node scripts/run-sql.mjs <file>`.

**Spec:** `docs/superpowers/specs/2026-06-09-multi-currency-invoices-design.md`

**Verification baseline:** every task ends green. Build: `npx next build` exits 0. Tests: `npx vitest run`. Deploy after a task = commit then `git push origin main && git push origin main:master` (Vercel deploys from master).

---

## File map

- Create `src/lib/currencies.ts` — curated currency list + symbol/format helpers (pure).
- Create `src/lib/exchange-rate.ts` — `ilsEquivalents()` pure helper + BoI fetch/parse/cache.
- Create `src/app/api/exchange-rate/route.ts` — server route wrapping the BoI fetch.
- Create `scripts/migrations/20260609-multi-currency.sql` — ALTER `documents` + replace `create_document_atomic`.
- Modify `src/lib/types.ts` — extend `InvoiceDocument`.
- Modify `src/lib/document-store.ts` — `mapDocRow` + `createDocument` RPC params.
- Modify `src/lib/tax-authority.ts` — `requiresAllocationNumber` uses the ₪ total.
- Modify `src/components/receipt-editor.tsx` — currency/zero-rated/rate UI + persist `*_ils`.
- Modify `src/components/document-body.tsx` (+ receipt-view) — currency symbol, ₪-equivalent line, export note.
- Modify `src/app/api/tax-authority/request-allocation/route.ts` — send `*_ils`.
- Modify `src/app/api/public-document/[id]/route.ts` — keep the new display columns.
- Modify reports: `src/app/(app)/reports/*` + `src/lib/tax-projection.ts` callers + aging/statement — read `*_ils`.
- Tests under `tests/`.

---

## Task 1: Currencies const + helpers

**Files:**
- Create: `src/lib/currencies.ts`
- Test: `tests/currencies.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/currencies.test.ts
import { describe, it, expect } from "vitest";
import { CURRENCIES, currencySymbol, formatMoney, isSupportedCurrency } from "@/lib/currencies";

describe("currencies", () => {
  it("includes ILS as the default plus the curated foreign set", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(codes).toContain("ILS");
    expect(codes).toEqual(expect.arrayContaining(["USD", "EUR", "GBP", "CHF", "CAD", "AUD"]));
  });
  it("maps codes to symbols, ILS -> ₪", () => {
    expect(currencySymbol("ILS")).toBe("₪");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("XXX")).toBe("XXX"); // unknown -> code
  });
  it("formats an amount with its symbol and 2 decimals", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "ILS")).toBe("₪1,234.50");
  });
  it("validates supported currencies", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("xxx")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/currencies.test.ts`
Expected: FAIL — cannot find module `@/lib/currencies`.

- [ ] **Step 3: Implement**

```ts
// src/lib/currencies.ts
export interface Currency {
  code: string;
  symbol: string;
  name: string; // Hebrew label
}

export const CURRENCIES: Currency[] = [
  { code: "ILS", symbol: "₪", name: "שקל" },
  { code: "USD", symbol: "$", name: "דולר אמריקאי" },
  { code: "EUR", symbol: "€", name: "אירו" },
  { code: "GBP", symbol: "£", name: "ליש\"ט" },
  { code: "CHF", symbol: "Fr", name: "פרנק שווייצרי" },
  { code: "CAD", symbol: "C$", name: "דולר קנדי" },
  { code: "AUD", symbol: "A$", name: "דולר אוסטרלי" },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

export function currencySymbol(code: string): string {
  return BY_CODE.get(code)?.symbol ?? code;
}

export function formatMoney(amount: number, code: string): string {
  return `${currencySymbol(code)}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/currencies.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/currencies.ts tests/currencies.test.ts
git commit -m "feat(currency): curated currency list + format helpers"
```

---

## Task 2: ₪-equivalent pure helper

**Files:**
- Create: `src/lib/exchange-rate.ts` (helper only in this task; fetch added in Task 3)
- Test: `tests/exchange-rate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/exchange-rate.test.ts
import { describe, it, expect } from "vitest";
import { ilsEquivalents } from "@/lib/exchange-rate";

describe("ilsEquivalents", () => {
  it("ILS-at-rate-1 returns the same numbers (backward compatible)", () => {
    expect(ilsEquivalents({ subtotal: 100, vat: 18, total: 118 }, 1)).toEqual({
      subtotalIls: 100, vatIls: 18, totalIls: 118,
    });
  });
  it("converts foreign amounts at the given rate, ₪ total = ₪ parts (reconciled)", () => {
    // rate 3.7 ₪/$, subtotal $100 vat $0 total $100 (zero-rated export)
    expect(ilsEquivalents({ subtotal: 100, vat: 0, total: 100 }, 3.7)).toEqual({
      subtotalIls: 370, vatIls: 0, totalIls: 370,
    });
  });
  it("rounds each part to 2dp and derives totalIls from the parts", () => {
    const r = ilsEquivalents({ subtotal: 33.33, vat: 6, total: 39.33 }, 3.715);
    expect(r.subtotalIls).toBe(123.82); // round2(33.33*3.715)=123.8210->123.82
    expect(r.vatIls).toBe(22.29);       // round2(6*3.715)=22.29
    expect(r.totalIls).toBe(146.11);    // subtotalIls + vatIls, NOT round2(total*rate)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/exchange-rate.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/lib/exchange-rate.ts
import { round2 } from "./vat";

export interface MoneyTriple {
  subtotal: number;
  vat: number;
  total: number;
}
export interface IlsTriple {
  subtotalIls: number;
  vatIls: number;
  totalIls: number;
}

/**
 * Snapshot the ₪ equivalent of a document's amounts at a given exchange
 * rate (₪ per 1 currency unit). Derives totalIls from the rounded parts so
 * the ₪ figures reconcile internally (same rule as the line/header fix).
 * For ILS docs the caller passes rate=1 → identical numbers.
 */
export function ilsEquivalents(m: MoneyTriple, rate: number): IlsTriple {
  const subtotalIls = round2(m.subtotal * rate);
  const vatIls = round2(m.vat * rate);
  return { subtotalIls, vatIls, totalIls: round2(subtotalIls + vatIls) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/exchange-rate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/exchange-rate.ts tests/exchange-rate.test.ts
git commit -m "feat(currency): ilsEquivalents ₪-snapshot helper"
```

---

## Task 3: Bank-of-Israel rate fetch + caching + API route

**Background:** Bank of Israel publishes representative rates. As of 2025 the
endpoint is the BoI "edge" API. **First step is to confirm the live endpoint**
(the BoI migrated from the old `boi.org.il/currency.xml` to
`https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/...`).
Implement against whatever returns a `(currency, date) -> rate` JSON, behind
the `fetchBoiRate` function so the parsing is swappable.

**Files:**
- Modify: `src/lib/exchange-rate.ts`
- Create: `src/app/api/exchange-rate/route.ts`
- Test: `tests/exchange-rate.test.ts` (extend)

- [ ] **Step 1: Write the failing test (cache + ILS short-circuit, fetch mocked)**

```ts
// append to tests/exchange-rate.test.ts
import { getRate, __setRateFetcher } from "@/lib/exchange-rate";

describe("getRate", () => {
  it("short-circuits ILS to 1 with no fetch", async () => {
    let called = 0;
    __setRateFetcher(async () => { called++; return 9; });
    expect(await getRate("ILS", "2026-06-09")).toBe(1);
    expect(called).toBe(0);
  });
  it("fetches a foreign rate and caches by (currency,date)", async () => {
    let called = 0;
    __setRateFetcher(async () => { called++; return 3.71; });
    expect(await getRate("USD", "2026-06-09")).toBe(3.71);
    expect(await getRate("USD", "2026-06-09")).toBe(3.71);
    expect(called).toBe(1); // second call served from cache
  });
  it("returns null when the fetch fails (manual-entry fallback)", async () => {
    __setRateFetcher(async () => { throw new Error("boom"); });
    expect(await getRate("EUR", "2026-06-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/exchange-rate.test.ts`
Expected: FAIL — `getRate` / `__setRateFetcher` not exported.

- [ ] **Step 3: Implement**

```ts
// append to src/lib/exchange-rate.ts

// BoI representative rate fetcher. Swappable for tests. Confirm the exact
// endpoint/shape at implementation time; parse to a number of ₪ per unit.
type RateFetcher = (currency: string, dateISO: string) => Promise<number>;

let fetcher: RateFetcher = async (currency, dateISO) => {
  // TODO at impl: call the BoI edge SDMX endpoint for `currency` on `dateISO`.
  const url =
    `https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0` +
    `/RER_${currency}_ILS?startPeriod=${dateISO}&endPeriod=${dateISO}&format=jsondata`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`BoI ${res.status}`);
  const json = await res.json();
  const value = Number(json?.data?.dataSets?.[0]?.series?.["0:0:0"]?.observations?.["0"]?.[0]);
  if (!Number.isFinite(value) || value <= 0) throw new Error("BoI: no rate");
  return value;
};

/** Test seam — override the network fetcher. */
export function __setRateFetcher(f: RateFetcher) {
  fetcher = f;
}

const cache = new Map<string, number>();

/**
 * ₪ per 1 unit of `currency` on `dateISO`. ILS → 1 (no network). On any
 * failure returns null so the caller falls back to manual entry. Cached by
 * (currency, date) — BoI daily rates are immutable for past dates.
 */
export async function getRate(currency: string, dateISO: string): Promise<number | null> {
  if (currency === "ILS") return 1;
  const key = `${currency}:${dateISO}`;
  if (cache.has(key)) return cache.get(key)!;
  try {
    const rate = await fetcher(currency, dateISO);
    cache.set(key, rate);
    return rate;
  } catch {
    return null;
  }
}
```

```ts
// src/app/api/exchange-rate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRate } from "@/lib/exchange-rate";
import { isSupportedCurrency } from "@/lib/currencies";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const currency = url.searchParams.get("currency") || "";
  const date = url.searchParams.get("date") || "";
  if (!isSupportedCurrency(currency) || !DATE_RE.test(date)) {
    return NextResponse.json({ ok: false, error: "bad params" }, { status: 400 });
  }
  const rate = await getRate(currency, date);
  return NextResponse.json({ ok: true, rate }); // rate may be null -> manual entry
}
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run tests/exchange-rate.test.ts` → PASS (6 tests).
Run: `npx next build` → exits 0 (route compiles).

- [ ] **Step 5: Commit**

```bash
git add src/lib/exchange-rate.ts src/app/api/exchange-rate/route.ts tests/exchange-rate.test.ts
git commit -m "feat(currency): BoI rate fetch + cache + /api/exchange-rate"
```

- [ ] **Step 6: Confirm the BoI endpoint live (manual)**

`curl 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startPeriod=2026-06-08&endPeriod=2026-06-08&format=jsondata'`
If the shape differs, adjust the parse in `fetcher` only (tests still pass — they mock it). Commit any parse fix.

---

## Task 4: Schema migration + RPC extension

**Files:**
- Create: `scripts/migrations/20260609-multi-currency.sql`

- [ ] **Step 1: Write the migration**

```sql
-- scripts/migrations/20260609-multi-currency.sql
-- Multi-currency: per-document currency + rate + ₪-equivalent snapshot + zero-rated.
-- Backward compatible: existing rows backfill to ILS / rate 1 / *_ils = * / not zero-rated.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'ILS',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal_ils NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS vat_ils NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS total_ils NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS zero_rated BOOLEAN NOT NULL DEFAULT false;

UPDATE documents
  SET subtotal_ils = COALESCE(subtotal_ils, subtotal),
      vat_ils      = COALESCE(vat_ils, vat),
      total_ils    = COALESCE(total_ils, total)
  WHERE subtotal_ils IS NULL OR vat_ils IS NULL OR total_ils IS NULL;

-- Extend the atomic creator with the new fields (defaults keep it safe).
CREATE OR REPLACE FUNCTION public.create_document_atomic(
  p_business_id uuid,
  p_id uuid,
  p_type text,
  p_date date,
  p_client_id uuid,
  p_client_name text,
  p_subject text,
  p_status text,
  p_subtotal numeric,
  p_vat numeric,
  p_total numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb,
  p_currency text DEFAULT 'ILS',
  p_exchange_rate numeric DEFAULT 1,
  p_subtotal_ils numeric DEFAULT NULL,
  p_vat_ils numeric DEFAULT NULL,
  p_total_ils numeric DEFAULT NULL,
  p_zero_rated boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_number int;
  v_business_user uuid;
BEGIN
  SELECT user_id INTO v_business_user FROM businesses WHERE id = p_business_id;
  IF v_business_user IS NULL OR v_business_user <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO document_counters (business_id, doc_type, next_number)
  VALUES (p_business_id, p_type, CASE WHEN p_type = 'receipt' THEN 1001 ELSE 201 END)
  ON CONFLICT (business_id, doc_type) DO NOTHING;

  UPDATE document_counters
  SET next_number = next_number + 1
  WHERE business_id = p_business_id AND doc_type = p_type
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO documents (
    id, business_id, type, number, date, client_id, client_name,
    subject, status, subtotal, vat, total, payment_method, notes,
    currency, exchange_rate, subtotal_ils, vat_ils, total_ils, zero_rated
  ) VALUES (
    p_id, p_business_id, p_type, v_number, p_date, p_client_id, p_client_name,
    p_subject, p_status, p_subtotal, p_vat, p_total, p_payment_method, p_notes,
    COALESCE(p_currency, 'ILS'), COALESCE(p_exchange_rate, 1),
    COALESCE(p_subtotal_ils, p_subtotal), COALESCE(p_vat_ils, p_vat),
    COALESCE(p_total_ils, p_total), COALESCE(p_zero_rated, false)
  );

  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO document_items (id, document_id, product_id, description, quantity, unit_price, total, sort_order)
    SELECT (item->>'id')::uuid, p_id, NULLIF(item->>'product_id', '')::uuid,
      item->>'description', (item->>'quantity')::numeric, (item->>'unit_price')::numeric,
      (item->>'total')::numeric, (idx - 1)::int
    FROM jsonb_array_elements(p_items) WITH ORDINALITY arr(item, idx);
  END IF;

  RETURN json_build_object('id', p_id, 'number', v_number);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_document_atomic TO authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `node scripts/run-sql.mjs scripts/migrations/20260609-multi-currency.sql`
Expected: success, no error.

- [ ] **Step 3: Verify columns + backfill**

Run:
```bash
node -e 'import("fs").then(async({readFileSync})=>{const e=readFileSync("./.env.local","utf8").split("\n").filter(l=>l&&!l.startsWith("#")).reduce((a,l)=>{const[k,...r]=l.split("=");if(k)a[k.trim()]=r.join("=").trim();return a;},{});const{createClient}=await import("@supabase/supabase-js");const sb=createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});const{data}=await sb.from("documents").select("currency,exchange_rate,total,total_ils").limit(3);console.log(data);})'
```
Expected: rows show `currency:'ILS'`, `exchange_rate:1`, `total_ils === total`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/20260609-multi-currency.sql
git commit -m "feat(currency): documents schema + create_document_atomic extension"
```

(Schema-only; safe to push — no app code reads the columns yet.)

---

## Task 5: Types + document-store mapping & create

**Files:**
- Modify: `src/lib/types.ts:61-105` (InvoiceDocument)
- Modify: `src/lib/document-store.ts` (`mapDocRow` ~11-38, `createDocument` ~112-140)
- Test: `tests/document-currency.test.ts`

- [ ] **Step 1: Extend the type**

Add to `InvoiceDocument` (after `paymentReference?`):

```ts
  /** ISO 4217 currency the document is denominated in. Default "ILS". */
  currency?: string;
  /** ₪ per 1 unit of `currency`, snapshotted at issue. ILS → 1. */
  exchangeRate?: number;
  /** ₪ equivalents snapshotted at issue (= foreign × rate). For ILS docs = the foreign value. */
  subtotalIls?: number;
  vatIls?: number;
  totalIls?: number;
  /** Zero-rated export transaction (0% VAT, distinct from עוסק פטור). */
  zeroRated?: boolean;
```

- [ ] **Step 2: Map the new columns in `mapDocRow`**

Add inside the returned object in `src/lib/document-store.ts` `mapDocRow`:

```ts
    currency: (row.currency as string) || "ILS",
    exchangeRate: row.exchange_rate != null ? Number(row.exchange_rate) : 1,
    subtotalIls: row.subtotal_ils != null ? Number(row.subtotal_ils) : Number(row.subtotal) || 0,
    vatIls: row.vat_ils != null ? Number(row.vat_ils) : Number(row.vat) || 0,
    totalIls: row.total_ils != null ? Number(row.total_ils) : Number(row.total) || 0,
    zeroRated: Boolean(row.zero_rated),
```

- [ ] **Step 3: Pass new params in `createDocument`**

In the `supabase.rpc("create_document_atomic", {...})` call, after `p_notes`:

```ts
    p_currency: doc.currency || "ILS",
    p_exchange_rate: doc.exchangeRate ?? 1,
    p_subtotal_ils: doc.subtotalIls ?? doc.subtotal,
    p_vat_ils: doc.vatIls ?? doc.vat,
    p_total_ils: doc.totalIls ?? doc.total,
    p_zero_rated: doc.zeroRated ?? false,
```

- [ ] **Step 4: Write a test for the round-trip mapping**

```ts
// tests/document-currency.test.ts
import { describe, it, expect } from "vitest";
import { ilsEquivalents } from "@/lib/exchange-rate";

// The editor computes *_ils via ilsEquivalents before createDocument; this
// guards that a USD doc snapshots correct ₪ figures.
describe("document ₪ snapshot at create", () => {
  it("USD export doc: rate 3.7, $1000 zero-rated -> ₪3700 total, 0 vat", () => {
    const ils = ilsEquivalents({ subtotal: 1000, vat: 0, total: 1000 }, 3.7);
    expect(ils).toEqual({ subtotalIls: 3700, vatIls: 0, totalIls: 3700 });
  });
  it("ILS doc: rate 1 -> identical (no behavior change)", () => {
    expect(ilsEquivalents({ subtotal: 100, vat: 18, total: 118 }, 1))
      .toEqual({ subtotalIls: 100, vatIls: 18, totalIls: 118 });
  });
});
```

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run` → all pass.
Run: `npx next build` → 0. (Types compile; mapDocRow returns new optional fields.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/document-store.ts tests/document-currency.test.ts
git commit -m "feat(currency): InvoiceDocument fields + store mapping/create params"
```

---

## Task 6: requiresAllocationNumber uses the ₪ total

**Files:**
- Modify: `src/lib/tax-authority.ts` (`requiresAllocationNumber` ~84-92)
- Test: `tests/tax-authority.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/tax-authority.test.ts
import { requiresAllocationNumber as reqAlloc } from "@/lib/tax-authority";
describe("requiresAllocationNumber — ₪ equivalent governs the threshold", () => {
  it("a $2000 export doc whose ₪ value (₪7400) is over the June-2026 ₪5,000 threshold requires a number", () => {
    const doc = { type: "tax_invoice", date: "2026-06-10", total: 2000, totalIls: 7400 } as never;
    expect(reqAlloc(doc)).toBe(true);
  });
  it("a $2000 doc worth only ₪4000 in ₪ is below threshold", () => {
    const doc = { type: "tax_invoice", date: "2026-06-10", total: 2000, totalIls: 4000 } as never;
    expect(reqAlloc(doc)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tax-authority.test.ts`
Expected: FAIL — current code compares `doc.total` (2000) not `doc.totalIls`.

- [ ] **Step 3: Implement** — in `requiresAllocationNumber`, replace the amount used:

```ts
  const docDate = doc.date ? new Date(doc.date) : new Date();
  // The Tax Authority threshold is in ₪ — use the ₪ equivalent of a
  // foreign-currency document (falls back to total for legacy ILS docs).
  const amountIls = Math.abs((doc.totalIls ?? doc.total) as number);
  return amountIls >= allocationRequiredThreshold(docDate);
```

(Remove the old `Math.abs(doc.total)` line.)

- [ ] **Step 4: Run tests** → `npx vitest run tests/tax-authority.test.ts` PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax-authority.ts tests/tax-authority.test.ts
git commit -m "fix(currency): allocation threshold compares the ₪ equivalent"
```

---

## Task 7: request-allocation sends the ₪ amounts

**Files:**
- Modify: `src/app/api/tax-authority/request-allocation/route.ts`

- [ ] **Step 1: Update the doc select** — add the ₪ columns to the `.select(...)`:

```ts
      "id, business_id, type, number, date, total, subtotal, vat, client_name, allocation_number, total_ils, subtotal_ils, vat_ils, exchange_rate",
```

- [ ] **Step 2: Build the allocation request from the ₪ figures**

Replace the amount fields in the `allocRequest` object so they use the ₪
equivalents (the API is ₪-based). Derive them with a local fallback for
legacy ILS docs:

```ts
  const subtotalIls = Number(doc.subtotal_ils ?? doc.subtotal) || 0;
  const vatIls = Number(doc.vat_ils ?? doc.vat) || 0;
  const totalIls = Number(doc.total_ils ?? doc.total) || 0;
  // ...
  amountBeforeDiscount: subtotalIls,
  discount: 0,
  paymentAmount: subtotalIls,
  vatAmount: vatIls,
  paymentAmountIncludingVat: totalIls,
```

For item rows, multiply each line by `exchange_rate` for its ₪ value:

```ts
  const rate = Number(doc.exchange_rate) || 1;
  // inside items.map:
      totalAmount: round2((Number(it.total) || 0) * rate),
      vatRate,
      vatAmount: round2(((Number(it.total) || 0) * rate * vatRate) / 100),
```

(Keep `vatRate` from `deriveVatRate` computed on the ₪ subtotal/vat:
`deriveVatRate(vatIls, subtotalIls)`.)

- [ ] **Step 3: Build** → `npx next build` exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/tax-authority/request-allocation/route.ts
git commit -m "fix(currency): allocation request uses ₪ equivalents"
```

---

## Task 8: Editor — currency picker, zero-rated, rate, ₪ preview

**Files:**
- Modify: `src/components/receipt-editor.tsx`

Context: `vatRate` is currently `getVatRate(business)` (receipt-editor ~82).
`computeAmounts(items, vatRate, vatMode)` produces subtotal/vat/total (~251).
Persist builds `draft` (~431) and calls `createDocument`.

- [ ] **Step 1: State** — add near the other `useState`s:

```tsx
  const [currency, setCurrency] = useState("ILS");
  const [zeroRated, setZeroRated] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateLoading, setRateLoading] = useState(false);
```

- [ ] **Step 2: Effective VAT rate** — replace the `vatRate` used for compute:

```tsx
  const baseVatRate = getVatRate(business);
  const effectiveVatRate = zeroRated ? 0 : baseVatRate;
```
Use `effectiveVatRate` in the `computeAmounts(items, effectiveVatRate, vatMode)` memo and anywhere `vatRate` drove display.

- [ ] **Step 3: Fetch the rate when currency/date change**

```tsx
  useEffect(() => {
    if (currency === "ILS") { setRate(1); return; }
    let cancelled = false;
    setRateLoading(true);
    fetch(`/api/exchange-rate?currency=${currency}&date=${date}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.ok && d.rate) setRate(d.rate); })
      .finally(() => { if (!cancelled) setRateLoading(false); });
    return () => { cancelled = true; };
  }, [currency, date]);
```

- [ ] **Step 4: UI** — add near the document-type/VAT controls (RTL block):

```tsx
  <label className="block text-sm">
    מטבע
    <select value={currency} onChange={(e) => setCurrency(e.target.value)}
      className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2">
      {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
    </select>
  </label>
  {canIssueTaxInvoices(business) && (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={zeroRated} onChange={(e) => setZeroRated(e.target.checked)} />
      עסקה בשיעור אפס (ייצוא)
    </label>
  )}
  {currency !== "ILS" && (
    <label className="block text-sm">
      שער {currency}→₪ {rateLoading && "…"}
      <input type="number" step="0.0001" value={rate}
        onChange={(e) => setRate(Number(e.target.value) || 0)}
        className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 font-mono" />
      <span className="text-xs text-stone-500">≈ {formatMoney(round2(total * rate), "ILS")}</span>
    </label>
  )}
```
Imports: `import { CURRENCIES, formatMoney } from "@/lib/currencies"; import { ilsEquivalents } from "@/lib/exchange-rate"; import { round2, canIssueTaxInvoices } from "@/lib/vat";` (canIssueTaxInvoices/round2 may already be imported).

- [ ] **Step 5: Persist** — in the `draft` object add the currency fields:

```tsx
        currency,
        exchangeRate: currency === "ILS" ? 1 : rate,
        zeroRated,
        ...ilsEquivalents({ subtotal, vat, total }, currency === "ILS" ? 1 : rate),
```
(`ilsEquivalents` returns `{subtotalIls, vatIls, totalIls}` — matches the type.)

- [ ] **Step 6: Build + manual smoke**

Run: `npx next build` → 0.
Manual: create a USD doc, confirm the rate prefills and the ₪ preview shows; save; reload; the doc persists currency/rate/`*_ils`.

- [ ] **Step 7: Commit**

```bash
git add src/components/receipt-editor.tsx
git commit -m "feat(currency): editor currency/zero-rated/rate + ₪ snapshot on save"
```

---

## Task 9: Document display — symbol, ₪-equivalent line, export note

**Files:**
- Modify: `src/components/document-body.tsx`
- Modify: `src/components/receipt-view.tsx` (if it renders its own totals)

- [ ] **Step 1: Thread currency into the display** — `document-body.tsx` receives the document; read `doc.currency` (default "ILS") and use `formatMoney(amount, currency)` wherever amounts render (line items, subtotal, total). Import `{ formatMoney, currencySymbol } from "@/lib/currencies"`.

- [ ] **Step 2: VAT line** — when `doc.zeroRated`, render the note instead of a VAT row:

```tsx
  {doc.zeroRated ? (
    <div className="text-sm text-stone-600">עסקה בשיעור אפס — ייצוא שירותים</div>
  ) : vatRate > 0 ? (
    <Row label={`מע״מ (${vatRate}%)`} value={formatMoney(vat, currency)} />
  ) : null}
```

- [ ] **Step 3: ₪-equivalent line (non-ILS only)** — after the total:

```tsx
  {currency !== "ILS" && (
    <div className="mt-1 text-xs text-stone-500">
      סה״כ ב-₪ (שער {Number(doc.exchangeRate).toFixed(4)}): {formatMoney(doc.totalIls ?? 0, "ILS")}
    </div>
  )}
```

- [ ] **Step 4: Build + manual** — `npx next build` 0; open a USD doc and an ILS doc; confirm symbols, the ₪ line on the USD doc, and that the ILS doc is visually unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/document-body.tsx src/components/receipt-view.tsx
git commit -m "feat(currency): document display — symbol, ₪-equivalent line, export note"
```

---

## Task 10: Reports + public route read the ₪ columns

**Files:**
- Modify: report aggregations that sum `total`/`subtotal`/`vat` for ₪ analytics:
  `src/app/(app)/reports/tax-projection/page.tsx`, `src/components/aging-report.tsx`,
  `src/app/(app)/reports/*` (VAT-period, client-statement, monthly), `src/app/(app)/dashboard`,
  `src/components/exempt-ceiling-tracker.tsx`.
- Modify: `src/app/api/public-document/[id]/route.ts` (keep the new display columns).

- [ ] **Step 1: Swap the field in each ₪ aggregation** — replace `doc.total` →
  `(doc.totalIls ?? doc.total)`, `doc.subtotal` → `(doc.subtotalIls ?? doc.subtotal)`,
  `doc.vat` → `(doc.vatIls ?? doc.vat)` in the report sums (NOT in the document
  display, which stays in the doc's own currency). Grep to find them:

Run: `grep -rnE "\.total\b|\.subtotal\b|\.vat\b" src/app/\(app\)/reports src/components/aging-report.tsx src/components/exempt-ceiling-tracker.tsx`
For each that feeds a ₪ analytic, apply the `?? ` fallback swap. (Legacy ILS docs are unaffected — `*_ils` equals the original.)

- [ ] **Step 2: public-document** — the route currently strips internal columns
  (Task from a prior session). Ensure it does NOT strip `currency`,
  `exchange_rate`, `subtotal_ils`, `vat_ils`, `total_ils`, `zero_rated` (the
  public view needs them to render). They are not in the strip list — confirm
  and leave as-is.

- [ ] **Step 3: Build + full tests** — `npx next build` 0; `npx vitest run` all green.

- [ ] **Step 4: Manual report check** — with one USD doc present, open
  tax-projection / aging / VAT-period; confirm the ₪ figures include the USD
  doc's ₪ equivalent (not its raw foreign number).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(currency): reports + allocation read the ₪ equivalents"
```

---

## Task 11: End-to-end verification + deploy

- [ ] **Step 1: Full build + tests** — `npx next build` exits 0; `npx vitest run` all pass.
- [ ] **Step 2: Push** — `git push origin main && git push origin main:master`.
- [ ] **Step 3: Verify deploy** — `node scripts/check-deploy.mjs` shows READY at the new SHA; `node scripts/health-check.mjs --no-push` is 🟢.
- [ ] **Step 4: Live smoke** — create a USD export invoice in production; confirm it saves, displays the ₪-equivalent line, and the tax-projection ₪ total reflects it.

---

## Self-review notes

- **Spec coverage:** schema+RPC (Task 4), rate service auto+fallback+cache (Task 3), currencies list (Task 1), zero-rated VAT (Tasks 6–9), editor (Task 7), display+₪ line (Task 9), reports/allocation/threshold → `*_ils` (Tasks 6,7,10), backward compat (defaults + `?? ` fallbacks throughout), tests (Tasks 1–6,10). All covered.
- **Backward compatibility:** every read uses `?? legacy` and every new column has a default; ILS docs at rate 1 reproduce current numbers exactly (proven by the rate-1 tests in Tasks 2 and 5).
- **Open technical confirm:** the exact BoI endpoint/JSON shape (Task 3 Step 6) — isolated behind `fetcher`, tests mock it, so it can't block the rest.
