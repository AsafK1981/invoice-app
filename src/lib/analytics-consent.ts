// Analytics consent + the route allowlist that scopes Google Tag Manager.
//
// Why this exists (2026-09-27): the site had only Vercel Analytics, which is
// cookieless and answers "how many", never "which channel brought the people
// who signed up". GA4 answers that, but GA4 sets cookies, so it runs in
// BASIC consent mode: nothing from Google is fetched at all until the
// visitor explicitly accepts. That choice lives here.
//
// Design notes, all deliberate:
//   - localStorage, not a cookie. The choice is per-browser, never needs to
//     reach the server, and storing it does not itself need consent.
//   - Every storage access is wrapped, same as src/lib/attribution.ts:
//     localStorage throws outright in private mode / with blocked site data.
//     A thrown error here must never break a page; "no stored choice" is the
//     safe fallback (the banner simply shows again).
//   - The route list is an ALLOWLIST, not a denylist. A new app route added
//     next month must be dark to Google by default; only public pages that
//     were consciously opted in may ever carry the tag. Customer documents
//     (/view, /portal), invites, verification links and the whole signed-in
//     app are therefore excluded without being named.

export const CONSENT_KEY = "fi_consent_v1";

// Window event the footer's "הגדרות עוגיות" button dispatches; ConsentGtm
// listens, forgets the choice and shows the banner again.
export const CONSENT_RESET_EVENT = "fi:consent-reset";

export interface ConsentRecord {
  v: 1;
  analytics: boolean;
  /** ISO timestamp of when the choice was made. */
  at: string;
}

/** The stored choice, or null when none was made (or storage is unusable). */
export function readConsent(): ConsentRecord | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord> | null;
    // Anything that is not exactly our v1 shape counts as "no choice": a
    // half-parsed record must never be read as a yes.
    if (!parsed || parsed.v !== 1 || typeof parsed.analytics !== "boolean") {
      return null;
    }
    return { v: 1, analytics: parsed.analytics, at: String(parsed.at ?? "") };
  } catch {
    return null;
  }
}

/** Persist the visitor's choice. Best effort; returns the record either way. */
export function writeConsent(analytics: boolean): ConsentRecord {
  const record: ConsentRecord = {
    v: 1,
    analytics,
    at: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // Storage blocked: the choice still applies for this page view, it just
    // will not be remembered. Never escalate this into an error.
  }
  return record;
}

export function clearConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // see writeConsent
  }
}

/** True only for an explicit, stored "accept". */
export function hasAnalyticsConsent(): boolean {
  return readConsent()?.analytics === true;
}

// ---------------------------------------------------------------------------
// Route allowlist
// ---------------------------------------------------------------------------

// Every public page of the (marketing) route group, plus the two signup
// funnel steps (/login, /onboarding) that the whole measurement exists for.
// tests/analytics-consent.test.ts walks src/app/(marketing) and fails if a
// marketing page is added without being listed here, so the list cannot silently rot.
const EXACT_PATHS = new Set<string>([
  "/",
  "/accessibility",
  "/accountants",
  "/blog",
  "/from-accountant",
  "/pricing",
  "/privacy",
  "/product",
  "/security",
  "/status",
  "/terms",
  "/vs",
  "/login",
  "/onboarding",
]);

// Sections whose CHILDREN are also public marketing pages (/blog/<slug>,
// /vs/<competitor>). Kept to exactly these two on purpose.
const PREFIX_PATHS = ["/blog/", "/vs/"];

/** Trailing slashes off ("/pricing/" -> "/pricing"), root stays "/". */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.replace(/\/+$/, "") || "/"
    : pathname;
}

/**
 * Whether Google Tag Manager may run (and page views may be sent) on this
 * pathname. Trailing slashes are ignored; query strings must not be passed.
 */
export function isAnalyticsPath(pathname: string | null | undefined): boolean {
  if (!pathname || typeof pathname !== "string") return false;
  const path = normalizePath(pathname);
  if (EXACT_PATHS.has(path)) return true;
  return PREFIX_PATHS.some(
    (prefix) => path.startsWith(prefix) && path.length > prefix.length,
  );
}

