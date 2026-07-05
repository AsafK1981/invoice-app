// Maps a caught error (Supabase / postgREST / fetch / anything) to a
// friendly Hebrew message. Our users are Hebrew-speaking freelancers —
// surfacing a raw English string like "duplicate key value violates
// unique constraint" is both confusing and leaks internals. Prefer a
// short, actionable Hebrew sentence; fall back to a generic one.

const GENERIC = "אירעה שגיאה, נסה שוב";

/**
 * Extract a lowercase message + numeric code from whatever was thrown.
 * Handles Error instances, Supabase/postgREST error objects
 * ({ message, code, details, hint }), plain strings, and fetch failures.
 */
function extract(err: unknown): { text: string; code: string } {
  if (err == null) return { text: "", code: "" };
  if (typeof err === "string") return { text: err.toLowerCase(), code: "" };
  if (err instanceof Error) return { text: err.message.toLowerCase(), code: "" };
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.error, e.details, e.hint]
      .filter((v) => typeof v === "string")
      .join(" ")
      .toLowerCase();
    const code = typeof e.code === "string" ? e.code : String(e.code ?? "");
    return { text: parts, code };
  }
  return { text: "", code: "" };
}

/**
 * Turn a thrown value into a Hebrew message safe to show a user.
 * @param err the caught value
 * @param fallback overrides the generic Hebrew fallback (e.g. a
 *   context-specific "שגיאה במחיקה"); the pattern matches still win.
 */
export function friendlyError(err: unknown, fallback: string = GENERIC): string {
  const { text, code } = extract(err);

  if (!text && !code) return fallback;

  // Auth / session expiry — tell them to log back in.
  if (
    code === "PGRST301" ||
    text.includes("jwt expired") ||
    text.includes("jwt is expired") ||
    text.includes("invalid token") ||
    text.includes("token is expired") ||
    text.includes("not authenticated") ||
    text.includes("no api key") ||
    text.includes("invalid claim")
  ) {
    return "פג תוקף ההתחברות, התחבר מחדש";
  }

  // Unique-constraint violation — the record already exists.
  if (code === "23505" || text.includes("duplicate key") || text.includes("already exists")) {
    return "כבר קיימת רשומה כזו";
  }

  // Row-level security / permission denied.
  if (
    code === "42501" ||
    text.includes("row-level security") ||
    text.includes("row level security") ||
    text.includes("permission denied") ||
    text.includes("violates") ||
    text.includes("not allowed") ||
    text.includes("insufficient")
  ) {
    return "אין הרשאה לפעולה זו";
  }

  // Network / connectivity problems.
  if (
    text.includes("fetch failed") ||
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network error") ||
    text.includes("network request failed") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("econnrefused") ||
    text.includes("load failed")
  ) {
    return "בעיית תקשורת, נסה שוב";
  }

  // If the message is already Hebrew, it was written for the user on
  // purpose (our own API returns Hebrew errors) — pass it through.
  if (/[֐-׿]/.test(text)) {
    // Recover the original (non-lowercased) message when possible so we
    // don't mangle any embedded Latin text.
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      for (const k of ["message", "error", "details"] as const) {
        if (typeof e[k] === "string" && /[֐-׿]/.test(e[k] as string)) {
          return e[k] as string;
        }
      }
    }
  }

  return fallback;
}
