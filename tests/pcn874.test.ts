import { describe, it, expect } from "vitest";
import {
  buildPcn874,
  headerLine,
  transactionLine,
  footerLine,
  validatePcn874Content,
  roundShekel,
  signedDigits,
  pcnCanDownload,
  pcnBlockingCodes,
} from "@/lib/ita/pcn874";
import { buildFilingFixModel } from "@/lib/filing-fix-items";
import type { Expense, InvoiceDocument } from "@/lib/types";

const business = { taxId: "512345679", businessType: "authorized" as const };
const range = { start: "2026-01-01", end: "2026-02-28" };
const generatedOn = new Date("2026-03-10T09:00:00+02:00");

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    type: "tax_invoice",
    number: 1001,
    date: "2026-01-15",
    clientId: "c1",
    clientName: "לקוח בע״מ",
    clientTaxId: "515555555",
    status: "paid",
    items: [],
    subtotal: 10000,
    vat: 1800,
    total: 11800,
    ...over,
  };
}

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    date: "2026-01-20",
    category: "תוכנה",
    supplier: "ספק",
    amount: 1180,
    vatAmount: 180,
    supplierTaxId: "513333336",
    reference: "A-7788",
    ...over,
  };
}

/** A clean identified sale that keeps a period out of refund mode without adding warnings. */
const sale = () => doc({ allocationNumber: "123456789" });

function build(documents: InvoiceDocument[], expenses: Expense[]) {
  return buildPcn874({ business, documents, expenses, range, generatedOn });
}

describe("PCN874 record layout", () => {
  it("header is 131 chars, transaction 60, footer 10", () => {
    const r = build([doc()], [expense()]);
    const lines = r.content.split("\r\n").filter(Boolean);
    expect(lines[0]).toHaveLength(131);
    expect(lines[0][0]).toBe("O");
    expect(lines.at(-1)).toHaveLength(10);
    expect(lines.at(-1)).toBe("X512345679");
    for (const l of lines.slice(1, -1)) expect(l).toHaveLength(60);
    expect(r.content.endsWith("\r\n")).toBe(true);
    expect(validatePcn874Content(r.content)).toEqual([]);
  });

  it("writes dealer, period (last month of the range), report type 1 and file date in the header", () => {
    const r = build([], []);
    expect(r.header.reportMonth).toBe("202602");
    expect(headerLine(r.header).slice(0, 25)).toBe("O" + "512345679" + "202602" + "1" + "20260310");
    expect(r.filename).toBe("PCN874_512345679_202602.txt");
  });

  it("encodes a regular identified sale as S with unsigned VAT and signed sum", () => {
    const r = build([doc({ number: 42, allocationNumber: "123456789" })], []);
    const s = r.transactions.find((t) => t.entryType === "S")!;
    expect(transactionLine(s)).toBe(
      "S" + "515555555" + "20260115" + "0000" + "000000042" + "000001800" + "+0000010000" + "123456789",
    );
  });

  it("pads short allocation numbers and takes the last 9 digits of long ones", () => {
    const r = build([doc({ allocationNumber: "98765432101" })], []);
    expect(r.transactions[0].allocationNumber).toBe("765432101");
    expect(signedDigits(-5, 3)).toBe("-005");
  });
});

