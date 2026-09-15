// Outcome codes the Tax Authority OAuth callback puts in
// /settings?tax_authority=error&reason=<code>, and the Hebrew message the
// settings page shows for each. Client-safe (no server imports).
//
// Only these short codes ever go into the URL. Exception text, provider
// error descriptions and anything else stay in the server log, so nothing
// internal lands in browser history, logs or referrers, and nobody can put
// arbitrary text in front of a user through a crafted link.

export const TAX_AUTHORITY_CONNECT_ERROR_CODES = [
  "missing_params",
  "invalid_state",
  "expired_state",
  "browser_mismatch",
  "denied",
  "provider_error",
  "exchange_failed",
  "save_failed",
  "server_error",
] as const;

export type TaxAuthorityConnectErrorCode = (typeof TAX_AUTHORITY_CONNECT_ERROR_CODES)[number];

const MESSAGES: Record<TaxAuthorityConnectErrorCode, string> = {
  missing_params: "רשות המסים לא החזירה את פרטי ההרשאה. נסו לחבר שוב.",
  invalid_state: "קישור החיבור אינו תקף או שכבר נוצל. לחצו שוב על כפתור החיבור.",
  expired_state: "עברו יותר מ-10 דקות מתחילת החיבור. לחצו שוב על כפתור החיבור.",
  browser_mismatch:
    "יש להתחיל ולסיים את החיבור לרשות המסים באותו דפדפן, תוך 10 דקות. לחצו שוב על כפתור החיבור מכאן.",
  denied: "ההרשאה לא אושרה במסך של רשות המסים. אפשר לנסות שוב בכל עת.",
  provider_error: "רשות המסים החזירה שגיאה. נסו לחבר שוב בעוד כמה דקות.",
  exchange_failed: "לא הצלחנו להשלים את החיבור מול רשות המסים. נסו שוב בעוד כמה דקות.",
  save_failed: "האישור מרשות המסים התקבל אבל לא נשמר אצלנו, ולכן החיבור לא הושלם. נסו לחבר שוב.",
  server_error: "אירעה שגיאה בשרת בזמן החיבור. נסו שוב בעוד כמה דקות.",
};

export function isTaxAuthorityConnectErrorCode(v: unknown): v is TaxAuthorityConnectErrorCode {
  return typeof v === "string" && (TAX_AUTHORITY_CONNECT_ERROR_CODES as readonly string[]).includes(v);
}

/** Hebrew message for a reason code; unknown or missing codes get a generic message, never the raw text. */
export function taxAuthorityConnectErrorMessage(reason: string | null | undefined): string {
  if (isTaxAuthorityConnectErrorCode(reason)) return MESSAGES[reason];
  return "החיבור לרשות המסים לא הושלם. נסו שוב.";
}
