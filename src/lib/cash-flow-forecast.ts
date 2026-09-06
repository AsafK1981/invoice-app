/**
 * "כמה כסף ייכנס ויצא בשלושת החודשים הקרובים" - computed, never guessed.
 *
 * There is no due-date field and no payment-terms field anywhere in the app,
 * so the timing of an open invoice cannot be read off the document. What the
 * app does have is `paidAt`, and that is enough: how long a given client took
 * to pay, in the past, is the best available predictor of how long they will
 * take next time. The median of that client's own history dates the money;
 * with no history the forecast falls back to 30 days and says so out loud in
 * `assumptions`.
 *
 * Everything else in here is already-known money, not a prediction: detected
 * recurring cadences (recurring-patterns.ts), the trailing expense average,
 * the מקדמה that is due on the 15th and the VAT period that closes inside the
 * window. No LLM is involved, and no rule is restated - every money rule is
 * imported from the module that owns it, so this report cannot disagree with
 * the screens by a shekel.
 *
 * Pure: no fetching, no clock, no React. `today` comes in as an Israel-local
 * YYYY-MM-DD and all date maths is plain string arithmetic.
 */

import { normalizeName, resolveDocumentClientId } from "./client-picker";
import { addDays, daysInclusive, monthLabel } from "./report-period";
import { clampDayToMonth } from "./reminder-schedule";
import {
  alreadyBilledForPeriod,
  detectRecurringPatterns,
  periodMinusMonths,
  type RecurringSourceDoc,
} from "./recurring-patterns";
import { advanceDueDate, computeAdvance, roundShekelHalfUp } from "./ita/income-tax-advances";
import { biMonthlyRange, singleMonthRange } from "./ita/vat-periods";
import { round2, VAT_RATES } from "./vat";
import {
  DOCUMENT_TYPE_LABELS,
  isCountableRevenue,
  type Business,
  type Client,
  type DocumentType,
  type Expense,
  type InvoiceDocument,
} from "./types";

/** Days a client is assumed to take when they have never paid anything yet. */
export const DEFAULT_DAYS_TO_PAY = 30;
/**
 * A gap this long between issue and payment is a data artefact (a document
 * back-dated on import), not a payment habit, and one of them would drag the
 * median off the end of the window.
 */
const MAX_DAYS_TO_PAY = 365;
/** Months of history behind the "running costs" figure. */
const EXPENSE_AVERAGE_MONTHS = 3;
/** Running costs are posted mid-month; nothing here knows the real dates. */
const EXPENSE_DAY_OF_MONTH = 15;
/** Bi-monthly VAT periods checked around today when looking for due dates. */
const VAT_PERIOD_OFFSETS = [-2, -1, 0, 1, 2];

/** Documents that are money on the way in but not yet collected. */
const OPEN_TYPES: DocumentType[] = ["tax_invoice", "proforma"];

export type ForecastKind =
  | "open_invoice"
  | "recurring_income"
  | "expenses_avg"
  | "income_tax_advance"
  | "vat";

export type ForecastConfidence = "certain" | "likely" | "estimate";

const INFLOW_KINDS: ForecastKind[] = ["open_invoice", "recurring_income"];

export interface ForecastLine {
  /** Expected cash date, YYYY-MM-DD. */
  date: string;
  /** Positive = money in, negative = money out. Credit notes arrive already negative. */
  amount: number;
  kind: ForecastKind;
  confidence: ForecastConfidence;
  label: string;
  href?: string;
  clientName?: string;
  documentId?: string;
}

export interface ForecastMonth {
  /** YYYY-MM. */
  period: string;
  /** "ספטמבר 2026". */
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  lines: ForecastLine[];
}

export interface ForecastResult {
  months: ForecastMonth[];
  /** Open quotes: possible money, deliberately outside every total. */
  potentialQuotes: { count: number; total: number };
  totals: { inflow: number; outflow: number; net: number };
  /** Hebrew sentences naming everything the numbers above assumed. */
  assumptions: string[];
}

export type ForecastBusiness = Pick<Business, "businessType"> &
  Partial<Pick<Business, "incomeTaxAdvanceRate">>;

export type ForecastClient = Pick<Client, "id" | "name" | "taxId">;

