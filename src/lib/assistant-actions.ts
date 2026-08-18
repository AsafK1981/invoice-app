import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { normalizeName } from "@/lib/client-picker";
import { searchTerms } from "@/lib/ilike-search";
import { todayInIsrael } from "@/lib/date";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS } from "@/lib/types";
import type { DocumentType } from "@/lib/types";

/**
 * The assistant's WRITE tools - everything the app lets a user do by hand on
 * the expenses, clients and products screens, plus marking a document paid.
 *
 * Execution model, decided 2026-08-17 (Asaf: "the assistant should be able
 * to do everything the app can do, not just prepare document drafts"):
 *
 * - Adds and updates run immediately, server-side, scoped to the caller's own
 *   business_id (resolved from the auth token, never from the model). They
 *   are reversible from the app, so no confirmation step stands between the
 *   user's sentence and the row.
 * - Deletes are NOT executed here. The tool verifies the row exists and hands
 *   the widget a `pendingDelete`; the widget shows a red button and the
 *   delete runs client-side, through the same store the screen uses, only on
 *   the user's click. Model output - and any text that reached the model from
 *   the database - can never remove data by itself.
 * - Documents themselves stay in the editor (prepare_document_draft in the
 *   route): issuing assigns a legal number and may need a Tax Authority
 *   allocation, and the user must see it before it exists.
 *
 * Every write is audited (`audit_log`, payload.via = "assistant") so the
 * settings-page log shows what the assistant did, same as manual actions.
 */

export type ActionEntity = "expense" | "client" | "product" | "document";

/** A write that already happened. The widget shows it as a "done" chip. */
export type AssistantAction = {
  kind: "created" | "updated";
  entity: ActionEntity;
  id: string;
  label: string;
  /** Where the user can see the row. */
  href: string;
};

/** A delete the user still has to click. */
export type PendingDelete = {
  entity: Exclude<ActionEntity, "document">;
  id: string;
  label: string;
};

/**
 * An update the user still has to click. Used for a client's contact fields
 * (email / phone): those decide where the next invoice goes, so a single
 * sentence - or text injected through a document - must not be able to move
 * them silently. Asaf asked for this gate on 2026-08-18.
 */
export type PendingUpdate = {
  entity: "client";
  id: string;
  /** Who is being changed, e.g. the client's name. */
  label: string;
  /** Human-readable per-field lines the widget shows before the button. */
  changes: { field: string; from: string; to: string }[];
  /** Column patch the widget applies (RLS-scoped, on click). */
  patch: Record<string, string | null>;
};

export type ActionToolResult = {
  content: string;
  action?: AssistantAction;
  pendingDelete?: PendingDelete;
  pendingUpdate?: PendingUpdate;
};

/** Client columns whose change goes through a confirm button, not straight to the DB. */
const CLIENT_GATED_COLUMNS: Record<string, string> = { email: "מייל", phone: "טלפון" };

/** Categories the app suggests. The column itself is free text. */
const COMMON_EXPENSE_CATEGORIES = ["תוכנה", "ציוד", "שיווק", "משרד", "שירותים מקצועיים", "נסיעות", "אחר"];

const LIST_LIMIT = 15;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clientProps = {
  name: { type: "string", description: "שם הלקוח" },
  taxId: { type: "string", description: "ח.פ / ת.ז / עוסק מורשה" },
  email: { type: "string" },
  phone: { type: "string" },
  address: { type: "string" },
  notes: { type: "string", description: "הערות פנימיות על הלקוח" },
} as const;

const productProps = {
  name: { type: "string", description: "שם המוצר או השירות" },
  price: { type: "number", description: "מחיר ליחידה בשקלים" },
  unit: { type: "string", description: "יחידת מידה: שעה / יחידה / פרויקט / חודש. ברירת מחדל: יחידה" },
  description: { type: "string", description: "תיאור קצר" },
} as const;

const expenseProps = {
  supplier: { type: "string", description: "שם הספק / בית העסק" },
  amount: { type: "number", description: "הסכום ששולם בשקלים, כולל מע\"מ" },
  date: { type: "string", description: "תאריך ההוצאה YYYY-MM-DD. אם המשתמש לא ציין - היום" },
  category: {
    type: "string",
    description: `קטגוריה. עדיף אחת מאלה: ${COMMON_EXPENSE_CATEGORIES.join(" / ")}. אם לא ברור - אחר`,
  },
  vatAmount: { type: "number", description: "רכיב המע\"מ בשקלים, רק אם המשתמש ציין. אחרת 0" },
  description: { type: "string", description: "תיאור קצר, מה נקנה" },
} as const;

