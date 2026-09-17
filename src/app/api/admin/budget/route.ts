import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";
import { checkRate } from "@/lib/rate-limit";
import {
  mapPolarOrders,
  validateBudgetInput,
  AUTOMATIC_DISPLAY_LIMIT,
  DEFAULT_USD_RATE,
  type AutomaticIncome,
  type BudgetEntry,
  type PolarOrderLike,
  type PolarStatus,
} from "@/lib/admin-budget";
import { polar } from "@/lib/polar";
import { getRateQuote } from "@/lib/exchange-rate";
import { todayInIsrael } from "@/lib/date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * The operator's budget (design: docs/superpowers/specs/2026-09-17-admin-budget-design.md).
 *
 *   GET  -> every budget row, the automatic income (both payment rails), and
 *           the USD rate to convert with
 *   POST -> create one row
 *
 * Same gate as every other admin route: Bearer token -> auth.getUser -> the
 * hardcoded allow-list, 404 (not 403) to anyone else so the endpoint's
 * existence is not leaked. Data queries run with the service key, because the
 * table has RLS on with no policies.
 *
 * TWO income rails, because the app has two. `subscription_charge_log` is the
 * Grow rail (ILS); Polar is the LIVE one, and its webhook
 * (src/app/api/billing/webhook/route.ts) writes plan state to app_metadata and
 * nothing to the charge log. Reading only the log would have shown roughly zero
 * income and painted a loss that is not real, so paid Polar orders are read
 * live (a free read-only GET) and merged in.
 *
 * No summary is computed here on purpose. The page recomputes it from
 * summarizeBudget with the operator's own rate; one source of truth beats two
 * that can disagree by a rounding step.
 *
 * PRIVACY: both rails touch paying customers' records. Exactly five fields
 * leave this route per payment - amount, currency, charged_at, provider and the
 * payer's SIGNUP EMAIL, which /admin already shows. Not the user id, not the
 * period, not the transaction or order id, never the self-invoice behind it,
 * and none of the name/address/tax-id a Polar order carries. Do not widen this.
 */

/** How far back the automatic income reaches. The cards need the current
 *  month; the chart's year view needs whole past years to compare, so three
 *  years. Both read caps below still apply and are still reported when hit. */
const INCOME_MONTHS = 36;

/** Hard stop on the Polar paging loop, so a huge account cannot hang the page. */
const POLAR_MAX_PAGES = 10;

/**
 * Row caps on the charge-log reads. Both are reported to the page when hit
 * (`growTruncated`) rather than silently swallowed: the history cap only
 * shortens the list, but a number with an unannounced ceiling under it is how
 * a dashboard lies. The month query is separate so THIS month, the figure the
 * summary cards are built from, is never the truncated one.
 */
const GROW_HISTORY_LIMIT = 500;
const GROW_MONTH_LIMIT = 1000;

async function authAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user || !isAdminEmail(user.email)) return null;
  return user;
}

function serviceClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Paid Polar orders of the last `INCOME_MONTHS`, or null when Polar cannot be
 * read at all (no POLAR_ACCESS_TOKEN in this environment, network error, API
 * error). Null is NOT an empty list: the page says so out loud instead of
 * showing a zero that would read as "nobody paid".
 */
async function loadPolarIncome(
  since: Date,
): Promise<{ rows: AutomaticIncome[]; capped: boolean } | null> {
  if (!polar) return null;
  try {
    const orders: PolarOrderLike[] = [];
    // Newest first, so the loop can stop as soon as it walks past the window.
    const pages = await polar.orders.list({ limit: 100, sorting: ["-created_at"] });
    let pageCount = 0;
    // `capped` distinguishes the two ways this loop can end. Reaching the page
    // cap means there were MORE payments in the window that were not read, and
    // the page has to say so; walking past `since` or running out of pages
    // means the window was covered and the numbers are complete.
    let capped = false;
    outer: for await (const page of pages) {
      pageCount += 1;
      for (const order of page.result.items) {
        if (order.createdAt instanceof Date && order.createdAt < since) break outer;
        orders.push(order);
      }
      if (pageCount >= POLAR_MAX_PAGES) {
        capped = true;
        break;
      }
    }
    return { rows: mapPolarOrders(orders), capped };
  } catch {
    return null;
  }
}

/**
 * USD -> ILS for the summary: the Bank of Israel representative rate (free,
 * cached 15 minutes in src/lib/exchange-rate.ts). Fails soft to the visible
 * 3.7 estimate, and says which one it is so the page can label it honestly.
 */
async function loadUsdRate(): Promise<{ usdRate: number; usdRateSource: "boi" | "fallback" }> {
  try {
    const quote = await getRateQuote("USD", todayInIsrael());
    if (quote && Number.isFinite(quote.rate) && quote.rate > 0) {
      return { usdRate: quote.rate, usdRateSource: "boi" };
    }
  } catch {
    // fall through to the estimate
  }
  return { usdRate: DEFAULT_USD_RATE, usdRateSource: "fallback" };
}

