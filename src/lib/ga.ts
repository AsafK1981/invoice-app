// Google Tag Manager / GA4 plumbing, consent-gated (2026-09-27).
//
// Everything here is a no-op unless BOTH hold: NEXT_PUBLIC_GTM_ID is set and
// the visitor explicitly accepted analytics (src/lib/analytics-consent.ts).
// Nothing in this file may ever throw into a caller: analytics is best effort, a signup
// or a document save is not.
//
// Why page_location / page_title are always overridden: with client-side
// navigation, a GTM container loaded on the homepage stays in the window when
// the user walks into the app. GA4 tags read document.location and
// document.title by default, and app URLs + titles can carry customer data
// (e.g. the client statement page sets the title to the client's name). So
// every push made from here carries its own sanitized location, and any event
// fired on a route outside the allowlist is reported as a generic "/app".
// The container must map these dataLayer keys onto the GA4 tag (and keep
// GA4's automatic page_view + history-change tracking OFF); see the report
// that shipped with this change.

import {
  hasAnalyticsConsent,
  isAnalyticsPath,
  sanitizePageLocation,
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

/** Location/title fields every push carries (see the header comment). */
function locationFields(): { page_location: string; page_title?: string } {
  const loc = window.location;
  if (isAnalyticsPath(loc.pathname)) {
    return { page_location: sanitizePageLocation(loc.href) };
  }
  return { page_location: `${loc.origin}/app`, page_title: "app" };
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
    // Spread first, location last: a caller can never override the
    // sanitized location with a real app URL.
    const payload = { event: name, ...(params ?? {}), ...locationFields() };
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
    if (!isAnalyticsPath(currentPath())) return;
    gaEvent("fi_page_view", {
      page_path: currentPath(),
      page_title: document.title || "",
    });
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

const CONSENT_TYPES = [
  "ad_storage",
  "analytics_storage",
  "ad_user_data",
  "ad_personalization",
] as const;

function consentState(value: "granted" | "denied"): Record<string, string> {
  return Object.fromEntries(CONSENT_TYPES.map((k) => [k, value]));
}

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
 * consent default (all denied) -> consent update (granted) -> gtm.start ->
 * any queued events -> the script tag.
 */
export function loadGtm(id: string): void {
  try {
    if (document.querySelector(gtmScriptSelector(id))) return;
    window.dataLayer = window.dataLayer || [];
    gtag("consent", "default", consentState("denied"));
    gtag("consent", "update", consentState("granted"));
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

/**
 * The visitor reopened the cookie settings: stop sending immediately. GTM
 * stays in memory until the next full load (a script cannot be unloaded),
 * but with consent denied and our own gate closed nothing new goes out.
 */
export function denyConsentInPlace(): void {
  try {
    if (!Array.isArray(window.dataLayer)) return;
    gtag("consent", "update", consentState("denied"));
  } catch {
    // see gaEvent
  }
}

/** Re-grant after the visitor accepted again without a reload. */
export function grantConsentInPlace(): void {
  try {
    if (!Array.isArray(window.dataLayer)) return;
    gtag("consent", "update", consentState("granted"));
  } catch {
    // see gaEvent
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
