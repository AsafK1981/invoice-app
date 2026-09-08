// Pure rendering for the welcome email. Extracted from route.ts so unit tests
// can import it without dragging in next/server (same reason as
// send-email/template.ts), and so the HTML is a full document with a
// plain-text twin: a bare <div> fragment is what corporate filters
// (Microsoft 365 Defender, Mimecast) strip to a blank message, which
// bit a real customer on 2026-06-01.
//
// Copy (2026-09-08, Asaf's pick from three Hormozi-framed directions):
// the Value Equation says raise the dream outcome and the perceived
// likelihood, cut the time and the effort. The previous version handed a
// new user five tasks; this one gives them ONE action with a time promise
// ("יוצא תוך דקה"), tells them what they do NOT have to set up, names the
// one thing the system does for them (allocation numbers), and closes
// with a personal note from Asaf. Nothing here is a made-up number: the
// launch period is free with no card, and allocation numbers are fetched
// automatically (see tax-authority-section.tsx).
//
// Layout (2026-09-08, fourth round, Asaf's pick): everything centred. An
// opening band in the brand tint holds the stacked lockup (mark, Hebrew
// name, "Friendly Invoice" in a serif) and the welcome line, closed by a
// thin orange rule; the white body carries the headline at 25px, a
// 440px reading measure, one orange CTA, the "give" box, a hairline and
// the founder note with his photo. Email HTML rules: tables for layout,
// inline styles only, fixed 600px width, no flex/grid, no <style> block.

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
const TINT = "#fbeadb";
const TINT_LINE = "#f3d2b4";

export const WELCOME_SUBJECT = "המסמך הראשון שלך יוצא תוך דקה";

const WELCOME_LINE = "ברוכים הבאים לחשבונית ידידותית";
const HEADLINE = "המסמך הראשון שלך יוצא תוך דקה.";
const BODY =
  "בלי הגדרות ובלי טפסים. פותחים, כותבים למי ועל כמה, והקבלה או החשבונית יוצאת. פרטי העסק, הלוגו והלקוחות אפשר להשלים מתי שנוח, ואת מספרי ההקצאה מרשות המסים המערכת מביאה לבד.";
const CTA_LABEL = "להפיק את המסמך הראשון";
const CTA_SUB = "לוקח דקה. באמת.";
const GIVE = "בתקופת ההשקה הכל פתוח וחינם, בלי כרטיס אשראי. אין מה להפסיד, רק לנסות.";
const NOTE_GREETING = "היי, אני אסף.";
const NOTE_BODY =
  "בניתי את חשבונית ידידותית כי להוציא חשבונית לא אמור להיות הדבר המעצבן ביום. אם משהו תוקע אותך, תענה למייל הזה. אני קורא ועונה בעצמי.";
const NOTE_SIGNATURE = "אסף קוטלר, מייסד חשבונית ידידותית";

export function welcomeUrls() {
  return {
    /** Straight into the editor: the one action the email asks for. */
    firstDocument: `${CANONICAL_ORIGIN}/documents/new`,
    avatar: `${CANONICAL_ORIGIN}/email/asaf.png`,
    logo: `${CANONICAL_ORIGIN}/logo-192.png`,
    site: CANONICAL_ORIGIN,
  };
}

export function buildWelcomeHtml(): string {
  const { firstDocument, avatar, logo, site } = welcomeUrls();

  const lockup = `<table ${TABLE} align="center">
    <tr><td align="center" style="padding-bottom:10px;"><img src="${logo}" width="56" height="56" alt="" style="display:block;border-radius:14px;"></td></tr>
    <tr><td align="center" style="font-family:${FONT};font-size:19px;font-weight:700;color:${INK};line-height:1.1;">חשבונית ידידותית</td></tr>
    <tr><td align="center" dir="ltr" style="font-family:${SERIF};font-size:14px;color:${ORANGE};line-height:1.3;padding-top:2px;">Friendly Invoice</td></tr>
  </table>`;

  const note = `<table ${TABLE} width="100%"><tr>
    <td width="64" valign="top" style="padding-left:16px;"><img src="${avatar}" width="64" height="64" alt="אסף" style="display:block;width:64px;height:64px;border-radius:50%;"></td>
    <td valign="top" style="font-family:${FONT};font-size:15px;line-height:1.65;color:${INK};text-align:right;">
      <p style="margin:0 0 4px;font-weight:700;font-size:15px;">${NOTE_GREETING}</p>
      <p style="margin:0 0 8px;">${NOTE_BODY}</p>
      <p style="margin:0;font-size:13px;color:${MUTED};">${NOTE_SIGNATURE}</p>
    </td>
  </tr></table>`;

  const footer = `<table ${TABLE} width="100%" style="background:${INK};border-radius:0 0 16px 16px;"><tr>
    <td style="padding:16px 28px;font-family:${FONT};font-size:12px;color:${CREAM};">חשבונית ידידותית &nbsp;<span dir="ltr" style="font-family:${SERIF};color:${ORANGE};">Friendly Invoice</span></td>
    <td align="left" style="padding:16px 28px;font-family:${FONT};font-size:12px;"><a href="${site}" style="color:${CREAM};text-decoration:none;">friendlyinvoice.co.il</a></td>
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
    <tr><td align="center" style="padding:36px 12px;">
      <table ${TABLE} dir="rtl" width="600" style="width:600px;max-width:100%;">
        <tr><td align="center" style="background:${TINT};border:1px solid ${TINT_LINE};border-bottom:2px solid ${ORANGE};border-radius:16px 16px 0 0;padding:34px 56px 30px;text-align:center;">
          ${lockup}
          <div style="font-family:${FONT};font-size:18px;font-weight:600;color:${INK};line-height:1.3;margin-top:22px;">${WELCOME_LINE}</div>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid ${SAND};border-top:0;border-bottom:0;padding:38px 56px 36px;text-align:center;">
          <h1 style="font-family:${FONT};font-size:25px;font-weight:700;color:${INK};line-height:1.3;margin:0 0 14px;">${HEADLINE}</h1>
          <p style="font-family:${FONT};font-size:16px;color:${INK};line-height:1.7;margin:0 auto 26px;max-width:440px;">${BODY}</p>
          <a href="${firstDocument}" style="display:inline-block;background:${ORANGE};color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:12px;font-family:${FONT};font-weight:700;font-size:16px;">${CTA_LABEL}</a>
          <p style="font-family:${FONT};font-size:13px;color:${MUTED};margin:12px 0 30px;">${CTA_SUB}</p>
          <p style="font-family:${FONT};font-size:14px;color:${BURNT};line-height:1.6;margin:0;padding:14px 18px;background:${TINT};border-radius:10px;">${GIVE}</p>
          <div style="border-top:1px solid ${HAIRLINE};margin:30px 0 26px;"></div>
          ${note}
        </td></tr>
        <tr><td>${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildWelcomeText(): string {
  const { firstDocument } = welcomeUrls();
  return `${WELCOME_LINE}

${HEADLINE}
${BODY}

${CTA_LABEL}: ${firstDocument}
${CTA_SUB}

${GIVE}

${NOTE_GREETING}
${NOTE_BODY}
${NOTE_SIGNATURE}
`;
}
