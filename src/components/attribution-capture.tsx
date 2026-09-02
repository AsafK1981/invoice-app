"use client";

import { useEffect } from "react";
import { captureAttribution } from "@/lib/attribution";

/**
 * Records the visitor's first touch (see src/lib/attribution.ts). Mounted in
 * the root layout so it runs on every entry point, including the SEO pages a
 * stranger is most likely to land on. Renders nothing and never throws.
 */
export function AttributionCapture() {
  useEffect(() => {
    captureAttribution();
  }, []);
  return null;
}
