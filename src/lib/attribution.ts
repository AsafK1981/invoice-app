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
 * Remember which accountant's link brought this visitor. Runs on every page
 * load but writes only on /from-accountant with a valid `?ref=` (a generic
 * `?ref=facebook` on another page must not block a real accountant later),
 * and the first one recorded stays.
 */
export function captureReferral(): void {
  try {
    if (typeof window === "undefined") return;
    const path = window.location.pathname.replace(/\/+$/, "");
    if (path !== REFERRAL_LANDING) return;
    const ref = normalizeReferralSlug(new URLSearchParams(window.location.search).get("ref"));
    if (!ref) return;
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

/** The remembered accountant slug, or null. Never throws. */
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
