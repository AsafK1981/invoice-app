#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const TOKEN = get("SUPABASE_ACCESS_TOKEN");
const REF = get("SUPABASE_PROJECT_REF");
if (!TOKEN || !REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in .env.local");
  process.exit(1);
}

const APP_NAME = "MySuperFriendlyInvoiceApp";
const APP_URL = "https://mysuperfriendlyinvoiceapp.vercel.app";

const confirmationHtml = `
<div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Heebo, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1c1917; background: #fff7ed; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display:inline-block;background:linear-gradient(135deg,#fb923c,#f43f5e);color:#fff;padding:14px 22px;border-radius:18px;font-weight:700;font-size:16px;letter-spacing:0.2px;">${APP_NAME}</div>
  </div>
  <h2 style="color:#1c1917;font-size:20px;margin:0 0 12px;">ברוך/ה הבא/ה!</h2>
  <p style="color:#44403c;font-size:15px;line-height:1.6;margin:0 0 16px;">
    נרשמת למערכת ${APP_NAME} - אפליקציה אישית להפקת חשבוניות וקבלות.
    כדי להשלים את הרישום, אנא אשר/י את כתובת המייל שלך:
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:linear-gradient(135deg,#fb923c,#f43f5e);color:#fff;text-decoration:none;padding:14px 32px;border-radius:14px;font-weight:600;font-size:15px;">
      אשר את הרישום
    </a>
  </div>
  <p style="color:#78716c;font-size:13px;line-height:1.5;margin:0 0 8px;">
    אם לא נרשמת, אפשר להתעלם מההודעה - לא ייעשה שימוש בכתובת המייל שלך.
  </p>
  <p style="color:#78716c;font-size:13px;line-height:1.5;margin:0;">
    אפליקציית ${APP_NAME} - <a href="${APP_URL}" style="color:#ea580c;text-decoration:none;">${APP_URL.replace("https://", "")}</a>
  </p>
</div>
`.trim();

const recoveryHtml = `
<div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Heebo, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1c1917; background: #fff7ed; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display:inline-block;background:linear-gradient(135deg,#fb923c,#f43f5e);color:#fff;padding:14px 22px;border-radius:18px;font-weight:700;font-size:16px;letter-spacing:0.2px;">${APP_NAME}</div>
  </div>
  <h2 style="color:#1c1917;font-size:20px;margin:0 0 12px;">איפוס סיסמה</h2>
  <p style="color:#44403c;font-size:15px;line-height:1.6;margin:0 0 16px;">
    קיבלנו בקשה לאיפוס הסיסמה שלך ב-${APP_NAME}.
    לחץ/י על הכפתור כדי לבחור סיסמה חדשה:
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:linear-gradient(135deg,#fb923c,#f43f5e);color:#fff;text-decoration:none;padding:14px 32px;border-radius:14px;font-weight:600;font-size:15px;">
      בחירת סיסמה חדשה
    </a>
  </div>
  <p style="color:#78716c;font-size:13px;line-height:1.5;margin:0 0 8px;">
    אם לא ביקשת איפוס, אפשר להתעלם מההודעה. הסיסמה הקיימת לא תשתנה.
  </p>
  <p style="color:#78716c;font-size:13px;line-height:1.5;margin:0;">
    אפליקציית ${APP_NAME} - <a href="${APP_URL}" style="color:#ea580c;text-decoration:none;">${APP_URL.replace("https://", "")}</a>
  </p>
</div>
`.trim();

const body = {
  mailer_subjects_confirmation: `${APP_NAME} - אישור רישום`,
  mailer_templates_confirmation_content: confirmationHtml,
  mailer_subjects_recovery: `${APP_NAME} - איפוס סיסמה`,
  mailer_templates_recovery_content: recoveryHtml,
};

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error("Failed:", res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
console.log("Updated email templates.");
console.log("Confirmation subject:", data.mailer_subjects_confirmation);
console.log("Recovery subject:", data.mailer_subjects_recovery);
