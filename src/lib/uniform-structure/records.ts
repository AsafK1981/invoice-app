// Record builders for OPENFORMAT 1.31 / מבנה אחיד.
//
// Field positions, lengths, and types are all sourced from the official
// horaot_131.pdf spec downloaded from the Tax Authority. Every record
// type is documented with its field block (1000s for A000/INI, 1100s
// for A100, 1150s for Z900, 1200s for C100, 1250s for D110, 1300s for
// D120, 1350s for B100, 1400s for B110, 1450s for M100, 1050s for
// summary records).
//
// Document type codes (from appendix #1 of the spec):
//   100 = חשבון עסקה
//   305 = חשבונית מס
//   320 = חשבונית מס/קבלה
//   330 = חשבונית מס/זיכוי
//   400 = קבלה
//   800 = הוצאה / חשבונית רכש (synthetic — for expense journal entries)

import {
  buildLine,
  formatAmount,
  formatDate,
  formatSignedAmount,
  formatTime,
  padNum,
  padStr,
} from "./encode";
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
  credit_card: "3",
  bank_transfer: "4",
  bit: "9",
  paypal: "9",
};

export interface FileMeta {
  business: Business;
  taxYear: number;
  generatedAt: Date;
  softwareName: string;
  softwareVersion: string;
  softwareVendorName: string;
  softwareVendorTaxId: string;
  softwareRegistrationNumber: string;
  fromDate: string;
  toDate: string;
}

export interface RecordCounts {
  total: number;
  c100: number;
  d110: number;
  d120: number;
  b100: number;
  b110: number;
  m100: number;
}

/** Build the 15-digit "primary identifier" — uses the business taxId padded. */
function primaryIdFor(business: Business): string {
  return padNum(business.taxId, 15);
}

// ── A000: master record of INI.txt ──────────────────────────────────
// Fields 1000-1035 per spec section 3.1.
export function buildA000(meta: FileMeta, counts: RecordCounts): string {
  const bookkeepingType = meta.business.businessType === "exempt" ? "1" : "2";
  return buildLine([
    "A000", // 1000: code (4) — pos 1-4
    padStr("", 5), // 1001: reserved (5) — pos 5-9
    padNum(counts.total, 15), // 1002: total BKMVDATA records (15) — pos 10-24
    padStr(meta.business.taxId, 9), // 1003: VAT (9) — pos 25-33
    primaryIdFor(meta.business), // 1004: primary identifier (15) — pos 34-48
    "&OF1.31&", // 1005: system constant (8) — pos 49-56
    padStr(meta.softwareRegistrationNumber, 8), // 1006: software reg # (8) — pos 57-64
    padStr(meta.softwareName, 20), // 1007: software name (20) — pos 65-84
    padStr(meta.softwareVersion, 20), // 1008: software version (20) — pos 85-104
    padStr(meta.softwareVendorTaxId, 9), // 1009: vendor VAT (9) — pos 105-113
    padStr(meta.softwareVendorName, 20), // 1010: vendor name (20) — pos 114-133
    "1", // 1011: software type — 1=single-year, 2=multi-year — pos 134
    padStr("C:\\OPENFRMT", 50), // 1012: backup path (50) — pos 135-184
    bookkeepingType, // 1013: bookkeeping type — pos 185
    "0", // 1014: balance required — pos 186 (0=N/A for single-entry)
    padStr("", 9), // 1015: company registration # (9) — pos 187-195 (optional)
    padStr("", 9), // 1016: deductions file # (9) — pos 196-204 (optional)
    padStr("", 10), // 1017: future field (10) — pos 205-214
    padStr(meta.business.name, 50), // 1018: business name (50) — pos 215-264
    padStr(meta.business.address || "", 50), // 1019: street (50) — pos 265-314
    padStr("", 10), // 1020: building number (10) — pos 315-324
    padStr("", 30), // 1021: city (30) — pos 325-354
    padStr("", 8), // 1022: postal code (8) — pos 355-362
    padNum(meta.taxYear, 4), // 1023: tax year (4) — pos 363-366
    formatDate(meta.fromDate), // 1024: period start (8) — pos 367-374
    formatDate(meta.toDate), // 1025: period end (8) — pos 375-382
    formatDate(meta.generatedAt), // 1026: process start date (8) — pos 383-390
    formatTime(meta.generatedAt), // 1027: process start time (4) — pos 391-394
    "0", // 1028: language code — 0=Hebrew — pos 395
    "1", // 1029: character set — 1=ISO-8859-8-i — pos 396
    padStr("", 20), // 1030: compression program name (20) — pos 397-416
    // 1031: 0-length cancelled field
    padStr("ILS", 3), // 1032: leading currency (3) — pos 417-419
    // 1033: 0-length cancelled field
    "0", // 1034: branch info (1) — 0=no branches — pos 420
    padStr("", 46), // 1035: future field (46) — pos 421-466
  ]);
}

