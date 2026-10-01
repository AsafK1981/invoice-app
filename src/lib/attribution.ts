// First-touch signup attribution.
//
// Why this exists: on 2026-08-30 and 08-31 the first two real external users
// ever signed up, two and three days after a link was dropped in a Facebook
// thread. That link carried no UTM and nothing in the schema records where a
// signup came from, so the strongest growth signal the product has had is a
// correlation we cannot prove. This closes that for the next one.
//
// Design notes, all of them deliberate:
//   - FIRST touch wins. Someone can land from Facebook, leave, come back via
//     Google, and sign up. The channel that earned the user is the first one.
//   - localStorage, not a cookie. No consent banner, no request weight, and
//     it is per-browser which is exactly the granularity we want.
//   - Every access is wrapped. localStorage throws outright in some contexts
//     (private mode, blocked site data), and attribution must never be able
//     to break a signup. Losing the label is fine; losing the user is not.
//   - Referrer only when it is external. A same-origin referrer is just
//     internal navigation and would overwrite the real source with our
//     own domain.

const KEY = "fi_attr_v1";

// Accountant referral (2026-09-27). Separate from first-touch attribution on
// purpose: an accountant's personal link (/from-accountant?ref=<slug>) must be
// remembered even when the visitor's FIRST touch was something else weeks
// earlier, and it is what ranks the in-app accountant directory, so it needs
// its own key and its own "first ref wins" rule.
const REF_KEY = "fi_ref_v1";

/** The shape a referral slug must have; the DB CHECK on businesses.referred_by matches it. */
export const REFERRAL_SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;

export function normalizeReferralSlug(raw: string | null | undefined): string | null {
  const slug = (raw ?? "").trim().toLowerCase();
  return REFERRAL_SLUG.test(slug) ? slug : null;
}

// Friend invites (2026-10-01). A user's personal invite link is
// `/?ref=f-<10 hex>`, and the code lands in the same businesses.referred_by
// column as an accountant slug: no migration, and the existing CHECK and
// freeze trigger already guard it. The "f-" + exactly 10 hex shape is what
// keeps the two kinds apart (tests/friend-referral.test.ts pins that no listed
// accountant slug can take it).

/** A friend invite code: "f-" plus the first 10 hex characters of the inviter's business id. */
export const FRIEND_REFERRAL = /^f-[0-9a-f]{10}$/;

/**
 * The invite code for a business. Deterministic, so the sidebar can build the
 * link from the id it already has and the server can recompute it from the
 * caller's own business without storing anything. 40 bits of the UUID is
 * plenty to keep two businesses from sharing a code at this scale.
 */
export function friendReferralCode(businessId: string): string {
  return "f-" + businessId.replace(/-/g, "").toLowerCase().slice(0, 10);
}

export function isFriendReferral(ref: string | null | undefined): boolean {
  return FRIEND_REFERRAL.test(ref ?? "");
}

export interface Attribution {
  /** utm_source, or "referral" when only a referrer was present. */
  source?: string;
  medium?: string;
  campaign?: string;
  /** The external referring host, e.g. "l.facebook.com". */
  referrer?: string;
  /** Path the visitor first landed on. */
  landing?: string;
  /** ISO timestamp of the first touch. */
  at?: string;
}

function read(): Attribution | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}

/**
 * Record where this visitor came from, once. Safe to call on every page
 * load: an existing record is never overwritten, and a visit with no
 * source information at all is not recorded (so a later real source can
 * still be captured).
 */
export function captureAttribution(): void {
  try {
    if (typeof window === "undefined") return;
    if (read()) return; // first touch already recorded

    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get("utm_source") || undefined;

    let referrer: string | undefined;
    try {
      if (document.referrer) {
        const host = new URL(document.referrer).hostname;
        if (host && host !== window.location.hostname) referrer = host;
      }
    } catch {
      // Malformed referrer; treat as absent.
    }

    // Nothing to learn from this visit. Do not write an empty record, or a
    // later visit that DOES carry a source would be ignored as "already set".
    if (!utmSource && !referrer) return;

    const attr: Attribution = {
      source: utmSource || "referral",
      medium: params.get("utm_medium") || undefined,
      campaign: params.get("utm_campaign") || undefined,
      referrer,
      landing: window.location.pathname,
      at: new Date().toISOString(),
    };

    window.localStorage.setItem(KEY, JSON.stringify(attr));
  } catch {
    // Storage unavailable or blocked. Attribution is best effort.
  }
}

