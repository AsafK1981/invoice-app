/**
 * The operator's budget: what the app costs to run, what it earns.
 *
 * Design: docs/superpowers/specs/2026-09-17-admin-budget-design.md
 *
 * Everything here is pure. The API route (/api/admin/budget) and the page
 * (/admin/budget) share these types, the validator and `summarizeBudget`, so
 * the client cannot compute a total the server would disagree with, and the
 * server cannot accept a shape the client cannot render.
 *
 * Two rules the maths obeys everywhere:
 *
 *  1. A NULL amount is a hole, not a zero. It is excluded from every sum and
 *     counted separately ("N חסרי סכום"), because a budget that quietly treats
 *     an unknown price as zero reads as if it is complete when it is not.
 *  2. Rounding is half-up (0.5 goes away from zero), never ceil. Ceil would
 *     inflate a run-rate by up to a shekel per row, and a budget that rounds
 *     its own numbers up is not a budget.
 */

import { todayInIsrael, toIsraelDate } from "./date";

export type BudgetKind = "expense" | "income";
export type BudgetCurrency = "ILS" | "USD";
export type BudgetRecurrence = "once" | "monthly" | "yearly";

export const BUDGET_KINDS: readonly BudgetKind[] = ["expense", "income"];
export const BUDGET_CURRENCIES: readonly BudgetCurrency[] = ["ILS", "USD"];
export const BUDGET_RECURRENCES: readonly BudgetRecurrence[] = ["once", "monthly", "yearly"];

/** One row of `admin_budget_entries`, in the DB's own snake_case. */
export interface BudgetEntry {
  id: string;
  kind: BudgetKind;
  title: string;
  party: string;
  amount: number | null;
  currency: BudgetCurrency;
  is_free: boolean;
  recurrence: BudgetRecurrence;
  is_fixed: boolean;
  entry_date: string | null;
  payment_method: string | null;
  link: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * One real payment in, as the budget page is allowed to see it.
 *
 * Two sources feed it: `subscription_charge_log` (the Grow rail, ILS) and paid
 * Polar orders (the live rail). Deliberately five fields. The charge log also
 * holds user_id, period_start, transaction_id and the self-invoice document id,
 * and a Polar order carries the customer's name, address and tax id; none of
 * those are the operator's business on a budget screen. The signup email is the
 * same metadata /admin already shows, so this stays inside the operator-privacy
 * rule (metadata yes, content no).
 */
export interface AutomaticIncome {
  amount: number;
  currency: BudgetCurrency;
  charged_at: string;
  provider: string;
  payer_email: string | null;
}

/**
 * How well the Polar side of the automatic income could be read.
 *
 *   ok           every order in the window was read
 *   partial      the paging cap stopped the walk before the window ended, so
 *                older payments are missing from the list and the sums
 *   unavailable  Polar could not be reached at all (no token, network, API)
 *
 * "partial" exists because a cap that reports success is a lie with a number
 * attached: the page has to be able to say the figures are incomplete.
 */
export type PolarStatus = "ok" | "partial" | "unavailable";

/**
 * How many automatic rows the page lists. The summary still sums EVERY row of
 * the current month; this only caps what is painted (and, in the route, how
 * many signup emails are looked up).
 */
export const AUTOMATIC_DISPLAY_LIMIT = 40;

/**
 * Fallback USD -> ILS rate, used only when the Bank of Israel representative
 * rate cannot be fetched (src/lib/exchange-rate.ts). A visible estimate, never
 * presented as the real rate.
 */
export const DEFAULT_USD_RATE = 3.7;

/** localStorage key for the operator's manual override of the rate. */
export const USD_RATE_STORAGE_KEY = "admin-budget-usd-rate";

/**
 * Half-up to agorot/cents, away from zero: 1.005 -> 1.01, -1.005 -> -1.01,
 * 3.7046 -> 3.70. Mirrors roundToShekel in src/lib/format.ts, one decimal
 * place deeper.
 *
 * ONE rounding step, on purpose. The first version of this function snapped to
 * three decimals and then rounded to two, which double-rounded: 3.7046 lifted
 * to 3.705 and then to 3.71, a cent that was never there. A rate times an
 * amount hits that case constantly.
 *
 * The scaling goes through the number's own decimal string (`${abs}e2`) rather
 * than `abs * 100`, because the multiplication is where binary noise appears:
 * `1.005 * 100` is 100.49999999999999 and would round DOWN, while "1.005e2"
 * parses to exactly 100.5 and rounds up as a person expects. Values big or
 * small enough to print in exponent form (>= 1e21, < 1e-6) would produce
 * "1e+21e2", so those fall back to the plain multiplication; no budget amount
 * lives there (the validator caps input at 1e9).
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.abs(value);
  const viaString = Number(`${abs}e2`);
  const scaled = Number.isFinite(viaString) ? viaString : abs * 100;
  const cents = Math.floor(scaled + 0.5);
  return value < 0 ? -cents / 100 : cents / 100;
}

// Money is rendered with formatMoney(amount, currency) from src/lib/currencies.ts,
// the same helper every other screen uses. There is no budget-only formatter:
// a second one would drift from the app's shekel/symbol conventions.

export interface PerCurrency {
  ILS: number;
  USD: number;
}

export interface BudgetSummary {
  /** sum(active monthly) + sum(active yearly)/12, per currency. */
  monthlyRunRate: PerCurrency;
  /** Run-rate with the USD part converted at the operator's estimated rate. */
  monthlyRunRateIls: number;
  /** Automatic charges + manual income counted for the current month. */
  incomeThisMonth: PerCurrency;
  incomeThisMonthIls: number;
  /** Of `incomeThisMonthIls`, the part that came from real payments in. */
  automaticIncomeIls: number;
  /** incomeThisMonthIls - monthlyRunRateIls. Negative means the app loses money. */
  netIls: number;
  /**
   * Active rows with no amount and no free-tier flag, of EITHER kind: an
   * income row waiting for its number is as much a hole in the budget as an
   * unpriced vendor, and the page prompts for both.
   */
  missingAmountCount: number;
  /** Nearest future renewal among active recurring expenses, or null. */
  nextCharge: { entry: BudgetEntry; date: string } | null;
  /** Active expense rows counted into the run-rate (free tiers included). */
  activeExpenseCount: number;
}

