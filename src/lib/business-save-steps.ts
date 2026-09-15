/**
 * The business form saves in two column-scoped steps: the details, then the
 * logo (only when it changed). The second can fail after the first already
 * committed, and a generic "save failed" would make the owner think nothing
 * was saved. This keeps the two outcomes apart so the modal can say exactly
 * what happened and stay open for the logo retry.
 */
export const LOGO_NOT_SAVED_MESSAGE = "פרטי העסק נשמרו, אבל הלוגו לא נשמר. נסו להעלות אותו שוב.";

export type BusinessSaveOutcome = { ok: true } | { ok: false; step: "details" | "logo"; message: string };

export async function saveBusinessThenLogo(steps: {
  saveDetails: () => Promise<void>;
  saveLogo: () => Promise<void>;
  logoChanged: boolean;
}): Promise<BusinessSaveOutcome> {
  try {
    await steps.saveDetails();
  } catch (err) {
    return { ok: false, step: "details", message: err instanceof Error ? err.message : "שגיאה בשמירה" };
  }
  if (steps.logoChanged) {
    try {
      await steps.saveLogo();
    } catch {
      return { ok: false, step: "logo", message: LOGO_NOT_SAVED_MESSAGE };
    }
  }
  return { ok: true };
}
