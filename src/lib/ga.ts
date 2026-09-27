// Google Tag Manager / GA4 plumbing, consent-gated (2026-09-27).
//
// Everything here is a no-op unless BOTH hold: NEXT_PUBLIC_GTM_ID is set and
// the visitor explicitly accepted analytics (src/lib/analytics-consent.ts).
// Nothing in this file may ever throw into a caller: analytics is best
// effort, a signup or a document save is not.
//
// What Google may learn about a page is decided in ONE place,
// safePageFields() in analytics-consent.ts, and applied twice:
//   - as gtag('set', ...) globals, refreshed by ConsentGtm on every route
//     change (all routes, not only allowlisted ones), so gtag's own automatic
//     hits (session_start, user_engagement, first_visit) can never read a
//     live app URL, title or referrer - GTM survives client-side navigation
//     into the app once loaded;
//   - explicitly on every dataLayer push from here, so no event carries a
//     stale value either. Off the allowlist every page is an anonymous "/app".
// The container must keep GA4's automatic page_view + history-change
// tracking OFF and map page_location/page_title/page_referrer onto its tags.

import {
  hasAnalyticsConsent,
  isAnalyticsPath,
  safePageFields,
  type SafePageFields,
} from "./analytics-consent";

export type GaParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/;

/**
 * The container id, or null when unset/malformed. Inlined at build time by
 * Next (NEXT_PUBLIC_*). Unset = the banner, the footer link and the script
 * all stay off, which is the correct state until the container exists.
 */
export function getGtmId(): string | null {
  const id = process.env.NEXT_PUBLIC_GTM_ID?.trim();
  return id && GTM_ID_PATTERN.test(id) ? id : null;
}

// Events fired while consent is granted on an allowlisted page but before the
// GTM bootstrap ran. React runs a child's effects before its parent's, so the
// /onboarding page's own effect fires before the root-layout component that
// loads GTM; without this queue that event would be dropped (or worse, pushed
// ahead of the consent commands). Bounded so it can never grow unchecked.
const MAX_PENDING = 10;
let pending: Record<string, unknown>[] = [];

/** Test hook: forget queued events. */
export function _resetGaStateForTests(): void {
  pending = [];
}

function currentPath(): string {
  try {
    return window.location.pathname || "";
  } catch {
    return "";
  }
}

/** The safe page fields for wherever the browser is right now. */
export function currentPageFields(): SafePageFields {
  let referrer = "";
  try {
    referrer = document.referrer || "";
  } catch {
    referrer = "";
  }
  return safePageFields(window.location.href, referrer);
}

/**
 * Push a GA4 event to the dataLayer. Silently does nothing unless analytics
 * consent was granted and GTM was loaded in this window. NEVER pass PII
 * (emails, names, amounts) in params.
 */
export function gaEvent(name: string, params?: GaParams): void {
  try {
    if (typeof window === "undefined") return;
    if (!hasAnalyticsConsent()) return;
    // Spread first, page fields last: a caller can never override the
    // sanitized location/title/referrer with real app values.
    const payload = { event: name, ...(params ?? {}), ...currentPageFields() };
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push(payload);
      return;
    }
    // GTM not bootstrapped yet. Only worth holding on to when this page is
    // one where it is about to load; on app routes it never will.
    if (isAnalyticsPath(currentPath()) && pending.length < MAX_PENDING) {
      pending.push(payload);
    }
  } catch {
    // analytics must never break the caller
  }
}

/** Manual page view for an allowlisted path (GA4 auto page_view is off). */
export function gaPageView(): void {
  try {
    const path = currentPath();
    if (!isAnalyticsPath(path)) return;
    gaEvent("fi_page_view", { page_path: path });
  } catch {
    // see gaEvent
  }
}

// The standard gtag shim. It MUST push the `arguments` object itself, not an
// array copy: GTM only treats Arguments objects as gtag commands, so
// ["consent", ...] as a plain array would be ignored as an unknown message.
function gtag(..._args: unknown[]): void {
  void _args;
  (window.dataLayer = window.dataLayer || []).push(arguments);
}

