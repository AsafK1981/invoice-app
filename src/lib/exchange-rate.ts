import { round2 } from "./vat";

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
// Uses the Bank of Israel public API, which returns the current representative
// rate per currency: { currentExchangeRate, unit }. `unit` is the quoting unit
// (1 for USD/EUR/GBP, 10 for JPY, etc.), so ₪-per-unit = rate / unit. This
// endpoint serves the CURRENT rate (not a historical per-date rate); for the
// common case of issuing today's invoice that is correct, and the editor lets
// the user override the rate for back-dated documents. The `dateISO` arg is
// kept for the cache key + future historical support.
type RateFetcher = (currency: string, dateISO: string) => Promise<number>;

let fetcher: RateFetcher = async (currency) => {
  const res = await fetch(`https://boi.org.il/PublicApi/GetExchangeRate?key=${currency}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`BoI ${res.status}`);
  const json = await res.json();
  const rate = Number(json?.currentExchangeRate);
  const unit = Number(json?.unit) || 1;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("BoI: no rate");
  return rate / unit;
};

/** Test seam: override the network fetcher. */
export function __setRateFetcher(f: RateFetcher) {
  fetcher = f;
}

const cache = new Map<string, number>();

/**
 * ₪ per 1 unit of `currency` on `dateISO`. ILS → 1 (no network). On any
 * failure returns null so the caller falls back to manual entry. Cached by
 * (currency, date); BoI daily rates are immutable for past dates.
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