export interface ForecastInputs {
  documents: InvoiceDocument[];
  expenses: Expense[];
  business: ForecastBusiness;
  /** Israel-local today, YYYY-MM-DD. */
  today: string;
  /** Months in the window, today's month included. Default 3. */
  months?: number;
  /**
   * The saved clients, for the same client-identity rule the rest of the app
   * uses (an unlinked document belongs to the one saved client it names).
   * Omitted, identity falls back to client_id / normalised name.
   */
  clients?: ForecastClient[];
}

/* ------------------------------------------------------------------ */
/* date + number helpers                                               */
/* ------------------------------------------------------------------ */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM", `months` months after `period` (negative moves back). */
function periodPlus(period: string, months: number): string {
  return periodMinusMonths(period, -months);
}

/** The YYYY-MM a date belongs to. */
function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

/** `day` of `period`, clamped into that month (the 31st of February is the 28th). */
function dayInPeriod(period: string, day: number): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return `${period}-${pad2(clampDayToMonth(year, month, day))}`;
}

/** The inclusive calendar bounds of a YYYY-MM. */
function monthRange(period: string): { start: string; end: string; label: string } {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return singleMonthRange(new Date(year, month - 1, 1), 0);
}

/** Whole days from `a` to `b`, both YYYY-MM-DD. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return 0;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * The lower median - `medianDay` in recurring-patterns picks the same element,
 * and for the same reason: an averaged half-day is not a payment habit, and
 * two runs of the report must never disagree by rounding.
 */
function lowerMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/* ------------------------------------------------------------------ */
/* client identity + days to pay                                       */
/* ------------------------------------------------------------------ */

const UNLINKED_PREFIX = "__no_client__:";

/**
 * The client a document's money belongs to, by the app-wide rule: the linked
 * client id when there is one, otherwise the one saved client the free-text
 * document names, otherwise the normalised name itself (aging.ts does exactly
 * this, and the two reports must bucket the same documents together).
 */
function clientKeyOf(
  doc: Pick<InvoiceDocument, "clientId" | "clientName" | "clientTaxId">,
  clients: ForecastClient[],
): string {
  const resolved = resolveDocumentClientId(doc, clients);
  return resolved || `${UNLINKED_PREFIX}${normalizeName(doc.clientName)}`;
}

/** Every client's observed issue-to-payment gaps, in days. */
function buildPayHistory(
  documents: InvoiceDocument[],
  clients: ForecastClient[],
): Map<string, number[]> {
  const history = new Map<string, number[]>();
  for (const d of documents) {
    if (!d.paidAt || d.status !== "paid" || !isCountableRevenue(d)) continue;
    const paidOn = d.paidAt.slice(0, 10);
    if (paidOn.length < 10 || d.date.length < 10) continue;
    const days = daysBetween(d.date, paidOn);
    // A negative gap means the receipt was written after the money arrived
    // (the normal receipt flow), which is a same-day payment, not a refund.
    const clamped = Math.max(0, days);
    if (clamped > MAX_DAYS_TO_PAY) continue;
    const key = clientKeyOf(d, clients);
    const list = history.get(key);
    if (list) list.push(clamped);
    else history.set(key, [clamped]);
  }
  return history;
}

/**
 * How long this client takes to pay: the median of their own past
 * issue-to-payment gaps, or `fallback` when they have never paid anything.
 *
 * `clientKey` is what {@link forecastCashFlow} groups by - a client id, or
 * `__no_client__:<normalised name>` for documents that were never linked.
 */
export function expectedDaysToPay(
  clientKey: string,
  documents: InvoiceDocument[],
  fallback = DEFAULT_DAYS_TO_PAY,
  clients: ForecastClient[] = [],
): number {
  const days = buildPayHistory(documents, clients).get(clientKey);
  return days && days.length > 0 ? lowerMedian(days) : fallback;
}

/* ------------------------------------------------------------------ */
/* recurring source shape                                              */
/* ------------------------------------------------------------------ */