export const ACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_products",
    description:
      "מחזיר את המוצרים והשירותים השמורים של המשתמש (שם, מחיר, יחידה). קרא לזה לשאלות כמו " +
      "'מה המוצרים שלי', 'כמה אני לוקח על שעת ייעוץ', לפני עדכון או מחיקה של מוצר, " +
      "ולפני הכנת טיוטה כדי להשתמש במחיר השמור.",
    input_schema: {
      type: "object",
      properties: { search: { type: "string", description: "חלק משם המוצר לסינון" } },
    },
  },
  {
    name: "list_expenses",
    description:
      "מחזיר הוצאות בודדות (עם מזהה) לפי סינון - ספק, קטגוריה, טווח תאריכים, סכום. " +
      "קרא לזה כשהמשתמש מחפש הוצאה מסוימת ('מה קניתי בסופר-פארם', 'ההוצאות מהשבוע'), " +
      "ולפני עדכון או מחיקה של הוצאה כדי לקבל את המזהה שלה. " +
      "לסכומים כוללים לתקופה השתמש ב-get_expense_summary.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "חלק משם הספק או מהתיאור" },
        category: { type: "string" },
        dateFrom: { type: "string", description: "YYYY-MM-DD" },
        dateTo: { type: "string", description: "YYYY-MM-DD" },
        minAmount: { type: "number" },
        maxAmount: { type: "number" },
      },
    },
  },
  {
    name: "add_expense",
    description:
      "רושם הוצאה חדשה בספר ההוצאות של המשתמש - מיד, בלי שלב אישור. " +
      "'תוסיף הוצאה של 120 שקל בסופר-פארם', 'קניתי מקלדת ב-250', 'שילמתי 89 לזום'. " +
      "אם חסר ספק או סכום - שאל. את התאריך אל תשאל: היום, אלא אם נאמר אחרת.",
    input_schema: {
      type: "object",
      properties: expenseProps,
      required: ["supplier", "amount"],
    },
  },
  {
    name: "update_expense",
    description:
      "מעדכן הוצאה קיימת. שלח רק את השדות שמשתנים. את המזהה קח מ-list_expenses.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה ההוצאה (UUID)" }, ...expenseProps },
      required: ["id"],
    },
  },
  {
    name: "delete_expense",
    description:
      "מבקש למחוק הוצאה. המחיקה לא מתבצעת מיד: המשתמש מקבל כפתור אישור וצריך ללחוץ עליו. " +
      "את המזהה קח מ-list_expenses. אם יש כמה התאמות - שאל איזו.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה ההוצאה (UUID)" } },
      required: ["id"],
    },
  },
  {
    name: "add_client",
    description:
      "מוסיף לקוח חדש לרשימת הלקוחות - מיד. 'תוסיף לקוח בשם דני כהן', 'לקוח חדש: סטודיו אור, " +
      "מייל or@studio.co.il'. אם כבר קיים לקוח באותו שם הכלי לא יוצר כפילות אלא מחזיר את הקיים.",
    input_schema: {
      type: "object",
      properties: clientProps,
      required: ["name"],
    },
  },
  {
    name: "update_client",
    description:
      "מעדכן פרטי לקוח קיים (שם, ח.פ, מייל, טלפון, כתובת, הערות). שלח רק את השדות שמשתנים. " +
      "את המזהה קח מ-list_clients. שינוי מייל או טלפון לא מתבצע מיד: המשתמש מקבל כפתור אישור " +
      "עם הערך הישן והחדש וצריך ללחוץ עליו (כמו מחיקה).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה הלקוח (UUID)" }, ...clientProps },
      required: ["id"],
    },
  },
  {
    name: "delete_client",
    description:
      "מבקש למחוק לקוח. המחיקה לא מתבצעת מיד: המשתמש מקבל כפתור אישור וצריך ללחוץ עליו. " +
      "המסמכים של הלקוח לא נמחקים. את המזהה קח מ-list_clients.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה הלקוח (UUID)" } },
      required: ["id"],
    },
  },
  {
    name: "add_product",
    description:
      "מוסיף מוצר או שירות למחירון - מיד. 'תוסיף שירות: שעת ייעוץ 350 שקל', " +
      "'מוצר חדש בשם עיצוב לוגו במחיר 1500'. אם חסר מחיר - שאל. " +
      "אם כבר קיים מוצר באותו שם הכלי מחזיר את הקיים במקום ליצור כפילות.",
    input_schema: {
      type: "object",
      properties: productProps,
      required: ["name", "price"],
    },
  },
  {
    name: "update_product",
    description:
      "מעדכן מוצר קיים (שם, מחיר, יחידה, תיאור). 'תעלה את המחיר של שעת ייעוץ ל-400'. " +
      "שלח רק את השדות שמשתנים. את המזהה קח מ-list_products.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה המוצר (UUID)" }, ...productProps },
      required: ["id"],
    },
  },
  {
    name: "delete_product",
    description:
      "מבקש למחוק מוצר מהמחירון. המחיקה לא מתבצעת מיד: המשתמש מקבל כפתור אישור וצריך ללחוץ עליו. " +
      "את המזהה קח מ-list_products.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה המוצר (UUID)" } },
      required: ["id"],
    },
  },
  {
    name: "set_document_status",
    description:
      "מסמן מסמך שהופק כשולם ('דני שילם את חשבונית 87', 'סמן את הקבלה האחרונה כשולמה'), " +
      "או מחזיר מסמך ששולם למצב 'נשלח' אם סומן בטעות. עובד רק על מסמכים שהופקו (לא טיוטות, " +
      "לא מבוטלים). את המזהה קח מ-search_documents.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "מזהה המסמך (UUID)" },
        status: { type: "string", enum: ["paid", "sent"], description: "paid = שולם, sent = נשלח (טרם שולם)" },
      },
      required: ["id", "status"],
    },
  },
];