describe("PCN874 classification", () => {
  it("sums small sales to customers without a VAT number into one L record", () => {
    const r = build(
      [
        doc({ id: "a", clientTaxId: undefined, subtotal: 1000, vat: 180, total: 1180 }),
        doc({ id: "b", number: 1002, clientTaxId: "", subtotal: 2000, vat: 360, total: 2360 }),
      ],
      [],
    );
    expect(r.transactions).toHaveLength(1);
    const l = r.transactions[0];
    expect(l.entryType).toBe("L");
    expect(l.vatId).toBe("000000000");
    expect(l.refNumber).toBe("000000002");
    expect(l.invoiceSum).toBe(3000);
    expect(l.totalVat).toBe(540);
    expect(l.invoiceDate).toBe("20260228");
    expect(l.sourceIds).toEqual(["a", "b"]);
    expect(r.warnings).toEqual([]);
  });

  it("flags a 5,000+ sale without a customer VAT number as an error but still emits S", () => {
    const r = build([doc({ clientTaxId: undefined, subtotal: 5000, vat: 900, total: 5900 })], []);
    expect(r.transactions[0].entryType).toBe("S");
    expect(r.transactions[0].vatId).toBe("000000000");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].level).toBe("error");
    expect(r.warnings[0].source).toBe("document");
  });

  it("credit notes carry a minus on the sum, unsigned VAT, and net the header down", () => {
    const r = build(
      [
        doc({ id: "inv", subtotal: 10000, vat: 1800, total: 11800 }),
        doc({ id: "cn", type: "credit_note", number: 7, subtotal: -2000, vat: -360, total: -2360 }),
      ],
      [],
    );
    const cn = r.transactions.find((t) => t.sourceIds[0] === "cn")!;
    expect(cn.invoiceSum).toBe(-2000);
    expect(cn.totalVat).toBe(360);
    expect(transactionLine(cn)).toContain("000000360-0000002000");
    expect(r.header.taxableSalesAmount).toBe(8000);
    expect(r.header.taxableSalesVat).toBe(1440);
    expect(r.figures.netDue).toBe(1440);
  });

  it("a zero-VAT document WITHOUT the zero-rated flag stays taxable and is flagged, never promoted to export", () => {
    const r = build([doc({ clientTaxId: undefined, subtotal: 7000, vat: 0, total: 7000 })], []);
    expect(r.transactions[0].entryType).toBe("S");
    expect(r.header.zeroOrExemptSales).toBe(0);
    expect(r.header.taxableSalesAmount).toBe(7000);
    expect(r.warnings.some((w) => w.level === "warning" && w.message.includes("שיעור אפס"))).toBe(true);
  });

  it("zero-rated sales go to Y (no customer number) or S with zero VAT (identified), and into the exempt box", () => {
    const r = build(
      [
        doc({ id: "exp", clientTaxId: undefined, zeroRated: true, subtotal: 7000, vat: 0, total: 7000 }),
        doc({ id: "idz", zeroRated: true, subtotal: 3000, vat: 0, total: 3000 }),
      ],
      [],
    );
    const y = r.transactions.find((t) => t.entryType === "Y")!;
    expect(y.vatId).toBe("999999999");
    expect(y.totalVat).toBe(0);
    const s = r.transactions.find((t) => t.entryType === "S")!;
    expect(s.totalVat).toBe(0);
    expect(r.header.zeroOrExemptSales).toBe(10000);
    expect(r.header.taxableSalesAmount).toBe(0);
  });

  it("uses the shekel snapshot for foreign-currency documents", () => {
    const r = build(
      [doc({ currency: "USD", subtotal: 1000, vat: 180, total: 1180, subtotalIls: 3700, vatIls: 666, totalIls: 4366 })],
      [],
    );
    expect(r.transactions[0].invoiceSum).toBe(3700);
    expect(r.transactions[0].totalVat).toBe(666);
  });

  it("skips drafts, cancelled documents, receipts and documents outside the period", () => {
    const r = build(
      [
        doc({ status: "draft" }),
        doc({ status: "cancelled" }),
        doc({ type: "receipt", vat: 0 }),
        doc({ date: "2026-03-01" }),
      ],
      [],
    );
    expect(r.transactions).toHaveLength(0);
    expect(r.header.salesRecordCount).toBe(0);
  });

  it("emits T for inputs with supplier number + reference, K for small inputs without them", () => {
    // A sale keeps the period out of refund mode, so petty-cash aggregation is allowed.
    const r = build(
      [sale()],
      [
        expense({ id: "t1", reference: "INV/2026/15" }),
        expense({ id: "k1", supplierTaxId: undefined, reference: undefined, amount: 118, vatAmount: 18 }),
        expense({ id: "k2", supplierTaxId: undefined, reference: undefined, amount: 236, vatAmount: 36 }),
        expense({ id: "novat", amount: 500, vatAmount: 0 }),
      ],
    );
    const t = r.transactions.find((x) => x.entryType === "T")!;
    expect(t.vatId).toBe("513333336");
    expect(t.refNumber).toBe("000000015");
    expect(t.totalVat).toBe(180);
    expect(t.invoiceSum).toBe(1000);
    const k = r.transactions.find((x) => x.entryType === "K")!;
    expect(k.refNumber).toBe("000000002");
    expect(k.totalVat).toBe(54);
    expect(k.invoiceSum).toBe(300);
    expect(r.transactions.filter((x) => x.entryType !== "S")).toHaveLength(2);
    expect(r.header.inputsCount).toBe(2);
    expect(r.header.otherInputsVat).toBe(234);
    expect(r.refundPeriod).toBe(false);
    expect(r.warnings.some(w => w.level === "warning" && w.sourceId === "t1")).toBe(true);
  });

  it("an input with VAT of 300+ and no supplier details is an error, not petty cash", () => {
    const r = build([sale()], [expense({ supplierTaxId: undefined, amount: 2360, vatAmount: 360 })]);
    const t = r.transactions.find((x) => x.entryType === "T")!;
    expect(t.vatId).toBe("000000000");
    expect(r.warnings[0].level).toBe("error");
    expect(r.warnings[0].source).toBe("expense");
  });

  it("splits input VAT between equipment and other, and nets the total", () => {
    const r = build(
      [doc()],
      [expense({ isEquipment: true, amount: 5900, vatAmount: 900 }), expense({ amount: 1180, vatAmount: 180 })],
    );
    expect(r.header.equipmentInputsVat).toBe(900);
    expect(r.header.otherInputsVat).toBe(180);
    expect(r.header.totalVat).toBe(1800 - 900 - 180);
    expect(r.figures).toEqual({
      taxableSales: 10000,
      outputVat: 1800,
      zeroOrExemptSales: 0,
      equipmentInputVat: 900,
      otherInputVat: 180,
      netDue: 720,
    });
  });

  it("leaves a supplier invoice above the allocation threshold out of the file until it has an allocation number", () => {
    // 2026-01: threshold 10,000 before VAT.
    const r = build([sale()], [expense({ id: "noalloc", amount: 14160, vatAmount: 2160 })]);
    const item = r.warnings.find((w) => w.code === "supplier_allocation_missing");
    expect(item).toMatchObject({ level: "action", source: "expense", sourceId: "noalloc", excludedVat: 2160 });
    expect(r.warnings.some((w) => w.level === "error")).toBe(false);
    expect(r.header.otherInputsVat).toBe(0);
    expect(r.transactions.some((t) => t.entryType === "T")).toBe(false);
    expect(r.blockers).toEqual([]);
    expect(pcnCanDownload(r)).toBe(true);

    const ok = build([sale()], [expense({ id: "noalloc", amount: 14160, vatAmount: 2160, allocationNumber: "111222333" })]);
    expect(ok.warnings).toEqual([]);
    expect(ok.header.otherInputsVat).toBe(2160);
    expect(ok.transactions.find((x) => x.entryType === "T")!.allocationNumber).toBe("111222333");
  });

  it("excludes equipment input VAT the same way", () => {
    const r = build([sale()], [expense({ isEquipment: true, amount: 14160, vatAmount: 2160 })]);
    expect(r.header.equipmentInputsVat).toBe(0);
    expect(r.warnings[0]).toMatchObject({ code: "supplier_allocation_missing", excludedVat: 2160 });
  });

  it("warns about our own tax invoice above the allocation threshold without an allocation number", () => {
    const r = build([doc({ subtotal: 12000, vat: 2160, total: 14160 })], []);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].level).toBe("warning");
    expect(r.warnings[0].source).toBe("document");
  });

  it("rounds agorot half-up on magnitudes so a credit never rounds toward zero", () => {
    expect(roundShekel(10.5)).toBe(11);
    expect(roundShekel(10.49)).toBe(10);
    expect(roundShekel(-10.5)).toBe(-11);
    const r = build([doc({ subtotal: 1000.5, vat: 180.09, total: 1180.59 })], []);
    expect(r.transactions[0].invoiceSum).toBe(1001);
    expect(r.transactions[0].totalVat).toBe(180);
  });

  it("header counts reconcile with the body, and the self-check catches a corrupted line", () => {
    const r = build([doc(), doc({ id: "x", number: 2 })], [expense()]);
    expect(r.header.salesRecordCount).toBe(2);
    expect(r.header.inputsCount).toBe(1);
    expect(validatePcn874Content(r.content)).toEqual([]);
    const broken = r.content.replace("\r\nT", "\r\nT0");
    expect(validatePcn874Content(broken).length).toBeGreaterThan(0);
  });

  it("a refund period itemises every input instead of folding small ones into K", () => {
    const r = build(
      [doc({ subtotal: 100, vat: 18, total: 118 })],
      [
        expense({ id: "big", amount: 5900, vatAmount: 900 }),
        expense({ id: "small", supplierTaxId: undefined, reference: undefined, amount: 118, vatAmount: 18 }),
      ],
    );
    expect(r.refundPeriod).toBe(true);
    expect(r.header.totalVat).toBe(18 - 918);
    expect(r.transactions.some((t) => t.entryType === "K")).toBe(false);
    expect(r.transactions.filter((t) => t.entryType === "T")).toHaveLength(2);
    expect(r.warnings.some((w) => w.level === "error" && w.sourceId === "small" && w.message.includes("להחזר"))).toBe(true);
    expect(validatePcn874Content(r.content).some(p => p.includes("מספר העוסק"))).toBe(true);
  });

  it("blocks the file when the period is still open, spans more than two months, or the dealer number is not 9 digits", () => {
    const open = buildPcn874({ business, documents: [], expenses: [], range, generatedOn: new Date("2026-02-20T12:00:00+02:00") });
    expect(open.blockers.some((b) => b.message.includes("לא הסתיימה"))).toBe(true);
    const year = buildPcn874({ business, documents: [], expenses: [], range: { start: "2026-01-01", end: "2026-12-31" }, generatedOn: new Date("2027-01-05T12:00:00+02:00") });
    expect(year.blockers.some((b) => b.message.includes("חודשיים"))).toBe(true);
    const badDealer = buildPcn874({ business: { taxId: "1234", businessType: "authorized" }, documents: [], expenses: [], range, generatedOn });
    expect(badDealer.blockers.some((b) => b.message.includes("9 ספרות"))).toBe(true);
    expect(build([], []).blockers).toEqual([]);
  });

  it("the self-check catches a header whose VAT totals do not match the body", () => {
    const r = build([doc()], [expense()]);
    // Flip the S record's VAT digits: header says 1800, body now says 1801.
    const tampered = r.content.replace("000001800+0000010000", "000001801+0000010000");
    expect(validatePcn874Content(tampered).some((p) => p.includes("מס העסקאות"))).toBe(true);
  });

  it("footer is X plus the dealer number", () => {
    expect(footerLine("12345678")).toBe("X012345678");
  });
});


