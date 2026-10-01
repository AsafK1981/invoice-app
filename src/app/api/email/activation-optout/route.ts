import { NextResponse } from "next/server";
import { cronAdminClient } from "@/lib/cron";
import { NUDGE_META, UUID_RE, verifyActivationOptoutToken } from "@/lib/activation-nudge";

/**
 * One-click opt-out from the activation emails (src/lib/activation-nudge.ts).
 *
 * GET is the link in the email footer; POST is RFC 8058 one-click from the
 * List-Unsubscribe-Post header (Gmail's "Unsubscribe" button). Both verify
 * the HMAC token for the user id, then stamp app_metadata.
 * activation_nudge_optout_at, which the selection treats as "never again".
 *
 * Public by design (the reader is not logged in), so it validates the id
 * shape and the token before touching the DB. A valid token for a user that
 * no longer exists still gets the success page, so the response says nothing
 * about who has an account.
 */
async function optOut(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  const userId = url.searchParams.get("u") || "";
  const token = url.searchParams.get("t") || "";
  if (!UUID_RE.test(userId) || !verifyActivationOptoutToken(userId, token)) return false;

  const admin = cronAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { [NUDGE_META.optout]: new Date().toISOString() },
  });
  if (error) console.error(`[activation-optout] update failed user=${userId}`);
  return true;
}

function page(ok: boolean): NextResponse {
  const title = ok ? "הוסרת מהרשימה" : "הקישור לא תקין";
  const body = ok
    ? "לא נשלח לך יותר תזכורות כאלה. מיילים על מסמכים שאתה שולח ממשיכים כרגיל."
    : "לא הצלחנו לזהות את הקישור. אפשר לענות למייל שקיבלת ונסיר אותך ידנית.";
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>${title}</title></head>
<body style="margin:0;padding:48px 16px;background:#f7f2eb;font-family:'Segoe UI',Heebo,Arial,sans-serif;color:#1f232b;text-align:center;">
<h1 style="font-size:22px;margin:0 0 12px;">${title}</h1>
<p style="font-size:16px;line-height:1.6;margin:0 auto;max-width:420px;">${body}</p>
<p style="font-size:14px;color:#6b6560;margin-top:28px;">צוות חשבונית ידידותית</p>
</body></html>`;
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  return page(await optOut(req));
}

export async function POST(req: Request) {
  const ok = await optOut(req);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
