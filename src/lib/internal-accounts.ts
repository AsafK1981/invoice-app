/**
 * Businesses that belong to us, not to customers. Their documents are real
 * rows but not platform usage, so every cross-tenant metric must skip them.
 *
 * An explicit list, matched on the first 8 characters of businesses.id, the
 * same list scripts/count-data.mjs uses for the north-star count. The
 * `.internal` email suffix alone caught only the Lynkeus bot: on 2026-09-14 the
 * father's tax-testing business and the founder's own documents still landed
 * on the admin turnover card, about four times the real customer figure.
 * Add every new internal or QA account here and in scripts/count-data.mjs.
 */
export const INTERNAL_BUSINESS_ID_PREFIXES: ReadonlySet<string> = new Set([
  "dc3b5b61", // the founder's own business
  "eda11499", // father's עוסק מורשה, used for tax-authority testing
  "957d0e04", // seeded demo account
  "23673f84", // QA/audit account
  "acf71faa", // the founder's first throwaway test account
  "3085885f", // Lynkeus automated QA bot
]);

export function isInternalBusinessId(id: string): boolean {
  return INTERNAL_BUSINESS_ID_PREFIXES.has(String(id).slice(0, 8));
}
