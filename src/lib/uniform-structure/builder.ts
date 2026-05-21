// Orchestrator that assembles a complete מבנה אחיד export from raw
// app data (documents, items, clients, expenses, business profile).
//
// Returns the two file contents as Windows-1255 Buffers ready to ship
// in a ZIP archive: INI.txt (header / counts) + BKMVDATA.txt (data).

import { toWindows1255 } from "./encode";
import {
  buildA000,
  buildA100,
  buildB100,
  buildB110,
  buildC100,
  buildD110,
  buildD120,
  buildSummary,
  buildZ900,
  expenseAsJournal,
  DOC_TYPE_CODE,
  type FileMeta,
  type RecordCounts,
} from "./records";
import type { Business, Client, DocumentItem, Expense, InvoiceDocument } from "../types";

export interface UniformInput {
  business: Business;
  documents: InvoiceDocument[];
  clients: Client[];
  expenses: Expense[];
  taxYear: number;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  softwareName?: string;
  softwareVersion?: string;
  softwareVendorName?: string;
  softwareVendorTaxId?: string;
  softwareRegistrationNumber?: string;
}

export interface UniformOutput {
  ini: Buffer;
  bkmvdata: Buffer;
  /** Plain-text version, useful for debugging / inspection. */
  iniText: string;
  bkmvdataText: string;
  counts: RecordCounts;
}

/**
 * The set of synthetic accounts we generate in B110 because the app
 * doesn't have a real chart of accounts. The simulator needs *some*
 * accounts to validate B100 transactions against.
 */
const STANDARD_ACCOUNTS = [
  { code: "SALES-000", name: "הכנסות ממכירות", class: "INCOME" },
  { code: "VAT-COL", name: "מע״מ עסקאות", class: "LIABILITY" },
  { code: "VAT-INP", name: "מע״מ תשומות", class: "ASSET" },
  { code: "CASH", name: "מזומן", class: "ASSET" },
  { code: "BANK", name: "בנק", class: "ASSET" },
];

