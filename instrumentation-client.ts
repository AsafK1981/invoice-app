import * as Sentry from "@sentry/nextjs";

/**
 * Deploy-skew self-heal.
 *
 * Vercel Hobby has no skew protection: the moment a new production deploy
 * goes READY, every hashed `/_next/static/...` file of the previous build
 * starts returning 404 on friendlyinvoice.co.il. A tab that loaded the old
 * build and then navigates client-side asks React to insert the new route's
 * stylesheet, the <link> 404s, and React DOM rejects its internal load
 * promise with the bare `error` Event. Nothing handles it, so Sentry logged
 * it as "Event `Event` (type=error) captured as promise rejection" (iPhone,
 * 2026-09-08 16:13 UTC, two minutes after 899eafc went live while the page
 * still ran cc5d15e).
 *
 * The user-visible symptom is a route rendered without its CSS. The only
 * real cure is a fresh page load, which is what Next itself does when a JS
 * chunk fails during navigation; CSS just never got the same treatment. So:
 * once per stale URL per tab, reload. The rejection is dropped from Sentry
 * in favour of one explicit, greppable warning that carries the asset URL.
 */
const STALE_ASSET_RELOAD_KEY = "fi:stale-asset-reloaded";

function staleAssetUrl(reason: unknown): string | null {
  if (typeof Event === "undefined" || !(reason instanceof Event)) return null;
  const target = reason.target;
  const url =
    target instanceof HTMLLinkElement ? target.href
    : target instanceof HTMLScriptElement ? target.src
    : null;
  return url && url.includes("/_next/static/") ? url : null;
}

function installStaleAssetRecovery() {
  if (typeof window === "undefined") return;
  window.addEventListener("unhandledrejection", (event) => {
    const url = staleAssetUrl(event.reason);
    if (!url) return;
    event.preventDefault();
    let alreadyReloaded = false;
    try {
      alreadyReloaded = window.sessionStorage.getItem(STALE_ASSET_RELOAD_KEY) === url;
      if (!alreadyReloaded) window.sessionStorage.setItem(STALE_ASSET_RELOAD_KEY, url);
    } catch {
      // storage blocked: still reload once, the guard below just cannot persist
    }
    Sentry.captureMessage(`Stale build asset after deploy: ${url}`, {
      level: "warning",
      fingerprint: ["stale-build-asset"],
      tags: { recovery: alreadyReloaded ? "gave-up" : "reload" },
      extra: { url, path: window.location.pathname },
    });
    // A second failure for the same URL after a reload means the asset is
    // genuinely missing from the live build, not just skewed. Reloading
    // again would only loop, so the warning above is all we do.
    if (!alreadyReloaded) window.location.reload();
  });
}

installStaleAssetRecovery();

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Session replay is OFF on both paths, deliberately.
  //
  // This used to be `replaysOnErrorSampleRate: 1.0`, i.e. a DOM recording of
  // the screen on every single error. The screens this app errors on show
  // client names, invoice amounts, tax IDs and bank details - the recording
  // is tenant financial data leaving for a subprocessor. The Sentry SDK masks
  // text by default, but nothing in this repo pinned that: no
  // `replayIntegration()` call, so the masking was whatever the installed SDK
  // version happened to default to, and it could change under a minor bump
  // without anyone noticing.
  //
  // Traces and error events still give the stack, the route and the release,
  // which is what has actually diagnosed every bug here so far. If replay is
  // ever genuinely needed, turn it back on by ADDING an explicit
  // `integrations: [Sentry.replayIntegration({ maskAllText: true,
  // maskAllInputs: true, blockAllMedia: true })]` - never by raising these
  // rates alone, and update מדיניות הפרטיות §4א in the same commit.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
  // supabase-js coordinates auth-token refreshes between tabs with the
  // Web Locks API. When two tabs (or two parallel loads of /dashboard)
  // contend for the lock, the library deliberately steals it after a
  // timeout and the loser throws one of these. Nothing is lost - the
  // session is refreshed by whichever side won - so they are pure noise.
  ignoreErrors: [
    /Lock ".*" was released because another request stole it/,
    /Lock was stolen by another request/,
    /NavigatorLockAcquireTimeoutError/,
  ],
  // The stale-asset rejection is re-reported above as a named warning;
  // the raw "Event `Event` captured as promise rejection" adds nothing.
  beforeSend(event, hint) {
    return staleAssetUrl(hint?.originalException) ? null : event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
