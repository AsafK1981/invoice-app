"use client";

import { useEffect } from "react";
import { captureAttribution, captureReferral, takeReferralVisitToReport } from "@/lib/attribution";

/**
 * Records the visitor's first touch (see src/lib/attribution.ts). Mounted in
 * the root layout so it runs on every entry point, including the SEO pages a
 * stranger is most likely to land on. Renders nothing and never throws.
 */
export function AttributionCapture() {
  useEffect(() => {
    captureAttribution();
    captureReferral();
    // Count the visit to an accountant's personal link (once per browser).
    // Fire and forget: the landing page must not depend on it.
    const ref = takeReferralVisitToReport();
    if (ref) {
      fetch("/api/referral-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref }),
        keepalive: true,
      }).catch(() => {});
    }
  }, []);
  return null;
}
