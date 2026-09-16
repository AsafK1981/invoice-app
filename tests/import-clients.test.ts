import { describe, it, expect } from "vitest";
import {
  mapImportedClientRow,
  paymentTermsCell,
  unrecognizedTermsNote,
  PAYMENT_TERMS_HEADER_ALIASES,
} from "@/lib/import-clients";

const opts = { id: "c-1", createdAt: "2026-09-16" };

describe("mapImportedClientRow", () => {
  it("maps a recognised terms column onto the new client", () => {
    const out = mapImportedClientRow({ "שם": "אלפא", "ח.פ / ת.ז": "514123456", "תנאי תשלום": "שוטף+30" }, opts);
    expect(out).toEqual({
      client: {
        id: "c-1",
        name: "אלפא",
        taxId: "514123456",
        address: undefined,
        phone: undefined,
        email: undefined,
        notes: undefined,
        createdAt: "2026-09-16",
        paymentTerms: "eom_30",
      },
      termsUnrecognized: false,
    });
  });

  it("imports a row with unrecognised terms without terms, and flags it", () => {
    const out = mapImportedClientRow({ name: "Beta", payment_terms: "שוטף+120" }, opts);
    expect(out?.client.name).toBe("Beta");
    expect(out?.client.paymentTerms).toBeUndefined();
    expect(out?.termsUnrecognized).toBe(true);
  });

  it("does not flag a file without the column, or an empty cell", () => {
    const absent = mapImportedClientRow({ "שם": "גמא", "טלפון": "050-1234567" }, opts);
    expect(absent?.client.paymentTerms).toBeUndefined();
    expect(absent?.termsUnrecognized).toBe(false);
    expect(absent?.client.phone).toBe("050-1234567");

    const blank = mapImportedClientRow({ "שם": "גמא", "תנאי תשלום": "   " }, opts);
    expect(blank?.client.paymentTerms).toBeUndefined();
    expect(blank?.termsUnrecognized).toBe(false);
  });

  it("returns null for a row without a name", () => {
    expect(mapImportedClientRow({ "שם": "  ", "תנאי תשלום": "שוטף" }, opts)).toBeNull();
  });

  it("falls back to the English name column when the Hebrew one is blank", () => {
    expect(mapImportedClientRow({ "שם": " ", name: "Delta" }, opts)?.client.name).toBe("Delta");
  });

  it.each(PAYMENT_TERMS_HEADER_ALIASES)("accepts the %j header", (header) => {
    const out = mapImportedClientRow({ "שם": "אלפא", [header]: "net 30" }, opts);
    expect(out?.client.paymentTerms).toBe("net_30");
  });

  it("matches headers trimmed and case-insensitively", () => {
    expect(paymentTermsCell({ "  Payment   Terms ": "eom" })).toBe("eom");
    expect(paymentTermsCell({ TERMS: "30" })).toBe("30");
    expect(paymentTermsCell({ "תנאי  תשלום": "מיידי" })).toBe("מיידי");
    expect(paymentTermsCell({ "תנאים": "30" })).toBe("");
  });
});

describe("unrecognizedTermsNote", () => {
  it("is silent for none", () => {
    expect(unrecognizedTermsNote(0)).toBeNull();
  });
  it("says one client in words, with a singular verb", () => {
    expect(unrecognizedTermsNote(1)).toBe("לקוח אחד יובא בלי תנאי תשלום, כי הערך בקובץ לא זוהה.");
  });
  it("counts many", () => {
    expect(unrecognizedTermsNote(3)).toBe("3 לקוחות יובאו בלי תנאי תשלום, כי הערך בקובץ לא זוהה.");
  });
});
