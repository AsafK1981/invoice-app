// Pure rendering for the two activation emails (see src/lib/activation-nudge.ts
// for who gets them). Same visual system as the welcome email: tinted opening
// band with the stacked lockup, white body with one orange CTA, dark footer.
// Email HTML rules as there: tables for layout, inline styles only, fixed
// 600px width, no flex/grid, no <style> block, full document + text twin.
//
// Copy is Asaf's, verbatim. No personal name, photo or address on purpose
// (decision 27.09.2026: no personal contact on marketing); the only
// signature is the system one.

import { CANONICAL_ORIGIN } from "@/lib/public-url";
import {
  FONT,
  TABLE,
  INK,
  MUTED,
  ORANGE,
  BURNT,
  CREAM,
  SAND,
  TINT,
  TINT_LINE,
  HAIRLINE,
  brandLockupHtml,
  brandFooterHtml,
} from "@/app/api/send-welcome/template";
import type { NudgeStep } from "@/lib/activation-nudge";

const SIGNATURE = "צוות חשבונית ידידותית";
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
    site: CANONICAL_ORIGIN,
  };
}

/** The opt-out link for one user. The token comes from activationOptoutToken. */
export function activationOptoutUrl(userId: string, token: string): string {
  return `${CANONICAL_ORIGIN}/api/email/activation-optout?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}

interface Copy {
  subject: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  secondary?: { label: string; href: string };
}

function copyFor(step: NudgeStep): Copy {
  const urls = activationUrls(step);
  if (step === 1) {
    return {
      subject: "החשבונית הראשונה שלך מחכה",
      body: "היי, ראינו שנרשמת לחשבונית ידידותית אבל עוד לא הוצאת מסמך. זה לוקח 20 שניות: בוחרים לקוח, סכום, ושולחים.",
      ctaLabel: "להוציא חשבונית עכשיו",
      ctaHref: urls.newDocument,
    };
  }
  return {
    subject: "20 שניות, וזה מוכן",
    body: "רוצים לראות איך זה עובד לפני שמתחילים? הנה סרטון של 18 שניות.",
    ctaLabel: "לצפות בסרטון",
    ctaHref: urls.video,
    secondary: { label: "או להוציא חשבונית ראשונה עכשיו", href: urls.newDocument },
  };
}

export function activationSubject(step: NudgeStep): string {
  return copyFor(step).subject;
}

export function buildActivationHtml(step: NudgeStep, optoutUrl: string): string {
  const c = copyFor(step);
  const { logo, site } = activationUrls(step);

  const secondary = c.secondary
    ? `<p style="font-family:${FONT};font-size:14px;margin:14px 0 0;"><a href="${c.secondary.href}" style="color:${BURNT};text-decoration:underline;">${c.secondary.label}</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="he" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${c.subject}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
  <table ${TABLE} dir="rtl" width="100%" style="background:${CREAM};">
    <tr><td align="center" style="padding:36px 12px;">
      <table ${TABLE} dir="rtl" width="600" style="width:600px;max-width:100%;">
        <tr><td align="center" style="background:${TINT};border:1px solid ${TINT_LINE};border-bottom:2px solid ${ORANGE};border-radius:16px 16px 0 0;padding:30px 56px 26px;text-align:center;">
          ${brandLockupHtml(logo)}
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid ${SAND};border-top:0;border-bottom:0;padding:38px 56px 34px;text-align:center;">
          <h1 style="font-family:${FONT};font-size:25px;font-weight:700;color:${INK};line-height:1.3;margin:0 0 14px;">${c.subject}</h1>
          <p style="font-family:${FONT};font-size:16px;color:${INK};line-height:1.7;margin:0 auto 26px;max-width:440px;">${c.body}</p>
          <a href="${c.ctaHref}" style="display:inline-block;background:${ORANGE};color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:12px;font-family:${FONT};font-weight:700;font-size:16px;">${c.ctaLabel}</a>
          ${secondary}
          <div style="border-top:1px solid ${HAIRLINE};margin:30px 0 18px;"></div>
          <p style="font-family:${FONT};font-size:14px;color:${MUTED};margin:0;">${SIGNATURE}</p>
        </td></tr>
        <tr><td>${brandFooterHtml(site)}</td></tr>
        <tr><td align="center" style="padding:14px 28px 0;font-family:${FONT};font-size:12px;"><a href="${optoutUrl}" style="color:${MUTED};text-decoration:underline;">${OPTOUT_LABEL}</a></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildActivationText(step: NudgeStep, optoutUrl: string): string {
  const c = copyFor(step);
  const secondary = c.secondary ? `\n${c.secondary.label}: ${c.secondary.href}\n` : "";
  return `${c.subject}

${c.body}

${c.ctaLabel}: ${c.ctaHref}
${secondary}
${SIGNATURE}

${OPTOUT_LABEL}: ${optoutUrl}
`;
}
