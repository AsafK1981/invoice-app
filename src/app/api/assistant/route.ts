import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { todayInIsrael } from "@/lib/date";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS, REVENUE_DOCUMENT_TYPES } from "@/lib/types";
import type { DocumentType } from "@/lib/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

const MODEL = "claude-haiku-4-5-20251001";

// Same reasoning as MONTHLY_SCAN_CAP in expenses/scan: the in-memory rate
// limits below reset on every cold start and can't bound monthly spend on the
// shared ANTHROPIC_API_KEY. Note one message is not one model call - a message
// that uses tools costs up to MAX_ROUNDS calls, so budget accordingly: 200
// messages/user/month bounds worst case to roughly 800 Haiku calls (~10₪/user)
// while sitting far above realistic use of a few dozen messages.
const MONTHLY_MESSAGE_CAP = 200;

/** Tool-use rounds per request. Each round is one model call. */
const MAX_ROUNDS = 4;
/** Conversation turns accepted from the client (older ones are dropped). */
const MAX_HISTORY = 8;
/** Rows a single search may return - keeps tool results out of the context. */
const SEARCH_LIMIT = 15;

// Calibrated against Haiku 4.5 on real questions: the first draft of this
// prompt led with "ask when you're missing information", and the model took it
// literally - it answered "לא הבנתי את השאלה" to plain requests like "תמצא לי
// את המסמכים האחרונים" instead of calling a tool. Leading with tool-first
// routing and narrowing the ask-clause to genuine ambiguity took tool routing
// from 0/6 to 6/6 on the same question set. Re-run that check before loosening.
const SYSTEM = `אתה העוזר החכם של "חשבונית ידידותית", אפליקציית חשבוניות לעוסקים פטורים בישראל.

יש לך כלים שניגשים לנתונים האמיתיים של המשתמש המחובר. השתמש בהם - זו הדרך היחידה שלך לדעת משהו.

כלל הברזל: כמעט כל שאלה של המשתמש דורשת קריאה לכלי לפני שאתה עונה.
אל תבקש הבהרה על דבר שכלי יכול לענות עליו. קודם תחפש, ואז תענה.

דוגמאות לניתוב:
- "תמצא את המסמכים האחרונים" / "מה שלחתי לאחרונה" -> search_documents בלי פרמטרים
- "תמצא את חשבונית 87" -> search_documents עם number=87
- "מה שלחתי לדני" -> search_documents עם clientName="דני"
- "כמה הכנסתי החודש" -> get_income_summary עם התאריכים של החודש הנוכחי
- "כמה הכנסתי השנה" / "ב-2026" -> get_income_summary מ-01/01 עד היום
- "מי הלקוחות שלי" -> list_clients
- "תוציא קבלה ל..." -> קודם list_clients כדי לזהות את הלקוח, ואז prepare_document_draft

תאריכים: אל תשאל את המשתמש לטווח תאריכים. חשב אותו בעצמך מהתאריך של היום.
"החודש" = מה-1 בחודש הנוכחי עד היום. "השנה" = מה-1 בינואר עד היום.

שאל שאלה רק כשהתשובה באמת לא נמצאת בנתונים - למשל כשיש שני לקוחות בשם דני
ואתה צריך לדעת על מי מדובר, או כשחסר סכום להכנת טיוטה. שאלה אחת, ממוקדת.

סגנון: עברית, קצר וענייני. בלי הקדמות ובלי "בשמחה!". סכומים בשקלים,
תאריכים בפורמט DD/MM/YYYY. אל תמציא נתונים - אם החיפוש לא החזיר תוצאות, אמור זאת.
אתה רואה אך ורק את הנתונים של המשתמש המחובר.

יצירת מסמכים: אתה לא יוצר מסמכים. prepare_document_draft מכין טיוטה שהמשתמש
פותח בעורך, בודק ומאשר בעצמו. תמיד הבהר שזו טיוטה שממתינה לאישורו.

אינך יועץ מס. לשאלות על חוקי מס, זכאות או דיווח - הפנה לרואה חשבון.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_documents",
    description:
      "קורא את המסמכים האמיתיים של המשתמש (חשבוניות, קבלות, הצעות מחיר, זיכויים). " +
      "קרא לכלי הזה בכל פעם שהמשתמש מחפש מסמך, שואל מה שלח או למי, מבקש רשימה, " +
      "או שואל על מסמך מסוים. " +
      `מחזיר עד ${SEARCH_LIMIT} מסמכים מהחדש לישן. כל הפרמטרים אופציונליים - ` +
      "קריאה בלי פרמטרים מחזירה את המסמכים האחרונים, וזו התשובה הנכונה ל'מה המסמכים האחרונים שלי'.",
    input_schema: {
      type: "object",
      properties: {
        number: { type: "integer", description: "מספר מסמך מדויק" },
        clientName: { type: "string", description: "שם לקוח, או חלק ממנו" },
        type: {
          type: "string",
          enum: ["receipt", "quote", "proforma", "tax_invoice", "tax_invoice_receipt", "credit_note"],
          description: "סוג המסמך",
        },
        status: {
          type: "string",
          enum: ["draft", "sent", "paid", "cancelled"],
          description: "סטטוס המסמך",
        },
        dateFrom: { type: "string", description: "תאריך התחלה, YYYY-MM-DD" },
        dateTo: { type: "string", description: "תאריך סיום, YYYY-MM-DD" },
        minTotal: { type: "number", description: "סכום מינימלי בשקלים" },
        maxTotal: { type: "number", description: "סכום מקסימלי בשקלים" },
      },
    },
  },
  {
    name: "get_document",
    description:
      "מחזיר את הפרטים המלאים של מסמך אחד, כולל שורות הפריטים. " +
      "השתמש בזה אחרי search_documents כשצריך לראות מה בדיוק היה במסמך.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה המסמך (UUID) מתוך תוצאות החיפוש" } },
      required: ["id"],
    },
  },
  {
    name: "get_income_summary",
    description:
      "מחשב הכנסות אמיתיות לתקופה: סך ההכנסה, מספר המסמכים ופילוח לפי לקוח. " +
      "קרא לזה לכל שאלה על כמה כסף נכנס - 'כמה הכנסתי החודש', 'כמה הכנסתי השנה', " +
      "'מי הלקוח הכי גדול שלי'. חשב את התאריכים בעצמך; אל תשאל את המשתמש. " +
      "סופר רק מסמכים ששולמו ונחשבים הכנסה (קבלה / חשבונית מס / חשבונית מס-קבלה), " +
      "בניכוי זיכויים, בלי כפילויות של מסמכים שהומרו.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "תאריך התחלה, YYYY-MM-DD" },
        dateTo: { type: "string", description: "תאריך סיום, YYYY-MM-DD" },
      },
      required: ["dateFrom", "dateTo"],
    },
  },
  {
    name: "list_clients",
    description:
      "מחזיר את רשימת הלקוחות האמיתית של המשתמש. קרא לזה לשאלות כמו 'מי הלקוחות שלי', " +
      "וגם לפני הכנת טיוטה כדי לזהות לקוח לפי שם חלקי ולקבל את המזהה שלו.",
    input_schema: {
      type: "object",
      properties: { search: { type: "string", description: "חלק משם הלקוח לסינון" } },
    },
  },
  {
    name: "prepare_document_draft",
    description:
      "מכין טיוטת מסמך שהמשתמש יפתח בעורך, יבדוק ויאשר. " +
      "הכלי לא יוצר מסמך ולא מקצה מספר - הוא רק מכין את הטופס. " +
      "השתמש בזה רק אחרי שברור לך סוג המסמך, הלקוח, והשורות.",
    input_schema: {
      type: "object",
      properties: {
        documentType: {
          type: "string",
          enum: ["receipt", "quote", "proforma", "tax_invoice", "tax_invoice_receipt", "credit_note"],
        },
        clientId: { type: "string", description: "מזהה לקוח מתוך list_clients. אם אין לקוח שמור, השאר ריק ומלא clientName." },
        clientName: { type: "string", description: "שם לקוח חופשי, כשאין לקוח שמור במערכת" },
        subject: { type: "string", description: "נושא המסמך" },
        items: {
          type: "array",
          description: "שורות המסמך",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitPrice: { type: "number", description: "מחיר ליחידה בשקלים" },
            },
            required: ["description", "quantity", "unitPrice"],
          },
        },
        notes: { type: "string", description: "הערות למסמך" },
      },
      required: ["documentType", "items"],
    },
  },
];

type ToolResult = { content: string; draft?: unknown };

function money(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Every tool runs through here, and every query is filtered by the caller's
 * own business_id - resolved server-side from the authenticated user, never
 * taken from the model or the request body. The model cannot widen its own
 * scope: a tool argument can only narrow the result set further.
 */
async function runTool(
  admin: SupabaseClient,
  businessId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (name === "search_documents") {
    let q = admin
      .from("documents")
      .select("id, type, number, date, client_name, subject, status, total, currency, converted_to_id")
      .eq("business_id", businessId)
      .order("date", { ascending: false })
      .order("number", { ascending: false })
      .limit(SEARCH_LIMIT);

    if (typeof input.number === "number") q = q.eq("number", input.number);
    if (typeof input.clientName === "string" && input.clientName.trim()) {
      // Escape PostgREST ilike wildcards and the comma/paren filter separators
      // so a crafted client name can't alter the query shape.
      const safe = input.clientName.trim().replace(/[%_,()\\]/g, " ");
      q = q.ilike("client_name", `%${safe}%`);
    }
    if (typeof input.type === "string") q = q.eq("type", input.type);
    if (typeof input.status === "string") q = q.eq("status", input.status);
    if (typeof input.dateFrom === "string") q = q.gte("date", input.dateFrom);
    if (typeof input.dateTo === "string") q = q.lte("date", input.dateTo);
    if (typeof input.minTotal === "number") q = q.gte("total", input.minTotal);
    if (typeof input.maxTotal === "number") q = q.lte("total", input.maxTotal);

    const { data, error } = await q;
    if (error) return { content: `שגיאה בחיפוש: ${error.message}` };
    if (!data?.length) return { content: "לא נמצאו מסמכים התואמים לחיפוש." };

    const rows = data.map((d) => ({
      id: d.id,
      type: DOCUMENT_TYPE_LABELS[d.type as DocumentType] ?? d.type,
      number: d.number,
      date: d.date,
      client: d.client_name,
      subject: d.subject || undefined,
      status: DOCUMENT_STATUS_LABELS[d.status as keyof typeof DOCUMENT_STATUS_LABELS] ?? d.status,
      total: money(d.total),
      currency: d.currency || "ILS",
      converted: !!d.converted_to_id,
    }));
    return { content: JSON.stringify({ count: rows.length, documents: rows }) };
  }

  if (name === "get_document") {
    const id = String(input.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { content: "מזהה מסמך לא תקין." };
    const { data: doc } = await admin
      .from("documents")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();
    if (!doc) return { content: "המסמך לא נמצא." };
    const { data: items } = await admin
      .from("document_items")
      .select("description, quantity, unit_price, total")
      .eq("document_id", id)
      .order("sort_order", { ascending: true });
    return {
      content: JSON.stringify({
        id: doc.id,
        type: DOCUMENT_TYPE_LABELS[doc.type as DocumentType] ?? doc.type,
        number: doc.number,
        date: doc.date,
        client: doc.client_name,
        subject: doc.subject,
        status: DOCUMENT_STATUS_LABELS[doc.status as keyof typeof DOCUMENT_STATUS_LABELS] ?? doc.status,
        subtotal: money(doc.subtotal),
        vat: money(doc.vat),
        total: money(doc.total),
        currency: doc.currency || "ILS",
        paidAt: doc.paid_at,
        notes: doc.notes,
        allocationNumber: doc.allocation_number,
        items: (items || []).map((i) => ({
          description: i.description,
          quantity: money(i.quantity),
          unitPrice: money(i.unit_price),
          total: money(i.total),
        })),
      }),
    };
  }

  if (name === "get_income_summary") {
    const from = String(input.dateFrom || "");
    const to = String(input.dateTo || "");
    const { data, error } = await admin
      .from("documents")
      .select("type, total, client_name, status, converted_to_id")
      .eq("business_id", businessId)
      .gte("date", from)
      .lte("date", to);
    if (error) return { content: `שגיאה בשליפת הנתונים: ${error.message}` };

    // `status === "paid" && isCountableRevenue(d)` - the exact gate every
    // revenue screen in the app uses (dashboard, reports, journal, chart).
    // The paid check applies to credit notes too: an unpaid credit note is not
    // yet a refund, and gating it differently here would make the assistant
    // quote a number that disagrees with the dashboard for the same period.
    const countable = (data || []).filter((d) => {
      if (d.status !== "paid") return false;
      if (d.converted_to_id) return false;
      return d.type === "credit_note" || REVENUE_DOCUMENT_TYPES.includes(d.type as DocumentType);
    });

    let total = 0;
    const byClient = new Map<string, number>();
    for (const d of countable) {
      const amount = d.type === "credit_note" ? -money(d.total) : money(d.total);
      total += amount;
      const key = d.client_name || "ללא לקוח";
      byClient.set(key, (byClient.get(key) || 0) + amount);
    }
    const clients = [...byClient.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([client, amount]) => ({ client, amount: Math.round(amount * 100) / 100 }));

    return {
      content: JSON.stringify({
        period: { from, to },
        total: Math.round(total * 100) / 100,
        documentCount: countable.length,
        topClients: clients,
      }),
    };
  }

  if (name === "list_clients") {
    let q = admin
      .from("clients")
      .select("id, name, email, tax_id")
      .eq("business_id", businessId)
      .order("name")
      .limit(50);
    if (typeof input.search === "string" && input.search.trim()) {
      const safe = input.search.trim().replace(/[%_,()\\]/g, " ");
      q = q.ilike("name", `%${safe}%`);
    }
    const { data, error } = await q;
    if (error) return { content: `שגיאה בשליפת לקוחות: ${error.message}` };
    if (!data?.length) return { content: "לא נמצאו לקוחות." };
    return { content: JSON.stringify({ count: data.length, clients: data }) };
  }

  if (name === "prepare_document_draft") {
    const rawItems = Array.isArray(input.items) ? input.items : [];
    const items = rawItems.slice(0, 30).map((raw) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      return {
        description: String(it.description ?? "").slice(0, 300),
        quantity: money(it.quantity) || 1,
        unitPrice: money(it.unitPrice),
      };
    });
    if (!items.length) return { content: "לא ניתן להכין טיוטה בלי שורות." };

    // The client id is validated against the caller's own clients so a
    // hallucinated or injected id can never pull in another tenant's client.
    let clientId = "";
    let clientName = String(input.clientName ?? "").slice(0, 200);
    const requestedId = String(input.clientId ?? "");
    if (/^[0-9a-f-]{36}$/i.test(requestedId)) {
      const { data: client } = await admin
        .from("clients")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("id", requestedId)
        .maybeSingle();
      if (client) {
        clientId = client.id as string;
        clientName = client.name as string;
      }
    }
    if (!clientId && !clientName) return { content: "חסר לקוח לטיוטה. שאל את המשתמש למי המסמך." };

    const draft = {
      documentType: String(input.documentType || "receipt"),
      clientId,
      clientName,
      subject: String(input.subject ?? "").slice(0, 200),
      notes: String(input.notes ?? "").slice(0, 1000),
      items,
    };
    const sum = items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
    return {
      content: JSON.stringify({
        prepared: true,
        note: "הטיוטה מוכנה והוצגה למשתמש עם כפתור לפתיחה בעורך. הוא עדיין צריך לבדוק ולאשר.",
        summary: { client: clientName, lines: items.length, sum: Math.round(sum * 100) / 100 },
      }),
      draft,
    };
  }

  return { content: `כלי לא מוכר: ${name}` };
}

export async function POST(req: NextRequest) {
  try {
    if (!anthropicKey) {
      return NextResponse.json(
        { ok: false, error: "העוזר החכם לא מוגדר במערכת." },
        { status: 503 },
      );
    }

    const ip = clientIp(req);
    const ipLimit = checkRate({ key: `assistant:ip:${ip}`, max: 20, windowMs: 60_000 });
    if (!ipLimit.ok) {
      return NextResponse.json(
        { ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(ipLimit.resetIn / 1000)) } },
      );
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

    const userLimit = checkRate({ key: `assistant:user:${user.id}`, max: 40, windowMs: 60 * 60_000 });
    if (!userLimit.ok) {
      return NextResponse.json(
        { ok: false, error: "חרגת ממכסת ההודעות השעתית (40 הודעות לשעה)." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(userLimit.resetIn / 1000)) } },
      );
    }

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // The business is resolved from the authenticated user and is the only
    // tenant scope any tool ever sees. Nothing in the request body or the
    // model's tool arguments can change it.
    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!business) {
      return NextResponse.json(
        { ok: false, error: "לא נמצא עסק פעיל בחשבון." },
        { status: 404 },
      );
    }
    const businessId = business.id as string;

    const month = todayInIsrael().slice(0, 7);
    const { data: monthlyCount, error: monthlyErr } = await admin.rpc("increment_assistant_usage", {
      p_user_id: user.id,
      p_month: month,
    });
    if (monthlyErr) {
      console.error("[assistant] monthly usage check failed:", monthlyErr.message);
      // Fail open: a bug in the cap check shouldn't take the feature down.
    } else if ((monthlyCount as number) > MONTHLY_MESSAGE_CAP) {
      return NextResponse.json(
        { ok: false, error: `חרגת ממכסת ההודעות החודשית (${MONTHLY_MESSAGE_CAP} הודעות לחודש).` },
        { status: 429 },
      );
    }

    const body = await req.json();
    const rawHistory = Array.isArray(body.messages) ? body.messages : [];
    const history: Anthropic.MessageParam[] = rawHistory
      .slice(-MAX_HISTORY)
      .filter(
        (m: unknown): m is { role: string; content: string } =>
          !!m &&
          typeof m === "object" &&
          typeof (m as { content?: unknown }).content === "string" &&
          ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant"),
      )
      .map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content.slice(0, 4000),
      }));

    if (!history.length || history[history.length - 1].role !== "user") {
      return NextResponse.json({ ok: false, error: "חסרה הודעה." }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const messages: Anthropic.MessageParam[] = [...history];
    const today = todayInIsrael();
    let draft: unknown = null;
    let answer = "";

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: `${SYSTEM}\n\nהתאריך היום: ${today}.`,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: TOOLS,
        messages,
      });

      const textOut = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (textOut) answer = textOut;

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !toolUses.length) break;

      messages.push({ role: "assistant", content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        try {
          const out = await runTool(
            admin,
            businessId,
            call.name,
            (call.input ?? {}) as Record<string, unknown>,
          );
          if (out.draft) draft = out.draft;
          results.push({ type: "tool_result", tool_use_id: call.id, content: out.content });
        } catch (toolErr) {
          console.error(
            `[assistant] tool ${call.name} failed:`,
            toolErr instanceof Error ? toolErr.message : toolErr,
          );
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "הפעולה נכשלה.",
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }

    return NextResponse.json({
      ok: true,
      reply: answer || "לא הצלחתי להשלים את הבקשה. נסח אותה קצת אחרת.",
      draft,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // Never forward the raw error: Anthropic SDK errors are English and expose
    // account internals (same reasoning as expenses/scan).
    console.error("assistant failed:", msg);
    return NextResponse.json(
      { ok: false, error: "העוזר לא זמין כרגע. נסה שוב בעוד רגע." },
      { status: 500 },
    );
  }
}
