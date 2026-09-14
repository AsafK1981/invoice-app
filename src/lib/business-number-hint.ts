import { normalizeBusinessNumber } from "./israeli-id";

export interface BusinessNumberHint {
  tone: "ok" | "info" | "warn";
  text: string;
}

/**
 * The live line under a business-number field. Never blocks a save: foreign
 * ids are legitimate, so every warning says so.
 *
 * `digitsOnlyField`: the input already strips everything but digits and caps
 * at 9 (the expense form), so letters and too-long can never show, and a
 * confirmation on every valid number would only be noise there. Only the two
 * hints that can matter remain: the checksum and the missing leading zero.
 */
export function businessNumberHint(raw: string, options: { digitsOnlyField?: boolean } = {}): BusinessNumberHint | null {
  if (!raw.trim()) return null;
  const n = normalizeBusinessNumber(raw);
  switch (n.reason) {
    case "empty":
      return null;
    case "ok":
      if (n.digitCount < 9) return { tone: "info", text: `נראה כמו מספר ישראלי שחסר בו אפס בהתחלה. בדוח למע״מ הוא יירשם כ-${n.value}.` };
      return options.digitsOnlyField ? null : { tone: "ok", text: "מספר עוסק תקין" };
    case "letters":
      return options.digitsOnlyField ? null : { tone: "warn", text: "יש במספר אותיות או סימנים. מספר עוסק ישראלי כולל ספרות בלבד; מספר זר אפשר לשמור כמו שהוא." };
    case "too_long":
      return options.digitsOnlyField ? null : { tone: "warn", text: "יש יותר מ-9 ספרות. מספר עוסק ישראלי הוא עד 9 ספרות; מספר זר אפשר לשמור כמו שהוא." };
    case "checksum":
      return { tone: "warn", text: "ספרת הביקורת לא מתאימה למספר עוסק ישראלי. בדוק מול החשבונית; מספר זר אפשר לשמור כמו שהוא." };
  }
}

/**
 * Save-time rule: rewrite to the 9-digit form only when the number is valid
 * AND already had 9 digits. A short number is never padded on save, because
 * a numeric foreign id passes the checksum one time in ten.
 */
export function businessNumberForSave(raw: string): string {
  const n = normalizeBusinessNumber(raw);
  return n.reason === "ok" && n.digitCount === 9 && n.value ? n.value : raw.trim();
}
