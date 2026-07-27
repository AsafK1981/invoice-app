import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { todayInIsrael } from "@/lib/date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = `You are a sharp, friendly business analyst for an Israeli solo freelancer (עוסק פטור or עוסק מורשה).

You receive a JSON summary of their finances. Produce 2-5 SHORT Hebrew insights (1-2 sentences each) that are genuinely useful, not generic. Lean toward:

- Notable period deltas: "ההכנסות עלו 23% החודש (₪6,200) לעומת מאי. כל הכבוד 🎉"
- Outstanding actions: "עברו 17 ימים מאז שלחת חשבון עסקה לגינדין אנה (₪1,000). שווה לשלוח תזכורת?"
- Category jumps: "הוצאות התוכנה זינקו פי 7 (₪180 → ₪1,240), בעיקר Anthropic ו-Cursor."
- Cash flow concerns: "החודש יצאת במינוס ₪480: הוצאה אחת ואפס הכנסות."
- Milestones: "עברת את ה-₪10,000 השנה. צבירה יפה."

For each insight, pick a kind:
- "positive": good news (revenue up, profitability)
- "warning": something to watch (cash flow, expense spike, ceiling close)
- "action": user should act (overdue quotes, unpaid invoices, send reminder)
- "info": neutral context (notable patterns, milestones, comparisons)

OUTPUT: STRICT JSON array, nothing else. No markdown fences:
[
  {"kind": "positive" | "warning" | "action" | "info", "text": "Hebrew sentence", "href": "/documents/xyz" | null}
]

Rules:
- Hebrew only. Names of services in English are fine (Anthropic, Cursor, etc.) but the sentence structure is Hebrew.
- **Write natural, idiomatic Hebrew as a native Israeli speaker would.** Do NOT translate from English literally. Do NOT invent clever-sounding phrases. If unsure, pick the SIMPLE wording.
- Each sentence must be grammatically correct and immediately understandable. If a phrase sounds like AI-Hebrew (forced or unusual word combinations), rewrite it. Common bad patterns to AVOID:
  - "כל השולמים ובאים" (made-up)
  - "המתשלמים והמסיימים" (made-up)
  - "התובנות מצביעות על" (translation-ese)
  - Cute slogans that aren't real Hebrew expressions
