import type { Client, ConsentSource } from "./types";

/**
 * הוראות ניהול ספרים 18ב(ג): a computerized document may be sent only to a
 * recipient who agreed beforehand, בכתב או באופן ממוחשב. These helpers name
 * how a consent was given and where a client currently stands. Shared by the
 * owner UI (client card, document page) and the send path.
 */

/** Hebrew label for each way a client's consent can be recorded. */
export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  download: "הורדת המסמך מהקישור",
  button: "אישור בלחיצה בדף המסמך",
  email: "תשובה במייל",
  written: "בכתב",
  manual: "נרשם ידנית על ידי בעל העסק",
};

export type ConsentStatus = "none" | "active" | "revoked";

/** none = never consented, active = consented and not withdrawn, revoked = withdrew. */
export function consentStatus(
  c: Pick<Client, "computerizedConsentAt" | "computerizedConsentRevokedAt"> | null | undefined,
): ConsentStatus {
  if (!c || !c.computerizedConsentAt) return "none";
  if (c.computerizedConsentRevokedAt) return "revoked";
  return "active";
}
