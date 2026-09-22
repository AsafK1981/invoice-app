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

/** A login we created for a bot or a test, never a customer's address. */
export function isInternalEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(".internal"));
}

/**
 * Resolves "ours" for a whole snapshot, in one place, at the two different
 * grains the two questions need.
 *
 * A BUSINESS is ours when it is on the list above, or when a `.internal` login
 * owns it. That grain has to stay precise: turnover excludes it, and wrongly
 * excluding a paying tenant's business would silently understate the product.
 *
 * A USER is ours when they log in with a `.internal` address, or when every
 * business they hold is one of ours. The second clause is what makes the
 * founder, his father's tax-testing עוסק and the demo account count as ours on
 * the dashboard even though they sign in with ordinary addresses. It is
 * deliberately "every", not "any": someone who holds one of our businesses
 * alongside a genuine one of their own is a customer, and their own turnover
 * and activity still count.
 */
export function resolveInternalAccounts(snapshot: {
  users: ReadonlyArray<{ id: string; email?: string | null }>;
  businesses: ReadonlyArray<{ id: string; user_id: string }>;
}): { internalUserIds: Set<string>; internalBusinessIds: Set<string> } {
  const internalEmailUserIds = new Set<string>();
  for (const user of snapshot.users) {
    if (isInternalEmail(user.email)) internalEmailUserIds.add(user.id);
  }

  const internalBusinessIds = new Set<string>();
  const owned = new Map<string, { total: number; ours: number }>();
  for (const business of snapshot.businesses) {
    const ours = internalEmailUserIds.has(business.user_id) || isInternalBusinessId(business.id);
    if (ours) internalBusinessIds.add(business.id);
    const tally = owned.get(business.user_id) ?? { total: 0, ours: 0 };
    tally.total++;
    if (ours) tally.ours++;
    owned.set(business.user_id, tally);
  }

  const internalUserIds = new Set(internalEmailUserIds);
  for (const [userId, tally] of owned) {
    if (tally.total > 0 && tally.total === tally.ours) internalUserIds.add(userId);
  }
  return { internalUserIds, internalBusinessIds };
}