export interface SummaryOptions {
  /** "YYYY-MM-DD"; defaults to today in Israel. */
  today?: string;
  /** USD -> ILS estimate; defaults to DEFAULT_USD_RATE. */
  usdRate?: number;
}

/** Amount that counts into a sum: NULL is a hole, a free tier is a real zero. */
function countableAmount(entry: BudgetEntry): number | null {
  if (entry.is_free) return 0;
  if (entry.amount === null || entry.amount === undefined) return null;
  if (!Number.isFinite(entry.amount)) return null;
  return entry.amount;
}

function isSameMonth(date: string | null, today: string): boolean {
  return !!date && date.slice(0, 7) === today.slice(0, 7);
}

/**
 * The Israel calendar day of an instant, "YYYY-MM-DD", or "" if unparseable.
 *
 * Every timestamp that reaches this module (`charged_at` on both rails) is an
 * instant stored in UTC; the operator lives in Asia/Jerusalem and the month
 * boundary that matters is theirs.
 */
export function israelDayOf(iso: string | null | undefined): string {
  if (typeof iso !== "string" || !iso) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : toIsraelDate(at);
}

/**
 * The whole budget in one pass.
 *
 * Income for "this month" is the automatic charges of the current month plus
 * manual income rows that are either dated in the current month or set to
 * recur monthly. The spec's wording is "manual entries dated this month"; a
 * monthly retainer entered once would then vanish from every later month, so
 * an active `recurrence = 'monthly'` income row counts every month, the same
 * way a monthly expense does on the cost side. A yearly income row still only
 * counts in the month it is dated.
 */
