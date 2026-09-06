// The Gmail forwarding confirmation link, and the only rule that decides
// whether a URL is one.
//
// Lives on its own because BOTH sides need the same answer: the webhook
// (src/lib/email-inbox.ts, server, node:crypto) decides what to store, and
// the queue card (src/components/email-inbox-queue.tsx, client) decides what
// to render. Pure string work, no imports, so either side can take it.
//
// Why it is this strict: the mail that carries this link arrived from the
// open internet, and anyone who knows a business's forwarding address can
// send one. If we took "any URL with google.com in it", a spoofed
// confirmation mail would put an attacker's link inside the owner's app,
// under our own "אשר את ההעברה ב-Gmail" button. So the URL is PARSED, not
// pattern-matched: https only, and one of exactly two Google hosts.

/** Anything that looks like a URL; the real filter is isGmailConfirmUrl. */
const URL_CANDIDATE_RE = /https?:\/\/[^\s"'<>\\]+/gi;

/**
 * True only for a genuine Gmail forwarding confirmation URL.
 *
 * `new URL()` does the parsing, so no amount of `@`, `#`, backslash or
 * userinfo trickery in the string can make evil.com read as Google:
 * `https://mail.google.com@evil.com/` has hostname evil.com, and
 * `https://evil.com/?x=https://mail.google.com/mail/vf-1` has hostname
 * evil.com too. Both are rejected here and would have passed a substring test.
 */
export function isGmailConfirmUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // URL lowercases the hostname for us, so this comparison is exact.
  if (url.hostname === "mail-settings.google.com") return true;
  if (url.hostname === "mail.google.com") return url.pathname.startsWith("/mail/vf-");
  return false;
}

/**
 * The first genuine confirmation URL in a blob of mail text/html, or null.
 *
 * Every candidate is cleaned before it is judged: `&amp;` survives in the
 * HTML part and makes the link useless, and a link at the end of a sentence
 * picks up the punctuation after it.
 */
export function findGmailConfirmUrl(...blobs: (string | null | undefined)[]): string | null {
  for (const blob of blobs) {
    if (!blob) continue;
    for (const raw of blob.match(URL_CANDIDATE_RE) ?? []) {
      const cleaned = raw.replace(/&amp;/g, "&").replace(/[.,)\]]+$/, "");
      if (isGmailConfirmUrl(cleaned)) return cleaned;
    }
  }
  return null;
}
