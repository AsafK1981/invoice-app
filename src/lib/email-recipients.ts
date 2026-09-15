import { isValidEmail } from "./emails";

/**
 * Most addresses one document email may go to. A freelancer sends an invoice
 * to a client and maybe their bookkeeper; ten is generous for that and keeps
 * the platform's shared Gmail identity from being used as a bulk mailer.
 */
export const MAX_EMAIL_RECIPIENTS = 10;

export type RecipientParseResult =
  | { ok: true; recipients: string[] }
  | { ok: false; error: string };

/**
 * Server-side parse of the `to` field of /api/send-email. The client
 * validates too, but the route is callable directly with any body, so this is
 * the gate: a string, each address valid (and free of header-breaking
 * characters), duplicates collapsed, at most {@link MAX_EMAIL_RECIPIENTS}.
 */
export function parseEmailRecipients(to: unknown): RecipientParseResult {
  if (typeof to !== "string" || !to.trim()) {
    return { ok: false, error: "חסר נמען" };
  }
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const raw of to.split(/[,;\n]+/)) {
    const address = raw.trim();
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(address);
  }
  if (recipients.length === 0) {
    return { ok: false, error: "לא נמצאו נמענים" };
  }
  if (recipients.length > MAX_EMAIL_RECIPIENTS) {
    return {
      ok: false,
      error: `אפשר לשלוח מסמך לעד ${MAX_EMAIL_RECIPIENTS} נמענים בכל פעם.`,
    };
  }
  const invalid = recipients.find(
    (a) => a.length > 254 || /[\r<>"]/.test(a) || !isValidEmail(a),
  );
  if (invalid !== undefined) {
    const shown = invalid.length > 80 ? `${invalid.slice(0, 80)}...` : invalid;
    return { ok: false, error: `כתובת מייל לא תקינה: ${shown}` };
  }
  return { ok: true, recipients };
}