// ── Summary record (INI.txt) ────────────────────────────────────────
// Fields 1050-1051 per spec section 3.2.
export function buildSummary(args: { recordType: string; count: number }): string {
  return buildLine([
    args.recordType, // 1050: code (4) — same as the type being summarized
    padNum(args.count, 15), // 1051: total records (15)
  ]);
}

// ── A100: opening record of BKMVDATA.txt ────────────────────────────
// Fields 1100-1105 per spec section 4.1.
export function buildA100(args: { recordNum: number; meta: FileMeta }): string {
  return buildLine([
    "A100", // 1100: code (4) — pos 1-4
    padNum(args.recordNum, 9), // 1101: record number (9) — pos 5-13
    padStr(args.meta.business.taxId, 9), // 1102: VAT (9) — pos 14-22
    primaryIdFor(args.meta.business), // 1103: primary identifier (15) — pos 23-37
    "&OF1.31&", // 1104: system constant (8) — pos 38-45
    padStr("", 50), // 1105: future field (50) — pos 46-95
  ]);
}

// ── Z900: closing record of BKMVDATA.txt ────────────────────────────
// Fields 1150-1156 per spec section 4.2.
export function buildZ900(args: {
  recordNum: number;
  meta: FileMeta;
  totalRecords: number;
}): string {
  return buildLine([
    "Z900", // 1150: code (4) — pos 1-4
    padNum(args.recordNum, 9), // 1151: record number (9) — pos 5-13
    padStr(args.meta.business.taxId, 9), // 1152: VAT (9) — pos 14-22
    primaryIdFor(args.meta.business), // 1153: primary identifier (15) — pos 23-37
    "&OF1.31&", // 1154: system constant (8) — pos 38-45
    padNum(args.totalRecords, 15), // 1155: total file records (15) — pos 46-60
    padStr("", 50), // 1156: future field (50) — pos 61-110
  ]);
}

// ── C100: document header ───────────────────────────────────────────
// Fields 1200-1235 per spec section 4.3.
export function buildC100(args: {
  recordNum: number;
  meta: FileMeta;
  doc: InvoiceDocument;
  client: Client | null;
}): string {
  const { recordNum, meta, doc, client } = args;
  const docType = DOC_TYPE_CODE[doc.type];
  const cancelled = doc.status === "cancelled" ? "1" : "";
  // The "row link field" 1234 links D110/D120 rows to the C100 header.
  // We use the document's numeric sequence number for this purpose.
  const linkField = doc.number % 10_000_000;

  return buildLine([
    "C100", // 1200 (4) — pos 1-4
    padNum(recordNum, 9), // 1201 — pos 5-13
    padStr(meta.business.taxId, 9), // 1202: VAT — pos 14-22
    padStr(docType, 3), // 1203: doc type — pos 23-25
    padStr(String(doc.number), 20), // 1204: doc number — pos 26-45
    formatDate(doc.date), // 1205: issue date — pos 46-53
    "0000", // 1206: issue time HHMM (optional) — pos 54-57
    padStr(doc.clientName, 50), // 1207: customer/supplier name — pos 58-107
    padStr(client?.address || "", 50), // 1208: address street — pos 108-157
    padStr("", 10), // 1209: building # — pos 158-167
    padStr("", 30), // 1210: city — pos 168-197
    padStr("", 8), // 1211: postal code — pos 198-205
    padStr("", 30), // 1212: country — pos 206-235
    padStr("", 2), // 1213: country code — pos 236-237
    padStr(client?.phone || "", 15), // 1214: phone — pos 238-252
    padStr(client?.taxId || "", 9), // 1215: customer VAT — pos 253-261
    formatDate(doc.date), // 1216: value date — pos 262-269
    formatSignedAmount(0, 12, 2), // 1217: foreign-currency total (15) — pos 270-284
    padStr("", 3), // 1218: foreign-currency code — pos 285-287
    formatSignedAmount(doc.subtotal, 12, 2), // 1219: amount before discount (15) — pos 288-302
    formatSignedAmount(0, 12, 2), // 1220: doc discount (15) — pos 303-317
    formatSignedAmount(doc.subtotal, 12, 2), // 1221: amount after discount, before VAT (15) — pos 318-332
    formatSignedAmount(doc.vat, 12, 2), // 1222: VAT amount (15) — pos 333-347
    formatSignedAmount(doc.total, 12, 2), // 1223: amount inc. VAT (15) — pos 348-362
    formatSignedAmount(0, 9, 2), // 1224: source deduction (12) — pos 363-374
    padStr(client?.id?.slice(0, 15) || "", 15), // 1225: customer/supplier key — pos 375-389
    padStr("", 10), // 1226: matching field — pos 390-399
    // 1227: 0-length cancelled
    padStr(cancelled, 1), // 1228: cancelled flag — pos 400
    // 1229: 0-length cancelled
    formatDate(doc.date), // 1230: document date — pos 401-408
    padStr("", 7), // 1231: branch identifier — pos 409-415
    // 1232: 0-length cancelled
    padStr("", 9), // 1233: operation performer (username) — pos 416-424
    padNum(linkField, 7), // 1234: row link field — pos 425-431
    padStr("", 13), // 1235: future field — pos 432-444
  ]);
}

