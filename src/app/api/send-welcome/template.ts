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
// Design: one white "letter" card on the cream ground, one orange CTA,
// a soft orange-tint "give" box, a hairline, then the founder note with
// his photo and signature. Email HTML rules: tables for layout, inline
// styles only, fixed 600px width, no flex/grid, no <style> block.

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

export const WELCOME_SUBJECT = "המסמך הראשון שלך יוצא תוך דקה";

const EYEBROW = "ברוכים הבאים לחשבונית ידידותית";
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

  const lockup = `<table ${TABLE}><tr>
    <td style="padding-left:12px;"><img src="${logo}" width="40" height="40" alt="" style="display:block;border-radius:10px;"></td>
    <td style="font-family:${FONT};">
      <div style="font-size:17px;font-weight:700;color:${INK};line-height:1.1;">חשבונית ידידותית</div>
      <div dir="ltr" style="font-family:${SERIF};font-size:13px;color:${ORANGE};line-height:1.2;text-align:right;">Friendly Invoice</div>
    </td>
  </tr></table>`;

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
          <h1 style="font-family:${FONT};font-size:30px;font-weight:700;color:${INK};line-height:1.2;margin:0 0 14px;">${HEADLINE}</h1>
          <p style="font-family:${FONT};font-size:16px;color:${INK};line-height:1.65;margin:0 0 18px;">${BODY}</p>
          <div style="text-align:center;padding:10px 0 12px;">
            <a href="${firstDocument}" style="display:inline-block;background:${ORANGE};color:#ffffff;text-decoration:none;padding:16px 36px;border-radius:12px;font-family:${FONT};font-weight:700;font-size:17px;">${CTA_LABEL}</a>
          </div>
          <p style="font-family:${FONT};font-size:13px;color:${MUTED};line-height:1.65;margin:0 0 22px;text-align:center;">${CTA_SUB}</p>
          <table ${TABLE} width="100%" style="background:${TINT};border-radius:12px;"><tr>
            <td style="padding:14px 18px;font-family:${FONT};font-size:14px;color:${BURNT};line-height:1.5;">${GIVE}</td>
          </tr></table>
          <div style="border-top:1px solid ${HAIRLINE};margin:26px 0;"></div>
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
  return `${EYEBROW}

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
