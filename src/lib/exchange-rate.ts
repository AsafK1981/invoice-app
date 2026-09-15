import { round2 } from "./vat";
import { toIsraelDate, todayInIsrael } from "./date";

export interface MoneyTriple {
  subtotal: number;
  vat: number;
  total: number;
  /** Optional הפרש עיגול in the document currency (default 0). */
  rounding?: number;
}
export interface IlsTriple {
  subtotalIls: number;
  vatIls: number;
  totalIls: number;
}

/**
 * Snapshot the ₪ equivalent of a document's amounts at a given exchange
 * rate (₪ per 1 currency unit). The own-currency total is already rounded (the
 * הפרש עיגול lives in `m.rounding`); we derive the ₪ figures from the rounded
 * parts so they reconcile internally: totalIls = subtotalIls + vatIls +
 * roundingIls. For ILS docs the caller passes rate=1 → identical numbers.
 */
export function ilsEquivalents(m: MoneyTriple, rate: number): IlsTriple {
  const subtotalIls = round2(m.subtotal * rate);
  const vatIls = round2(m.vat * rate);
  const roundingIls = round2((m.rounding ?? 0) * rate);
  return { subtotalIls, vatIls, totalIls: round2(subtotalIls + vatIls + roundingIls) };
}

// BoI representative rate fetcher. Swappable for tests. Returns ₪ per 1 unit.
// Uses the Bank of Israel public API, which returns the CURRENT representative
// rate per currency: { currentExchangeRate, unit, lastUpdate }. `unit` is the
// quoting unit (1 for USD/EUR/GBP, 10 for JPY, etc.), so ₪-per-unit = rate /
// unit. This endpoint has no date parameter: it cannot answer "the rate on
// 2026-03-01". So the requested date never selects the rate; it only decides
// whether the answer is labelled as a fallback (a past date got today's rate)
// and the cache is keyed by currency with a short lifetime, never by the
// requested date (caching today's rate as a past date's rate used to make the
// wrong answer look final).
export interface FetchedRate {
  rate: number;
  /** Israel calendar date the upstream rate was published for, when it says. */
  rateDate: string | null;
}
type RateFetcher = (currency: string, dateISO: string) => Promise<number | FetchedRate>;

let fetcher: RateFetcher = async (currency) => {
  const res = await fetch(`https://boi.org.il/PublicApi/GetExchangeRate?key=${currency}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`BoI ${res.status}`);
  const json = await res.json();
  const rate = Number(json?.currentExchangeRate);
  const unit = Number(json?.unit) || 1;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("BoI: no rate");
  const updated = typeof json?.lastUpdate === "string" ? new Date(json.lastUpdate) : null;
  const rateDate = updated && !Number.isNaN(updated.getTime()) ? toIsraelDate(updated) : null;
  return { rate: rate / unit, rateDate };
};

/** Test seam: override the network fetcher (and drop cached answers). */
export function __setRateFetcher(f: RateFetcher) {
  fetcher = f;
  cache.clear();
}

export interface RateQuote {
  /** ₪ per 1 unit. */
  rate: number;
  /** The date the upstream says the rate is for, null when unknown. */
  rateDate: string | null;
  /**
   * True when the document date is in the past and the source only had the
   * current rate: the number is NOT that day's representative rate, and the
   * editor tells the user to check it.
   */
  fallback: boolean;
}

/** How long one upstream answer is reused. The current rate changes once a business day. */
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { value: FetchedRate; at: number }>();

/**
 * The representative rate to use for a document dated `dateISO`, with a label
 * saying whether it really is that date's rate. ILS → 1 (no network). On any
 * failure returns null so the caller falls back to manual entry.
 */
export async function getRateQuote(
  currency: string,
  dateISO: string,
  today: string = todayInIsrael(),
  now: number = Date.now(),
): Promise<RateQuote | null> {
  if (currency === "ILS") return { rate: 1, rateDate: dateISO, fallback: false };
  let value: FetchedRate;
  const hit = cache.get(currency);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    value = hit.value;
  } else {
    try {
      const got = await fetcher(currency, dateISO);
      value = typeof got === "number" ? { rate: got, rateDate: null } : got;
      if (!Number.isFinite(value.rate) || value.rate <= 0) return null;
      cache.set(currency, { value, at: now });
    } catch {
      return null;
    }
  }
  // A document dated today or later takes the latest published rate, which is
  // what this source returns. An earlier date needs that day's rate, which it
  // cannot give, unless the upstream's own date happens to be that day.
  const fallback = dateISO < today && value.rateDate !== dateISO;
  return { rate: value.rate, rateDate: value.rateDate, fallback };
}

/** ₪ per 1 unit of `currency` for a document dated `dateISO`, or null. See getRateQuote. */
export async function getRate(currency: string, dateISO: string): Promise<number | null> {
  return (await getRateQuote(currency, dateISO))?.rate ?? null;
}