describe("PCN874 preflight rejects malformed source data", () => {
  it.each([
    { subtotal: Number.NaN }, { vat: Number.POSITIVE_INFINITY },
    { subtotal: 10_000_000_000 }, { number: 1_000_000_000 },
    { number: 0 }, { date: "2026-02-30" }, { date: "" },
    { clientTaxId: "515555554" }, { clientTaxId: "ABC515555550" },
    { allocationNumber: "1234567890" }, { allocationNumber: "000000000" },
    { zeroRated: true }, { currency: "USD" }, { subtotal: -100, vat: 18 },
  ])("blocks malformed document %j before normalization", (over) => {
    const r = build([doc({ ...over, id: "bad" })], []);
    expect(r.warnings.some(w => w.sourceId === "bad" && w.level === "error")).toBe(true);
  });
  it.each([{ vatAmount: NaN }, { vatAmount: -18 }, { amount: 100, vatAmount: 180 }])("blocks bad input %j even when filtered out of the body", (over) => {
    expect(build([sale()], [expense({ ...over, id: "bad" })]).warnings.some(w => w.sourceId === "bad" && w.level === "error")).toBe(true);
  });
  it.each(["13333331", "1234566", "51-333333-6", "\u200F513333336\u200E", " 513 333 336 "])(
    "accepts a valid supplier number typed as %j and pads it to 9 digits in the file",
    (supplierTaxId) => {
      const r = build([sale()], [expense({ supplierTaxId, id: "short" })]);
      expect(r.warnings.filter(w => w.sourceId === "short" && w.level === "error")).toEqual([]);
      const expected = supplierTaxId.replace(/\D/g, "").padStart(9, "0");
      expect(r.content.split("\r\n").some(l => l[0] === "T" && l.slice(1, 10) === expected)).toBe(true);
    },
  );
  it.each(["51333333X", "1234567", "5133333360"])("still blocks supplier number %j", (supplierTaxId) => {
    expect(build([sale()], [expense({ supplierTaxId, id: "bad" })]).warnings.some(w => w.sourceId === "bad" && w.level === "error")).toBe(true);
  });
  it("accepts the business's own 8-digit number", () => {
    expect(buildPcn874({ business: { ...business, taxId: "13333331" }, documents: [sale()], expenses: [], range, generatedOn }).blockers).toEqual([]);
  });
  it("ignores invalid drafts and cancelled documents", () => {
    expect(build([doc({ status: "draft", date: "" }), doc({ status: "cancelled", vat: NaN })], []).warnings).toEqual([]);
  });
  it("validates closed whole calendar periods", () => {
    for (const badRange of [{ start: "2026-02-02", end: "2026-02-28" }, { start: "2026-02-01", end: "2026-02-30" }, { start: "2026-02-01", end: "2026-02-27" }]) {
      expect(buildPcn874({ business, documents: [], expenses: [], range: badRange, generatedOn }).blockers.length).toBeGreaterThan(0);
    }
  });
  it("requires supplier allocations strictly above threshold on invoice date", () => {
    const at = build([sale()], [expense({ amount: 11800, vatAmount: 1800 })]);
    expect(at.warnings.some(w => w.code === "supplier_allocation_missing")).toBe(false);
    expect(at.header.otherInputsVat).toBe(1800);
    const above = build([sale()], [expense({ amount: 11800.01, vatAmount: 1800 })]);
    expect(above.warnings.some(w => w.source === "expense" && w.level === "action" && w.code === "supplier_allocation_missing")).toBe(true);
    expect(above.header.otherInputsVat).toBe(0);
  });
  it("detects numeric corruption, impossible dates and a wrong payable independently", () => {
    const r = build([sale()], []);
    const lines = r.content.trim().split("\r\n");
    for (const [offset, value] of [[31, "x"], [10, "20260230"], [40, "?"]] as const) {
      const modified = [...lines];
      modified[1] = lines[1].slice(0, offset) + value + lines[1].slice(offset + value.length);
      expect(validatePcn874Content(modified.join("\r\n")).length).toBeGreaterThan(0);
    }
    const modified = [...lines];
    modified[0] = lines[0].slice(0, 119) + "+00000000001";
    expect(validatePcn874Content(modified.join("\r\n")).some(p => p.includes("לתשלום"))).toBe(true);
  });
  it("duplicate suggestions distinguish supplier and document type", () => {
    const r = build([sale(), doc({ type: "credit_note", subtotal: -100, vat: -18, total: -118 })], [expense(), expense({ supplierTaxId: "512345674" })]);
    expect(r.warnings.some(w => w.message.includes("דיווח כפול"))).toBe(false);
    expect(build([sale(), sale()], []).warnings.some(w => w.message.includes("דיווח כפול"))).toBe(true);
  });
});

