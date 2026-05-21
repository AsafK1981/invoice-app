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
 * A100 — file header of BKMVDATA.txt. Layout per OPENFORMAT 1.31.
 * Field 1104 must carry the system constant "1031" (= version 1.31).
 * Iteration 2 — field positions revised after first simulator run.
 */
export function buildA100(meta: FileMeta, totalRecords: number): string {
  return buildLine([
    "A100", // 1-4: record code
    padNum(1, 9), // 5-13: 1101 — record number
    padStr(meta.business.taxId, 9), // 14-22: 1102 — VAT file number (must match A000)
    padNum(meta.taxYear, 4), // 23-26: 1103 — tax year
    "1031", // 27-30: 1104 — system constant (version 1.31)
    formatDate(meta.generatedAt), // 31-38: 1105 — generation date
    formatTime(meta.generatedAt), // 39-42: 1106 — generation time
    padStr(meta.softwareName, 20), // 43-62: 1107 — software name
    padStr(meta.softwareRegistrationNumber, 8), // 63-70: 1108 — software reg #
    padStr(meta.softwareVendorTaxId, 9), // 71-79: 1109 — vendor tax id
    padStr(meta.softwareVendorName, 20), // 80-99: 1110 — vendor name
    padStr(meta.softwareVersion, 20), // 100-119: 1111 — software version
    padStr(meta.business.taxId, 9), // 120-128: 1112 — VAT file (again)
    padStr(meta.business.name, 50), // 129-178: 1113 — business name
    padStr(meta.business.address || "", 50), // 179-228: 1114 — address
    formatDate(meta.fromDate), // 229-236: 1115 — period start
    formatDate(meta.toDate), // 237-244: 1116 — period end
    padStr("L", 1), // 245: 1117 — linear file marker
    padStr("", 50), // 246-295: reserved
  ]);
}

/**
 * A000 — header of INI.txt. Contains metadata + per-record-type counts so
 * the auditor can verify BKMVDATA.txt matches the declared counts.
 * Iteration 2 — revised layout, ensure VAT file matches A100/Z900.
 */
export function buildA000(meta: FileMeta, counts: RecordCounts): string {
  return buildLine([
    "A000", // 1-4: record code
    padNum(1, 9), // 5-13: 1001 — record number
    padStr(meta.business.taxId, 9), // 14-22: 1002 — VAT file (must match A100/Z900)
    padNum(meta.taxYear, 4), // 23-26: 1003 — tax year
    "1031", // 27-30: 1004 — system constant (version 1.31)
    formatDate(meta.generatedAt), // 31-38: 1005 — generation date
    formatTime(meta.generatedAt), // 39-42: 1006 — generation time
    padStr(meta.softwareName, 20), // 43-62: 1007 — software name
    padStr(meta.softwareRegistrationNumber, 8), // 63-70: 1008 — software reg #
    padStr(meta.softwareVendorTaxId, 9), // 71-79: 1009 — vendor tax id
    padStr(meta.softwareVendorName, 20), // 80-99: 1010 — vendor name
    padStr(meta.softwareVersion, 20), // 100-119: 1011 — software version
    padStr(meta.business.taxId, 9), // 120-128: 1012 — VAT file (again)
    padStr(meta.business.name, 50), // 129-178: 1013 — business name
    padStr(meta.business.address || "", 50), // 179-228: 1014 — address
    formatDate(meta.fromDate), // 229-236: 1015 — period start
    formatDate(meta.toDate), // 237-244: 1016 — period end
    // Per-record summary counts — 15 chars each, in canonical order:
    padNum(counts.c100, 15), // 245-259: C100 count
    padNum(counts.d110, 15), // 260-274: D110 count
    padNum(counts.d120, 15), // 275-289: D120 count
    padNum(counts.b100, 15), // 290-304: B100 count
    padNum(counts.b110, 15), // 305-319: B110 count
    padNum(counts.m100, 15), // 320-334: M100 count
    padNum(counts.total, 15), // 335-349: total records
    padStr("", 50), // 350-399: reserved
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

/** No-op for now — we don't track inventory. Exported for future use. */
export function buildM100(_args: {
  recordNum: number;
  vatFile: string;
}): string {
  // intentionally not implemented — we don't have an inventory module
  throw new Error("M100 not implemented — no inventory in this app");
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