// ---------------------------------------------------------------------------
// What a page may tell Google about itself
// ---------------------------------------------------------------------------
//
// Revised 2026-09-27 after a 4-seat review of the first cut. Google is never
// handed a value read live from the browser: GTM, once loaded, survives
// client-side navigation into the app, and gtag's own automatic hits
// (session_start, user_engagement, first_visit) would otherwise read
// document.location / title / referrer on whatever app page the user is on.
// These three builders are the only source of those fields.

// Query parameters that may travel to Google with a page URL. Campaign tags
// are the entire point (GA4 attributes a session from page_location's utm_*),
// everything else is dropped: /login?next=... and similar must not leak
// internal paths or anything a user typed.
const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
];
// Ad click ids. Opaque by design, so the digit-run rule below does not apply.
const CLICK_ID_PARAMS = ["gclid", "gbraid", "wbraid"];

const MAX_PARAM_LENGTH = 100;

/**
 * Whether a campaign parameter value is safe to forward. A utm tag is
 * whoever-built-the-link's free text; a link pasted from an email or a CRM
 * can carry an address or a phone/ID number in it. '@' = likely an email,
 * 5+ consecutive digits = likely a phone, ת.ז or account number.
 */
function isSafeParamValue(key: string, value: string): boolean {
  if (!value || value.length > MAX_PARAM_LENGTH) return false;
  if (value.includes("@")) return false;
  if (!CLICK_ID_PARAMS.includes(key) && /\d{5,}/.test(value)) return false;
  return true;
}

/** origin + pathname + only the safe campaign parameters above. No hash. */
export function sanitizePageLocation(href: string): string {
  try {
    const url = new URL(href);
    const kept = new URLSearchParams();
    for (const key of [...CAMPAIGN_PARAMS, ...CLICK_ID_PARAMS]) {
      const value = url.searchParams.get(key);
      if (value && isSafeParamValue(key, value)) kept.set(key, value);
    }
    const qs = kept.toString();
    return `${url.origin}${url.pathname}${qs ? `?${qs}` : ""}`;
  } catch {
    return "";
  }
}

/**
 * The referrer, reduced to "https://<host>/" for an external site and to ""
 * for our own origin. Same-origin must be empty, not just trimmed: a
 * customer opening /view/<document-uuid> and clicking its CTA lands on
 * /product with that full URL as the referrer.
 */
export function sanitizeReferrer(referrer: string, currentOrigin: string): string {
  try {
    if (!referrer) return "";
    const ref = new URL(referrer);
    if (ref.protocol !== "https:" && ref.protocol !== "http:") return "";
    let own = "";
    try {
      own = new URL(currentOrigin).host;
    } catch {
      // unknown origin: treat nothing as same-origin, still host-only
    }
    if (!ref.host || ref.host === own) return "";
    return `https://${ref.host}/`;
  } catch {
    return "";
  }
}

export interface SafePageFields {
  page_location: string;
  page_title: string;
  page_referrer: string;
}

/**
 * The page_location / page_title / page_referrer Google may see for the
 * current page. Off the allowlist every page is the same anonymous "/app".
 * The title is a static label (the path), NEVER document.title: app pages set
 * titles from customer data (the client statement page uses the client's
 * name), and on a client-side navigation the title lags the route, so a
 * stale one could ride along even on an allowlisted page.
 */
export function safePageFields(
  href: string,
  referrer: string,
): SafePageFields {
  let url: URL | null = null;
  try {
    url = new URL(href);
  } catch {
    url = null;
  }
  const origin = url?.origin ?? "";
  const page_referrer = sanitizeReferrer(referrer, origin);
  if (url && isAnalyticsPath(url.pathname)) {
    return {
      page_location: sanitizePageLocation(url.href),
      page_title: normalizePath(url.pathname),
      page_referrer,
    };
  }
  return { page_location: `${origin}/app`, page_title: "app", page_referrer };
}