/**
 * Refresh gtag's global page fields for the current route. Called by
 * ConsentGtm on mount and on every pathname change (in a layout effect, so
 * before paint and before any passive effect can fire an event), and by
 * loadGtm before the script is injected. Does nothing if GTM never loaded:
 * it must not create a dataLayer on its own.
 */
export function setGlobalPageFields(): void {
  try {
    if (typeof window === "undefined" || !Array.isArray(window.dataLayer)) return;
    gtag("set", currentPageFields());
  } catch {
    // see gaEvent
  }
}

// Consent scope: analytics ONLY. The ad_* signals stay denied in the default
// AND in the update - the banner asks about Google Analytics, nothing more,
// and the privacy policy promises no advertising cookies. Granting them here
// would let a future ads tag in the container act on this consent.
const CONSENT_DEFAULT = {
  ad_storage: "denied",
  analytics_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
} as const;
const CONSENT_ACCEPTED = { ...CONSENT_DEFAULT, analytics_storage: "granted" } as const;

function gtmScriptSelector(id: string): string {
  return `script[data-fi-gtm="${id}"]`;
}

export function isGtmLoaded(): boolean {
  try {
    return !!document.querySelector("script[data-fi-gtm]");
  } catch {
    return false;
  }
}

/**
 * Bootstrap Consent Mode v2 and inject gtm.js, once per window. Only ever
 * called after an explicit accept, on an allowlisted path. Order matters:
 * consent default (all denied) -> consent update (analytics only) -> safe
 * page globals -> gtm.start -> any queued events -> the script tag.
 */
export function loadGtm(id: string): void {
  try {
    if (document.querySelector(gtmScriptSelector(id))) return;
    window.dataLayer = window.dataLayer || [];
    gtag("consent", "default", { ...CONSENT_DEFAULT });
    gtag("consent", "update", { ...CONSENT_ACCEPTED });
    setGlobalPageFields();
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const queued = pending;
    pending = [];
    for (const item of queued) window.dataLayer.push(item);

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
    script.setAttribute("data-fi-gtm", id);
    document.head.appendChild(script);
  } catch {
    // A blocked script (extension, CSP) just means no analytics.
  }
}

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------

/**
 * Delete GA4's cookies (_ga and every _ga_<container>) after the visitor
 * withdraws consent. GA sets them on the registrable domain
 * (.friendlyinvoice.co.il), and a cookie can only be removed with the same
 * domain attribute, so every candidate is tried: host-only, then each parent
 * suffix of the hostname. A browser silently ignores the ones that do not
 * apply (including a public suffix like co.il), which is what makes the
 * brute force safe without a public-suffix list.
 */
export function deleteGaCookies(): void {
  try {
    const names = document.cookie
      .split(";")
      .map((c) => c.split("=")[0]?.trim() ?? "")
      .filter((n) => n === "_ga" || n.startsWith("_ga_"));
    if (names.length === 0) return;
    const labels = window.location.hostname.split(".");
    const domains: string[] = [];
    for (let i = 0; i < labels.length - 1; i++) {
      domains.push(labels.slice(i).join("."));
    }
    const expired = "expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    for (const name of names) {
      document.cookie = `${name}=; ${expired}`;
      for (const domain of domains) {
        document.cookie = `${name}=; ${expired}; domain=.${domain}`;
      }
    }
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// sign_up de-duplication
// ---------------------------------------------------------------------------

// Google sign-in cannot tell a new account from a returning one where it
// completes, so sign_up is also fired on the first visit to /onboarding. The
// email path fires it at the form and sets this same flag, so one person is
// never counted twice in one browser. Set regardless of consent: a sign_up
// that was not measured at the time must not be sent days later.
const SIGNUP_FLAG_KEY = "fi_ga_signup_sent";

export function wasSignupSent(): boolean {
  try {
    return window.localStorage.getItem(SIGNUP_FLAG_KEY) === "1";
  } catch {
    // Unknown: say "sent" so a broken storage never produces duplicates.
    return true;
  }
}

export function markSignupSent(): void {
  try {
    window.localStorage.setItem(SIGNUP_FLAG_KEY, "1");
  } catch {
    // best effort
  }
}
