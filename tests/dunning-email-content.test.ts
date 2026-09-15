import { describe, it, expect } from "vitest";
import {
  dunningDocVars,
  dunningEmailContent,
  whatsappReminderText,
  type DunningStage,
} from "@/lib/dunning-copy";
import { formatDocTotal } from "@/lib/currencies";
import { whatsappShareText } from "@/lib/document-share-text";

const LONG_DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
const STAGES: DunningStage[] = [3, 14, 30];

const BASE = { number: 12, total: 3600, date: "2026-07-05", days: 20 };

describe("formatDocTotal", () => {
  it("formats ILS like formatCurrency and other currencies with their own symbol", () => {
    expect(formatDocTotal(3600, "ILS")).toBe("⁦₪ 3,600⁩");
    expect(formatDocTotal(3600, null)).toBe("⁦₪ 3,600⁩");
    expect(formatDocTotal(3600, undefined)).toBe("⁦₪ 3,600⁩");
    expect(formatDocTotal(3600, "USD")).toBe("⁦$3,600.00⁩");
    expect(formatDocTotal(99.5, "EUR")).toBe("⁦€99.50⁩");
  });
});

describe("dunningEmailContent", () => {
  it("keeps the tax invoice wording exactly as it was", () => {
    const c = dunningEmailContent({ ...BASE, stage: 3, docType: "tax_invoice" });
    expect(c.subject).toBe("תזכורת: חשבונית מספר 12");
    expect(c.intro).toBe(
      "מקווה שהמסמך הגיע בסדר. רק רציתי לוודא שראיתם את חשבונית המס מספר 12 על סך ⁦₪ 3,600⁩ ששלחנו ב-05.07.2026.",
    );
    expect(c.cta).toBe("אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים בחשבונית.");
    expect(dunningEmailContent({ ...BASE, stage: 30, docType: "tax_invoice" }).intro).toBe(
      "חשבונית מספר 12 על סך ⁦₪ 3,600⁩ מ-05.07.2026 עדיין לא שולמה. חלפו 20 ימים.",
    );
  });

  it("never calls a proforma a tax invoice, in any stage", () => {
    for (const stage of STAGES) {
      const c = dunningEmailContent({ ...BASE, stage, docType: "proforma" });
      const all = [c.subject, c.intro, c.cta].join("\n");
      expect(all).not.toContain("חשבונית");
      expect(c.subject).toContain("חשבון עסקה מספר 12");
    }
    expect(dunningEmailContent({ ...BASE, stage: 3, docType: "proforma" }).intro).toContain(
      "שראיתם את חשבון העסקה מספר 12",
    );
    expect(dunningEmailContent({ ...BASE, stage: 3, docType: "proforma" }).cta).toContain(
      "נמצאים בחשבון העסקה.",
    );
    // Masculine noun, masculine verb.
    expect(dunningEmailContent({ ...BASE, stage: 30, docType: "proforma" }).intro).toContain(
      "עדיין לא שולם.",
    );
  });

  it("shows a foreign-currency total in its own currency, never with a shekel sign", () => {
    for (const stage of STAGES) {
      const c = dunningEmailContent({ ...BASE, stage, docType: "tax_invoice", currency: "USD" });
      expect(c.intro).toContain("$3,600.00");
      expect(c.intro).not.toContain("₪");
    }
  });

  it("formats the issue date the Israeli way, never the raw ISO value", () => {
    for (const stage of STAGES) {
      const c = dunningEmailContent({ ...BASE, stage, docType: "tax_invoice" });
      expect(c.intro).toContain("05.07.2026");
      expect(c.intro).not.toContain("2026-07-05");
    }
  });

  it("leaves no placeholder and no long dash in any rendered variant", () => {
    for (const stage of STAGES) {
      for (const docType of ["tax_invoice", "proforma"]) {
        const c = dunningEmailContent({ ...BASE, stage, docType });
        for (const line of [c.subject, c.intro, c.cta, c.signoff]) {
          expect(line).not.toMatch(/[{}]/);
          for (const dash of LONG_DASHES) expect(line.includes(dash)).toBe(false);
        }
      }
    }
  });

  it("falls back to the tax invoice nouns for an unknown type", () => {
    expect(dunningDocVars("something")).toEqual(dunningDocVars("tax_invoice"));
  });
});

describe("whatsappReminderText currency and type", () => {
  const args = {
    businessName: "עסק",
    clientName: "לקוח",
    number: 12,
    total: 3600,
    date: "05.07.2026",
    viewUrl: "https://friendlyinvoice.co.il/view/x",
  };

  it("uses the document currency", () => {
    const text = whatsappReminderText({ ...args, days: 5, stage: 3, currency: "EUR" });
    expect(text).toContain("€3,600.00");
    expect(text).not.toContain("₪");
  });

  it("names a proforma correctly before day 3 and in the stages", () => {
    expect(whatsappReminderText({ ...args, days: 1, stage: null, docType: "proforma" })).toContain(
      "שלחתי לך את חשבון העסקה מספר 12",
    );
    expect(whatsappReminderText({ ...args, days: 1, stage: null })).toContain("שלחתי לך את החשבונית מספר 12");
    for (const stage of STAGES) {
      expect(whatsappReminderText({ ...args, days: stage, stage, docType: "proforma" })).not.toContain("חשבונית");
    }
  });
});

describe("whatsappShareText", () => {
  const args = { clientName: "Dana", number: 7, total: 1200, viewUrl: "https://friendlyinvoice.co.il/view/y" };

  it("uses the document currency", () => {
    const text = whatsappShareText({ ...args, type: "quote", currency: "USD" });
    expect(text).toContain("$1,200.00");
    expect(text).not.toContain("₪");
  });

  it("agrees in gender: masculine only for a proforma", () => {
    expect(whatsappShareText({ ...args, type: "tax_invoice" })).toContain("מצורפת חשבונית מס מספר #7");
    expect(whatsappShareText({ ...args, type: "quote" })).toContain("מצורפת הצעת מחיר מספר #7");
    expect(whatsappShareText({ ...args, type: "proforma" })).toContain("מצורף חשבון עסקה מספר #7");
  });

  it("writes to an English document's client in English", () => {
    const text = whatsappShareText({ ...args, type: "tax_invoice", currency: "GBP", language: "en" });
    expect(text).toBe(
      "Hello Dana,\n\nAttached is your Tax Invoice no. #7 for ⁦£1,200.00⁩.\n\nView and download: https://friendlyinvoice.co.il/view/y",
    );
    expect(text).not.toMatch(/[֐-׿]/);
  });
});