function toSourceDoc(d: InvoiceDocument): RecurringSourceDoc {
  return {
    id: d.id,
    number: d.number,
    type: d.type,
    status: d.status,
    date: d.date,
    clientId: d.clientId || null,
    clientName: d.clientName,
    subject: d.subject || "",
    notes: d.notes ?? null,
    currency: d.currency ?? "ILS",
    zeroRated: d.zeroRated ?? false,
    discountAmount: d.discountAmount ?? 0,
    withholdingAmount: d.withholdingAmount ?? 0,
    items: (d.items || []).map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* the forecast                                                        */
/* ------------------------------------------------------------------ */

export function forecastCashFlow(inputs: ForecastInputs): ForecastResult {
  const { documents, expenses, business, today } = inputs;
  const clients = inputs.clients ?? [];
  const monthCount = Math.max(1, Math.floor(inputs.months ?? 3));

  const startPeriod = periodOf(today);
  const periods: string[] = [];
  for (let i = 0; i < monthCount; i++) periods.push(periodPlus(startPeriod, i));
  const windowStart = `${periods[0]}-01`;
  const windowEnd = monthRange(periods[periods.length - 1]).end;
  const inWindow = (iso: string) => iso >= windowStart && iso <= windowEnd;
  /** Money whose expected date already passed is money expected now. */
  const notBefore = (iso: string) => (iso < today ? today : iso);

  const lines: ForecastLine[] = [];
  const assumptions: string[] = [];

  const payHistory = buildPayHistory(documents, clients);
  let usedFallbackDays = false;
  function daysToPay(clientKey: string): number {
    const days = payHistory.get(clientKey);
    if (days && days.length > 0) return lowerMedian(days);
    usedFallbackDays = true;
    return DEFAULT_DAYS_TO_PAY;
  }

  /* ---------- open invoices ---------- */

  /**
   * A credit note reverses an invoice, so an open invoice that has already
   * been credited is not money on the way in. Credit notes are stored ALREADY
   * NEGATIVE app-wide, so they are ADDED here - negating them again would turn
   * a reversal into extra forecast income.
   *
   * Only credit notes that name their original are netted. A credit note has
   * no "settled" state in the app, so sweeping every one of them as its own
   * open line would keep a refund from two years ago in the forecast forever.
   */
  const creditByOriginal = new Map<string, number>();
  for (const d of documents) {
    if (d.type !== "credit_note") continue;
    if (d.status === "draft" || d.status === "cancelled") continue;
    if (!d.originalDocumentId) continue;
    const amount = d.totalIls ?? d.total;
    creditByOriginal.set(d.originalDocumentId, (creditByOriginal.get(d.originalDocumentId) ?? 0) + amount);
  }

  let openInvoiceCount = 0;
  for (const d of documents) {
    if (d.status !== "sent" || d.convertedToId) continue;
    if (!OPEN_TYPES.includes(d.type)) continue;
    const amount = round2(Math.max(0, (d.totalIls ?? d.total) + (creditByOriginal.get(d.id) ?? 0)));
    if (amount <= 0) continue;
    const date = notBefore(addDays(d.date, daysToPay(clientKeyOf(d, clients))));
    if (!inWindow(date)) continue;
    openInvoiceCount += 1;
    lines.push({
      date,
      amount,
      kind: "open_invoice",
      // The amount is a fact (an issued document); only its date is estimated.
      confidence: "certain",
      label: `${DOCUMENT_TYPE_LABELS[d.type]} ${d.number}`,
      href: `/documents/${d.id}`,
      clientName: d.clientName,
      documentId: d.id,
    });
  }

  /* ---------- recurring income ---------- */

  const sourceDocs = documents.map(toSourceDoc);
  const patterns = detectRecurringPatterns(sourceDocs, { today });
  let recurringCount = 0;
  for (const pattern of patterns) {
    // The pattern carries no total - it is a template, not a document - so the
    // money is the sum of its lines.
    const amount = round2(
      pattern.items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unitPrice || 0), 0),
    );
    if (amount <= 0) continue;
    const key = clientKeyOf(
      { clientId: pattern.clientId || "", clientName: pattern.clientName },
      clients,
    );
    const days = daysToPay(key);
    for (const period of periods) {
      // Already issued for that month by hand: the money is an open invoice
      // above, and counting the cadence too would bill the owner twice.
      if (alreadyBilledForPeriod(sourceDocs, pattern, period)) continue;
      const date = notBefore(addDays(dayInPeriod(period, pattern.dayOfMonth), days));
      if (!inWindow(date)) continue;
      recurringCount += 1;
      lines.push({
        date,
        amount,
        kind: "recurring_income",
        confidence: "likely",
        label: "חיוב חוזר קבוע",
        href: `/documents/${pattern.lastDocId}`,
        clientName: pattern.clientName,
      });
    }
  }

  /* ---------- open quotes: reported, never counted ---------- */

  let quoteCount = 0;
  let quoteTotal = 0;
  for (const d of documents) {
    if (d.type !== "quote" || d.status !== "sent" || d.convertedToId) continue;
    quoteCount += 1;
    quoteTotal += d.totalIls ?? d.total;
  }

  /* ---------- running costs ---------- */

  // The three whole months before this one. The current month is deliberately
  // out: it is still filling up, and a half-month of receipts would halve the
  // average exactly when the forecast needs it most.
  const averageStart = `${periodPlus(startPeriod, -EXPENSE_AVERAGE_MONTHS)}-01`;
  const averageEnd = addDays(`${startPeriod}-01`, -1);
  let expenseTotal = 0;
  for (const e of expenses) {
    if (e.date < averageStart || e.date > averageEnd) continue;
    expenseTotal += e.amount;
  }
  const monthlyExpenses = round2(Math.max(0, expenseTotal / EXPENSE_AVERAGE_MONTHS));
  if (monthlyExpenses > 0) {
    for (const period of periods) {
      lines.push({
        date: notBefore(dayInPeriod(period, EXPENSE_DAY_OF_MONTH)),
        amount: -monthlyExpenses,
        kind: "expenses_avg",
        confidence: "estimate",
        label: "הוצאות שוטפות",
        href: "/expenses",
      });
    }
    assumptions.push(
      "ההוצאות השוטפות בתחזית הן ממוצע שלושת החודשים המלאים האחרונים, ולא הוצאות ידועות.",
    );
  } else {
    assumptions.push(
      "לא נרשמו הוצאות בשלושת החודשים המלאים האחרונים, ולכן התחזית לא כוללת הוצאות שוטפות.",
    );
  }

  /* ---------- month totals so far (the advance estimate needs them) ---------- */

  const inflowByPeriod = new Map<string, number>();
  for (const line of lines) {
    if (!INFLOW_KINDS.includes(line.kind)) continue;
    const period = periodOf(line.date);
    inflowByPeriod.set(period, (inflowByPeriod.get(period) ?? 0) + line.amount);
  }

  /* ---------- מקדמות מס הכנסה ---------- */

  const vatRate = VAT_RATES[business.businessType] ?? 0;
  const advanceRate = business.incomeTaxAdvanceRate;
  if (advanceRate && advanceRate > 0) {
    for (const period of periods) {
      const previous = periodPlus(period, -1);
      const range = monthRange(previous);
      const due = advanceDueDate(range.end);
      if (!inWindow(due)) continue;
      let amount: number;
      if (range.end < today) {
        // The month is over: the turnover is known, so the payment is too.
        amount = computeAdvance(documents, range, advanceRate).due;
      } else {
        // The month is still running: the base is this report's own forecast
        // inflow for it, taken back to pre-VAT because מקדמות are charged on
        // turnover, not on the VAT collected with it.
        const inflow = inflowByPeriod.get(previous) ?? 0;
        amount = roundShekelHalfUp(((inflow / (1 + vatRate / 100)) * advanceRate) / 100);
      }
      if (amount <= 0) continue;
      lines.push({
        date: notBefore(due),
        amount: -amount,
        kind: "income_tax_advance",
        confidence: "estimate",
        label: `מקדמת מס הכנסה עבור ${monthLabel(previous)}`,
        href: "/reports/advances",
      });
    }
  } else {
    assumptions.push(
      "לא הוגדר אחוז מקדמות מס הכנסה, ולכן התחזית לא כוללת מקדמות. אפשר להזין אותו בדוח מקדמות מס הכנסה.",
    );
  }

  /* ---------- מע״מ ---------- */

  const filesVat = business.businessType === "authorized" || business.businessType === "company";
  if (filesVat) {
    const [ty, tm, td] = today.split("-").map(Number);
    const reference = new Date(ty, tm - 1, td);
    for (const offset of VAT_PERIOD_OFFSETS) {
      const range = biMonthlyRange(reference, offset);
      // Same deadline arithmetic as the מקדמה: the 15th of the month after the
      // period ends.
      const due = advanceDueDate(range.end);
      if (!inWindow(due)) continue;

      let outputVat = 0;
      for (const d of documents) {
        if (d.date < range.start || d.date > range.end) continue;
        if (d.status === "draft" || d.status === "cancelled") continue;
        if (d.type !== "tax_invoice" && d.type !== "tax_invoice_receipt" && d.type !== "credit_note") {
          continue;
        }
        // Credit notes are stored negative; folding them into the same `+=`
        // nets them out, and a `-=` would add the refund's VAT back in.
        outputVat += d.vatIls ?? d.vat;
      }
      let inputVat = 0;
      for (const e of expenses) {
        if (e.date < range.start || e.date > range.end) continue;
        inputVat += e.vatAmount ?? 0;
      }

      const running = range.end >= today;
      let factor = 1;
      if (running) {
        const elapsed = daysInclusive(range.start, today < range.end ? today : range.end);
        if (elapsed > 0) factor = daysInclusive(range.start, range.end) / elapsed;
      }
      const net = roundShekelHalfUp((outputVat - inputVat) * factor);
      if (net < 0) {
        assumptions.push(
          `בתקופת המע״מ ${range.label} מס התשומות גבוה ממס העסקאות. התחזית מציגה 0 ולא החזר, כי מועד ההחזר אינו ידוע.`,
        );
        continue;
      }
      if (net === 0) continue;
      if (running) {
        assumptions.push(
          `תקופת המע״מ ${range.label} עדיין פתוחה, והסכום שלה נאמד לפי הקצב מתחילת התקופה ועד היום.`,
        );
      }
      lines.push({
        date: notBefore(due),
        amount: -net,
        kind: "vat",
        confidence: running ? "estimate" : "likely",
        label: `מע״מ לתקופה ${range.label}`,
        href: "/reports/vat",
      });
    }
  }

  /* ---------- assemble ---------- */

  if (openInvoiceCount > 0) {
    assumptions.push(
      "מועד התשלום של כל מסמך פתוח נאמד לפי חציון ימי התשלום של אותו לקוח בעבר. מסמך שכבר עבר את מועדו מוצג בחודש הנוכחי.",
    );
  }
  if (usedFallbackDays) {
    assumptions.push(
      `ללקוחות שאין להם היסטוריית תשלומים הונחו ${DEFAULT_DAYS_TO_PAY} ימים עד לתשלום.`,
    );
  }
  if (recurringCount > 0) {
    assumptions.push(
      "חיובים חוזרים שזוהו לפי ההיסטוריה נספרים כהכנסה צפויה, גם אם המסמך עוד לא הופק.",
    );
  }
  if (quoteCount > 0) {
    assumptions.push("הצעות מחיר פתוחות אינן נכללות בסכומים - הן עדיין לא הכנסה.");
  }

  const byPeriod = new Map<string, ForecastLine[]>();
  for (const period of periods) byPeriod.set(period, []);
  for (const line of lines) byPeriod.get(periodOf(line.date))?.push(line);

  const months: ForecastMonth[] = periods.map((period) => {
    const monthLines = byPeriod.get(period)!.sort(
      (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label),
    );
    let inflow = 0;
    let outflow = 0;
    for (const line of monthLines) {
      if (INFLOW_KINDS.includes(line.kind)) inflow += line.amount;
      else outflow -= line.amount;
    }
    inflow = round2(inflow);
    outflow = round2(outflow);
    return { period, label: monthLabel(period), inflow, outflow, net: round2(inflow - outflow), lines: monthLines };
  });

  const totals = months.reduce(
    (acc, m) => ({
      inflow: round2(acc.inflow + m.inflow),
      outflow: round2(acc.outflow + m.outflow),
      net: round2(acc.net + m.net),
    }),
    { inflow: 0, outflow: 0, net: 0 },
  );

  return {
    months,
    potentialQuotes: { count: quoteCount, total: round2(quoteTotal) },
    totals,
    assumptions,
  };
}

/** Hebrew labels for the line kinds, shared by the report and the export. */
export const FORECAST_KIND_LABELS: Record<ForecastKind, string> = {
  open_invoice: "מסמך פתוח",
  recurring_income: "חיוב חוזר",
  expenses_avg: "הוצאות",
  income_tax_advance: "מקדמה",
  vat: "מע״מ",
};

export const FORECAST_CONFIDENCE_LABELS: Record<ForecastConfidence, string> = {
  certain: "ודאי",
  likely: "סביר",
  estimate: "הערכה",
};
