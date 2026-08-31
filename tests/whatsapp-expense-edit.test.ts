import { describe, it, expect } from "vitest";
import { parseExpenseEdit, parseIsraeliDate, validateSpokenExpenseEdit } from "@/lib/whatsapp/expense-edit";

const TODAY = "2026-08-18";

describe("validateSpokenExpenseEdit (model fallback for voice-note corrections)", () => {
  it("keeps only present, valid keys on the same rails as the typed parser", () => {
    const r = validateSpokenExpenseEdit(
      { vendor: " מרכז הבטיחות ", amount: 150, vatAmount: null, date: "2026-08-17", category: "ציוד", description: "כפפות" },
      TODAY,
    );
    expect(r.unknown).toBeUndefined();
    expect(r.patch).toEqual({ vendor: "מרכז הבטיחות", amount: 150, vatAmount: null, date: "2026-08-17", category: "ציוד", description: "כפפות" });
  });

  it("drops a negative amount, a future date and an off-list category, keeps the rest", () => {
    const r = validateSpokenExpenseEdit({ amount: -5, date: "2026-09-01", category: "משהו אחר", vendor: "כנען סנטר" }, TODAY);
    expect(r.patch).toEqual({ vendor: "כנען סנטר" });
  });

  it("vat 0 clears the vat like the typed path; unknown from the model is passed through", () => {
    expect(validateSpokenExpenseEdit({ vatAmount: 0 }, TODAY).patch).toEqual({ vatAmount: null });
    expect(validateSpokenExpenseEdit({ unknown: "זו לא הוראת תיקון" }, TODAY).unknown).toBe("זו לא הוראת תיקון");
    expect(validateSpokenExpenseEdit({}, TODAY).unknown).toBeTruthy();
  });
});

describe("parseExpenseEdit", () => {
  it("parses keyworded lines, several per message", () => {
    const r = parseExpenseEdit("סכום 120\nספק כנען סנטר\nתאריך 26/07/2026\nמע״מ 18.3\nקטגוריה נסיעות\nתיאור לוח גבס", TODAY);
    expect(r.patch).toEqual({
      amount: 120,
      vendor: "כנען סנטר",
      date: "2026-07-26",
      vatAmount: 18.3,
      category: "נסיעות",
      description: "לוח גבס",
    });
    expect(r.unrecognized).toEqual([]);
  });

  it("accepts colon / currency / thousands variants", () => {
    const r = parseExpenseEdit("סכום: 1,250 ₪\nמעמ 0", TODAY);
    expect(r.patch.amount).toBe(1250);
    expect(r.patch.vatAmount).toBeNull();
  });

  it("bare number = amount, bare date = date, bare category = category", () => {
    const r = parseExpenseEdit("89.90\n26.7\nמשרד", TODAY);
    expect(r.patch).toEqual({ amount: 89.9, date: "2026-07-26", category: "משרד" });
  });

  it("does NOT treat a bare word as the vendor - reports it as unrecognized", () => {
    const r = parseExpenseEdit("כנען", TODAY);
    expect(r.patch).toEqual({});
    expect(r.unrecognized).toEqual(["כנען"]);
  });

  it("rejects an off-list category and a garbage amount", () => {
    const r = parseExpenseEdit("קטגוריה מזון\nסכום הרבה", TODAY);
    expect(r.patch).toEqual({});
    expect(r.unrecognized).toEqual(["קטגוריה מזון", "סכום הרבה"]);
  });

  it("vat 'אין' clears VAT", () => {
    expect(parseExpenseEdit("מע״מ אין", TODAY).patch.vatAmount).toBeNull();
  });
});

describe("parseIsraeliDate", () => {
  it("handles DD/MM/YYYY, DD.MM.YY, DD-MM and ISO", () => {
    expect(parseIsraeliDate("26/07/2026", TODAY)).toBe("2026-07-26");
    expect(parseIsraeliDate("26.07.26", TODAY)).toBe("2026-07-26");
    expect(parseIsraeliDate("2026-07-26", TODAY)).toBe("2026-07-26");
    expect(parseIsraeliDate("5-1", TODAY)).toBe("2026-01-05");
  });
  it("a day/month with no year that would be in the future means last year", () => {
    expect(parseIsraeliDate("25/12", TODAY)).toBe("2025-12-25");
  });
  it("rejects impossible or future dates and non-dates", () => {
    expect(parseIsraeliDate("30/02/2026", TODAY)).toBeNull();
    expect(parseIsraeliDate("01/01/2027", TODAY)).toBeNull();
    expect(parseIsraeliDate("120", TODAY)).toBeNull();
    expect(parseIsraeliDate("hello", TODAY)).toBeNull();
  });
});
