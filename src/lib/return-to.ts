/**
 * "Fix it and come back" links. A report that sends the user to another screen
 * to correct something (an expense, a document) appends `?return=<path>` so
 * that screen can offer a way back to the exact report, period included.
 *
 * Only same-origin relative paths are honoured, so the parameter can never be
 * turned into an open redirect.
 */
export const RETURN_PARAM = "return";

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if ([...raw].some((ch) => ch.charCodeAt(0) < 32)) return null;
  return raw;
}

/** `href` plus a return path, keeping any query the href already has. */
export function withReturn(href: string, returnTo: string, extra: Record<string, string> = {}): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  params.set(RETURN_PARAM, returnTo);
  return `${path}?${params.toString()}`;
}

/** Human label for the way back, by where it leads. */
export function returnLabel(path: string): string {
  if (path.startsWith("/reports/vat")) return "חזרה לדיווח המע״מ";
  if (path.startsWith("/reports")) return "חזרה לדוח";
  return "חזרה";
}
