import { NextResponse } from "next/server";
import { cronAuthError, cronAdminClient } from "@/lib/cron";
import { createNotificationForBusiness } from "@/lib/notifications-server";

/**
 * הוראות ניהול ספרים סעיף 25(ו)(2): "בשבוע הראשון בכל רבעון של שנת המס, יערך
 * גיבוי ממוחשב למסמכים הממוחשבים וכן למערכת החשבונות הממוחשבת". And the
 * computerized-audit department: the software should carry "מערכת מתאימה של
 * הודעות ו/או התראות שיקלו על ניהול הגיבויים".
 *
 * Runs daily during the first week of each quarter (vercel.json). For every
 * business that has issued at least one document and has not downloaded a
 * backup since the quarter began, one notification per quarter: "הגיע הזמן
 * לגיבוי הרבעוני", linking to the backup card in settings. Idempotent: a
 * backup_reminder notification created since the quarter start means this
 * quarter was already nagged.
 */
export async function GET(req: Request) {
  const unauth = cronAuthError(req);
  if (unauth) return unauth;

  const admin = cronAdminClient();
  const now = new Date();
  const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)).toISOString();
  const quarterLabel = `Q${Math.floor(now.getUTCMonth() / 3) + 1}/${now.getUTCFullYear()}`;

  // Businesses with books worth backing up: at least one non-draft document.
  const { data: issued, error } = await admin
    .from("documents")
    .select("business_id")
    .neq("status", "draft")
    .limit(100000);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const businessIds = [...new Set((issued ?? []).map((r) => r.business_id as string))];

  const [{ data: backedUp }, { data: reminded }] = await Promise.all([
    admin
      .from("audit_log")
      .select("business_id")
      .eq("action", "business.backup_exported")
      .gte("created_at", quarterStart),
    admin
      .from("notifications")
      .select("business_id")
      .eq("kind", "backup_reminder")
      .gte("created_at", quarterStart),
  ]);
  const covered = new Set((backedUp ?? []).map((r) => r.business_id as string));
  const alreadyReminded = new Set((reminded ?? []).map((r) => r.business_id as string));

  let sent = 0;
  for (const businessId of businessIds) {
    if (covered.has(businessId) || alreadyReminded.has(businessId)) continue;
    const ok = await createNotificationForBusiness({
      businessId,
      kind: "backup_reminder",
      title: `הגיע הזמן לגיבוי הרבעוני (${quarterLabel})`,
      body: "הוראות ניהול ספרים דורשות גיבוי של המסמכים הממוחשבים בשבוע הראשון של כל רבעון, שנשמר במקום נפרד בישראל. ההורדה לוקחת דקה.",
      href: "/settings#backup",
    });
    if (ok) sent++;
  }

  return NextResponse.json({
    ok: true,
    quarter: quarterLabel,
    businessesWithBooks: businessIds.length,
    alreadyBackedUp: covered.size,
    alreadyReminded: alreadyReminded.size,
    sent,
  });
}