export function summarizeBudget(
  entries: BudgetEntry[],
  automatic: AutomaticIncome[],
  options: SummaryOptions = {},
): BudgetSummary {
  const today = options.today ?? todayInIsrael();
  const usdRate = Number.isFinite(options.usdRate) && (options.usdRate as number) > 0
    ? (options.usdRate as number)
    : DEFAULT_USD_RATE;

  const monthlyRunRate: PerCurrency = { ILS: 0, USD: 0 };
  const incomeThisMonth: PerCurrency = { ILS: 0, USD: 0 };
  let missingAmountCount = 0;
  let activeExpenseCount = 0;
  let nextCharge: { entry: BudgetEntry; date: string } | null = null;

  for (const entry of entries) {
    if (!entry.active) continue;

    if (entry.kind === "expense") {
      activeExpenseCount += 1;
      const amount = countableAmount(entry);
      if (amount === null) missingAmountCount += 1;
      if (amount !== null) {
        if (entry.recurrence === "monthly") monthlyRunRate[entry.currency] += amount;
        else if (entry.recurrence === "yearly") monthlyRunRate[entry.currency] += amount / 12;
        // 'once' never enters a run-rate: it is not a rate.
      }
      if (entry.recurrence !== "once" && entry.entry_date && entry.entry_date >= today) {
        if (!nextCharge || entry.entry_date < nextCharge.date) {
          nextCharge = { entry, date: entry.entry_date };
        }
      }
      continue;
    }

    const amount = countableAmount(entry);
    if (amount === null) {
      missingAmountCount += 1;
      continue;
    }
    const countsThisMonth =
      entry.recurrence === "monthly" || isSameMonth(entry.entry_date, today);
    if (countsThisMonth) incomeThisMonth[entry.currency] += amount;
  }

  // Real payments in. Grow charges are ILS, Polar orders are usually USD, so
  // they are kept apart and converted with the same rate the expenses use.
  //
  // `charged_at` is an INSTANT, so its month is the month in Israel, not in
  // UTC. Slicing the ISO string filed a payment taken at 00:30 on 1 October
  // Israel time (21:30 on 30 September UTC) under September, and emptied the
  // first hours of every month from the card the operator reads first.
  const automaticByCurrency: PerCurrency = { ILS: 0, USD: 0 };
  for (const row of automatic) {
    const when = israelDayOf(row.charged_at);
    if (!isSameMonth(when, today)) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    automaticByCurrency[row.currency === "USD" ? "USD" : "ILS"] += amount;
  }
  incomeThisMonth.ILS += automaticByCurrency.ILS;
  incomeThisMonth.USD += automaticByCurrency.USD;
  const automaticIls = automaticByCurrency.ILS + automaticByCurrency.USD * usdRate;

  const runRate: PerCurrency = {
    ILS: roundMoney(monthlyRunRate.ILS),
    USD: roundMoney(monthlyRunRate.USD),
  };
  const income: PerCurrency = {
    ILS: roundMoney(incomeThisMonth.ILS),
    USD: roundMoney(incomeThisMonth.USD),
  };
  const runRateIls = roundMoney(monthlyRunRate.ILS + monthlyRunRate.USD * usdRate);
  const incomeIls = roundMoney(incomeThisMonth.ILS + incomeThisMonth.USD * usdRate);

  return {
    monthlyRunRate: runRate,
    monthlyRunRateIls: runRateIls,
    incomeThisMonth: income,
    incomeThisMonthIls: incomeIls,
    automaticIncomeIls: roundMoney(automaticIls),
    netIls: roundMoney(incomeIls - runRateIls),
    missingAmountCount,
    nextCharge,
    activeExpenseCount,
  };
}

// ── Polar orders -> automatic income ─────────────────────────────────────────

/**
 * The fields this app reads off a Polar order, verified against the installed
 * @polar-sh/sdk 0.47.1 `Order` type (dist/commonjs/models/components/order.d.ts).
 *
 * Structural, not the SDK type itself, so the mapping can be unit tested
 * without constructing a full SDK object, and so an SDK bump that adds fields
 * cannot break this file.
 */