// ── D110: document line item ────────────────────────────────────────
// Fields 1250-1275 per spec section 4.4.
export function buildD110(args: {
  recordNum: number;
  meta: FileMeta;
  doc: InvoiceDocument;
  item: DocumentItem;
  lineNumber: number;
}): string {
  const { recordNum, meta, doc, item, lineNumber } = args;
  const linkField = doc.number % 10_000_000;

  return buildLine([
    "D110", // 1250 — pos 1-4
    padNum(recordNum, 9), // 1251 — pos 5-13
    padStr(meta.business.taxId, 9), // 1252: VAT — pos 14-22
    padStr(DOC_TYPE_CODE[doc.type], 3), // 1253: doc type — pos 23-25
    padStr(String(doc.number), 20), // 1254: doc number — pos 26-45
    padNum(lineNumber, 4), // 1255: line number — pos 46-49
    padStr("", 3), // 1256: base doc type — pos 50-52
    padStr("", 20), // 1257: base doc number — pos 53-72
    padStr("1", 1), // 1258: transaction type — 1=service, 2=goods, 3=mixed — pos 73
    padStr(item.productId?.slice(0, 20) || "", 20), // 1259: internal SKU — pos 74-93
    padStr(item.description.slice(0, 30), 30), // 1260: item description — pos 94-123
    padStr("", 50), // 1261: manufacturer name — pos 124-173
    padStr("", 30), // 1262: serial number — pos 174-203
    padStr("יחידה", 20), // 1263: unit of measure — pos 204-223
    formatSignedAmount(item.quantity, 12, 4), // 1264: quantity X9(12)v9999 — len 17 — pos 224-240
    formatSignedAmount(item.unitPrice, 12, 2), // 1265: price w/o VAT — pos 241-255
    formatSignedAmount(0, 12, 2), // 1266: line discount — pos 256-270
    formatSignedAmount(item.total, 12, 2), // 1267: line total before VAT — pos 271-285
    padNum(0, 4), // 1268: VAT % — 9(2)v99, len 4 — pos 286-289
    // 1269: 0-length cancelled
    padStr("", 7), // 1270: branch identifier — pos 290-296
    // 1271: 0-length cancelled
    formatDate(doc.date), // 1272: document date — pos 297-304
    padNum(linkField, 7), // 1273: link to header — pos 305-311
    padStr("", 7), // 1274: base doc branch — pos 312-318
    padStr("", 21), // 1275: future field — pos 319-339
  ]);
}

