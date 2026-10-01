import { friendReferralCode, isFriendReferral } from "./attribution";
import { isInternalBusinessId } from "./internal-accounts";

export interface FriendReferralCounts {
  /** Businesses that signed up through the invite link(s). */
  joined: number;
  /** Of those, how many issued at least one non-draft, non-imported document. */
  active: number;
}

/**
 * Counts friend-invite signups from business rows. Pure, so the inviter's
 * route (/api/referrals/mine), the admin stats and the tests share one
 * definition:
 *   - `code` given: only rows referred by that code (one inviter); otherwise
 *     every row whose referred_by has the friend-code shape (admin total).
 *   - A business referred by its OWN code never counts. It cannot normally
 *     happen, but a self-referral must never inflate anyone's number.
 *   - Our own accounts never count (isInternalBusinessId by default; the admin
 *     route passes its wider snapshot-based set).
 *   - "Active" is the same bar the accountant ranking uses: the business is in
 *     `activeIds`, which the caller fills from non-draft, non-imported documents.
 */
export function countFriendReferrals(
  rows: ReadonlyArray<{ id: string; referred_by: string | null }>,
  opts: {
    activeIds: ReadonlySet<string>;
    code?: string;
    isInternal?: (businessId: string) => boolean;
  },
): FriendReferralCounts {
  const isInternal = opts.isInternal ?? isInternalBusinessId;
  let joined = 0;
  let active = 0;
  for (const row of rows) {
    const ref = row.referred_by;
    if (!ref) continue;
    if (opts.code ? ref !== opts.code : !isFriendReferral(ref)) continue;
    if (ref === friendReferralCode(row.id)) continue;
    if (isInternal(row.id)) continue;
    joined++;
    if (opts.activeIds.has(row.id)) active++;
  }
  return { joined, active };
}