describe("PCN874 issue codes", () => {
  it("gives every blocker and warning a stable code", () => {
    const r = buildPcn874({
      business: { taxId: "1234", businessType: "authorized" },
      documents: [doc({ id: "d", clientTaxId: "515555554", allocationNumber: "123456789" })],
      expenses: [expense({ id: "e", supplierTaxId: undefined, amount: 2360, vatAmount: 360 })],
      range,
      generatedOn: new Date("2026-02-20T12:00:00+02:00"),
    });
    const blockerCodes = r.blockers.map((b) => b.code);
    expect(blockerCodes).toEqual(expect.arrayContaining(["dealer_number_invalid", "period_open", "file_structure"]));
    expect(r.warnings.find((w) => w.sourceId === "d")?.code).toBe("customer_number_invalid");
    expect(r.warnings.find((w) => w.sourceId === "e")?.code).toBe("input_missing_supplier_details");
    expect(r.warnings.every((w) => typeof w.code === "string" && w.code.length > 0)).toBe(true);
    expect(pcnCanDownload(r)).toBe(false);
    expect(pcnBlockingCodes(r)).toEqual(expect.arrayContaining(["dealer_number_invalid", "customer_number_invalid", "input_missing_supplier_details"]));
  });

  it("marks notes with their own codes and lets a clean file download", () => {
    const dup = build([sale(), sale()], []);
    expect(dup.warnings.map((w) => w.code)).toContain("possible_duplicate");
    expect(pcnCanDownload(dup)).toBe(true);
    expect(pcnBlockingCodes(dup)).toEqual([]);
    expect(build([doc({ subtotal: 12000, vat: 2160, total: 14160 })], []).warnings[0].code).toBe("sale_allocation_missing");
  });
});

