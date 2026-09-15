import { isPlaceholderBusinessName, isPlaceholderBusinessTaxId } from "./business-init";
import type { Business } from "./types";

export interface OnboardingBusinessForm {
  name: string;
  businessType: Business["businessType"];
  taxId: string;
  address: string;
  phone: string;
  email: string;
  /**
   * Free-text profession hint, used ONLY client-side to suggest a document
   * design template (see suggestTemplateForBusinessType). Deliberately not
   * persisted as its own DB column: it drives a one-tap suggestion, not a
   * stored business attribute.
   */
  profession: string;
}

/** The onboarding business step, pre-filled from what is already stored. */
export function onboardingFormFromBusiness(business: Business): OnboardingBusinessForm {
  return {
    name: isPlaceholderBusinessName(business.name) ? "" : business.name,
    businessType: business.businessType,
    taxId: isPlaceholderBusinessTaxId(business.taxId) ? "" : business.taxId,
    address: business.address || "",
    phone: business.phone || "",
    email: business.email || "",
    profession: "",
  };
}

/**
 * The form after the business store finished loading.
 *
 * useBusiness() returns an empty default on the first render, and the form was
 * seeded from that once and never again. A user sent back to onboarding (for
 * example after a failed finish) then saved a blank tax id and address, type
 * "exempt" and cleared phone and email over their real profile. So once the
 * store is ready the form is re-seeded from the stored business, unless the
 * user already started typing (the form no longer equals its initial seed),
 * in which case their input wins. The profession hint is never stored, so it
 * is always kept.
 */
export function reseedOnboardingForm(
  current: OnboardingBusinessForm,
  initialSeed: OnboardingBusinessForm,
  loaded: Business,
): OnboardingBusinessForm {
  const keys: (keyof OnboardingBusinessForm)[] = [
    "name",
    "businessType",
    "taxId",
    "address",
    "phone",
    "email",
  ];
  const untouched = keys.every((k) => current[k] === initialSeed[k]);
  if (!untouched) return current;
  return { ...onboardingFormFromBusiness(loaded), profession: current.profession };
}
