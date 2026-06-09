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
  return NextResponse.json({ ok: true, rate });
}
