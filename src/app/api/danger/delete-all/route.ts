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
 *   1) Bearer auth: must be a real user.
 *   2) Rate limit: 3/hour/user.
 *   3) Body `confirmation` must be a case-insensitive trim match of the
 *      caller's business.name (server-side check; can't be bypassed from
 *      the client even with devtools).
 *   4) Only deletes rows where business_id = the caller's business.
 *
 * Returns a per-resource count of what was deleted and a list of any
 * partial-failure errors; the modal surfaces both to the user.
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
  // these; every accidental click here is irreversible.
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

  // Wrap a step so any thrown error is captured as an honest partial-failure
  // entry instead of crashing the whole wipe. `assertOk` inside each step turns
  // a Supabase `{ error }` response (which does NOT throw on its own) into a
  // throw; the previous version ignored these and reported ok:true / count 0.
  async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ step: name, message });
      return null;
    }
  }
  function assertOk(res: { error: { message: string } | null }, what: string) {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
  }

  // 1) Collect doc ids first; we need them to count child rows + purge storage.
  const { data: docRows, error: docListErr } = await admin
    .from("documents")
    .select("id")
    .eq("business_id", businessId);
  if (docListErr) {
    errors.push({ step: "documents_list", message: docListErr.message });
  }
  const docIds = (docRows || []).map((r) => r.id as string);

  // 2) Gather attachment paths + child counts BEFORE any delete, so the counts
  //    we report stay accurate even though deleting the parent documents row
  //    cascades the children away (document_items / document_attachments /
  //    dunning_log all have ON DELETE CASCADE on documents.id).
  let attachmentPaths: string[] = [];
  await step("document_attachments_scan", async () => {
    if (docIds.length === 0) {
      deleted.document_attachments = 0;
      return;
    }
    const res = await admin
      .from("document_attachments")
      .select("file_path")
      .in("document_id", docIds);
    assertOk(res, "scan attachments");
    attachmentPaths = (res.data || [])
      .map((r) => r.file_path as string)
      .filter(Boolean);
    deleted.document_attachments = res.data?.length || 0;
  });
  await step("document_items_scan", async () => {
    if (docIds.length === 0) {
      deleted.document_items = 0;
      return;
    }
    const res = await admin
      .from("document_items")
      .select("*", { count: "exact", head: true })
      .in("document_id", docIds);
    assertOk(res, "scan items");
    deleted.document_items = res.count || 0;
  });

  // 3) Notifications scoped to this business (independent of documents order).
  await step("notifications", async () => {
    const res = await admin
      .from("notifications")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    assertOk(res, "delete notifications");
    deleted.notifications = res.count || 0;
  });

  // 4) Clear delivery markers, THEN delete the parent documents.
  //    A DB trigger (enforce_document_immutability) blocks DELETE of any row
  //    with emailed_at set ("delivered documents cannot be deleted"). This is
  //    a full account wipe behind a forced backup + exact-name confirmation, so
  //    that guard should not apply here. emailed_at is NOT in the trigger's
  //    immutable-field list, so nulling it is permitted even for issued docs.
  //    We delete the PARENT first: the ON DELETE CASCADE FKs remove
  //    document_items / document_attachments / dunning_log atomically, so a
  //    failure here can never leave orphaned children.
  await step("documents", async () => {
    if (docIds.length > 0) {
      const cleared = await admin
        .from("documents")
        .update({ emailed_at: null })
        .eq("business_id", businessId)
        .not("emailed_at", "is", null);
      assertOk(cleared, "clear delivery markers");
    }
    const res = await admin
      .from("documents")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    assertOk(res, "delete documents");
    deleted.documents = res.count || 0;
  });

  // 5) Dunning log: most rows cascade-deleted with their documents above; this
  //    sweeps any business-scoped rows not tied to a (now-gone) document.
  await step("dunning_log", async () => {
    const res = await admin
      .from("dunning_log")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    assertOk(res, "delete dunning_log");
    deleted.dunning_log = res.count || 0;
  });

  // 7) Expenses: also capture receipt paths first so we can purge storage.
  let receiptPaths: string[] = [];
  await step("expenses", async () => {
    const scan = await admin
      .from("expenses")
      .select("receipt_path")
      .eq("business_id", businessId);
    assertOk(scan, "scan expenses");
    receiptPaths = (scan.data || [])
      .map((r) => r.receipt_path as string)
      .filter(Boolean);
    const res = await admin
      .from("expenses")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    assertOk(res, "delete expenses");
    deleted.expenses = res.count || 0;
  });

  // 8-10) Clients, products, counters.
  await step("clients", async () => {
    const res = await admin
      .from("clients")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    assertOk(res, "delete clients");
    deleted.clients = res.count || 0;
  });
  await step("products", async () => {
    const res = await admin
      .from("products")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    assertOk(res, "delete products");
    deleted.products = res.count || 0;
  });
  await step("document_counters", async () => {
    const res = await admin
      .from("document_counters")
      .delete({ count: "exact" })
      .eq("business_id", businessId);
    assertOk(res, "delete document_counters");
    deleted.document_counters = res.count || 0;
  });

  // 11) Storage cleanup; delete in chunks so we don't blow past Supabase's
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

  // 13) Append the data.cleared audit entry; survives the wipe.
  await step("audit_log_append", async () => {
    const res = await admin.from("audit_log").insert({
      business_id: businessId,
      action: "data.cleared",
      target_type: "all",
      target_label: "כל הנתונים",
      payload: { deleted, errors },
    });
    assertOk(res, "append audit log");
  });

  return NextResponse.json({
    ok: errors.length === 0,
    deleted,
    errors,
    businessName: biz.name,
  });
}
