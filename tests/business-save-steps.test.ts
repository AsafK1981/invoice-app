import { describe, it, expect, vi } from "vitest";
import { LOGO_NOT_SAVED_MESSAGE, saveBusinessThenLogo } from "@/lib/business-save-steps";

describe("business form: details then logo", () => {
  it("saves details and the changed logo", async () => {
    const saveDetails = vi.fn().mockResolvedValue(undefined);
    const saveLogo = vi.fn().mockResolvedValue(undefined);
    await expect(saveBusinessThenLogo({ saveDetails, saveLogo, logoChanged: true })).resolves.toEqual({ ok: true });
    expect(saveDetails).toHaveBeenCalledOnce();
    expect(saveLogo).toHaveBeenCalledOnce();
  });

  it("never touches the logo when it did not change", async () => {
    const saveLogo = vi.fn();
    await saveBusinessThenLogo({ saveDetails: async () => {}, saveLogo, logoChanged: false });
    expect(saveLogo).not.toHaveBeenCalled();
  });

  it("says the details were saved when only the logo failed", async () => {
    const outcome = await saveBusinessThenLogo({
      saveDetails: async () => {},
      saveLogo: async () => {
        throw new Error("storage 500");
      },
      logoChanged: true,
    });
    expect(outcome).toEqual({ ok: false, step: "logo", message: LOGO_NOT_SAVED_MESSAGE });
    expect(LOGO_NOT_SAVED_MESSAGE).toBe("פרטי העסק נשמרו, אבל הלוגו לא נשמר. נסו להעלות אותו שוב.");
  });

  it("does not try the logo when the details failed, and passes that error through", async () => {
    const saveLogo = vi.fn();
    const outcome = await saveBusinessThenLogo({
      saveDetails: async () => {
        throw new Error("שגיאת שמירה");
      },
      saveLogo,
      logoChanged: true,
    });
    expect(outcome).toEqual({ ok: false, step: "details", message: "שגיאת שמירה" });
    expect(saveLogo).not.toHaveBeenCalled();
  });
});