describe("PCN874 builder and preflight share one strict normalizer", () => {
  const tLines = (content: string) => content.split("\r\n").filter((l) => l[0] === "T");
  const sLines = (content: string) => content.split("\r\n").filter((l) => l[0] === "S");

  it.each(["513333336", "13333331", "51-333333-6", "513.333.336", " 513 333 336 ", "\u200F513333336\u200E", "\u2066513333336\u2069"])(
    "a supplier number typed as %j builds, pads and passes",
    (supplierTaxId) => {
      const r = build([sale()], [expense({ id: "ok", supplierTaxId })]);
      const expected = supplierTaxId.replace(/\D/g, "").padStart(9, "0");
      expect(r.warnings.filter((w) => w.sourceId === "ok" && w.level === "error")).toEqual([]);
      expect(tLines(r.content).map((l) => l.slice(1, 10))).toEqual([expected]);
      expect(validatePcn874Content(r.content)).toEqual([]);
    },
  );

  it.each(["A513333336", "513333336X", "1513333336", "513333337"])(
    "supplier number %j blocks and is never written as a stripped or truncated valid number",
    (supplierTaxId) => {
      const r = build([sale()], [expense({ id: "bad", supplierTaxId })]);
      expect(r.warnings.some((w) => w.sourceId === "bad" && w.level === "error")).toBe(true);
      expect(tLines(r.content).some((l) => l.slice(1, 10) === "513333336")).toBe(false);
      expect(pcnCanDownload(r)).toBe(false);
    },
  );

  it.each(["A515555555", "1515555555"])("customer number %j is never written as 515555555", (clientTaxId) => {
    const r = build([doc({ id: "bad", clientTaxId, allocationNumber: "123456789" })], []);
    expect(r.warnings.some((w) => w.sourceId === "bad" && w.level === "error")).toBe(true);
    expect(sLines(r.content).some((l) => l.slice(1, 10) === "515555555")).toBe(false);
  });
});

