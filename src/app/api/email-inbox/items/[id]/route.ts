// Approve or reject one item from the email inbox queue.
//
// POST body:
//   { action: 'approve', expense: { date, category, supplier, amount,
//     vatAmount?, description?, supplierTaxId?, reference?, isEquipment?,
//     allocationNumber? } }
//   { action: 'reject' }
//
// Approve is where an email finally becomes a row in the books, so the values
// written are the ones the OWNER submitted (possibly corrected in the form),
// never the scanner's raw guess. The scan is a suggestion; this is the record.
//
// Idempotency matters here more than anywhere else in the feature: a double
// tap, a retried fetch or two open tabs must not book the same receipt twice.
// The whole approve step is therefore ONE call to public.email_inbox_approve()
// (see scripts/migrations/20260906-email-inbox.sql), which inside a single
// transaction:
//   1. locks the item FOR UPDATE, so only one caller can be past the status
//      check at a time;
//   2. inserts the expense with ON CONFLICT DO NOTHING on the partial unique
//      index (business_id, source_ref), so even a second item pointing at the
//      same message adopts the existing expense instead of duplicating it;
//   3. marks the item approved and links it - or nothing at all, if any step
//      fails. There is no window where the item says approved and no expense
//      exists.

import { NextRequest, NextResponse } from "next/server";
import { removeReceipt } from "@/lib/email-inbox";
import { UUID_RE, resolveInboxCaller } from "@/lib/email-inbox-server";
import { parseExpense } from "@/lib/email-inbox-expense";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "מזהה לא תקין." }, { status: 400 });
  }

  const caller = await resolveInboxCaller(req);
  if (!caller.ok) return caller.response;
  const { admin, business } = caller;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action || "");
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ ok: false, error: "פעולה לא מוכרת." }, { status: 400 });
  }

  // Scoped by business_id: the table is service-role only, so this predicate
  // IS the tenant check. Without it any signed-in user could name any item id.
  const { data: item, error: readErr } = await admin
    .from("email_inbox_items")
    .select("id, business_id, status, receipt_path, expense_id")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (readErr) {
    console.error("[email-inbox] item read failed:", readErr.message);
    return NextResponse.json({ ok: false, error: "שגיאה בטעינת הפריט." }, { status: 500 });
  }
  if (!item) {
    return NextResponse.json({ ok: false, error: "הפריט לא נמצא." }, { status: 404 });
  }

  if (action === "reject") {
    if (item.status === "approved") {
      return NextResponse.json(
        { ok: false, error: "הפריט כבר אושר ונרשם כהוצאה.", status: "approved", expenseId: item.expense_id },
        { status: 409 },
      );
    }
    if (item.status === "rejected") {
      return NextResponse.json({ ok: true, status: "rejected", alreadyResolved: true });
    }

    // Only a settled item can be thrown away. 'pending' is the normal case;
    // 'failed' is the dismiss button on a card that never made it (including
    // the Gmail confirmation notice). A 'processing' row belongs to a webhook
    // run that is still working on it, and rejecting it from under that run
    // would leave the run writing a scan onto a rejected item.
    const { data: rejected, error } = await admin
      .from("email_inbox_items")
      .update({ status: "rejected", receipt_path: null, resolved_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("business_id", business.id)
      .in("status", ["pending", "failed"])
      .select("id");
    if (error) {
      console.error("[email-inbox] reject failed:", error.message);
      return NextResponse.json({ ok: false, error: "הדחייה נכשלה." }, { status: 500 });
    }
    if (!rejected?.length) {
      // Somebody (or something) changed the row between the read and here.
      return NextResponse.json(
        { ok: false, error: "הפריט כבר טופל." },
        { status: 409 },
      );
    }
    // The file is dropped only after a row ACTUALLY stopped pointing at it, so
    // a lost race never deletes the object out from under the winner.
    await removeReceipt(admin, item.receipt_path as string | null);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // ── approve ───────────────────────────────────────────────────────────────

  if (item.status === "approved") {
    return NextResponse.json({
      ok: true,
      status: "approved",
      alreadyApproved: true,
      expenseId: item.expense_id,
    });
  }
  if (item.status !== "pending") {
    return NextResponse.json(
      { ok: false, error: "אפשר לאשר רק פריט ממתין.", status: item.status },
      { status: 409 },
    );
  }

  const parsed = parseExpense(body.expense, business.businessType);
  if (typeof parsed === "string") {
    return NextResponse.json({ ok: false, error: parsed }, { status: 400 });
  }

  const { data: expenseId, error: approveErr } = await admin.rpc("email_inbox_approve", {
    p_item: item.id,
    p_business: business.id,
    p_expense: parsed,
  });

  if (approveErr) {
    // P0001 'not_pending': the read above saw 'pending' but the row changed
    // before the lock was taken - a second tab won the race.
    if (approveErr.code === "P0001" || approveErr.message === "not_pending") {
      const { data: fresh } = await admin
        .from("email_inbox_items")
        .select("status, expense_id")
        .eq("id", item.id)
        .eq("business_id", business.id)
        .maybeSingle();
      if (fresh?.status === "approved") {
        return NextResponse.json({
          ok: true,
          status: "approved",
          alreadyApproved: true,
          expenseId: fresh.expense_id,
        });
      }
      return NextResponse.json(
        { ok: false, error: "הפריט כבר טופל.", status: fresh?.status ?? "unknown" },
        { status: 409 },
      );
    }
    if (approveErr.code === "P0002" || approveErr.message === "not_found") {
      return NextResponse.json({ ok: false, error: "הפריט לא נמצא." }, { status: 404 });
    }
    console.error("[email-inbox] approve failed:", approveErr.message);
    return NextResponse.json({ ok: false, error: "שמירת ההוצאה נכשלה." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "approved", expenseId: expenseId ?? null });
}
