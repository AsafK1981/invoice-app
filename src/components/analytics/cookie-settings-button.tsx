"use client";

import { getGtmId } from "@/lib/ga";
import { CONSENT_RESET_EVENT } from "@/lib/analytics-consent";

/**
 * "הגדרות עוגיות" in the marketing footers (2026-09-27): reopens the consent
 * banner so a visitor can change their mind as easily as they decided.
 * ConsentGtm does the actual work (clear, deny in place, show the banner).
 * Renders nothing when no GTM container is configured, because then there
 * are no analytics cookies to have settings for.
 */
export function CookieSettingsButton() {
  if (!getGtmId()) return null;
  return (
    <button
      type="button"
      className="fi-cookie-settings"
      onClick={() => window.dispatchEvent(new Event(CONSENT_RESET_EVENT))}
    >
      הגדרות עוגיות
    </button>
  );
}
