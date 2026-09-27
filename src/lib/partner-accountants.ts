/**
 * Recommended accountants ("רואי חשבון שעובדים עם חשבונית ידידותית").
 *
 * Shown to logged-in users at /find-accountant, and linked from the sidebar
 * and the reports page ONLY while this list is non-empty. The /accountants
 * marketing page tells accountants that recommending the app gets them listed
 * here, so every entry is a real, consenting accountant.
 *
 * Rules for adding an entry:
 *   - Only list an accountant who agreed IN WRITING to be listed. Keep that
 *     written consent (email / message) on file.
 *   - Publish contact fields exactly as they asked to publish them: omit any
 *     field they did not ask for (website, phone, email are all optional),
 *     and never fill one in from another source.
 *   - `slug` is a stable, unique, lowercase id (used as the React key and for
 *     future deep links). `joinedOn` is the date they agreed, yyyy-mm-dd.
 *   - Plain hyphens only in every string (tests/partner-accountants.test.ts).
 *
 * To add one: append an entry to PARTNER_ACCOUNTANTS and deploy. The page,
 * the sidebar item and the reports-page card all appear automatically with
 * the first entry.
 */
export interface PartnerAccountant {
  slug: string;
  name: string;
  office?: string;
  city: string;
  /** Who they serve, shown as chips, e.g. "עוסק פטור", "עוסק מורשה". */
  serves: string[];
  website?: string;
  phone?: string;
  email?: string;
  note?: string;
  /** yyyy-mm-dd */
  joinedOn: string;
}

export const PARTNER_ACCOUNTANTS: PartnerAccountant[] = [];

export function hasPartnerAccountants(): boolean {
  return PARTNER_ACCOUNTANTS.length > 0;
}
