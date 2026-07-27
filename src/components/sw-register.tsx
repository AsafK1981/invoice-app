"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js) once the page has loaded, which
 * is what makes the app an installable PWA (Add to Home Screen / Google Play
 * TWA). The SW itself is deliberately conservative; it never caches app HTML
 * or JS, so registering it can't cause stale code to be served.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration is best-effort; the app works fine without it */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
