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
 * the ₪ figures reconcile internally. For ILS docs the caller passes rate=1
 * → identical numbers.
 */
export function ilsEquivalents(m: MoneyTriple, rate: number): IlsTriple {
  const subtotalIls = round2(m.subtotal * rate);
  const vatIls = round2(m.vat * rate);
  return { subtotalIls, vatIls, totalIls: round2(subtotalIls + vatIls) };
}

// BoI representative rate fetcher. Swappable for tests. Parse to ₪ per unit.
type RateFetcher = (currency: string, dateISO: string) => Promise<number>;

let fetcher: RateFetcher = async (currency, dateISO) => {
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