/** Names of the tools this module owns, for the route's dispatcher. */
export const ACTION_TOOL_NAMES = new Set(ACTION_TOOLS.map((t) => t.name));

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** YYYY-MM-DD -> DD/MM/YYYY, the app's display format. */
function heDate(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
}

function money(n: number): string {
  return `${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })} ₪`;
}

/**
 * Fire-and-forget audit row, mirroring lib/audit-log's client-side logAudit.
 * Same table, same shape, plus `via: "assistant"` so the settings log can tell
 * the two apart.
 */
async function audit(
  admin: SupabaseClient,
  businessId: string,
  action: string,
  targetType: ActionEntity,
  targetId: string,
  targetLabel: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    business_id: businessId,
    action,
    target_type: targetType,
    target_id: targetId,
    target_label: targetLabel,
    payload: { ...payload, via: "assistant" },
  });
  if (error) console.warn("[assistant] audit insert failed:", error.message);
}

/**
 * Runs one of ACTION_TOOLS. Returns null for a tool this module does not own so
 * the route can fall through to its read tools. `asData` is the route's
 * data-boundary wrapper, passed in so there is exactly one definition of it.
 */
export async function runActionTool(
  admin: SupabaseClient,
  businessId: string,
  name: string,
  input: Record<string, unknown>,
  asData: (payload: unknown) => string,
): Promise<ActionToolResult | null> {
  if (!ACTION_TOOL_NAMES.has(name)) return null;

  // ---------------------------------------------------------------- reads
  if (name === "list_products") {
    let q = admin
      .from("products")
      .select("id, name, description, price, unit")
      .eq("business_id", businessId)
      .order("name")
      .limit(50);
    const search = str(input.search, 100);
    if (search) for (const term of searchTerms(search)) q = q.ilike("name", `%${term}%`);
    const { data, error } = await q;
    if (error) {
      console.error("[assistant] list_products failed:", error.message);
      return { content: "שגיאה בשליפת מוצרים." };
    }
    if (!data?.length) return { content: "לא נמצאו מוצרים." };
    return { content: asData({ count: data.length, products: data }) };
  }

  if (name === "list_expenses") {
    let q = admin
      .from("expenses")
      .select("id, date, category, supplier, amount, vat_amount, description")
      .eq("business_id", businessId)
      .order("date", { ascending: false })
      .limit(LIST_LIMIT);
    const search = str(input.search, 100);
    if (search) {
      for (const term of searchTerms(search)) {
        q = q.or(`supplier.ilike.%${term}%,description.ilike.%${term}%`);
      }
    }
    const category = str(input.category, 100);
    if (category) q = q.ilike("category", `%${category}%`);
    if (typeof input.dateFrom === "string" && DATE_RE.test(input.dateFrom)) q = q.gte("date", input.dateFrom);
    if (typeof input.dateTo === "string" && DATE_RE.test(input.dateTo)) q = q.lte("date", input.dateTo);
    const min = num(input.minAmount);
    const max = num(input.maxAmount);
    if (min !== undefined) q = q.gte("amount", min);
    if (max !== undefined) q = q.lte("amount", max);
    const { data, error } = await q;
    if (error) {
      console.error("[assistant] list_expenses failed:", error.message);
      return { content: "שגיאה בשליפת הוצאות." };
    }
    if (!data?.length) return { content: "לא נמצאו הוצאות התואמות לחיפוש." };
    return {
      content: asData({
        count: data.length,
        expenses: data.map((e) => ({
          id: e.id,
          date: e.date,
          supplier: e.supplier,
          category: e.category,
          amount: Number(e.amount) || 0,
          vatAmount: Number(e.vat_amount) || 0,
          description: e.description || undefined,
        })),
      }),
    };
  }

  // ------------------------------------------------------------- expenses
  if (name === "add_expense") {
    const supplier = str(input.supplier, 200);
    const amount = num(input.amount);
    if (!supplier) return { content: "חסר שם ספק. שאל את המשתמש." };
    if (amount === undefined || amount <= 0) return { content: "חסר סכום תקין. שאל את המשתמש." };
    const date = typeof input.date === "string" && DATE_RE.test(input.date) ? input.date : todayInIsrael();
    const vat = num(input.vatAmount);
    const row = {
      id: randomUUID(),
      business_id: businessId,
      date,
      category: str(input.category, 100) ?? "אחר",
      supplier,
      amount,
      vat_amount: vat !== undefined && vat >= 0 && vat <= amount ? vat : 0,
      description: str(input.description, 500) ?? null,
    };
    const { error } = await admin.from("expenses").insert(row);
    if (error) {
      console.error("[assistant] add_expense failed:", error.message);
      return { content: "שמירת ההוצאה נכשלה." };
    }
    const label = `${supplier} · ${money(amount)}`;
    await audit(admin, businessId, "expense.created", "expense", row.id, label, {
      category: row.category,
      amount,
      date,
    });
    return {
      content: JSON.stringify({ done: true, note: "ההוצאה נרשמה והוצגה למשתמש כפעולה שבוצעה.", expense: row }),
      action: { kind: "created", entity: "expense", id: row.id, label: `הוצאה נוספה: ${label}`, href: "/expenses" },
    };
  }

  if (name === "update_expense") {
    const id = String(input.id ?? "");
    if (!UUID_RE.test(id)) return { content: "מזהה הוצאה לא תקין. קרא קודם ל-list_expenses." };
    const { data: existing } = await admin
      .from("expenses")
      .select("id, supplier, amount, category, date")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();
    if (!existing) return { content: "ההוצאה לא נמצאה." };

    const patch: Record<string, unknown> = {};
    const supplier = str(input.supplier, 200);
    if (supplier) patch.supplier = supplier;
    const amount = num(input.amount);
    if (amount !== undefined && amount > 0) patch.amount = amount;
    if (typeof input.date === "string" && DATE_RE.test(input.date)) patch.date = input.date;
    const category = str(input.category, 100);
    if (category) patch.category = category;
    const vat = num(input.vatAmount);
    if (vat !== undefined && vat >= 0) patch.vat_amount = vat;
    if (input.description !== undefined) patch.description = str(input.description, 500) ?? null;
    if (!Object.keys(patch).length) return { content: "לא צוין שום שדה לעדכון." };

    const { error } = await admin.from("expenses").update(patch).eq("business_id", businessId).eq("id", id);
    if (error) {
      console.error("[assistant] update_expense failed:", error.message);
      return { content: "העדכון נכשל." };
    }
    const finalSupplier = (patch.supplier as string) ?? (existing.supplier as string);
    const finalAmount = (patch.amount as number) ?? Number(existing.amount);
    const label = `${finalSupplier} · ${money(finalAmount)}`;
    await audit(admin, businessId, "expense.updated", "expense", id, label, { changed: Object.keys(patch) });
    return {
      content: JSON.stringify({ done: true, updated: Object.keys(patch) }),
      action: { kind: "updated", entity: "expense", id, label: `הוצאה עודכנה: ${label}`, href: "/expenses" },
    };
  }

  if (name === "delete_expense") {
    const id = String(input.id ?? "");
    if (!UUID_RE.test(id)) return { content: "מזהה הוצאה לא תקין. קרא קודם ל-list_expenses." };
    const { data } = await admin
      .from("expenses")
      .select("id, supplier, amount, date")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();
    if (!data) return { content: "ההוצאה לא נמצאה." };
    const label = `${data.supplier} · ${money(Number(data.amount))} · ${heDate(data.date)}`;
    return {
      content: JSON.stringify({
        pending: true,
        note: "הוצג למשתמש כפתור אישור מחיקה. ההוצאה עדיין לא נמחקה - אמור לו ללחוץ על הכפתור כדי למחוק.",
        expense: label,
      }),
      pendingDelete: { entity: "expense", id, label },
    };
  }

  // -------------------------------------------------------------- clients
  if (name === "add_client") {
    const clientName = str(input.name, 200);
    if (!clientName) return { content: "חסר שם לקוח. שאל את המשתמש." };
    const wanted = normalizeName(clientName);
    const { data: all } = await admin.from("clients").select("id, name").eq("business_id", businessId).limit(1000);
    const dup = (all ?? []).find((c) => normalizeName(c.name as string) === wanted);
    if (dup) {
      return {
        content: JSON.stringify({
          done: false,
          note: "כבר קיים לקוח בשם הזה. לא נוצרה כפילות. אם המשתמש רוצה לעדכן פרטים - השתמש ב-update_client.",
          existing: dup,
        }),
      };
    }
    const row = {
      id: randomUUID(),
      business_id: businessId,
      name: clientName,
      tax_id: str(input.taxId, 50) ?? null,
      email: str(input.email, 200) ?? null,
      phone: str(input.phone, 50) ?? null,
      address: str(input.address, 300) ?? null,
      notes: str(input.notes, 1000) ?? null,
    };
    const { error } = await admin.from("clients").insert(row);
    if (error) {
      console.error("[assistant] add_client failed:", error.message);
      return { content: "שמירת הלקוח נכשלה." };
    }
    await audit(admin, businessId, "client.created", "client", row.id, clientName);
    return {
      content: JSON.stringify({ done: true, note: "הלקוח נוסף והוצג למשתמש כפעולה שבוצעה.", client: row }),
      action: { kind: "created", entity: "client", id: row.id, label: `לקוח נוסף: ${clientName}`, href: `/clients/${row.id}` },
    };
  }

  if (name === "update_client") {
    const id = String(input.id ?? "");
    if (!UUID_RE.test(id)) return { content: "מזהה לקוח לא תקין. קרא קודם ל-list_clients." };
    const { data: existing } = await admin
      .from("clients")
      .select("id, name, email, phone")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();
    if (!existing) return { content: "הלקוח לא נמצא." };

    const patch: Record<string, string | null> = {};
    const nm = str(input.name, 200);
    if (nm) patch.name = nm;
    for (const [key, col, max] of [
      ["taxId", "tax_id", 50],
      ["email", "email", 200],
      ["phone", "phone", 50],
      ["address", "address", 300],
      ["notes", "notes", 1000],
    ] as const) {
      if (input[key] !== undefined) patch[col] = str(input[key], max) ?? null;
    }
    if (!Object.keys(patch).length) return { content: "לא צוין שום שדה לעדכון." };

    // Contact fields are gated: nothing in this request is applied here - the
    // whole patch (contact and any other field sent with it) waits for the
    // user's click, so the confirmation shows exactly what will change.
    const gated = Object.keys(patch).filter((c) => c in CLIENT_GATED_COLUMNS && (patch[c] ?? "") !== ((existing as Record<string, unknown>)[c] ?? ""));
    if (gated.length) {
      const changes = gated.map((c) => ({
        field: CLIENT_GATED_COLUMNS[c],
        from: String((existing as Record<string, unknown>)[c] ?? "") || "(ריק)",
        to: patch[c] ?? "(ריק)",
      }));
      const others = Object.keys(patch).filter((c) => !(c in CLIENT_GATED_COLUMNS));
      return {
        content: JSON.stringify({
          pending: true,
          note: "שינוי מייל/טלפון דורש אישור בלחיצה. הוצג למשתמש כפתור עם הערך הישן והחדש - שום דבר עדיין לא השתנה. אמור לו ללחוץ כדי לאשר.",
          client: existing.name,
          changes,
          alsoInSameClick: others,
        }),
        pendingUpdate: { entity: "client", id, label: existing.name as string, changes, patch },
      };
    }

    const { error } = await admin.from("clients").update(patch).eq("business_id", businessId).eq("id", id);
    if (error) {
      console.error("[assistant] update_client failed:", error.message);
      return { content: "העדכון נכשל." };
    }
    const finalName = (patch.name as string) ?? (existing.name as string);
    await audit(admin, businessId, "client.updated", "client", id, finalName, { changed: Object.keys(patch) });
    return {
      content: JSON.stringify({ done: true, updated: Object.keys(patch) }),
      action: { kind: "updated", entity: "client", id, label: `לקוח עודכן: ${finalName}`, href: `/clients/${id}` },
    };
  }

  if (name === "delete_client") {
    const id = String(input.id ?? "");
    if (!UUID_RE.test(id)) return { content: "מזהה לקוח לא תקין. קרא קודם ל-list_clients." };
    const { data } = await admin
      .from("clients")
      .select("id, name")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();
    if (!data) return { content: "הלקוח לא נמצא." };
    return {
      content: JSON.stringify({
        pending: true,
        note: "הוצג למשתמש כפתור אישור מחיקה. הלקוח עדיין לא נמחק - אמור לו ללחוץ על הכפתור כדי למחוק. המסמכים שלו יישארו.",
        client: data.name,
      }),
      pendingDelete: { entity: "client", id, label: data.name as string },
    };
  }

  // ------------------------------------------------------------- products
  if (name === "add_product") {
    const productName = str(input.name, 200);
    const price = num(input.price);
    if (!productName) return { content: "חסר שם מוצר. שאל את המשתמש." };
    if (price === undefined || price < 0) return { content: "חסר מחיר תקין. שאל את המשתמש." };
    const wanted = normalizeName(productName);
    const { data: all } = await admin.from("products").select("id, name, price, unit").eq("business_id", businessId).limit(1000);
    const dup = (all ?? []).find((p) => normalizeName(p.name as string) === wanted);
    if (dup) {
      return {
        content: JSON.stringify({
          done: false,
          note: "כבר קיים מוצר בשם הזה. לא נוצרה כפילות. אם המשתמש רוצה לשנות מחיר - השתמש ב-update_product.",
          existing: dup,
        }),
      };
    }
    const row = {
      id: randomUUID(),
      business_id: businessId,
      name: productName,
      description: str(input.description, 500) ?? null,
      price,
      unit: str(input.unit, 50) ?? "יחידה",
    };
    const { error } = await admin.from("products").insert(row);
    if (error) {
      console.error("[assistant] add_product failed:", error.message);
      return { content: "שמירת המוצר נכשלה." };
    }
    const label = `${productName} · ${money(price)} ל${row.unit}`;
    await audit(admin, businessId, "product.created", "product", row.id, productName, { price, unit: row.unit });
    return {
      content: JSON.stringify({ done: true, note: "המוצר נוסף והוצג למשתמש כפעולה שבוצעה.", product: row }),
      action: { kind: "created", entity: "product", id: row.id, label: `מוצר נוסף: ${label}`, href: "/products" },
    };
  }

  if (name === "update_product") {
    const id = String(input.id ?? "");
    if (!UUID_RE.test(id)) return { content: "מזהה מוצר לא תקין. קרא קודם ל-list_products." };
    const { data: existing } = await admin
      .from("products")
      .select("id, name, price, unit")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();
    if (!existing) return { content: "המוצר לא נמצא." };

    const patch: Record<string, unknown> = {};
    const nm = str(input.name, 200);
    if (nm) patch.name = nm;
    const price = num(input.price);
    if (price !== undefined && price >= 0) patch.price = price;
    const unit = str(input.unit, 50);
    if (unit) patch.unit = unit;
    if (input.description !== undefined) patch.description = str(input.description, 500) ?? null;
    if (!Object.keys(patch).length) return { content: "לא צוין שום שדה לעדכון." };

    const { error } = await admin.from("products").update(patch).eq("business_id", businessId).eq("id", id);
    if (error) {
      console.error("[assistant] update_product failed:", error.message);
      return { content: "העדכון נכשל." };
    }
    const finalName = (patch.name as string) ?? (existing.name as string);
    const finalPrice = (patch.price as number) ?? Number(existing.price);
    const finalUnit = (patch.unit as string) ?? (existing.unit as string);
    const label = `${finalName} · ${money(finalPrice)} ל${finalUnit}`;
    await audit(admin, businessId, "product.updated", "product", id, finalName, { changed: Object.keys(patch) });
    return {
      content: JSON.stringify({ done: true, updated: Object.keys(patch) }),
      action: { kind: "updated", entity: "product", id, label: `מוצר עודכן: ${label}`, href: "/products" },
    };
  }

  if (name === "delete_product") {
    const id = String(input.id ?? "");
    if (!UUID_RE.test(id)) return { content: "מזהה מוצר לא תקין. קרא קודם ל-list_products." };
    const { data } = await admin
      .from("products")
      .select("id, name, price, unit")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();
    if (!data) return { content: "המוצר לא נמצא." };
    const label = `${data.name} · ${money(Number(data.price))} ל${data.unit}`;
    return {
      content: JSON.stringify({
        pending: true,
        note: "הוצג למשתמש כפתור אישור מחיקה. המוצר עדיין לא נמחק - אמור לו ללחוץ על הכפתור כדי למחוק.",
        product: label,
      }),
      pendingDelete: { entity: "product", id, label },
    };
  }

  // ------------------------------------------------------------ documents
  if (name === "set_document_status") {
    const id = String(input.id ?? "");
    const status = input.status === "paid" ? "paid" : input.status === "sent" ? "sent" : null;
    if (!UUID_RE.test(id)) return { content: "מזהה מסמך לא תקין. קרא קודם ל-search_documents." };
    if (!status) return { content: "סטטוס לא נתמך. אפשר רק paid או sent." };
    const { data: doc } = await admin
      .from("documents")
      .select("id, type, number, client_name, client_id, status")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();
    if (!doc) return { content: "המסמך לא נמצא." };
    const from = String(doc.status);
    if (from === status) return { content: `המסמך כבר במצב הזה (${DOCUMENT_STATUS_LABELS[status]}).` };
    if (from !== "sent" && from !== "paid") {
      return {
        content: `אי אפשר לשנות סטטוס למסמך במצב "${DOCUMENT_STATUS_LABELS[from as keyof typeof DOCUMENT_STATUS_LABELS] ?? from}". רק מסמכים שהופקו (נשלח / שולם) ניתנים לסימון.`,
      };
    }
    // Same write the app's "סמן כשולם" button does (document-store.updateDocumentStatus).
    const { data: updated, error } = await admin
      .from("documents")
      .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null })
      .eq("business_id", businessId)
      .eq("id", id)
      .select("id");
    if (error) {
      console.error("[assistant] set_document_status failed:", error.message);
      return { content: "עדכון הסטטוס נכשל." };
    }
    if (!updated?.length) return { content: "עדכון הסטטוס לא עבר." };
    const typeLabel = DOCUMENT_TYPE_LABELS[doc.type as DocumentType] ?? String(doc.type);
    const label = `${typeLabel} #${doc.number} · ${doc.client_name}`;
    await audit(admin, businessId, "document.status_changed", "document", id, label, {
      from: DOCUMENT_STATUS_LABELS[from as keyof typeof DOCUMENT_STATUS_LABELS] ?? from,
      to: DOCUMENT_STATUS_LABELS[status],
      clientId: doc.client_id ?? null,
      clientName: doc.client_name,
    });
    return {
      content: JSON.stringify({ done: true, status: DOCUMENT_STATUS_LABELS[status] }),
      action: {
        kind: "updated",
        entity: "document",
        id,
        label: `${label} סומן: ${DOCUMENT_STATUS_LABELS[status]}`,
        href: `/documents/${id}`,
      },
    };
  }

  return { content: `כלי לא מוכר: ${name}` };
}
