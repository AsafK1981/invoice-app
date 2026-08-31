import { describe, expect, it } from "vitest";
import { normalizeSpoken, looksLikeFreshRequest, isCancel, stripDescriptionLead } from "@/lib/whatsapp/spoken";

/**
 * REGRESSION GUARD (2026-08-31): a voice note is a sentence, not a command.
 *
 * Asaf spoke a correction to the bot and got "שמעתי ..., אבל לא הבנתי מה
 * לשנות" every time, while the same words typed worked. The gates in the
 * handlers assumed typed input: "^תוציא", "^בטל$", "סכום 120" at a line start.
 * These helpers are what let spoken Hebrew through the same gates.
 */

describe("normalizeSpoken", () => {
  it("strips leading filler and trailing punctuation from a transcript", () => {
    expect(normalizeSpoken("אה, תקשיב, תוציא קבלה לדני על 1200 שקל.")).toBe("תוציא קבלה לדני על 1200 שקל");
    expect(normalizeSpoken("היי! אוקיי אז הסכום זה מאה וחמישים?")).toBe("הסכום זה מאה וחמישים");
  });

  it("leaves a typed message alone and never returns empty", () => {
    expect(normalizeSpoken("סכום 120")).toBe("סכום 120");
    expect(normalizeSpoken("  כן.  ")).toBe("כן");
    expect(normalizeSpoken("...")).toBe("...");
  });

  it("keeps a leading לא - it is a negation, not filler", () => {
    expect(normalizeSpoken("לא, זה בביט.")).toBe("לא, זה בביט");
  });
});

describe("looksLikeFreshRequest", () => {
  it("accepts the typed imperative forms that always worked", () => {
    expect(looksLikeFreshRequest("תוציא קבלה לדני על 1200")).toBe(true);
    expect(looksLikeFreshRequest("קבלה לדני 500 ביט")).toBe(true);
    expect(looksLikeFreshRequest("הצעת מחיר לרוני על 3000")).toBe(true);
  });

  it("accepts spoken forms: filler, feminine verb, indirect phrasing", () => {
    expect(looksLikeFreshRequest("היי, תוציאי לי בבקשה קבלה לדני על אלף מאתיים.")).toBe(true);
    expect(looksLikeFreshRequest("אני רוצה שתוציא קבלה לרוני על 500 שקל")).toBe(true);
    expect(looksLikeFreshRequest("אפשר קבלה לדני כהן על 1200?")).toBe(true);
    expect(looksLikeFreshRequest("צריך להוציא חשבונית לדני על 800")).toBe(true);
  });

  it("does not mistake an answer or a correction for a new request", () => {
    expect(looksLikeFreshRequest("ייעוץ עסקי")).toBe(false);
    expect(looksLikeFreshRequest("הסכום 1500")).toBe(false);
    expect(looksLikeFreshRequest("לא, זה היה בביט")).toBe(false);
    expect(looksLikeFreshRequest("כולל מע״מ")).toBe(false);
    expect(looksLikeFreshRequest("הלקוח זה רוני לוי")).toBe(false);
  });
});

describe("isCancel", () => {
  it("matches typed and spoken cancellations", () => {
    for (const t of ["בטל", "ביטול", "בטלי", "בטל.", "תבטל את זה", "לא, בטל את זה.", "cancel", "עזוב"]) {
      expect(isCancel(t), t).toBe(true);
    }
  });
  it("does not cancel on a correction that merely contains the word", () => {
    expect(isCancel("הסכום 1500, לא לבטל")).toBe(false);
    expect(isCancel("ייעוץ")).toBe(false);
  });
});

describe("stripDescriptionLead", () => {
  it("turns a spoken answer to 'עבור מה?' into the bare description", () => {
    expect(stripDescriptionLead("זה עבור ייעוץ עסקי.")).toBe("ייעוץ עסקי");
    expect(stripDescriptionLead("אה, בשביל צילום אירוע")).toBe("צילום אירוע");
    expect(stripDescriptionLead("הקבלה היא על שיעור פרטי")).toBe("שיעור פרטי");
  });
  it("passes a typed one-liner through unchanged", () => {
    expect(stripDescriptionLead("ייעוץ")).toBe("ייעוץ");
    expect(stripDescriptionLead("עבודות גבס")).toBe("עבודות גבס");
  });
});
