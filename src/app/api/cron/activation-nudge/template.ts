// Pure rendering for the two activation emails (see src/lib/activation-nudge.ts
// for who gets them). Port of the approved design generator
// (peitho/out/2026-10-01/activation-email/build.py): a small lockup above one
// white card, founder row, headline with a gold highlight, one orange CTA,
// signoff, opt-out under the card.
// Email HTML rules: tables for layout, inline styles only, fixed 600px width,
// no flex/grid, no <style> block, full document + text twin.
//
// First-person founder voice with Asaf's photo and first name, as the owner
// asked for lifecycle emails to his own signups. Still no phone number or
// email address in the body; replies go to the sending address.

import { CANONICAL_ORIGIN } from "@/lib/public-url";
import type { NudgeStep } from "@/lib/activation-nudge";

const FONT = "Arial,Helvetica,sans-serif";
const INK = "#1F232B";
const MUTED = "#6B6259";
const ORANGE = "#D96A1D";
const BURNT = "#A94E16";
const CREAM = "#F7F2EB";
const SAND = "#E8DDD0";
const TINT = "#FBEADB";
const GOLD = "#F6C66A";
const T = 'cellpadding="0" cellspacing="0" border="0" role="presentation"';

const OPTOUT_LABEL = "לא רוצה לקבל תזכורות כאלה";

const utm = (campaign: string) =>
  `utm_source=email&utm_medium=lifecycle&utm_campaign=${campaign}`;

export function activationUrls(step: NudgeStep) {
  const campaign = step === 1 ? "activation_d1" : "activation_d3";
  return {
    /** Straight into the editor; a logged-out click goes through /login?next=. */
    newDocument: `${CANONICAL_ORIGIN}/documents/new?${utm(campaign)}`,
    video: `${CANONICAL_ORIGIN}/video?${utm("activation_d3")}`,
    logo: `${CANONICAL_ORIGIN}/logo-192.png`,
    images: `${CANONICAL_ORIGIN}/email`,
    site: CANONICAL_ORIGIN,
  };
}

