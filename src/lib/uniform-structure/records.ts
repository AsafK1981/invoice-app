// Record builders for OPENFORMAT 1.31 / מבנה אחיד.
//
// Each record is a fixed-width line that starts with a 4-char record-type
// code. Below we encode every record we generate. Field widths and order
// are based on our best knowledge of the spec; the gov.il anti-bot wall
// prevents us from reading the official PDF directly, so the first pass
// is iterated against the official simulator (Asaf runs it locally).
//
// Document type codes used (OPENFORMAT):
//   100 — חשבון עסקה (transaction invoice / quote)
//   305 — חשבונית מס
//   320 — חשבונית מס/קבלה
//   330 — חשבונית זיכוי (credit note)
//   400 — קבלה

import { buildLine, formatAmount, formatDate, formatTime, padNum, padStr } from "./encode";
import type { Business, Client, DocumentItem, Expense, InvoiceDocument, PaymentMethod } from "../types";

export const DOC_TYPE_CODE: Record<InvoiceDocument["type"], string> = {
  quote: "100",
  tax_invoice: "305",
  tax_invoice_receipt: "320",
  credit_note: "330",
  receipt: "400",
};

const PAYMENT_TYPE_CODE: Record<PaymentMethod, string> = {
  cash: "1",
  check: "2",
  bank_transfer: "4",
  credit_card: "3",
  bit: "5",
  paypal: "5",
};

export interface FileMeta {
  business: Business;
  /** Tax year covered by the export. 4 digits. */
  taxYear: number;
  /** When the export was generated. */
  generatedAt: Date;
  /** Software vendor info — us. */
  softwareName: string;
  softwareVersion: string;
  softwareVendorName: string;
  softwareVendorTaxId: string;
  /**
   * The Tax Authority's software registration number ("מספר רישום
   * תוכנה"). Only valid once we're approved at misim.gov.il/mm_tochna.
   * Until then we ship zeros — the simulator usually accepts 0s.
   */
  softwareRegistrationNumber: string;
  /** Range covered by the export. */
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
}

export interface RecordCounts {
  total: number; // total records in BKMVDATA.txt
  c100: number;
  d110: number;
  d120: number;
  b100: number;
  b110: number;
  m100: number;
}

/**
 * A100 — opening record of BKMVDATA.txt (section 4.1 of the spec).
 * Mirrors A000's pattern: code → reserved → totals → VAT → primary
 * identifier → system constant → metadata. The simulator cross-checks
 * fields 1003/1004 (A000) against 1103/1104 (A100), so values must
 * match exactly.
 */
export function buildA100(meta: FileMeta, totalRecords: number): string {
  const primaryId = padNum(meta.business.taxId, 15);
  return buildLine([
    "A100", // 1100: code
    padStr("", 8), // 1101: reserved
    padNum(totalRecords, 15), // 1102: total records
    padStr(meta.business.taxId, 9), // 1103: VAT (must match A000 1003)
    primaryId, // 1104: primary ID (must match A000 1004)
    "&OF1.31&", // 1105: system constant (was 1005 in A000)
    padStr(meta.softwareRegistrationNumber, 8), // 1106: software reg
    padStr(meta.softwareName, 20), // 1107: software name
    padStr(meta.softwareVersion, 20), // 1108: version
    padNum(meta.taxYear, 4), // 1109: tax year
    formatDate(meta.fromDate), // 1110: period start
    formatDate(meta.toDate), // 1111: period end
    formatDate(meta.generatedAt), // 1112: generation date
    formatTime(meta.generatedAt), // 1113: generation time
    padStr(meta.business.name, 50), // 1114: business name
    padStr(meta.business.address || "", 50), // 1115: address
  ]);
}

/**
 * Summary records that appear in INI.txt after A000 — one per record
 * type present in BKMVDATA.txt (per spec page 9). Each carries the
 * type code, the count, and the sum of amounts (where applicable).
 *
 * Codes for summary records use the same 4-char prefix as the records
 * they summarize. Best-guess format until we see the spec.
 */
export function buildSummary(args: {
  recordType: string; // e.g., "C100", "D110"
  vatFile: string;
  count: number;
  totalAmount?: number;
}): string {
  return buildLine([
    args.recordType, // type code
    padStr(args.vatFile, 9),
    padNum(args.count, 15),
    formatAmount(args.totalAmount ?? 0, 15),
    padStr("", 50), // reserved
  ]);
}

/**
 * A000 — master record of INI.txt. Layout matches the example PDF from
 * the Tax Authority (page 13, ביקורת מערכות מידע — מבנה אחיד 1.31).
 *
 * Fields (1000–1013):
 *   1000: record code "A000"
 *   1001: reserved (for future use, blank)
 *   1002: total record count in BKMVDATA.txt
 *   1003: business VAT/tax ID
 *   1004: primary identifier (15-digit unique ID for the business)
 *   1005: system constant — literal "&OF1.31&" for version 1.31
 *   1006: software registration number (assigned by misim.gov.il)
 *   1007: software name
 *   1008: software version/edition
 *   1009: vendor VAT/tax ID
 *   1010: vendor name
 *   1011: software type — "1" single-year / "2" multi-year
 *   1012: backup data path (filesystem path where exports go)
 *   1013: bookkeeping method — "1" single-entry / "2" double-entry
 */
