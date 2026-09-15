import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { onboardingFormFromBusiness, reseedOnboardingForm } from "@/lib/onboarding-form";
import type { Business } from "@/lib/types";

// What useBusiness() returns before the fetch resolves.
const emptyDefault: Business = { id: "", name: "", businessType: "exempt", taxId: "", address: "" };

const stored: Business = {
  id: "b1",
  name: "סטודיו כהן",
  businessType: "authorized",
  taxId: "123456782",
  address: "הרצל 5, חיפה",
  phone: "050-1234567",
  email: "studio@example.test",
};

describe("onboarding business form re-seed", () => {
  it("replaces the empty first-render seed with the stored profile once the store is ready", () => {
    const seed = onboardingFormFromBusiness(emptyDefault);
    const next = reseedOnboardingForm(seed, seed, stored);
    expect(next).toEqual({
      name: "סטודיו כהן",
      businessType: "authorized",
      taxId: "123456782",
      address: "הרצל 5, חיפה",
      phone: "050-1234567",
      email: "studio@example.test",
      profession: "",
    });
  });

  it("keeps what the user already typed", () => {
    const seed = onboardingFormFromBusiness(emptyDefault);
    const typed = { ...seed, name: "שם חדש" };
    expect(reseedOnboardingForm(typed, seed, stored)).toBe(typed);
  });

  it("keeps a typed profession hint while re-seeding the stored fields", () => {
    const seed = onboardingFormFromBusiness(emptyDefault);
    const next = reseedOnboardingForm({ ...seed, profession: "צלם" }, seed, stored);
    expect(next.profession).toBe("צלם");
    expect(next.taxId).toBe("123456782");
  });

  it("treats legacy placeholder values as empty", () => {
    const form = onboardingFormFromBusiness({ ...emptyDefault, name: "העסק שלי", taxId: "000000000" });
    expect(form.name).toBe("");
    expect(form.taxId).toBe("");
  });
});

describe("onboarding page wiring", () => {
  it("re-seeds on ready and surfaces save failures instead of swallowing them", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/onboarding/page.tsx"), "utf8");
    expect(src).toContain("reseedOnboardingForm(");
    // saveBusinessAndAdvance, applyDesignSuggestion, saveClientAndAdvance
    expect(src.match(/\} catch \{\s*showToast\(/g)?.length).toBe(3);
  });
});
