"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  denyConsentInPlace,
  gaPageView,
  getGtmId,
  grantConsentInPlace,
  isGtmLoaded,
  loadGtm,
} from "@/lib/ga";
import "./consent-banner.css";

/**
 * Consent banner + Google Tag Manager loader (2026-09-27). Mounted once in the
 * root layout so it survives client-side navigation.
 *
 * BASIC consent mode, on purpose: until the visitor presses "accept", not a
 * single request goes to Google - no script, no cookieless ping. A stored
 * accept loads GTM silently on the next visit; a stored decline loads
 * nothing and shows nothing. See src/lib/analytics-consent.ts for the
 * storage and the route ALLOWLIST (marketing pages, /login, /onboarding) and src/lib/ga.ts
 * for why every push carries its own sanitized page_location.
 *
 * Page views are sent by hand (`fi_page_view`) on every pathname change to an
 * allowlisted route, because GA4's automatic history-change page views are
 * OFF in the container: once GTM is in the window it stays there when the
 * user walks into the app, and those routes must never be reported.
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
  const lastTitle = useRef<string | null>(null);

  useEffect(() => {
    if (!gtmId) return;
    const stored = readConsent();
    setChoice(stored ? (stored.analytics ? "accepted" : "declined") : "none");
  }, [gtmId]);

  // Load GTM (once) and send the manual page view for this path.
  useEffect(() => {
    if (!gtmId || !allowed || choice !== "accepted") return;
    loadGtm(gtmId);
    if (lastPageView.current === pathname) return; // StrictMode double run
    lastPageView.current = pathname;
    // On a client-side navigation Next streams the new route's <title> in
    // AFTER this effect runs (measured 2026-09-27: title was "" at a 0ms
    // timeout), and GA4 would record the previous page's title or none. So
    // wait for the title to change, capped so a page that shares its
    // predecessor's title still gets its page view.
    const previousTitle = lastTitle.current;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      observer?.disconnect();
      window.clearTimeout(cap);
      lastTitle.current = document.title;
      gaPageView();
    };
    const settled = () => !!document.title && document.title !== previousTitle;
    let observer: MutationObserver | null = null;
    const cap = window.setTimeout(send, 1500);
    if (settled()) {
      send();
    } else {
      observer = new MutationObserver(() => {
        if (settled()) send();
      });
      observer.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    return () => {
      observer?.disconnect();
      window.clearTimeout(cap);
      // Torn down before sending (fast re-render, StrictMode): let the next
      // run of this effect send it instead of skipping it as a duplicate.
      if (!sent) lastPageView.current = null;
    };
  }, [gtmId, allowed, choice, pathname]);

  // Footer "cookie settings": forget the choice and ask again.
  useEffect(() => {
    if (!gtmId) return;
    const onReset = () => {
      clearConsent();
      denyConsentInPlace();
      lastPageView.current = null;
      setChoice("none");
    };
    window.addEventListener(CONSENT_RESET_EVENT, onReset);
    return () => window.removeEventListener(CONSENT_RESET_EVENT, onReset);
  }, [gtmId]);

  const accept = useCallback(() => {
    writeConsent(true);
    // Accepting again after a reset in the same window: GTM is already in
    // memory with consent denied, so re-grant it; loadGtm will no-op.
    grantConsentInPlace();
    setChoice("accepted");
  }, []);

  const decline = useCallback(() => {
    writeConsent(false);
    // A script cannot be unloaded. If GTM ran in this window (the visitor
    // accepted earlier and changed their mind), a reload is the only way to
    // really get it out of the page.
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
