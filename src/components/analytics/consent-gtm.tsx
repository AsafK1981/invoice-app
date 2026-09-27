"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CONSENT_RESET_EVENT,
  clearConsent,
  isAnalyticsPath,
  readConsent,
  writeConsent,
} from "@/lib/analytics-consent";
import {
  deleteGaCookies,
  gaPageView,
  getGtmId,
  isGtmLoaded,
  loadGtm,
  setGlobalPageFields,
} from "@/lib/ga";
import "./consent-banner.css";

/**
 * Consent banner + Google Tag Manager loader (2026-09-27). Mounted once in the
 * root layout so it survives client-side navigation and sees EVERY route.
 *
 * BASIC consent mode, on purpose: until the visitor presses "accept", not a
 * single request goes to Google - no script, no cookieless ping. A stored
 * accept loads GTM silently on the next visit; a stored decline loads
 * nothing and shows nothing. See src/lib/analytics-consent.ts for the
 * storage, the route ALLOWLIST (marketing pages, /login, /onboarding) and
 * the safe page fields, and src/lib/ga.ts for how they are applied.
 *
 * Page views are sent by hand (`fi_page_view`) on every pathname change to an
 * allowlisted route, because GA4's automatic history-change page views are
 * OFF in the container: once GTM is in the window it stays there when the
 * user walks into the app, and those routes must never be reported.
 *
 * Withdrawal (2026-09-27 review): declining after an accept, or pressing
 * "הגדרות עוגיות", deletes the GA cookies and, if GTM is resident in this
 * window, reloads the page. A script cannot be unloaded, and GTM must never
 * sit in memory in a denied state.
 */

type Choice = "unknown" | "none" | "accepted" | "declined";

export function ConsentGtm() {
  const gtmId = getGtmId();
  const pathname = usePathname();
  const allowed = isAnalyticsPath(pathname);
  // "unknown" until mounted: the server cannot see localStorage, so the
  // banner only ever appears after hydration (no SSR/CSR mismatch).
  const [choice, setChoice] = useState<Choice>("unknown");
  const lastPageView = useRef<string | null>(null);

  useEffect(() => {
    if (!gtmId) return;
    const stored = readConsent();
    setChoice(stored ? (stored.analytics ? "accepted" : "declined") : "none");
  }, [gtmId]);

  // On EVERY route (allowlisted or not), before paint and before any passive
  // effect can push an event: re-point gtag's global page fields at this
  // route's safe values. This is what keeps gtag's automatic hits from
  // reading an app URL/title/referrer after the user navigates into the app.
  // A no-op until GTM has loaded.
  useLayoutEffect(() => {
    if (!gtmId) return;
    setGlobalPageFields();
  }, [gtmId, pathname]);

  // Load GTM (once) and send the manual page view for this path. The title
  // is a static label derived from the path (see safePageFields), so there is
  // nothing to wait for.
  useEffect(() => {
    if (!gtmId || !allowed || choice !== "accepted") return;
    loadGtm(gtmId);
    if (lastPageView.current === pathname) return; // StrictMode double run
    lastPageView.current = pathname;
    gaPageView();
  }, [gtmId, allowed, choice, pathname]);

  // Footer "cookie settings": withdraw, then ask again.
  useEffect(() => {
    if (!gtmId) return;
    const onReset = () => {
      clearConsent();
      deleteGaCookies();
      if (isGtmLoaded()) {
        // A fresh page with no stored choice shows the banner by itself.
        window.location.reload();
        return;
      }
      lastPageView.current = null;
      setChoice("none");
    };
    window.addEventListener(CONSENT_RESET_EVENT, onReset);
    return () => window.removeEventListener(CONSENT_RESET_EVENT, onReset);
  }, [gtmId]);

  const accept = useCallback(() => {
    writeConsent(true);
    setChoice("accepted");
  }, []);

  const decline = useCallback(() => {
    writeConsent(false);
    // Cookies left by an earlier accept go too, whether or not GTM is in
    // this window right now.
    deleteGaCookies();
    if (isGtmLoaded()) {
      window.location.reload();
      return;
    }
    setChoice("declined");
  }, []);

  if (!gtmId || !allowed || choice !== "none") return null;

  return (
    <section
      className="fi-consent"
      role="region"
      aria-label="הסכמה לעוגיות"
      dir="rtl"
    >
      <p className="fi-consent-text">
        אנחנו משתמשים בעוגיות של Google Analytics כדי להבין איך מגיעים אלינו
        ולשפר את האתר. רק אם תאשר/י.{" "}
        <Link href="/privacy" className="fi-consent-link">
          מדיניות פרטיות
        </Link>
      </p>
      {/* Two buttons of identical weight: declining must be exactly as easy
          and as visible as accepting. */}
      <div className="fi-consent-actions">
        <button type="button" className="fi-consent-btn" onClick={accept}>
          מאשר/ת
        </button>
        <button type="button" className="fi-consent-btn" onClick={decline}>
          רק הכרחיות
        </button>
      </div>
    </section>
  );
}
