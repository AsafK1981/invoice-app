import { describe, it, expect } from "vitest";
import { groupUniformItems, mapUniformBusiness, mapUniformDocument, mapUniformExpense } from "@/lib/uniform-structure/rows";
import { uniformFolderPath } from "@/lib/uniform-structure/folder";
import { checkUniformExport } from "@/lib/uniform-structure/check";

describe("uniform rows", () => {
  it("maps the fields the export needs, including rate, customer number and import batch", () => {
    const d = mapUniformDocument({ id: "d", type: "tax_invoice", number: "12", date: "2026-03-01", client_id: null, client_name: "x", client_tax_id: "13333331", status: "sent", subtotal: "100", vat: "0", total: "100", currency: "USD", exchange_rate: "3.6", subtotal_ils: "360", vat_ils: null, total_ils: "360", rounding: null, import_batch_id: "b1", zero_rated: true }, []);
    expect(d).toMatchObject({ number: 12, clientId: "", clientTaxId: "13333331", currency: "USD", exchangeRate: 3.6, subtotalIls: 360, totalIls: 360, rounding: 0, importBatchId: "b1", zeroRated: true });
    expect(d.vatIls).toBeUndefined();
  });

  it("groups items per document in stored order", () => {
    const items = groupUniformItems([
      { id: "b", document_id: "d", sort_order: 2, description: "שני", quantity: "1", unit_price: "5", total: "5" },
      { id: "a", document_id: "d", sort_order: 1, description: "ראשון", quantity: 1, unit_price: 10, total: 10 },
    ]);
    expect(items.get("d")!.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("maps business and expense rows without inventing values", () => {
    expect(mapUniformBusiness({ id: "biz", name: null, business_type: "authorized", tax_id: null, address: null })).toMatchObject({ name: "", taxId: "", address: "" });
    expect(mapUniformExpense({ id: "e", date: "2026-01-02", category: null, supplier: "s", amount: "7", vat_amount: null })).toMatchObject({ category: "", amount: 7, vatAmount: 0 });
  });
});

describe("uniform folder path", () => {
  it("names the folder with the padded dealer number without its check digit", () => {
    const at = new Date("2026-01-05T07:07:00Z"); // 09:07 in Israel (UTC+2)
    expect(uniformFolderPath("512345679", at)).toBe("OPENFRMT/51234567.26/01050907");
    expect(uniformFolderPath("13333331", at)).toBe("OPENFRMT/01333333.26/01050907");
  });
});

describe("checkUniformExport", () => {
  const business = { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized" as const, address: "" };
  const input = { business, documents: [], clients: [], expenses: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31" };

  it("builds and checks a clean export, noting a missing registration number", () => {
    const check = checkUniformExport(input, { sample: false, registrationNumber: "" });
    expect(check.ok).toBe(true);
    expect(check.result).not.toBeNull();
    expect(check.issues.map((i) => i.code)).toEqual(["software_registration_missing"]);
  });

  it("does not build when the input blocks", () => {
    const check = checkUniformExport({ ...input, business: { ...business, taxId: "1" } }, { registrationNumber: "12345678" });
    expect(check).toMatchObject({ ok: false, result: null });
    expect(check.issues.map((i) => i.code)).toContain("dealer_number_invalid");
  });
});
