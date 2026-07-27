"use client";

import { formatCurrency } from "@/lib/format";
import {
  getExemptCeiling,
  getLatestPublishedCeilingYear,
} from "@/lib/tax-thresholds";
import type { Business } from "@/lib/types";

interface Props {
  type: Business["businessType"];
}

/**
 * Contextual help line shown below the business-type picker (in
 * onboarding + business-form-modal). The exempt option needs explicit
 * mention of the annual turnover ceiling; new users picking blindly
 * was the #1 source of "wait, I should have been authorized" support
 * tickets. Authorized + company show what they imply tax-wise.
 */
export function BusinessTypeHint({ type }: Props) {
  const year = getLatestPublishedCeilingYear();
  const ceiling = getExemptCeiling(year);

  if (type === "exempt") {
    return (
      <p className="text-xs text-stone-600 mt-1.5 leading-relaxed">
        מחזור עד <strong dir="ltr" className="inline-block">{formatCurrency(ceiling)}</strong> לשנה
        ({year}), פטור מגביית מע״מ. מעל הסף: חובת מעבר לעוסק מורשה.
      </p>
    );
  }
  if (type === "authorized") {
    return (
      <p className="text-xs text-stone-600 mt-1.5 leading-relaxed">
        בלי תקרת מחזור. גובה מע״מ 18% ומדווח דו-חודשי לרשות המסים.
        עוסק פטור מעל <strong dir="ltr" className="inline-block">{formatCurrency(ceiling)}</strong>{" "}
        ({year}) חייב לעבור לכאן.
      </p>
    );
  }
  if (type === "company") {
    return (
      <p className="text-xs text-stone-600 mt-1.5 leading-relaxed">
        ישות משפטית נפרדת. מע״מ + מס חברות + דרישת רואה חשבון מבקר.
        מתאים לעסקים גדולים או שותפויות.
      </p>
    );
  }
  return null;
}
