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

/**
 * The recorded first touch, as a flat object safe to hand to Supabase
 * user_metadata or an analytics event. Returns {} when nothing is known,
 * so callers can spread it unconditionally.
 */
export function readAttribution(): Record<string, string> {
  const a = read();
  if (!a) return {};
  const out: Record<string, string> = {};
  if (a.source) out.signup_source = a.source;
  if (a.medium) out.signup_medium = a.medium;
  if (a.campaign) out.signup_campaign = a.campaign;
  if (a.referrer) out.signup_referrer = a.referrer;
  if (a.landing) out.signup_landing = a.landing;
  if (a.at) out.signup_first_seen = a.at;
  return out;
}
