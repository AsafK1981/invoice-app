// Pure rendering for the single activation email (see src/lib/activation-nudge.ts
// for who gets it). Port of email2() in the approved design generator
// (peitho/out/2026-10-01/activation-email/build.py): a small lockup above one
// white card, founder row, headline with a gold highlight, the 18-second video
// card, three FAQ cards, one orange CTA, signoff, opt-out under the card.
// Email HTML rules: tables for layout, inline styles only, fixed 600px width,
// no flex/grid, no <style> block, full document + text twin.
//
// First-person founder voice with Asaf's photo and first name, as the owner
// asked for lifecycle emails to his own signups. Still no phone number or
// email address in the body; replies go to the sending address.
//
// Pricing answer: legal review bans any duration promise on the free tier
// (no "forever" style wording). tests/activation-nudge.test.ts enforces it.

import { CANONICAL_ORIGIN } from "@/lib/public-url";

const FONT = "Arial,Helvetica,sans-serif";
const INK = "#1F232B";
const MUTED = "#6B6259";
const ORANGE = "#D96A1D";
const CREAM = "#F7F2EB";
const SAND = "#E8DDD0";
const TINT = "#FBEADB";
const GOLD = "#F6C66A";
const T = 'cellpadding="0" cellspacing="0" border="0" role="presentation"';

const OPTOUT_LABEL = "לא רוצה לקבל תזכורות כאלה";

const SUBJECT = "18 שניות, ואתם יודעים בדיוק איך זה עובד";
const PREHEADER = "צילמתי חשבונית ראשונה מההתחלה ועד הסוף.";

const utm = (campaign: string) =>
  `utm_source=email&utm_medium=lifecycle&utm_campaign=${campaign}`;

export function activationUrls() {
  return {
    /** Straight into the editor; a logged-out click goes through /login?next=. */
    newDocument: `${CANONICAL_ORIGIN}/documents/new?${utm("activation")}`,
    video: `${CANONICAL_ORIGIN}/video?${utm("activation")}`,
    logo: `${CANONICAL_ORIGIN}/logo-192.png`,
    images: `${CANONICAL_ORIGIN}/email`,
    site: CANONICAL_ORIGIN,
  };
}

