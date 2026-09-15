import { NextRequest, NextResponse } from "next/server";
import { getRateQuote } from "@/lib/exchange-rate";
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
  const quote = await getRateQuote(currency, date);
  if (quote == null) {
    // Upstream (BoI) fetch failed; don't let the CDN cache a transient
    // failure.
    return NextResponse.json({ ok: true, rate: null }, { headers: { "Cache-Control": "no-store" } });
  }
  // The upstream only serves the CURRENT rate, so this answer is not final for
  // any date: a past date gets today's rate (labelled fallback), and today's
  // rate itself is replaced when the Bank of Israel publishes. Cache briefly.
  return NextResponse.json(
    { ok: true, rate: quote.rate, rateDate: quote.rateDate, fallback: quote.fallback },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=900",
      },
    },
  );
}
