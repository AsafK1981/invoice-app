import { describe, it, expect } from "vitest";
import {
  buildPcn874,
  headerLine,
  transactionLine,
  footerLine,
  validatePcn874Content,
  roundShekel,
  signedDigits,
} from "@/lib/ita/pcn874";
import type { Expense, InvoiceDocument } from "@/lib/types";

const business = { taxId: "512345678", businessType: "authorized" as const };
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
    supplierTaxId: "513333333",
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
    expect(lines.at(-1)).toBe("X512345678");
    for (const l of lines.slice(1, -1)) expect(l).toHaveLength(60);
    expect(r.content.endsWith("\r\n")).toBe(true);
    expect(validatePcn874Content(r.content)).toEqual([]);
  });

  it("writes dealer, period (last month of the range), report type 1 and file date in the header", () => {
    const r = build([], []);
    expect(r.header.reportMonth).toBe("202602");
    expect(headerLine(r.header).slice(0, 25)).toBe("O" + "512345678" + "202602" + "1" + "20260310");
    expect(r.filename).toBe("PCN874_512345678_202602.txt");
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
        doc({ id: "b", clientTaxId: "", subtotal: 2000, vat: 360, total: 2360 }),
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
    expect(t.vatId).toBe("513333333");
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
    expect(r.warnings).toEqual([]);
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

  it("warns about a supplier invoice above the allocation threshold without an allocation number", () => {
    // 2026-01: threshold 10,000 before VAT.
    const r = build([sale()], [expense({ amount: 14160, vatAmount: 2160 })]);
    expect(r.warnings.some((w) => w.level === "warning" && w.message.includes("הקצאה"))).toBe(true);
    const ok = build([sale()], [expense({ amount: 14160, vatAmount: 2160, allocationNumber: "111222333" })]);
    expect(ok.warnings).toEqual([]);
    expect(ok.transactions.find((x) => x.entryType === "T")!.allocationNumber).toBe("111222333");
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
    expect(validatePcn874Content(r.content)).toEqual([]);
  });

  it("blocks the file when the period is still open, spans more than two months, or the dealer number is not 9 digits", () => {
    const open = buildPcn874({ business, documents: [], expenses: [], range, generatedOn: new Date("2026-02-20T12:00:00+02:00") });
    expect(open.blockers.some((b) => b.includes("לא הסתיימה"))).toBe(true);
    const year = buildPcn874({ business, documents: [], expenses: [], range: { start: "2026-01-01", end: "2026-12-31" }, generatedOn: new Date("2027-01-05T12:00:00+02:00") });
    expect(year.blockers.some((b) => b.includes("חודשיים"))).toBe(true);
    const badDealer = buildPcn874({ business: { taxId: "1234", businessType: "authorized" }, documents: [], expenses: [], range, generatedOn });
    expect(badDealer.blockers.some((b) => b.includes("9 ספרות"))).toBe(true);
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