describe("PCN874 silent repairs (Layer 2)", () => {
  it("skips an expense without VAT before any amount check, a supplier refund included", () => {
    const r = build([sale()], [expense({ id: "refund", amount: -500, vatAmount: 0, supplierTaxId: "ABC", reference: "x" })]);
    expect(r.warnings.filter((w) => w.sourceId === "refund")).toEqual([]);
    expect(r.transactions.some((t) => t.sourceIds.includes("refund"))).toBe(false);
    expect(pcnCanDownload(r)).toBe(true);
  });

  it("folds a digitless reference with VAT under 300 into petty cash in a non-refund period", () => {
    const r = build([sale()], [expense({ id: "k", reference: "חשבונית", amount: 118, vatAmount: 18 })]);
    expect(r.warnings.filter((w) => w.sourceId === "k")).toEqual([]);
    expect(r.transactions.find((t) => t.entryType === "K")?.sourceIds).toEqual(["k"]);
    expect(pcnCanDownload(r)).toBe(true);
  });

  it("still blocks a digitless reference in a refund period, with the refund code only", () => {
    const r = build(
      [doc({ subtotal: 100, vat: 18, total: 118, allocationNumber: "123456789" })],
      [expense({ id: "big", amount: 5900, vatAmount: 900 }), expense({ id: "k", reference: "חשבונית", amount: 118, vatAmount: 18 })],
    );
    expect(r.refundPeriod).toBe(true);
    const codes = r.warnings.filter((w) => w.sourceId === "k").map((w) => w.code);
    expect(codes).toContain("refund_input_missing_supplier_details");
    expect(codes).not.toContain("reference_invalid");
  });

  it("still blocks a broken date and a 10-digit allocation number", () => {
    expect(build([sale()], [expense({ id: "d", date: "2026-02-30" })]).warnings.find((w) => w.sourceId === "d")?.code).toBe("date_invalid");
    const r = build([sale()], [expense({ id: "a", allocationNumber: "1234567890" })]);
    expect(r.warnings.some((w) => w.sourceId === "a" && w.code === "allocation_invalid" && w.level === "error")).toBe(true);
  });

  it("accepts an allocation number with separators or bidi marks when exactly 9 digits remain", () => {
    const r = build([sale()], [expense({ id: "a", allocationNumber: "\u200F111-222-333\u200E" })]);
    expect(r.warnings.filter((w) => w.sourceId === "a")).toEqual([]);
    expect(r.transactions.find((t) => t.entryType === "T")?.allocationNumber).toBe("111222333");
  });
  it("accepts an allocation number written with typographic dashes", () => {
    const r = build([sale()], [expense({ id: "a", allocationNumber: "111\u2013222\u2014333" })]);
    expect(r.warnings.filter((w) => w.sourceId === "a")).toEqual([]);
  });
});