export async function GET(req: NextRequest) {
  const user = await authAdmin(req);
  if (!user) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  // Rate-limited like the write verbs: this GET fans out to Supabase, the auth
  // admin API and Polar, so it is the most expensive call in the route.
  const rl = checkRate({ key: `admin-budget-read:${user.id}`, max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Slow down" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }
  if (!serviceKey) {
    return NextResponse.json({ ok: false, error: "Service role not configured" }, { status: 500 });
  }

  const sb = serviceClient();
  await logAdminAccess(sb, {
    actor: user.email || user.id,
    channel: "admin_api",
    action: "admin/budget GET",
  });

  const { data: rows, error } = await sb
    .from("admin_budget_entries")
    .select("*")
    .order("kind", { ascending: true })
    .order("active", { ascending: false })
    .order("party", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const entries = (rows ?? []) as BudgetEntry[];

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - INCOME_MONTHS);

  // The current month IN ISRAEL, as a UTC instant to query with. Deliberately
  // three hours early: Israel is UTC+2/+3, so this cannot start after the local
  // month does, and summarizeBudget re-filters by the Israel calendar day
  // anyway. Being a little over-inclusive here is free; being late by an hour
  // would drop the payments taken just after midnight on the 1st.
  const monthStart = new Date(`${todayInIsrael().slice(0, 7)}-01T00:00:00Z`);
  monthStart.setUTCHours(-3);

  const [historyResult, monthResult, polarIncome, rate] = await Promise.all([
    // History, newest first, for the list. Capped, and the cap is reported.
    sb
      .from("subscription_charge_log")
      .select("user_id, amount, charged_at, provider")
      .eq("success", true)
      .gte("charged_at", since.toISOString())
      .lt("charged_at", monthStart.toISOString())
      .order("charged_at", { ascending: false })
      .limit(GROW_HISTORY_LIMIT),
    // THIS month on its own, so the number the operator actually reads cannot
    // be truncated by the history cap. A month of charges is small; PostgREST's
    // own 1000-row ceiling is flagged below rather than assumed away.
    sb
      .from("subscription_charge_log")
      .select("user_id, amount, charged_at, provider")
      .eq("success", true)
      .gte("charged_at", monthStart.toISOString())
      .order("charged_at", { ascending: false })
      .limit(GROW_MONTH_LIMIT),
    loadPolarIncome(since),
    loadUsdRate(),
  ]);

  const chargeError = historyResult.error || monthResult.error;
  if (chargeError) {
    return NextResponse.json({ ok: false, error: chargeError.message }, { status: 500 });
  }

  // The two queries partition the window at the month boundary, so no row can
  // appear twice. The charge log stores ILS (the Grow rail) and keeps the payer
  // as a user id; the id is used here and dropped, it never leaves the route.
  const growRows = [...(monthResult.data ?? []), ...(historyResult.data ?? [])].map((row) => ({
    user_id: String(row.user_id ?? ""),
    row: {
      amount: Number(row.amount ?? 0),
      currency: "ILS" as const,
      charged_at: String(row.charged_at),
      provider: String(row.provider ?? "grow"),
      payer_email: null as string | null,
    },
  }));

  // A query that came back exactly full almost certainly had more to give.
  const growTruncated =
    (historyResult.data?.length ?? 0) >= GROW_HISTORY_LIMIT ||
    (monthResult.data?.length ?? 0) >= GROW_MONTH_LIMIT;

  // Merge both rails, newest first. Every Grow row of the current month is
  // here, so the page's sums are complete whatever the display cap below does.
  const merged = [
    ...growRows.map((item) => ({ ...item, polar: false })),
    ...(polarIncome?.rows ?? []).map((row) => ({ user_id: "", row, polar: true })),
  ].sort((a, b) => b.row.charged_at.localeCompare(a.row.charged_at));

  // Signup emails ONLY for the rows the page will paint, resolved in parallel.
  // A Polar order already carries its customer's email, so only the Grow rows
  // inside the display window need a lookup: the old version awaited one
  // getUserById per distinct payer across a whole year of charges, serially.
  const wanted = new Set(
    merged
      .slice(0, AUTOMATIC_DISPLAY_LIMIT)
      .filter((item) => !item.polar && item.user_id)
      .map((item) => item.user_id),
  );
  const resolved = await Promise.all(
    Array.from(wanted, async (id): Promise<[string, string | null]> => {
      try {
        const { data } = await sb.auth.admin.getUserById(id);
        return [id, data?.user?.email ?? null];
      } catch {
        // A failed lookup leaves the email null rather than failing the page:
        // the amount and the date are the numbers the budget needs.
        return [id, null];
      }
    }),
  );
  const emails = new Map(resolved);

  const automatic: AutomaticIncome[] = merged.map((item) =>
    item.polar || !emails.has(item.user_id)
      ? item.row
      : { ...item.row, payer_email: emails.get(item.user_id) ?? null },
  );

  const polarStatus: PolarStatus =
    polarIncome === null ? "unavailable" : polarIncome.capped ? "partial" : "ok";

  return NextResponse.json({
    ok: true,
    entries,
    automatic,
    polarStatus,
    growTruncated,
    ...rate,
  });
}

export async function POST(req: NextRequest) {
  const user = await authAdmin(req);
  if (!user) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const rl = checkRate({ key: `admin-budget:${user.id}`, max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Slow down" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = validateBudgetInput(body, false);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const sb = serviceClient();
  await logAdminAccess(sb, {
    actor: user.email || user.id,
    channel: "admin_api",
    action: "admin/budget POST",
    // Metadata only: which vendor, which kind. Never the notes field.
    detail: { kind: parsed.value.kind, party: parsed.value.party },
  });

  const { data: entry, error } = await sb
    .from("admin_budget_entries")
    .insert(parsed.value)
    .select()
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry });
}