export function buildA000(meta: FileMeta, counts: RecordCounts): string {
  // 15-digit primary identifier — for an עוסק פטור this is the personal
  // ID. We pad to 15 zeros to match the example's width.
  const primaryId = padNum(meta.business.taxId, 15);
  // עוסק פטור = single-entry bookkeeping (חד צידית).
  const bookkeepingType = meta.business.businessType === "exempt" ? "1" : "2";
  // We export single-year files for now; the simulator accepts both.
  const softwareType = "1";

  return buildLine([
    "A000", // 1000: 4 chars
    padStr("", 8), // 1001: reserved (8)
    padNum(counts.total, 15), // 1002: total records (15)
    padStr(meta.business.taxId, 9), // 1003: VAT (9)
    primaryId, // 1004: primary ID (15)
    "&OF1.31&", // 1005: system constant (8)
    padStr(meta.softwareRegistrationNumber, 8), // 1006: software reg (8)
    padStr(meta.softwareName, 20), // 1007: software name (20)
    padStr(meta.softwareVersion, 20), // 1008: version (20)
    padStr(meta.softwareVendorTaxId, 9), // 1009: vendor VAT (9)
    padStr(meta.softwareVendorName, 20), // 1010: vendor name (20)
    softwareType, // 1011: software type (1)
    padStr("C:\\OPENFRMT", 50), // 1012: backup path (50)
    bookkeepingType, // 1013: bookkeeping method (1)
  ]);
}

/**
 * B110 — chart of accounts row. We don't have a real bookkeeping chart of
 * accounts; we synthesize a minimal one so B100 (journal entries) have
 * something to reference. One row per customer + a small set of
 * standard accounts (sales / VAT collected / cash / bank).
 */
export function buildB110(args: {
  recordNum: number;
  vatFile: string;
  accountCode: string;
  accountName: string;
  accountClass: string;
  openingBalance?: number;
}): string {
  return buildLine([
    "B110",
    padNum(args.recordNum, 9),
    padStr(args.vatFile, 9),
    padStr(args.accountCode, 15),
    padStr(args.accountName, 50),
    padStr(args.accountClass, 15),
    padStr("", 30), // sub-class
    padStr("", 15), // parent account
    formatAmount(args.openingBalance ?? 0, 15),
    padStr("ILS", 3), // currency
    padStr("", 50), // reserved
  ]);
}

/**
 * B100 — journal entry line. One side of a double-entry transaction.
 * For our single-entry model we generate matching pairs of debit/credit
 * lines synthetically from documents and expenses.
 */
export function buildB100(args: {
  recordNum: number;
  vatFile: string;
  transactionNum: number;
  transactionLine: number;
  docType: string;
  docNum: string;
  date: string;
  valueDate: string;
  accountCode: string;
  counterAccountCode: string;
  details: string;
  amount: number;
  /** "1" = debit, "2" = credit */
  side: "1" | "2";
}): string {
  return buildLine([
    "B100",
    padNum(args.recordNum, 9),
    padStr(args.vatFile, 9),
    padNum(args.transactionNum, 10),
    padNum(args.transactionLine, 5),
    padStr(args.docType, 3),
    padStr(args.docNum, 20),
    formatDate(args.date),
    formatDate(args.valueDate),
    padStr(args.accountCode, 15),
    padStr(args.counterAccountCode, 15),
    padStr(args.details, 50),
    formatAmount(args.amount, 15),
    padStr(args.side, 1),
    padStr("ILS", 3),
    padStr("", 50), // reserved
  ]);
}

/**
 * C100 — document header. One per invoice / receipt / quote / credit note.
 */
export function buildC100(args: {
  recordNum: number;
  vatFile: string;
  doc: InvoiceDocument;
  client: Client | null;
}): string {
  const docType = DOC_TYPE_CODE[args.doc.type];
  const cancelled = args.doc.status === "cancelled" ? "Y" : "N";

  return buildLine([
    "C100",
    padNum(args.recordNum, 9),
    padStr(args.vatFile, 9),
    padStr(docType, 3),
    padStr(String(args.doc.number), 20),
    padStr(args.vatFile, 9), // document issuer = us
    formatDate(args.doc.date),
    formatDate(args.doc.date), // value date = doc date
    padStr(args.client?.id?.slice(0, 15) || "", 15), // customer code (truncated UUID)
    padStr(args.doc.clientName, 50),
    padStr(args.client?.address || "", 50),
    padStr(args.client?.taxId || "", 9),
    formatAmount(args.doc.subtotal, 15), // amount without VAT
    formatAmount(args.doc.vat, 15), // VAT amount
    formatAmount(args.doc.total, 15), // total
    padStr("ILS", 3),
    padNum(1, 8), // exchange rate (1 — same currency)
    padStr(cancelled, 1),
    padStr(args.doc.allocationNumber || "", 9), // Tax Authority allocation number (חשבונית ישראל)
    padStr(args.doc.subject || "", 50),
    padStr("", 50), // reserved
  ]);
}

