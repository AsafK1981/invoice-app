import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Destructive: wipes ALL business data (documents, items, expenses, clients,
 * products, counters, attachments + storage files, dunning log, notifications,
 * recurring templates in auth metadata). Audit log is kept and gets a
 * `data.cleared` row appended; business profile + tax-authority OAuth +
 * the Auth user itself stay.
 *
 * Safety gates (in order):
 *   1) Bearer auth — must be a real user.
 *   2) Rate limit — 3/hour/user.
 *   3) Body `confirmation` must be a case-insensitive trim match of the
 *      caller's business.name (server-side check; can't be bypassed from
 *      the client even with devtools).
 *   4) Only deletes rows where business_id = the caller's business.
 *
 * Returns a per-resource count of what was deleted and a list of any
 * partial-failure errors — the modal surfaces both to the user.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ipLimit = checkRate({ key: `danger-delete:ip:${ip}`, max: 5, windowMs: 60_000 });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." },
      { status: 429 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const accessToken = authHeader.slice(7);

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Per-user 3/hour cap. Even an angry user shouldn't be able to chain
  // these — every accidental click here is irreversible.
  const userLimit = checkRate({ key: `danger-delete:user:${user.id}`, max: 3, windowMs: 60 * 60_000 });
  if (!userLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "מכסת המחיקות לשעה מולאה. נסה שוב בעוד שעה." },
      { status: 429 },
    );
  }

  let body: { confirmation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const confirmation = String(body.confirmation || "").trim();
  if (!confirmation) {
    return NextResponse.json({ ok: false, error: "חסר אישור" }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: biz } = await admin
    .from("businesses")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!biz) {
    return NextResponse.json({ ok: false, error: "Business not found" }, { status: 404 });
  }
  if (!biz.name || confirmation.toLowerCase() !== biz.name.toLowerCase().trim()) {
    return NextResponse.json(
      { ok: false, error: "שם העסק שהוקלד אינו תואם" },
      { status: 400 },
    );
  }

  const businessId = biz.id as string;
  const deleted: Record<string, number> = {};
  const errors: Array<{ step: string; message: string }> = [];

  async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ step: name, message });
      return null;
    }
  }

  // 1) Collect doc ids first — we need them to clean up child rows + storage.
  const { data: docRows } = await admin
    .from("documents")
    .select("id")
    .eq("business_id", businessId);
  const docIds = (docRows || []).map((r) => r.id as string);
  deleted.documents = docIds.length;

  // 2) Notifications scoped to this business.
  await step("notifications", async () => {
    const { count } = await admin
      .from("notifications")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    deleted.notifications = count || 0;
  });

  // 3) Dunning log (FK on documents would CASCADE, but explicit is clearer).
  await step("dunning_log", async () => {
    const { count } = await admin
      .from("dunning_log")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    deleted.dunning_log = count || 0;
  });

  // 4) Document attachments — both DB rows and storage objects.
  let attachmentPaths: string[] = [];
  await step("document_attachments_db", async () => {
    if (docIds.length === 0) {
      deleted.document_attachments = 0;
      return;
    }
    const { data: rows } = await admin
      .from("document_attachments")
      .select("file_path")
      .in("document_id", docIds);
    attachmentPaths = (rows || [])
      .map((r) => r.file_path as string)
      .filter(Boolean);
    const { count } = await admin
      .from("document_attachments")
      .delete({ count: "exact" })
      .in("document_id", docIds);
    deleted.document_attachments = count || 0;
  });

  // 5) Document items (FK on documents would CASCADE; explicit anyway).
  await step("document_items", async () => {
    if (docIds.length === 0) {
      deleted.document_items = 0;
      return;
    }
    const { count } = await admin
      .from("document_items")
      .delete({ count: "exact" })
      .in("document_id", docIds);
    deleted.document_items = count || 0;
  });

  // 6) The documents themselves.
  await step("documents", async () => {
    const { count } = await admin
      .from("documents")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    deleted.documents = count || 0;
  });

  // 7) Expenses — also capture receipt paths first so we can purge storage.
  let receiptPaths: string[] = [];
  await step("expenses", async () => {
    const { data: rows } = await admin
      .from("expenses")
      .select("receipt_path")
      .eq("business_id", businessId);
    receiptPaths = (rows || [])
      .map((r) => r.receipt_path as string)
      .filter(Boolean);
    const { count } = await admin
      .from("expenses")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    deleted.expenses = count || 0;
  });

  // 8-10) Clients, products, counters.
  await step("clients", async () => {
    const { count } = await admin
      .from("clients")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    deleted.clients = count || 0;
  });
  await step("products", async () => {
    const { count } = await admin
      .from("products")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    deleted.products = count || 0;
  });
  await step("document_counters", async () => {
    const { count } = await admin
      .from("document_counters")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    deleted.document_counters = count || 0;
  });

  // 11) Storage cleanup — delete in chunks so we don't blow past Supabase's
  // per-call limit.
  await step("storage_attachments", async () => {
    if (attachmentPaths.length === 0) {
      deleted.storage_attachments = 0;
      return;
    }
    let removed = 0;
    for (let i = 0; i < attachmentPaths.length; i += 100) {
      const chunk = attachmentPaths.slice(i, i + 100);
      const { data, error } = await admin.storage.from("attachments").remove(chunk);
      if (error) throw new Error(`attachments remove failed: ${error.message}`);
      removed += data?.length || 0;
    }
    deleted.storage_attachments = removed;
  });

  await step("storage_expense_receipts", async () => {
    if (receiptPaths.length === 0) {
      deleted.storage_expense_receipts = 0;
      return;
    }
    let removed = 0;
    for (let i = 0; i < receiptPaths.length; i += 100) {
      const chunk = receiptPaths.slice(i, i + 100);
      const { data, error } = await admin.storage.from("expense-receipts").remove(chunk);
      if (error) throw new Error(`expense-receipts remove failed: ${error.message}`);
      removed += data?.length || 0;
    }
    deleted.storage_expense_receipts = removed;
  });

  // 12) Recurring templates live in user_metadata.
  await step("recurring_templates", async () => {
    const existing = (user.user_metadata?.recurring_templates as unknown[] | undefined) || [];
    if (existing.length === 0) {
      deleted.recurring_templates = 0;
      return;
    }
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, recurring_templates: [] },
    });
    if (error) throw new Error(error.message);
    deleted.recurring_templates = existing.length;
  });

  // 13) Append the data.cleared audit entry — survives the wipe.
  await step("audit_log_append", async () => {
    await admin.from("audit_log").insert({
      business_id: businessId,
      action: "data.cleared",
      target_type: "all",
      target_label: "כל הנתונים",
      payload: { deleted, errors },
    });
  });

  return NextResponse.json({
    ok: errors.length === 0,
    deleted,
    errors,
    businessName: biz.name,
  });
}