// ── D120: payment line (only for receipts / tax-invoice-receipts) ───
// Fields 1300-1324 per spec section 4.5.
export function buildD120(args: {
  recordNum: number;
  meta: FileMeta;
  doc: InvoiceDocument;
  lineNumber: number;
}): string {
  const { recordNum, meta, doc, lineNumber } = args;
  const payCode = doc.paymentMethod ? PAYMENT_TYPE_CODE[doc.paymentMethod] : "9";
  const linkField = doc.number % 10_000_000;

  return buildLine([
    "D120", // 1300 — pos 1-4
    padNum(recordNum, 9), // 1301 — pos 5-13
    padStr(meta.business.taxId, 9), // 1302: VAT — pos 14-22
    padStr(DOC_TYPE_CODE[doc.type], 3), // 1303: doc type — pos 23-25
    padStr(String(doc.number), 20), // 1304: doc number — pos 26-45
    padNum(lineNumber, 4), // 1305: line in doc — pos 46-49
    payCode, // 1306: payment method — pos 50
    padNum(0, 10), // 1307: bank # — pos 51-60
    padNum(0, 10), // 1308: branch # — pos 61-70
    padNum(0, 15), // 1309: account # — pos 71-85
    padNum(0, 10), // 1310: check # — pos 86-95
    formatDate(doc.date), // 1311: due date — pos 96-103
    formatSignedAmount(doc.total, 12, 2), // 1312: row amount — pos 104-118
    padStr("", 1), // 1313: clearing company code — pos 119
    padStr("", 20), // 1314: cleared card name — pos 120-139
    padStr("", 1), // 1315: credit txn type — pos 140
    // 1316-1319: 0-length cancelled fields
    padStr("", 7), // 1320: branch identifier — pos 141-147
    // 1321: 0-length cancelled
    formatDate(doc.date), // 1322: document date — pos 148-155
    padNum(linkField, 7), // 1323: link to header — pos 156-162
    padStr("", 60), // 1324: future field — pos 163-222
  ]);
}

// ── B100: journal entry ─────────────────────────────────────────────
// Fields 1350-1377 per spec section 4.6.
export function buildB100(args: {
  recordNum: number;
  meta: FileMeta;
  transactionNum: number;
  transactionLine: number;
  batchNum?: number;
  txType?: string;
  docTypeRef?: string;
  docRefNum: string;
  date: string;
  valueDate: string;
  accountKey: string;
  counterAccountKey?: string;
  /** "1" = debit/expense, "2" = credit/income */
  side: "1" | "2";
  amount: number;
  details?: string;
}): string {
  const { recordNum, meta } = args;
  return buildLine([
    "B100", // 1350 — pos 1-4
    padNum(recordNum, 9), // 1351 — pos 5-13
    padStr(meta.business.taxId, 9), // 1352: VAT — pos 14-22
    padNum(args.transactionNum, 10), // 1353: transaction # — pos 23-32
    padNum(args.transactionLine, 5), // 1354: row in transaction — pos 33-37
    padNum(args.batchNum ?? args.transactionNum, 8), // 1355: batch (manah) — pos 38-45
    padStr(args.txType ?? "", 15), // 1356: transaction type — pos 46-60
    padStr(args.docRefNum, 20), // 1357: reference doc — pos 61-80
    padStr(args.docTypeRef ?? "", 3), // 1358: reference doc type — pos 81-83
    padStr("", 20), // 1359: reference 2 — pos 84-103
    padStr("", 3), // 1360: reference 2 doc type — pos 104-106
    padStr(args.details ?? "", 50), // 1361: details — pos 107-156
    formatDate(args.date), // 1362: date — pos 157-164
    formatDate(args.valueDate), // 1363: value date — pos 165-172
    padStr(args.accountKey, 15), // 1364: account in transaction — pos 173-187
    padStr(args.counterAccountKey ?? "", 15), // 1365: counter account — pos 188-202
    args.side, // 1366: operation sign (1=debit, 2=credit) — pos 203
    padStr("", 3), // 1367: foreign currency code — pos 204-206
    formatSignedAmount(args.amount, 12, 2), // 1368: operation amount — pos 207-221
    formatSignedAmount(0, 12, 2), // 1369: foreign-currency amount — pos 222-236
    formatSignedAmount(0, 9, 2), // 1370: quantity field — pos 237-248
    padStr("", 10), // 1371: matching field 1 — pos 249-258
    padStr("", 10), // 1372: matching field 2 — pos 259-268
    // 1373: 0-length cancelled
    padStr("", 7), // 1374: branch identifier — pos 269-275
    formatDate(args.date), // 1375: entry date — pos 276-283
    padStr("", 9), // 1376: operation performer — pos 284-292
    padStr("", 25), // 1377: future field — pos 293-317
  ]);
}