export interface PolarOrderLike {
  status?: string | null;
  /** "Whether the order has been paid for." */
  paid?: boolean | null;
  /** "Amount in cents, after discounts and taxes." */
  totalAmount?: number | null;
  /** "Amount refunded in cents." */
  refundedAmount?: number | null;
  /** "Sales tax refunded in cents." */
  refundedTaxAmount?: number | null;
  /** Lowercase ISO code, e.g. "usd". */
  currency?: string | null;
  createdAt?: Date | string | null;
  customer?: { email?: string | null } | null;
}

/**
 * Paid Polar orders as budget income rows.
 *
 * Rules, each one a thing that would otherwise overstate the income:
 *  - Only orders the SDK marks `paid`. `pending` and `void` are not money in.
 *  - Amounts are CENTS in the SDK (every amount field on Order says so) and are
 *    divided by 100 exactly once, here.
 *  - Refunds net down: `totalAmount` is after tax, and the refund is reported
 *    split into `refundedAmount` (net) + `refundedTaxAmount`, mirroring the
 *    netAmount/taxAmount split of the charge, so both come off the total. A
 *    fully refunded order nets to zero and is dropped rather than shown as a
 *    zero-shekel payment.
 *  - Only ILS and USD are mapped, the two currencies this budget knows. Polar
 *    bills this app's customers in one currency; a third one appearing is a
 *    thing to notice, not to silently convert at a made-up rate.
 *
 * KNOWN LIMITATION, stated on the page too: a refund is netted against the
 * ORDER's date, not the date the refund was issued. A refund granted in
 * November for an October order lowers October, not November. Fixing that
 * properly means reading the refunds feed and treating each refund as its own
 * dated movement; until someone needs it, the budget says out loud that
 * refunds are netted on the original charge's month rather than pretending
 * otherwise ("החזרים מקוזזים מהחודש של החיוב המקורי").
 */
export function mapPolarOrders(orders: PolarOrderLike[]): AutomaticIncome[] {
  const rows: AutomaticIncome[] = [];
  for (const order of orders ?? []) {
    if (order?.paid !== true) continue;
    const status = typeof order.status === "string" ? order.status : "";
    if (status === "pending" || status === "void") continue;

    const code = String(order.currency ?? "").toUpperCase();
    if (code !== "ILS" && code !== "USD") continue;

    const cents =
      Number(order.totalAmount ?? 0) -
      Number(order.refundedAmount ?? 0) -
      Number(order.refundedTaxAmount ?? 0);
    if (!Number.isFinite(cents) || cents <= 0) continue;

    const when = order.createdAt instanceof Date
      ? order.createdAt.toISOString()
      : typeof order.createdAt === "string"
        ? order.createdAt
        : "";
    if (!when) continue;

    rows.push({
      amount: roundMoney(cents / 100),
      currency: code as BudgetCurrency,
      charged_at: when,
      provider: "polar",
      payer_email: order.customer?.email ?? null,
    });
  }
  return rows;
}

// ── Input validation, shared by POST and PATCH ───────────────────────────────