/** The opt-out link for one user. The token comes from activationOptoutToken. */
export function activationOptoutUrl(userId: string, token: string): string {
  return `${CANONICAL_ORIGIN}/api/email/activation-optout?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}

export function activationSubject(): string {
  return SUBJECT;
}

function shell(inner: string, optoutUrl: string): string {
  const { logo } = activationUrls();
  return `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><title>${SUBJECT}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${PREHEADER}</div>
<table ${T} width="100%" dir="rtl" style="background:${CREAM};"><tr><td align="center" style="padding:28px 12px 36px;">
<table ${T} width="600" dir="rtl" style="width:600px;max-width:100%;">
  <tr><td style="padding:0 6px 16px;">
    <table ${T} dir="rtl"><tr>
      <td style="vertical-align:middle;padding-left:10px;"><img src="${logo}" width="30" height="30" alt="" style="display:block;border:0;"></td>
      <td style="vertical-align:middle;font-family:${FONT};font-size:16px;font-weight:700;color:${INK};">חשבונית ידידותית</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid ${SAND};border-radius:20px;padding:40px 44px 36px;">
${inner}
  </td></tr>
  <tr><td align="center" style="padding:22px 20px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:${MUTED};">
    קיבלתם את המייל כי נרשמתם לחשבונית ידידותית.<br>
    <a href="${optoutUrl}" style="color:${MUTED};text-decoration:underline;">${OPTOUT_LABEL}</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function founderRow(images: string, line2: string): string {
  return `<table ${T} dir="rtl" style="margin-bottom:26px;"><tr>
  <td style="vertical-align:middle;padding-left:14px;"><img src="${images}/asaf-240.jpg" width="84" height="84" alt="אסף" style="display:block;width:84px;height:84px;border-radius:50%;border:3px solid ${TINT};"></td>
  <td style="vertical-align:middle;font-family:${FONT};">
    <div style="font-size:19px;font-weight:700;color:${INK};line-height:1.3;">אסף</div>
    <div style="font-size:14px;color:${MUTED};line-height:1.4;">${line2}</div>
  </td></tr></table>`;
}

const h1 = (text: string) =>
  `<h1 style="font-family:${FONT};font-size:30px;line-height:1.25;font-weight:800;color:${INK};margin:0 0 18px;">${text}</h1>`;

const p = (text: string, extra = "") =>
  `<p style="font-family:${FONT};font-size:17px;line-height:1.75;color:${INK};margin:0 0 16px;${extra}">${text}</p>`;

const hl = (text: string) => `<span style="background:${GOLD};padding:0 4px;">${text}</span>`;

function cta(label: string, href: string, note: string): string {
  return `<table ${T} width="100%" style="margin:10px 0 8px;"><tr><td align="center">
  <a href="${href}" style="display:block;background:${ORANGE};color:#ffffff;text-decoration:none;font-family:${FONT};font-size:18px;font-weight:700;padding:17px 20px;border-radius:14px;text-align:center;">${label} &larr;</a>
</td></tr><tr><td align="center" style="padding-top:10px;font-family:${FONT};font-size:14px;color:${MUTED};">${note}</td></tr></table>`;
}

function signoff(extra: string): string {
  return `<table ${T} width="100%" style="margin-top:28px;border-top:1px solid ${SAND};"><tr><td style="padding-top:22px;font-family:${FONT};font-size:16px;line-height:1.7;color:${INK};">
  ${extra}<br><span style="font-weight:700;">אסף</span>
</td></tr></table>`;
}

function qa(q: string, a: string): string {
  return `<tr><td style="padding:0 0 12px;"><table ${T} width="100%" style="background:${CREAM};border-radius:14px;"><tr><td style="padding:16px 20px;font-family:${FONT};">
  <div style="font-size:16px;font-weight:700;color:${INK};margin-bottom:4px;">${q}</div>
  <div style="font-size:15px;line-height:1.6;color:${MUTED};">${a}</div>
</td></tr></table></td></tr>`;
}

// Copy shared by the HTML and the text twin, so the two cannot drift.
const C = {
  founder: "בניתי את חשבונית ידידותית",
  h1a: "צילמתי לכם את כל הדרך, ",
  h1b: "ב-18 שניות",
  p1: "היי, ראיתי שנרשמתם ועוד לא הוצאתם מסמך. הרבה אנשים נרשמים, מסתכלים, ונעצרים כי לא בטוחים מאיפה מתחילים. אז צילמתי לכם חשבונית ראשונה מההתחלה ועד הסוף:",
  videoAlt: "סרטון של 18 שניות: ככה נראית חשבונית ראשונה",
  faqTitle: "ושלוש השאלות שהכי שואלים אותי:",
  faq: [
    ["אני עוסק פטור. זה מתאים לי?", "כן. קבלות בעברית, מספור רציף אוטומטי, ומעקב אחרי תקרת עוסק פטור בזמן אמת, כדי שלא תחצו אותה בלי לשים לב."],
    ["מה עם מספר הקצאה?", "כשהחשבונית חוצה את הסף, המערכת מבקשת את המספר מרשות המסים לבד. בלי טפסים באתר שלהם."],
    ["כמה זה עולה?", "עד 5 מסמכים בחודש זה חינם, בלי כרטיס אשראי. צריכים יותר? 15 ₪ לחודש, או 25 ₪ בלי הגבלה. ובתקופת ההשקה הכול פתוח בלי הגבלה."],
  ] as const,
  cta: "להוציא חשבונית ראשונה",
  ctaNote: "לוקח בערך 20 שניות",
  signoff: "יש שאלה אחרת? עונים למייל הזה, ואני חוזר אליכם.",
};

function inner(): string {
  const { newDocument, video, images } = activationUrls();
  const thumb = `<a href="${video}" style="display:block;margin:6px 0 26px;"><img src="${images}/video-thumb.jpg" width="510" alt="${C.videoAlt}" style="display:block;width:100%;max-width:510px;height:auto;border-radius:16px;border:1px solid ${SAND};"></a>`;
  const faq = `<div style="font-family:${FONT};font-size:18px;font-weight:800;color:${INK};margin:4px 0 14px;">${C.faqTitle}</div>
<table ${T} width="100%">
  ${C.faq.map(([q, a]) => qa(q, a)).join("\n  ")}
</table>`;
  return (
    founderRow(images, C.founder) +
    h1(`${C.h1a}${hl(C.h1b)}`) +
    p(C.p1) +
    thumb +
    faq +
    cta(C.cta, newDocument, C.ctaNote) +
    signoff(C.signoff)
  );
}

export function buildActivationHtml(optoutUrl: string): string {
  return shell(inner(), optoutUrl);
}

export function buildActivationText(optoutUrl: string): string {
  const urls = activationUrls();
  const faq = C.faq.map(([q, a]) => `${q}\n${a}`).join("\n\n");
  return `${C.h1a}${C.h1b}

${C.p1}
${urls.video}

${C.faqTitle}

${faq}

${C.cta}: ${urls.newDocument}
${C.ctaNote}

${C.signoff}
אסף

---
קיבלתם את המייל כי נרשמתם לחשבונית ידידותית.
${OPTOUT_LABEL}: ${optoutUrl}
`;
}