/** The opt-out link for one user. The token comes from activationOptoutToken. */
export function activationOptoutUrl(userId: string, token: string): string {
  return `${CANONICAL_ORIGIN}/api/email/activation-optout?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}

const SUBJECTS: Record<NudgeStep, string> = {
  1: "בניתי את זה כי נמאס לי מטפסים",
  2: "18 שניות, ואתם יודעים בדיוק איך זה עובד",
};

const PREHEADERS: Record<NudgeStep, string> = {
  1: "החשבונית הראשונה שלכם לוקחת 20 שניות. הנה איך.",
  2: "צילמתי חשבונית ראשונה מההתחלה ועד הסוף.",
};

export function activationSubject(step: NudgeStep): string {
  return SUBJECTS[step];
}

function shell(step: NudgeStep, inner: string, optoutUrl: string): string {
  const { logo } = activationUrls(step);
  return `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><title>${SUBJECTS[step]}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${PREHEADERS[step]}</div>
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

function stepCell(n: number, title: string, sub: string): string {
  return `<td width="33%" valign="top" style="width:33%;padding:0 6px;text-align:center;">
  <table ${T} align="center"><tr><td align="center" style="width:44px;height:44px;border-radius:50%;background:${ORANGE};color:#ffffff;font-family:${FONT};font-size:20px;font-weight:800;text-align:center;line-height:44px;">${n}</td></tr></table>
  <div style="font-family:${FONT};font-size:16px;font-weight:700;color:${INK};margin-top:10px;">${title}</div>
  <div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};margin-top:4px;">${sub}</div>
</td>`;
}

function qa(q: string, a: string): string {
  return `<tr><td style="padding:0 0 12px;"><table ${T} width="100%" style="background:${CREAM};border-radius:14px;"><tr><td style="padding:16px 20px;font-family:${FONT};">
  <div style="font-size:16px;font-weight:700;color:${INK};margin-bottom:4px;">${q}</div>
  <div style="font-size:15px;line-height:1.6;color:${MUTED};">${a}</div>
</td></tr></table></td></tr>`;
}

// Copy shared by the HTML and the text twin, so the two cannot drift.
const C1 = {
  founder: "בניתי את חשבונית ידידותית",
  h1a: "החשבונית הראשונה שלכם, ",
  h1b: "ב-20 שניות",
  p1: "היי, ראיתי שנרשמתם ועוד לא הוצאתם מסמך, אז רציתי לכתוב בעצמי.",
  p2: "לפני שבניתי את המערכת ניסיתי כמה תוכנות חשבוניות, וכל אחת הרגישה כמו טופס של רשות המסים. רציתי משהו שמוציאים איתו חשבונית בזמן שהלקוח עוד על הטלפון. ככה זה עובד:",
  steps: [
    ["בוחרים לקוח", "או מקלידים שם חדש"],
    ["מזינים סכום", 'המע"מ מחושב לבד'],
    ["שולחים", "ישר למייל של הלקוח"],
  ] as const,
  stepsNote: "בערך 20 שניות, מההתחלה עד הסוף",
  cta: "להוציא את החשבונית הראשונה",
  ctaNote: "חודש ראשון חינם, בלי כרטיס אשראי",
  signoff: "נתקעתם במשהו? פשוט עונים למייל הזה. אני קורא כל תשובה.",
  ps: "חשבונית מעל 5,000 ₪? מספר ההקצאה מרשות המסים מתבקש לבד. לא צריך לגעת בזה.",
};

const C2 = {
  founder: "זה שוב אני, מחשבונית ידידותית",
  h1a: "צילמתי לכם את כל הדרך, ",
  h1b: "ב-18 שניות",
  p1: "הרבה אנשים נרשמים, מסתכלים, ונעצרים כי לא בטוחים מאיפה מתחילים. אז צילמתי חשבונית ראשונה מההתחלה ועד הסוף:",
  videoAlt: "סרטון של 18 שניות: ככה נראית חשבונית ראשונה",
  faqTitle: "ושלוש השאלות שהכי שואלים אותי:",
  faq: [
    ["אני עוסק פטור. זה מתאים לי?", "כן. קבלות בעברית, מספור רציף אוטומטי, ומעקב אחרי תקרת עוסק פטור בזמן אמת, כדי שלא תחצו אותה בלי לשים לב."],
    ["מה עם מספר הקצאה?", "כשהחשבונית חוצה את הסף, המערכת מבקשת את המספר מרשות המסים לבד. בלי טפסים באתר שלהם."],
    ["כמה זה עולה?", "החודש הראשון חינם, בלי כרטיס אשראי. אחר כך 15 ₪ לחודש, או 25 ₪ בלי הגבלה."],
  ] as const,
  cta: "להוציא חשבונית ראשונה",
  ctaNote: "לוקח בערך 20 שניות",
  signoff: "יש שאלה אחרת? עונים למייל הזה, ואני חוזר אליכם.",
};

function email1Inner(): string {
  const { newDocument, images } = activationUrls(1);
  const steps = `<table ${T} width="100%" style="background:${TINT};border-radius:16px;margin:8px 0 26px;"><tr><td style="padding:24px 10px 22px;">
  <table ${T} width="100%" dir="rtl"><tr>
    ${C1.steps.map(([title, sub], i) => stepCell(i + 1, title, sub)).join("\n    ")}
  </tr></table>
  <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${BURNT};text-align:center;margin-top:18px;">${C1.stepsNote}</div>
</td></tr></table>`;
  return (
    founderRow(images, C1.founder) +
    h1(`${C1.h1a}${hl(C1.h1b)}`) +
    p(C1.p1) +
    p(C1.p2) +
    steps +
    cta(C1.cta, newDocument, C1.ctaNote) +
    signoff(C1.signoff) +
    p(`<span style="font-weight:700;">נ.ב.</span> ${C1.ps}`, `font-size:15px;color:${MUTED};margin:18px 0 0;`)
  );
}

function email2Inner(): string {
  const { newDocument, video, images } = activationUrls(2);
  const thumb = `<a href="${video}" style="display:block;margin:6px 0 26px;"><img src="${images}/video-thumb.jpg" width="510" alt="${C2.videoAlt}" style="display:block;width:100%;max-width:510px;height:auto;border-radius:16px;border:1px solid ${SAND};"></a>`;
  const faq = `<div style="font-family:${FONT};font-size:18px;font-weight:800;color:${INK};margin:4px 0 14px;">${C2.faqTitle}</div>
<table ${T} width="100%">
  ${C2.faq.map(([q, a]) => qa(q, a)).join("\n  ")}
</table>`;
  return (
    founderRow(images, C2.founder) +
    h1(`${C2.h1a}${hl(C2.h1b)}`) +
    p(C2.p1) +
    thumb +
    faq +
    cta(C2.cta, newDocument, C2.ctaNote) +
    signoff(C2.signoff)
  );
}

export function buildActivationHtml(step: NudgeStep, optoutUrl: string): string {
  return shell(step, step === 1 ? email1Inner() : email2Inner(), optoutUrl);
}

export function buildActivationText(step: NudgeStep, optoutUrl: string): string {
  const urls = activationUrls(step);
  if (step === 1) {
    const steps = C1.steps.map(([title, sub], i) => `${i + 1}. ${title} (${sub})`).join("\n");
    return `${C1.h1a}${C1.h1b}

${C1.p1}

${C1.p2}

${steps}
${C1.stepsNote}.

${C1.cta}: ${urls.newDocument}
${C1.ctaNote}

${C1.signoff}
אסף

נ.ב. ${C1.ps}

---
קיבלתם את המייל כי נרשמתם לחשבונית ידידותית.
${OPTOUT_LABEL}: ${optoutUrl}
`;
  }
  const faq = C2.faq.map(([q, a]) => `${q}\n${a}`).join("\n\n");
  return `${C2.h1a}${C2.h1b}

${C2.p1}
${urls.video}

${C2.faqTitle}

${faq}

${C2.cta}: ${urls.newDocument}
${C2.ctaNote}

${C2.signoff}
אסף

---
קיבלתם את המייל כי נרשמתם לחשבונית ידידותית.
${OPTOUT_LABEL}: ${optoutUrl}
`;
}