/** The writable fields, in the DB's snake_case so a valid result is insertable. */
export interface BudgetInput {
  kind: BudgetKind;
  title: string;
  party: string;
  amount: number | null;
  currency: BudgetCurrency;
  is_free: boolean;
  recurrence: BudgetRecurrence;
  is_fixed: boolean;
  entry_date: string | null;
  payment_method: string | null;
  link: string | null;
  notes: string | null;
  active: boolean;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;

function cleanText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * A link the UI will render as target="_blank", NORMALIZED, or null.
 *
 * https only and parseable: an "http://" or "javascript:" string must never
 * reach an anchor tag. It also returns `url.toString()` rather than what was
 * typed, because the column's CHECK is a literal `link ~ '^https://'` and
 * `new URL()` happily accepts forms that do not match it verbatim -
 * "HTTPS://x.com" and "https:x.com" both parse as https and both fail that
 * regex. Storing the raw string turned a typo into a bare 500 from Postgres;
 * the normalized form ("https://x.com/") satisfies parser and CHECK alike.
 * The lowercase test at the end is the belt to that suspenders: whatever comes
 * out of here is exactly what the database will accept.
 */
export function normalizeBudgetLink(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const normalized = url.toString();
  return normalized.startsWith("https://") ? normalized : null;
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Validate a create (`partial = false`) or an edit (`partial = true`) payload.
 *
 * Returns only known keys, so a caller cannot smuggle `id`, `created_at` or a
 * column that does not exist into an insert/update.
 */
export function validateBudgetInput(
  body: unknown,
  partial = false,
): ValidationResult<Partial<BudgetInput>> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "גוף הבקשה חייב להיות אובייקט" };
  }
  const input = body as Record<string, unknown>;
  const out: Partial<BudgetInput> = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);

  if (has("kind") || !partial) {
    const kind = input.kind;
    if (typeof kind !== "string" || !BUDGET_KINDS.includes(kind as BudgetKind)) {
      return { ok: false, error: "סוג רשומה לא חוקי" };
    }
    out.kind = kind as BudgetKind;
  }

  if (has("title") || !partial) {
    const title = cleanText(input.title, 200);
    if (!title) return { ok: false, error: "חסר תיאור" };
    out.title = title;
  }

  if (has("party") || !partial) {
    const party = cleanText(input.party, 120);
    if (!party) return { ok: false, error: "חסר שם ספק או משלם" };
    out.party = party;
  }

  if (has("amount")) {
    const raw = input.amount;
    if (raw === null || raw === "" || raw === undefined) {
      out.amount = null;
    } else {
      const amount = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        return { ok: false, error: "סכום חייב להיות מספר חיובי או ריק" };
      }
      if (amount > 1_000_000_000) {
        return { ok: false, error: "הסכום גדול מדי" };
      }
      out.amount = roundMoney(amount);
    }
  } else if (!partial) {
    out.amount = null;
  }

  if (has("currency") || !partial) {
    const currency = has("currency") ? input.currency : "ILS";
    if (typeof currency !== "string" || !BUDGET_CURRENCIES.includes(currency as BudgetCurrency)) {
      return { ok: false, error: "מטבע לא חוקי" };
    }
    out.currency = currency as BudgetCurrency;
  }

  if (has("recurrence") || !partial) {
    const recurrence = has("recurrence") ? input.recurrence : "monthly";
    if (
      typeof recurrence !== "string" ||
      !BUDGET_RECURRENCES.includes(recurrence as BudgetRecurrence)
    ) {
      return { ok: false, error: "תדירות לא חוקית" };
    }
    out.recurrence = recurrence as BudgetRecurrence;
  }

  for (const flag of ["is_free", "is_fixed", "active"] as const) {
    if (has(flag)) {
      if (typeof input[flag] !== "boolean") {
        return { ok: false, error: "ערך לוגי לא חוקי" };
      }
      out[flag] = input[flag] as boolean;
    }
  }

  if (has("entry_date")) {
    const raw = input.entry_date;
    if (raw === null || raw === "") {
      out.entry_date = null;
    } else if (typeof raw === "string" && isRealDate(raw)) {
      out.entry_date = raw;
    } else {
      return { ok: false, error: "תאריך לא חוקי" };
    }
  }

  if (has("link")) {
    const raw = input.link;
    if (raw === null || raw === "") {
      out.link = null;
    } else {
      const cleaned = cleanText(raw, 500);
      const link = cleaned ? normalizeBudgetLink(cleaned) : null;
      if (!link) {
        return { ok: false, error: "קישור חייב להתחיל ב-https://" };
      }
      out.link = link;
    }
  }

  for (const field of ["payment_method", "notes"] as const) {
    if (has(field)) {
      const raw = input[field];
      out[field] = raw === null || raw === "" ? null : cleanText(raw);
    }
  }

  if (partial && Object.keys(out).length === 0) {
    return { ok: false, error: "אין מה לעדכן" };
  }
  return { ok: true, value: out };
}