- When there's nothing alarming to report, say something genuinely positive in plain Hebrew, e.g. "כל החשבוניות שולמו, אין חוב פתוח." or "אין הצעות שמחכות לאישור, סיימת את כולן." Don't invent flourishes.
- Specific numbers > vague claims. Use ₪ symbol.
- 2-5 insights. Fewer is fine if data is sparse.
- If data is too sparse to say anything substantive, return ONE welcoming insight encouraging usage (e.g. "ההוצאה הראשונה תועדה. ככל שתתעד יותר, תקבל כאן תובנות יותר עשירות.").
- DON'T say "הנתונים מראים" / "אני רואה" / "יש לך"; state insights directly.
- DON'T invent numbers. Use only what's in the data.
- DON'T repeat data the user can see in the cards (no "הכנסות החודש: ₪6,200", that's already in the UI).
- href is optional; set it when the insight points to a specific document. Use the provided IDs.
- Use emojis sparingly (1-2 max across all insights).
- NEVER use a long dash of any kind. Use a comma, a colon, or a new sentence instead.`;

type Insight = { kind: "positive" | "warning" | "action" | "info"; text: string; href?: string | null };

function daysAgo(date: string): number {
  const d = new Date(date + "T00:00:00Z").getTime();
  const today = new Date(todayInIsrael() + "T00:00:00Z").getTime();
  return Math.floor((today - d) / (24 * 60 * 60 * 1000));
}

export async function POST(req: NextRequest) {
  try {
    if (!anthropicKey) {
      return NextResponse.json({ ok: false, error: "AI לא מוגדר." }, { status: 503 });
    }

    const ip = clientIp(req);
    const ipLimit = checkRate({ key: `insights:ip:${ip}`, max: 20, windowMs: 60_000 });
    if (!ipLimit.ok) {
      return NextResponse.json({ ok: false, error: "יותר מדי בקשות." }, { status: 429 });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 10 insight generations per user per hour. Generous for normal use.
    const userLimit = checkRate({ key: `insights:user:${user.id}`, max: 10, windowMs: 60 * 60_000 });
    if (!userLimit.ok) {
      return NextResponse.json({ ok: false, error: "חרגת ממכסת התובנות השעתית." }, { status: 429 });
    }

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: biz } = await admin
      .from("businesses")
      .select("id, business_type")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!biz) {
      return NextResponse.json({ ok: true, insights: [] });
    }

    const now = new Date();
    const currentMonthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const previousMonthStart = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const yearStart = `${now.getUTCFullYear()}-01-01`;
    const ytdLastYearStart = `${now.getUTCFullYear() - 1}-01-01`;

    const [{ data: docs }, { data: exps }] = await Promise.all([
      admin
        .from("documents")
        .select("id, type, status, date, total, total_ils, client_name, emailed_at, number")
        .eq("business_id", biz.id)
        .gte("date", ytdLastYearStart)
        .order("date", { ascending: false }),
      admin
        .from("expenses")
        .select("id, date, category, supplier, amount, description")
        .eq("business_id", biz.id)
        .gte("date", ytdLastYearStart)
        .order("date", { ascending: false }),
    ]);

    type Doc = { id: string; type: string; status: string; date: string; total: number; total_ils: number | null; client_name: string; emailed_at: string | null; number: string };
    type Exp = { id: string; date: string; category: string; supplier: string; amount: number; description: string | null };
    const documents = (docs as Doc[] | null) || [];
    const expenses = (exps as Exp[] | null) || [];

    const sumIf = <T extends { date: string }>(rows: T[], pred: (r: T) => boolean, val: (r: T) => number) =>
      rows.filter(pred).reduce((s, r) => s + (val(r) || 0), 0);

    const currentMonthPaidDocs = documents.filter((d) => d.date >= currentMonthStart && d.status === "paid");
    const previousMonthPaidDocs = documents.filter(
      (d) => d.date >= previousMonthStart && d.date < currentMonthStart && d.status === "paid",
    );
    const currentMonthExp = expenses.filter((e) => e.date >= currentMonthStart);
    const previousMonthExp = expenses.filter((e) => e.date >= previousMonthStart && e.date < currentMonthStart);

    const expensesByCategoryCurrent: Record<string, number> = {};
    for (const e of currentMonthExp) expensesByCategoryCurrent[e.category] = (expensesByCategoryCurrent[e.category] || 0) + Number(e.amount || 0);
    const expensesByCategoryPrevious: Record<string, number> = {};
    for (const e of previousMonthExp) expensesByCategoryPrevious[e.category] = (expensesByCategoryPrevious[e.category] || 0) + Number(e.amount || 0);

    const openQuotes = documents
      .filter((d) => d.type === "quote" && d.status === "sent")
      .map((d) => ({
        id: d.id,
        client: d.client_name,
        total: Number(d.total_ils ?? d.total ?? 0),
        days_ago: daysAgo(d.emailed_at ? d.emailed_at.slice(0, 10) : d.date),
      }))
      .filter((q) => q.days_ago >= 3)
      .slice(0, 8);

    const unpaidInvoices = documents
      .filter((d) => (d.type === "tax_invoice" || d.type === "tax_invoice_receipt") && d.status === "sent")
      .map((d) => ({
        id: d.id,
        client: d.client_name,
        total: Number(d.total_ils ?? d.total ?? 0),
        days_ago: daysAgo(d.emailed_at ? d.emailed_at.slice(0, 10) : d.date),
      }))
      .slice(0, 8);

    const ytdIncome = sumIf(documents, (d) => d.date >= yearStart && d.status === "paid", (d) => Number(d.total_ils ?? d.total ?? 0));
    const ytdExpenses = sumIf(expenses, (e) => e.date >= yearStart, (e) => Number(e.amount || 0));

    const payload = {
      business_type: biz.business_type,
      current_month: currentMonthStart.slice(0, 7),
      previous_month: previousMonthStart.slice(0, 7),
      current_month_stats: {
        income: currentMonthPaidDocs.reduce((s, d) => s + Number(d.total_ils ?? d.total ?? 0), 0),
        paid_doc_count: currentMonthPaidDocs.length,
        expenses: currentMonthExp.reduce((s, e) => s + Number(e.amount || 0), 0),
        expense_categories: expensesByCategoryCurrent,
      },
      previous_month_stats: {
        income: previousMonthPaidDocs.reduce((s, d) => s + Number(d.total_ils ?? d.total ?? 0), 0),
        paid_doc_count: previousMonthPaidDocs.length,
        expenses: previousMonthExp.reduce((s, e) => s + Number(e.amount || 0), 0),
        expense_categories: expensesByCategoryPrevious,
      },
      year_to_date: { income: ytdIncome, expenses: ytdExpenses, profit: ytdIncome - ytdExpenses },
      open_quotes: openQuotes,
      unpaid_invoices: unpaidInvoices,
      totals: {
        total_docs: documents.length,
        total_expenses: expenses.length,
      },
    };

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const today = todayInIsrael();

    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Today is ${today}.\n\nBusiness data:\n${JSON.stringify(payload, null, 2)}\n\nReturn ONLY the JSON array of insights.`,
        },
      ],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "");

    // Prompt-injection defense: the model output flows into a <Link href>
    // and Next.js Link will happily navigate to javascript:, data:, or
    // off-site URLs if asked. Only accept same-origin relative paths.
    const SAFE_HREF = /^\/(?!\/)[A-Za-z0-9_\-/?=&.%#]*$/;

    let insights: Insight[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        insights = parsed
          .filter((i): i is Insight => i && typeof i.text === "string" && typeof i.kind === "string")
          .map((i) => ({
            kind: i.kind,
            text: i.text,
            href: typeof i.href === "string" && SAFE_HREF.test(i.href) ? i.href : null,
          }))
          .slice(0, 5);
      }
    } catch {
      return NextResponse.json({ ok: false, error: "תשובת AI לא תקפה.", raw: text }, { status: 502 });
    }

    return NextResponse.json({ ok: true, insights });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