// ── B110: chart-of-accounts row ─────────────────────────────────────
// Fields 1400-1424 per spec section 4.7.
export function buildB110(args: {
  recordNum: number;
  meta: FileMeta;
  accountKey: string;
  accountName: string;
  trialBalanceCode: string;
  trialBalanceDesc: string;
  customerSupplierVat?: string;
  openingBalance?: number;
}): string {
  const { recordNum, meta } = args;
  return buildLine([
    "B110", // 1400 — pos 1-4
    padNum(recordNum, 9), // 1401 — pos 5-13
    padStr(meta.business.taxId, 9), // 1402: VAT — pos 14-22
    padStr(args.accountKey, 15), // 1403: account key (unique) — pos 23-37
    padStr(args.accountName, 50), // 1404: account name — pos 38-87
    padStr(args.trialBalanceCode, 15), // 1405: trial-balance code — pos 88-102
    padStr(args.trialBalanceDesc, 30), // 1406: trial-balance desc — pos 103-132
    padStr("", 50), // 1407: customer street — pos 133-182
    padStr("", 10), // 1408: customer building # — pos 183-192
    padStr("", 30), // 1409: customer city — pos 193-222
    padStr("", 8), // 1410: customer postal — pos 223-230
    padStr("", 30), // 1411: customer country — pos 231-260
    padStr("", 2), // 1412: country code — pos 261-262
    padStr("", 15), // 1413: parent account — pos 263-277
    formatSignedAmount(args.openingBalance ?? 0, 12, 2), // 1414: opening balance — pos 278-292
    formatSignedAmount(0, 12, 2), // 1415: total debit — pos 293-307
    formatSignedAmount(0, 12, 2), // 1416: total credit — pos 308-322
    padNum(0, 4), // 1417: accountant classification code — pos 323-326
    // 1418: 0-length cancelled
    padStr(args.customerSupplierVat || "", 9), // 1419: customer/supplier VAT — pos 327-335
    // 1420: 0-length cancelled
    padStr("", 7), // 1421: branch identifier — pos 336-342
    formatSignedAmount(0, 12, 2), // 1422: opening balance in foreign currency — pos 343-357
    padStr("", 3), // 1423: foreign currency code — pos 358-360
    padStr("", 16), // 1424: future field — pos 361-376
  ]);
}

// ── M100: inventory item master ─────────────────────────────────────
// Fields 1450-1465 per spec section 4.8.
export function buildM100(args: {
  recordNum: number;
  meta: FileMeta;
  itemCode: string;
  itemDescription: string;
  unitOfMeasure?: string;
  openingBalance?: number;
  totalIn?: number;
  totalOut?: number;
}): string {
  const { recordNum, meta } = args;
  return buildLine([
    "M100", // 1450 — pos 1-4
    padNum(recordNum, 9), // 1451 — pos 5-13
    padStr(meta.business.taxId, 9), // 1452: VAT — pos 14-22
    padStr("", 20), // 1453: universal item code — pos 23-42
    padStr("", 20), // 1454: supplier item code — pos 43-62
    padStr(args.itemCode, 20), // 1455: internal SKU (unique) — pos 63-82
    padStr(args.itemDescription, 50), // 1456: item name — pos 83-132
    padStr("", 10), // 1457: sort code — pos 133-142
    padStr("", 30), // 1458: sort code description — pos 143-172
    padStr(args.unitOfMeasure || "יחידה", 20), // 1459: unit of measure — pos 173-192
    formatSignedAmount(args.openingBalance ?? 0, 9, 2), // 1460: opening balance — pos 193-204
    formatSignedAmount(args.totalIn ?? 0, 9, 2), // 1461: total in — pos 205-216
    formatSignedAmount(args.totalOut ?? 0, 9, 2), // 1462: total out — pos 217-228
    padNum(0, 10), // 1463: cost in outside-warehouse — pos 229-238
    padNum(0, 10), // 1464: cost in bond-warehouse — pos 239-248
    padStr("", 50), // 1465: future field — pos 249-298
  ]);
}
