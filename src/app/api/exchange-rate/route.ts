import { NextRequest, NextResponse } from "next/server";
import { getRate } from "@/lib/exchange-rate";
import { isSupportedCurrency } from "@/lib/currencies";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const currency = url.searchParams.get("currency") || "";
  const date = url.searchParams.get("date") || "";
  if (!isSupportedCurrency(currency) || !DATE_RE.test(date)) {
    return NextResponse.json(
      { ok: false, error: "bad params" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const rate = await getRate(currency, date);
  if (rate == null) {
    // Upstream (BoI) fetch failed; don't let the CDN cache a transient
    // failure for a day.
    return NextResponse.json({ ok: true, rate }, { headers: { "Cache-Control": "no-store" } });
  }
  // Identical response for every caller given (currency, date), and
  // immutable once the date is in the past (BoI daily rates never change
  // retroactively). Safe to cache at the CDN.
  return NextResponse.json(
    { ok: true, rate },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
