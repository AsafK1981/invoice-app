/**
 * Reply-side helpers for the in-app assistant, shared by the API route (which
 * decides whether a reply is acceptable) and the chat widget (which renders it).
 * Kept free of React and of the Anthropic SDK so both sides can import it and
 * vitest can pin the behaviour.
 */

/**
 * Does the reply give up on the user instead of pointing them somewhere?
 *
 * Asaf's rule (2026-08-25): the assistant may never answer "I can't help" /
 * "I have no answer". Every question about the app has at least one next step -
 * the screen that does it, the closest workaround, the assistant's own tools, or
 * the human who will do it by hand. The prompt says so; this is the contract
 * check on the text that actually came back, in the same spirit as the confirm-
 * button guard in the route.
 *
 * Deliberately narrow: only phrasings that declare inability or absence of an
 * answer. "לא נמצאו מסמכים" (a real search result) and "אינך יועץ מס, פנה לרואה
 * חשבון" (a referral, i.e. a next step) must not match.
 */
const DEAD_END_PATTERNS: RegExp[] = [
  /(?:אני |אינני |אנחנו )?לא (?:יכול|יכולה|מסוגל|מסוגלת|אוכל|נוכל) (?:לעזור|לסייע|לבצע|לעשות|לענות|לתת|לספק|לטפל|לייבא|להעביר|לגשת)/,
  /אינני (?:יכול|יכולה|מסוגל)/,
  /אין (?:לי|לנו|באפשרותי|ביכולתי) (?:אפשרות|יכולת|דרך|תשובה|מידע|גישה|כלי)/,
  /אין (?:לי|לנו) (?:מושג|ידע)/,
  /לא (?:בטוח|בטוחה|יודע|יודעת) (?:איך|כיצד|מה|אם|לאן|היכן)/,
  /לא (?:קיימת?|נתמכת?|זמינה?|אפשרי) (?:אפשרות|תכונה|פיצ'ר|אופציה|כרגע|במערכת|באפליקציה)/,
  /(?:התכונה|האפשרות|הפעולה) (?:הזאת|הזו|זו|הזה) (?:לא|אינה) (?:קיימת|נתמכת|זמינה|אפשרית)/,
  /(?:מחוץ|מעבר) ל(?:תחום|יכולות|יכולת|אפשרויות|טווח)/,
  /אין (?:לי )?(?:אפשרות|דרך|יכולת) ל/,
  /I (?:can't|cannot|am unable to) help/i,
];

export function isDeadEndReply(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return DEAD_END_PATTERNS.some((re) => re.test(t));
}

/** A piece of a reply: plain text, or a link the widget should make clickable. */
export type ReplySegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; external: boolean };

/**
 * Internal routes the assistant is allowed to point at. The prompt teaches the
 * model to write them as bare paths ("/migrate"); anything else that merely
 * looks like a path (a date written 12/03, "50/50") stays text. Keep in sync
 * with the screen list in the assistant prompt.
 */
const INTERNAL_ROUTE = /\/(?:migrate|dashboard|documents(?:\/new(?:\/[a-z-]+)?)?|clients|products|expenses|recurring|notifications|reminders|reports(?:\/[a-z0-9-]+)?|settings(?:#[a-z-]+)?|billing|portal)\b/g;
const EXTERNAL_URL = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;

/**
 * Splits a plain-text reply into text and link segments. The chat window does
 * not render Markdown (the prompt forbids it), so the only links that survive
 * are literal ones: an internal path or a full https URL. Both are turned into
 * clickable segments; everything else is untouched.
 */
export function splitReplyLinks(text: string): ReplySegment[] {
  const matches: { start: number; end: number; href: string; external: boolean }[] = [];
  for (const m of text.matchAll(EXTERNAL_URL)) {
    matches.push({ start: m.index, end: m.index + m[0].length, href: m[0], external: true });
  }
  for (const m of text.matchAll(INTERNAL_ROUTE)) {
    const start = m.index;
    const end = start + m[0].length;
    // A path is only a route when it starts a token: "friendlyinvoice.co.il/migrate"
    // is already covered by the URL rule, and "12/2026" must stay text.
    const before = start === 0 ? " " : text[start - 1];
    if (!/[\s(\[,:"'־-]/.test(before)) continue;
    if (matches.some((x) => start < x.end && end > x.start)) continue;
    matches.push({ start, end, href: m[0], external: false });
  }
  matches.sort((a, b) => a.start - b.start);

  const out: ReplySegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) out.push({ kind: "text", text: text.slice(cursor, m.start) });
    out.push({ kind: "link", text: text.slice(m.start, m.end), href: m.href, external: m.external });
    cursor = m.end;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}
