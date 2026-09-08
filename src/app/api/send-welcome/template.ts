// Pure rendering for the welcome email. Extracted from route.ts so unit tests
// can import it without dragging in next/server (same reason as
// send-email/template.ts), and so the HTML is a full document with a
// plain-text twin: a bare <div> fragment is what corporate filters
// (Microsoft 365 Defender, Mimecast) strip to a blank message, which
// bit a real customer on 2026-06-01.
//
// Design (2026-09-08, chosen by Asaf from three rendered directions):
// one white "letter" card on the cream ground, a five-step numbered
// checklist with hairline rows and Georgia numerals in the brand orange,
// one orange CTA, and a personal note from Asaf with his photo and a
// signature. Email HTML rules: tables for layout, inline styles only,
// fixed 600px width, no flex/grid, no <style> block.

import { CANONICAL_ORIGIN } from "@/lib/public-url";

const FONT = "'Segoe UI',Heebo,Arial,Helvetica,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

const INK = "#1f232b";
const MUTED = "#6b6560";
const ORANGE = "#d96a1d";
const BURNT = "#a94e16";
const CREAM = "#f7f2eb";
const SAND = "#e8ddd0";
const HAIRLINE = "#efe6db";

/** The five onboarding steps, mirroring the dashboard checklist. */
export const WELCOME_STEPS: ReadonlyArray<readonly [title: string, detail: string]> = [
  ["פרטי העסק", "ממלאים פעם אחת, ומופיעים אוטומטית על כל מסמך."],
  ["לקוחות ומוצרים", "שומרים פעם אחת, וההפקה הבאה לוקחת שנייה."],
  ["המסמך הראשון", "קבלה, חשבון עסקה או חשבונית מס, בלחיצה אחת."],
  ["שליחה ללקוח", "במייל, בוואטסאפ או בקישור, ו-PDF מקצועי להורדה."],
  ["מעקב", "הכנסות, הוצאות ומסמכים פתוחים, במסך אחד."],
];

const EYEBROW = "ברוכים הבאים לחשבונית ידידותית";
const HEADLINE = "כיף שהצטרפת.";
const INTRO = "מכאן הכל פשוט. חמישה צעדים קצרים, והמסמך הראשון שלך בחוץ.";
const CTA_LABEL = "למסך הראשי שלי";
const TIP = "אותו צ'ק-ליסט מחכה לך גם במסך הראשי.";
const NOTE_GREETING = "היי, אני אסף.";
const NOTE_BODY =
  "בניתי את חשבונית ידידותית כי רציתי דרך פשוטה להפיק חשבוניות וקבלות, בלי טפסים מסובכים. יש שאלה, בעיה או רעיון? פשוט תענה למייל הזה, הוא מגיע אליי ישר.";
const NOTE_SIGNATURE = "אסף קוטלר, מייסד חשבונית ידידותית";

export const WELCOME_SUBJECT = "ברוכים הבאים לחשבונית ידידותית";

export function welcomeUrls() {
  return {
    dashboard: `${CANONICAL_ORIGIN}/dashboard`,
    avatar: `${CANONICAL_ORIGIN}/email/asaf.png`,
    logo: `${CANONICAL_ORIGIN}/logo-192.png`,
    site: CANONICAL_ORIGIN,
  };
}