/**
 * D110 — document line item. One per row inside an invoice/receipt.
 */
export function buildD110(args: {
  recordNum: number;
  vatFile: string;
  doc: InvoiceDocument;
  item: DocumentItem;
  lineNumber: number;
}): string {
  return buildLine([
    "D110",
    padNum(args.recordNum, 9),
    padStr(args.vatFile, 9),
    padStr(DOC_TYPE_CODE[args.doc.type], 3),
    padStr(String(args.doc.number), 20),
    padStr(args.vatFile, 9),
    padNum(args.lineNumber, 4),
    padStr(args.item.productId?.slice(0, 20) || "", 20),
    padStr(args.item.description, 50),
    formatAmount(args.item.quantity, 12), // quantity (also 2dp)
    padStr("", 20), // unit
    formatAmount(args.item.unitPrice, 15),
    padStr("", 5), // discount %
    formatAmount(0, 15), // line discount
    formatAmount(args.item.total, 15), // line total before VAT
    padStr("", 1), // VAT type — empty for עוסק פטור
    padStr("", 50), // reserved
  ]);
}

/**
 * D120 — payment details for documents that record payment (receipts,
 * tax-invoice/receipts). Not relevant for plain tax invoices or quotes.
 */
export function buildD120(args: {
  recordNum: number;
  vatFile: string;
  doc: InvoiceDocument;
  lineNumber: number;
}): string {
  const payCode = args.doc.paymentMethod ? PAYMENT_TYPE_CODE[args.doc.paymentMethod] : "9";
  return buildLine([
    "D120",
    padNum(args.recordNum, 9),
    padStr(args.vatFile, 9),
    padStr(DOC_TYPE_CODE[args.doc.type], 3),
    padStr(String(args.doc.number), 20),
    padStr(args.vatFile, 9),
    padNum(args.lineNumber, 4),
    padStr(payCode, 1), // payment type
    padStr("", 10), // bank
    padStr("", 10), // branch
    padStr("", 15), // account
    padStr("", 20), // check number
    formatDate(args.doc.date), // payment date
    formatAmount(args.doc.total, 15),
    padStr("ILS", 3),
    padStr("", 50), // reserved
  ]);
}

/**
 * Z900 — file footer. Must match the total record count claimed in the
 * A100/A000 header.
 */
export function buildZ900(args: { recordNum: number; vatFile: string; totalRecords: number }): string {
  return buildLine([
    "Z900",
    padNum(args.recordNum, 9),
    padStr(args.vatFile, 9),
    padNum(args.totalRecords, 15),
    padStr("", 50), // reserved
  ]);
}

/**
 * M100 — inventory item master record. One record per unique item
 * that appears in any document (across the entire file). Example
 * PDF page 15: "לכל פריט נוצרה רשומה מסוג M100".
 */
export function buildM100(args: {
  recordNum: number;
  vatFile: string;
  itemCode: string;
  itemDescription: string;
  unitOfMeasure?: string;
}): string {
  return buildLine([
    "M100",
    padNum(args.recordNum, 9),
    padStr(args.vatFile, 9),
    padStr(args.itemCode, 20),
    padStr(args.itemDescription, 50),
    padStr(args.unitOfMeasure || "יח׳", 20),
    padStr("", 50), // reserved
  ]);
}

/** Used by the expense-export path (B100 only — no document records). */
export function expenseAsJournal(
  recordNumStart: number,
  vatFile: string,
  expense: Expense,
  txNum: number,
): { lines: string[]; nextRecordNum: number } {
  // Debit: expense account; Credit: cash/bank
  const lines = [
    buildB100({
      recordNum: recordNumStart,
      vatFile,
      transactionNum: txNum,
      transactionLine: 1,
      docType: "800", // purchase invoice / expense
      docNum: expense.id.slice(0, 20),
      date: expense.date,
      valueDate: expense.date,
      accountCode: `EXP-${expense.category}`.slice(0, 15),
      counterAccountCode: "CASH",
      details: `${expense.supplier} ${expense.description ?? ""}`.slice(0, 50),
      amount: expense.amount,
      side: "1",
    }),
    buildB100({
      recordNum: recordNumStart + 1,
      vatFile,
      transactionNum: txNum,
      transactionLine: 2,
      docType: "800",
      docNum: expense.id.slice(0, 20),
      date: expense.date,
      valueDate: expense.date,
      accountCode: "CASH",
      counterAccountCode: `EXP-${expense.category}`.slice(0, 15),
      details: `${expense.supplier} ${expense.description ?? ""}`.slice(0, 50),
      amount: expense.amount,
      side: "2",
    }),
  ];
  return { lines, nextRecordNum: recordNumStart + 2 };
}