describe("zero-rated exports with a foreign customer number", () => {
  it("does not block a zero-rated export whose customer number is not Israeli, and writes Y", () => {
    const r = build([doc({ id: "exp", zeroRated: true, subtotal: 7000, vat: 0, total: 7000, clientTaxId: "DE123456789" })], []);
    expect(r.warnings.filter((w) => w.sourceId === "exp" && w.level === "error")).toEqual([]);
    expect(r.transactions[0]).toMatchObject({ entryType: "Y", vatId: "999999999" });
    expect(pcnCanDownload(r)).toBe(true);
  });

  it("does not block a zero-rated export whose customer number has more than 9 digits", () => {
    const r = build([doc({ id: "exp", zeroRated: true, subtotal: 7000, vat: 0, total: 7000, clientTaxId: "1234567890123" })], []);
    expect(r.warnings.filter((w) => w.sourceId === "exp" && w.level === "error")).toEqual([]);
    expect(r.transactions[0]).toMatchObject({ entryType: "Y", vatId: "999999999" });
  });

  it.each(["513333337", "51-333333-7", "1234567"])(
    "blocks a zero-rated document whose Israeli-looking number %j fails the checksum, never filing it as an export",
    (clientTaxId) => {
      const r = build([doc({ id: "zr", zeroRated: true, subtotal: 7000, vat: 0, total: 7000, clientTaxId })], []);
      expect(r.warnings.some((w) => w.sourceId === "zr" && w.code === "customer_number_invalid" && w.level === "error")).toBe(true);
      expect(pcnCanDownload(r)).toBe(false);
      const model = buildFilingFixModel(r, { business: { taxId: "513333336" }, documents: [doc({ id: "zr", zeroRated: true, clientTaxId })], expenses: [] });
      expect(model.blocking.find((i) => i.code === "customer_number_invalid")?.control).toEqual({ kind: "customer_tax_id", documentId: "zr", current: clientTaxId });
    },
  );

  it("still blocks the same invalid number on a document that is not zero-rated", () => {
    const r = build([doc({ id: "dom", clientTaxId: "DE123456789", allocationNumber: "123456789" })], []);
    expect(r.warnings.some((w) => w.sourceId === "dom" && w.code === "customer_number_invalid" && w.level === "error")).toBe(true);
  });
});