export function buildWelcomeHtml(): string {
  const { dashboard, avatar, logo, site } = welcomeUrls();

  const lockup = `<table ${TABLE}><tr>
    <td style="padding-left:12px;"><img src="${logo}" width="40" height="40" alt="" style="display:block;border-radius:10px;"></td>
    <td style="font-family:${FONT};">
      <div style="font-size:17px;font-weight:700;color:${INK};line-height:1.1;">חשבונית ידידותית</div>
      <div dir="ltr" style="font-family:${SERIF};font-size:13px;color:${ORANGE};line-height:1.2;text-align:right;">Friendly Invoice</div>
    </td>
  </tr></table>`;

  const rows = WELCOME_STEPS.map(([title, detail], idx) => {
    const n = idx + 1;
    const border = n < WELCOME_STEPS.length ? `border-bottom:1px solid ${HAIRLINE};` : "";
    return `<tr>
      <td width="36" valign="top" style="padding:14px 0 14px 12px;font-family:${SERIF};font-size:22px;color:${ORANGE};line-height:1.2;${border}">${n}</td>
      <td valign="top" style="padding:14px 0;font-family:${FONT};${border}">
        <div style="font-size:16px;font-weight:700;color:${INK};line-height:1.3;">${title}</div>
        <div style="font-size:14px;color:${MUTED};line-height:1.5;margin-top:2px;">${detail}</div>
      </td>
    </tr>`;
  }).join("");

  const note = `<table ${TABLE} width="100%"><tr>
    <td width="72" valign="top" style="padding-left:18px;"><img src="${avatar}" width="72" height="72" alt="אסף" style="display:block;width:72px;height:72px;border-radius:50%;"></td>
    <td valign="top" style="font-family:${FONT};font-size:15px;line-height:1.65;color:${INK};">
      <p style="margin:0 0 4px;font-weight:700;font-size:16px;">${NOTE_GREETING}</p>
      <p style="margin:0 0 10px;">${NOTE_BODY}</p>
      <p style="margin:0;font-size:13px;color:${MUTED};">${NOTE_SIGNATURE}</p>
    </td>
  </tr></table>`;

  const footer = `<table ${TABLE} width="100%" style="background:${INK};border-radius:0 0 16px 16px;"><tr>
    <td style="padding:18px 28px;font-family:${FONT};font-size:12px;color:${CREAM};">חשבונית ידידותית &nbsp;<span dir="ltr" style="font-family:${SERIF};color:${ORANGE};">Friendly Invoice</span></td>
    <td align="left" style="padding:18px 28px;font-family:${FONT};font-size:12px;"><a href="${site}" style="color:${CREAM};text-decoration:none;">friendlyinvoice.co.il</a></td>
  </tr></table>`;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${WELCOME_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
  <table ${TABLE} dir="rtl" width="100%" style="background:${CREAM};">
    <tr><td align="center" style="padding:32px 12px;">
      <table ${TABLE} dir="rtl" width="600" style="width:600px;max-width:100%;">
        <tr><td style="padding:0 8px 20px;">${lockup}</td></tr>
        <tr><td style="background:#ffffff;border:1px solid ${SAND};border-bottom:0;border-radius:16px 16px 0 0;padding:36px 40px 32px;">
          <div style="font-family:${FONT};font-size:13px;font-weight:700;color:${BURNT};margin-bottom:10px;">${EYEBROW}</div>
          <h1 style="font-family:${FONT};font-size:30px;font-weight:700;color:${INK};line-height:1.2;margin:0 0 12px;">${HEADLINE}</h1>
          <p style="font-family:${FONT};font-size:16px;color:${INK};line-height:1.6;margin:0 0 22px;">${INTRO}</p>
          <table ${TABLE} width="100%" style="border-top:1px solid ${HAIRLINE};">${rows}</table>
          <div style="text-align:center;padding:28px 0 8px;">
            <a href="${dashboard}" style="display:inline-block;background:${ORANGE};color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:12px;font-family:${FONT};font-weight:700;font-size:16px;">${CTA_LABEL}</a>
          </div>
          <p style="font-family:${FONT};font-size:13px;color:${MUTED};text-align:center;margin:0 0 30px;">${TIP}</p>
          <div style="border-top:1px solid ${HAIRLINE};padding-top:26px;">${note}</div>
        </td></tr>
        <tr><td>${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildWelcomeText(): string {
  const { dashboard } = welcomeUrls();
  const steps = WELCOME_STEPS.map(([title, detail], i) => `${i + 1}. ${title} - ${detail}`).join("\n");
  return `${EYEBROW}

${HEADLINE}
${INTRO}

${steps}

${CTA_LABEL}: ${dashboard}
${TIP}

${NOTE_GREETING}
${NOTE_BODY}
${NOTE_SIGNATURE}
`;
}