export function buildUniformStructure(input: UniformInput): UniformOutput {
  const meta: FileMeta = {
    business: input.business,
    taxYear: input.taxYear,
    generatedAt: new Date(),
    softwareName: input.softwareName ?? "MySuperFriendlyInvoiceApp",
    softwareVersion: input.softwareVersion ?? "1.0",
    softwareVendorName: input.softwareVendorName ?? "Asaf Kotler",
    softwareVendorTaxId: input.softwareVendorTaxId ?? "049040686",
    softwareRegistrationNumber: input.softwareRegistrationNumber ?? "",
    fromDate: input.fromDate,
    toDate: input.toDate,
  };
  const vatFile = input.business.taxId;

  // Filter to the requested year window.
  const fromMs = new Date(input.fromDate).getTime();
  const toMs = new Date(input.toDate).getTime() + 86_400_000 - 1;
  const docs = input.documents.filter((d) => {
    const t = new Date(d.date).getTime();
    return t >= fromMs && t <= toMs;
  });
  const expenses = input.expenses.filter((e) => {
    const t = new Date(e.date).getTime();
    return t >= fromMs && t <= toMs;
  });

  const clientById = new Map(input.clients.map((c) => [c.id, c]));

  // Track record numbers across the file — every record gets a globally
  // unique 9-digit sequence number. The simulator checks for monotonic.
  let recordNum = 2; // 1 is the A100 header itself
  const bkmvLines: string[] = [];

  // ── B110 chart of accounts ──────────────────────────────────────────
  for (const acct of STANDARD_ACCOUNTS) {
    bkmvLines.push(
      buildB110({
        recordNum: recordNum++,
        vatFile,
        accountCode: acct.code,
        accountName: acct.name,
        accountClass: acct.class,
      }),
    );
  }
  // One B110 row per known client so transactions can reference them
  for (const c of input.clients) {
    bkmvLines.push(
      buildB110({
        recordNum: recordNum++,
        vatFile,
        accountCode: `CLI-${c.id.slice(0, 10)}`,
        accountName: c.name,
        accountClass: "CUSTOMER",
      }),
    );
  }
  const b110Count = STANDARD_ACCOUNTS.length + input.clients.length;

  // ── C100 documents + D110 items + D120 payments + B100 journals ─────
  let txNum = 1;
  let c100Count = 0;
  let d110Count = 0;
  let d120Count = 0;
  let b100Count = 0;

  for (const doc of docs) {
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;

    // C100 header
    bkmvLines.push(buildC100({ recordNum: recordNum++, vatFile, doc, client }));
    c100Count++;

    // D110 items
    doc.items.forEach((item, idx) => {
      bkmvLines.push(
        buildD110({
          recordNum: recordNum++,
          vatFile,
          doc,
          item: item as DocumentItem,
          lineNumber: idx + 1,
        }),
      );
      d110Count++;
    });

    // D120 — only for receipt-bearing document types
    if (doc.type === "receipt" || doc.type === "tax_invoice_receipt") {
      bkmvLines.push(buildD120({ recordNum: recordNum++, vatFile, doc, lineNumber: 1 }));
      d120Count++;
    }

    // B100 — synthetic journal entries. Each paid doc gets matching
    // debit/credit pair: dr customer / cr sales (and dr cash / cr customer
    // for receipts). Quotes (status != paid) don't post journals.
    if (doc.status === "paid") {
      const docTypeCode = DOC_TYPE_CODE[doc.type];
      const customerAcct = client ? `CLI-${client.id.slice(0, 10)}` : "CASH";

      // dr customer
      bkmvLines.push(
        buildB100({
          recordNum: recordNum++,
          vatFile,
          transactionNum: txNum,
          transactionLine: 1,
          docType: docTypeCode,
          docNum: String(doc.number),
          date: doc.date,
          valueDate: doc.date,
          accountCode: customerAcct,
          counterAccountCode: "SALES-000",
          details: `${doc.clientName} ${doc.subject ?? ""}`,
          amount: doc.total,
          side: "1",
        }),
      );
      // cr sales
      bkmvLines.push(
        buildB100({
          recordNum: recordNum++,
          vatFile,
          transactionNum: txNum,
          transactionLine: 2,
          docType: docTypeCode,
          docNum: String(doc.number),
          date: doc.date,
          valueDate: doc.date,
          accountCode: "SALES-000",
          counterAccountCode: customerAcct,
          details: `${doc.clientName} ${doc.subject ?? ""}`,
          amount: doc.subtotal,
          side: "2",
        }),
      );
      b100Count += 2;

      // VAT line if applicable
      if (Math.abs(doc.vat) > 0.001) {
        bkmvLines.push(
          buildB100({
            recordNum: recordNum++,
            vatFile,
            transactionNum: txNum,
            transactionLine: 3,
            docType: docTypeCode,
            docNum: String(doc.number),
            date: doc.date,
            valueDate: doc.date,
            accountCode: "VAT-COL",
            counterAccountCode: customerAcct,
            details: "מע״מ עסקאות",
            amount: doc.vat,
            side: "2",
          }),
        );
        b100Count++;
      }
      txNum++;
    }
  }

  // ── Expenses → B100 pairs ───────────────────────────────────────────
  for (const e of expenses) {
    const { lines, nextRecordNum } = expenseAsJournal(recordNum, vatFile, e, txNum++);
    bkmvLines.push(...lines);
    recordNum = nextRecordNum;
    b100Count += 2;
  }

  // ── Z900 footer ─────────────────────────────────────────────────────
  // recordNum at this point = next-free slot. Total records so far is
  // (recordNum - 1) -- since recordNum started at 2 (A100 was 1) and
  // each push incremented before insertion. The Z900 itself is the
  // (recordNum)th record.
  const dataRecordCount = recordNum - 1; // count of records before Z900
  const totalIncludingZ900 = dataRecordCount + 1;

  bkmvLines.push(
    buildZ900({ recordNum: recordNum++, vatFile, totalRecords: totalIncludingZ900 }),
  );

  // ── Final assembly ──────────────────────────────────────────────────
  const bkmvdataText = buildA100(meta, totalIncludingZ900) + bkmvLines.join("");

  const counts: RecordCounts = {
    total: totalIncludingZ900,
    c100: c100Count,
    d110: d110Count,
    d120: d120Count,
    b100: b100Count,
    b110: b110Count,
    m100: 0,
  };

  // ── INI.txt: A000 + summary records (one per type in BKMVDATA) ──────
  // Spec page 9 requires a summary record for every record type present
  // in BKMVDATA. Best-guess format: type code + VAT + count + sum.
  const docTotal = docs.reduce((s, d) => s + d.total, 0);
  const docItemTotal = docs.reduce(
    (s, d) => s + d.items.reduce((ss, it) => ss + it.total, 0),
    0,
  );
  const summaries = [
    counts.c100 > 0 ? buildSummary({ recordType: "C100", vatFile, count: counts.c100, totalAmount: docTotal }) : "",
    counts.d110 > 0 ? buildSummary({ recordType: "D110", vatFile, count: counts.d110, totalAmount: docItemTotal }) : "",
    counts.d120 > 0 ? buildSummary({ recordType: "D120", vatFile, count: counts.d120, totalAmount: docTotal }) : "",
    counts.b100 > 0 ? buildSummary({ recordType: "B100", vatFile, count: counts.b100 }) : "",
    counts.b110 > 0 ? buildSummary({ recordType: "B110", vatFile, count: counts.b110 }) : "",
  ].filter(Boolean).join("");
  const iniText = buildA000(meta, counts) + summaries;

  return {
    iniText,
    bkmvdataText,
    ini: toWindows1255(iniText),
    bkmvdata: toWindows1255(bkmvdataText),
    counts,
  };
}
