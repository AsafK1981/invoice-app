import { describe, it, expect } from "vitest";
import { DOC_STRINGS, docStrings, docDir, toDocLang } from "../src/lib/document-strings";
import {
  BUSINESS_TYPE_LABELS,
  DOC_SUM_LABEL,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
} from "../src/lib/types";

/**
 * The document dictionary is the whole "English documents" feature. Two things
 * can go wrong and both are invisible in a build:
 *
 *   1. A key exists in Hebrew but not in English (or vice versa), so one word
 *      of the wrong language lands in the middle of a customer's invoice.
 *   2. A Hebrew value drifts while someone edits the English side, silently
 *      changing every Hebrew document ever rendered afterwards.
 */
describe("DOC_STRINGS", () => {
  const heKeys = Object.keys(DOC_STRINGS.he).sort();
  const enKeys = Object.keys(DOC_STRINGS.en).sort();

  it("has exactly the same keys in both languages", () => {
    expect(enKeys).toEqual(heKeys);
  });

  it("has a non-empty value of the same kind for every key", () => {
    for (const key of heKeys) {
      const he = (DOC_STRINGS.he as unknown as Record<string, unknown>)[key];
      const en = (DOC_STRINGS.en as unknown as Record<string, unknown>)[key];
      expect(typeof en, key).toBe(typeof he);
      if (typeof he === "string") {
        expect(he.length, `he.${key}`).toBeGreaterThan(0);
        expect((en as string).length, `en.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("covers every document type, payment method and business type in both languages", () => {
    for (const type of Object.keys(DOCUMENT_TYPE_LABELS)) {
      expect(DOC_STRINGS.en.documentTypes[type as never], type).toBeTruthy();
      expect(DOC_STRINGS.en.sumLabel[type as never], type).toBeTruthy();
    }
    for (const method of Object.keys(PAYMENT_METHOD_LABELS)) {
      expect(DOC_STRINGS.en.paymentMethods[method as never], method).toBeTruthy();
    }
    for (const bizType of Object.keys(BUSINESS_TYPE_LABELS)) {
      expect(DOC_STRINGS.en.businessTypes[bizType as never], bizType).toBeTruthy();
    }
  });

  it("keeps the Hebrew maps identical to the app-wide labels", () => {
    expect(DOC_STRINGS.he.documentTypes).toEqual(DOCUMENT_TYPE_LABELS);
    expect(DOC_STRINGS.he.sumLabel).toEqual(DOC_SUM_LABEL);
    expect(DOC_STRINGS.he.paymentMethods).toEqual(PAYMENT_METHOD_LABELS);
    expect(DOC_STRINGS.he.businessTypes).toEqual(BUSINESS_TYPE_LABELS);
  });

  it("keeps the Hebrew literals exactly as the document rendered them before", () => {
    const he = DOC_STRINGS.he;
    expect(he.original).toBe("מקור");
    expect(he.copy).toBe("העתק");
    expect(he.autoNumber).toBe("(אוטומטי)");
    expect(he.toLabel).toBe("לכבוד");
    expect(he.clientTaxId).toBe("ח.פ / ת.ז");
    expect(he.noClient).toBe("לקוח לא נבחר");
    expect(he.allocationLabel).toBe("מספר הקצאה · חשבונית ישראל");
    expect(he.subjectLabel).toBe("בגין");
    expect(he.itemsLabel).toBe("פירוט");
    expect(he.thDescription).toBe("תיאור");
    expect(he.thQuantity).toBe("כמות");
    expect(he.thUnitPrice).toBe("מחיר יחידה");
    expect(he.thAmount).toBe("סכום");
    expect(he.noItems).toBe("לא הוזנו פריטים עדיין");
    expect(he.totalBeforeDiscount).toBe("סה״כ לפני הנחה");
    expect(he.discount).toBe("הנחה");
    expect(he.subtotal).toBe("סכום ביניים");
    expect(he.vat).toBe("מע״מ");
    expect(he.zeroRatedNote).toBe("עסקה בשיעור אפס: ייצוא שירותים");
    expect(he.rounding).toBe("עיגול");
    expect(he.totalInIls).toBe("סה״כ ב-₪");
    expect(he.withholding).toBe("ניכוי מס במקור");
    expect(he.paidActual).toBe("שולם בפועל");
    expect(he.paidNote).toBe("הסכום נטו שהתקבל, אחרי ניכוי מס במקור");
    expect(he.paymentMethodLabel).toBe("אמצעי תשלום");
    expect(he.paymentDetailsLabel).toBe("פרטי תשלום");
    expect(he.bankTransfer).toBe("העברה בנקאית");
    expect(he.notesLabel).toBe("הערות");
    expect(he.footerIssued).toBe("מסמך זה הופק אלקטרונית");
    expect(he.footerBrand).toBe("הופק באמצעות");
    expect(he.documentTypes.tax_invoice).toBe("חשבונית מס");
    expect(he.sumLabel.credit_note).toBe("סה״כ זיכוי");
    expect(he.businessTypes.exempt).toBe("עוסק פטור");
  });

  it("composes the same Hebrew payment-detail phrases as before", () => {
    const he = DOC_STRINGS.he;
    expect(he.check("4521")).toBe("שיק 4521");
    expect(he.branch("812")).toBe("סניף 812");
    expect(he.account("123456")).toBe("חשבון 123456");
    expect(he.checkDueDate("01.08.2026")).toBe("ז״פ 01.08.2026");
    expect(he.cardLast4("1234")).toBe("מסתיים ב-1234");
    expect(he.cardApproval("00777")).toBe("אישור 00777");
    expect(he.reference("13094")).toBe("אסמכתא 13094");
    expect(he.exchangeRate("3.7000")).toBe("(שער 3.7000)");
  });

  it("names the English document types the way a foreign customer expects", () => {
    const en = DOC_STRINGS.en;
    expect(en.documentTypes.receipt).toBe("Receipt");
    expect(en.documentTypes.quote).toBe("Quote");
    expect(en.documentTypes.proforma).toBe("Pro Forma Invoice");
    expect(en.documentTypes.tax_invoice).toBe("Tax Invoice");
    expect(en.documentTypes.tax_invoice_receipt).toBe("Tax Invoice / Receipt");
    expect(en.documentTypes.credit_note).toBe("Credit Note");
    expect(en.businessTypes.exempt).toBe("Exempt Dealer");
    expect(en.businessTypes.authorized).toBe("Licensed Dealer");
    expect(en.businessTypes.company).toBe("Ltd. Company");
  });

  it("has no Hebrew left anywhere in the English dictionary", () => {
    const hebrew = /[֐-׿]/;
    for (const [key, value] of Object.entries(DOC_STRINGS.en)) {
      if (typeof value === "string") {
        expect(hebrew.test(value), `en.${key}`).toBe(false);
      } else if (typeof value === "function") {
        expect(hebrew.test(value("X")), `en.${key}`).toBe(false);
      } else {
        for (const [k, v] of Object.entries(value as Record<string, string>)) {
          expect(hebrew.test(v), `en.${key}.${k}`).toBe(false);
        }
      }
    }
  });
});

describe("docStrings / toDocLang / docDir", () => {
  it("returns English only for an exact 'en'", () => {
    expect(docStrings("en")).toBe(DOC_STRINGS.en);
    expect(docStrings("he")).toBe(DOC_STRINGS.he);
    expect(docStrings(undefined)).toBe(DOC_STRINGS.he);
    expect(docStrings(null)).toBe(DOC_STRINGS.he);
    expect(docStrings("EN")).toBe(DOC_STRINGS.he);
    expect(docStrings("english")).toBe(DOC_STRINGS.he);
  });

  it("narrows any untrusted value to a known language", () => {
    expect(toDocLang("en")).toBe("en");
    expect(toDocLang("he")).toBe("he");
    expect(toDocLang(undefined)).toBe("he");
    expect(toDocLang("' OR 1=1")).toBe("he");
  });

  it("maps the language to a writing direction", () => {
    expect(docDir("en")).toBe("ltr");
    expect(docDir("he")).toBe("rtl");
    expect(docDir(undefined)).toBe("rtl");
  });
});