/** The only page whose `?ref=` means "an accountant sent me". */
const REFERRAL_LANDING = "/from-accountant";

/**
 * Remember which accountant's or friend's link brought this visitor. Runs on
 * every page load. An accountant slug is taken only on /from-accountant (a
 * generic `?ref=facebook` on another page must not block a real accountant
 * later); a friend code is taken on any page, because the invite link lands
 * on the home page and its narrow shape cannot be mistaken for a generic tag.
 * Whichever valid one arrives first stays.
 */
export function captureReferral(): void {
  try {
    if (typeof window === "undefined") return;
    const path = window.location.pathname.replace(/\/+$/, "");
    const ref = normalizeReferralSlug(new URLSearchParams(window.location.search).get("ref"));
    if (!ref) return;
    if (path !== REFERRAL_LANDING && !isFriendReferral(ref)) return;
    if (readReferral()) return; // first VALID referral wins; junk in the key does not block
    window.localStorage.setItem(REF_KEY, JSON.stringify({ ref, at: new Date().toISOString() }));
  } catch {
    // Storage unavailable or blocked. Best effort, like attribution.
  }
}

/**
 * Forget the referral once it has been written to a business row, so a second
 * person signing up on the same browser is not attributed to the first
 * visitor's accountant. Never throws.
 */
export function clearReferral(): void {
  try {
    window.localStorage.removeItem(REF_KEY);
  } catch {
    // Nothing to clear, or storage blocked.
  }
}

const REF_PING_KEY = "fi_ref_ping_v1";

/**
 * The accountant slug whose visit should be reported to /api/referral-visit
 * right now, or null. Returns a slug at most once per browser per slug, so
 * the admin count reads as "people who opened the link", not page views, and
 * a visitor who never signs up is still visible as interest. Independent of
 * captureReferral on purpose: a second accountant's link does not replace the
 * first one as the signup referral, but it was still opened. Never throws.
 */
export function takeReferralVisitToReport(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const path = window.location.pathname.replace(/\/+$/, "");
    if (path !== REFERRAL_LANDING) return null;
    const ref = normalizeReferralSlug(new URLSearchParams(window.location.search).get("ref"));
    // Accountant links only: a friend code is a user's own id-derived code and
    // has no business in the operator's per-link visit table.
    if (!ref || isFriendReferral(ref)) return null;
    const seen = (window.localStorage.getItem(REF_PING_KEY) || "").split(",").filter(Boolean);
    if (seen.includes(ref)) return null;
    window.localStorage.setItem(REF_PING_KEY, [...seen, ref].slice(-20).join(","));
    return ref;
  } catch {
    // Storage blocked: skip the count rather than report on every page load.
    return null;
  }
}

/** The remembered accountant slug or friend code, or null. Never throws. */
export function readReferral(): string | null {
  try {
    const raw = window.localStorage.getItem(REF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ref?: unknown };
    return normalizeReferralSlug(typeof parsed.ref === "string" ? parsed.ref : null);
  } catch {
    return null;
  }
}

/**
 * The recorded first touch, as a flat object safe to hand to Supabase
 * user_metadata or an analytics event. Returns {} when nothing is known,
 * so callers can spread it unconditionally. Carries the accountant referral
 * too, so "who came through which accountant" is one SQL query on
 * user_metadata as well as on businesses.referred_by.
 */
export function readAttribution(): Record<string, string> {
  const a = read();
  const ref = readReferral();
  if (!a && !ref) return {};
  const out: Record<string, string> = {};
  if (ref) out.signup_ref = ref;
  if (!a) return out;
  if (a.source) out.signup_source = a.source;
  if (a.medium) out.signup_medium = a.medium;
  if (a.campaign) out.signup_campaign = a.campaign;
  if (a.referrer) out.signup_referrer = a.referrer;
  if (a.landing) out.signup_landing = a.landing;
  if (a.at) out.signup_first_seen = a.at;
  return out;
}
