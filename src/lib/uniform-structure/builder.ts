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
  buildM100,
  buildSummary,
  buildZ900,
  DOC_TYPE_CODE,
  type FileMeta,
  type RecordCounts,
} from "./records";
import type { Business, Client, Expense, InvoiceDocument } from "../types";

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
 * Synthetic chart of accounts. Our app is invoice-centric (no real
 * bookkeeping), so the simulator needs a minimal account list to
 * validate B100 journal entries against.
 */
const STANDARD_ACCOUNTS = [
  { code: "SALES-000", name: "הכנסות ממכירות", class: "INCOME" },
  { code: "VAT-COL", name: "מע״מ עסקאות", class: "LIABILITY" },
  { code: "VAT-INP", name: "מע״מ תשומות", class: "ASSET" },
  { code: "CASH", name: "מזומן", class: "ASSET" },
  { code: "BANK", name: "בנק", class: "ASSET" },
];

/**
 * Build the מבנה אחיד files. Output order in BKMVDATA matches the
 * example PDF (page 15 onward): A100 → B110 (accounts) → M100 (items)
 * → C100 (doc headers) → D110 (doc items) → D120 (payments) → B100
 * (journal entries) → Z900. Records are grouped by type, not
 * interleaved per-document — this is critical for the simulator.
 */
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

  // ── Collect unique items across all documents (for M100 master records).
  // Key by item description since our app doesn't enforce product codes.
  const uniqueItems = new Map<string, { code: string; description: string }>();
  for (const doc of docs) {
    for (const item of doc.items) {
      const key = item.description.trim();
      if (!uniqueItems.has(key)) {
        const code = item.productId
          ? item.productId.slice(0, 20)
          : `ITM-${(uniqueItems.size + 1).toString().padStart(6, "0")}`;
        uniqueItems.set(key, { code, description: key });
      }
    }
  }

  // ── Record number is monotonic across the entire BKMVDATA file.
  let recordNum = 2; // 1 = A100 header
  const b110Lines: string[] = [];
  const m100Lines: string[] = [];
  const c100Lines: string[] = [];
  const d110Lines: string[] = [];
  const d120Lines: string[] = [];
  const b100Lines: string[] = [];

  // ── B110: chart of accounts + one row per client ────────────────────
  for (const acct of STANDARD_ACCOUNTS) {
    b110Lines.push(
      buildB110({
        recordNum: recordNum++,
        vatFile,
        accountCode: acct.code,
        accountName: acct.name,
        accountClass: acct.class,
      }),
    );
  }
  for (const c of input.clients) {
    b110Lines.push(
      buildB110({
        recordNum: recordNum++,
        vatFile,
        accountCode: `CLI-${c.id.slice(0, 10)}`,
        accountName: c.name,
        accountClass: "CUSTOMER",
      }),
    );
  }
  const b110Count = b110Lines.length;

  // ── M100: unique inventory items master records ─────────────────────
  for (const item of uniqueItems.values()) {
    m100Lines.push(
      buildM100({
        recordNum: recordNum++,
        vatFile,
        itemCode: item.code,
        itemDescription: item.description,
      }),
    );
  }
  const m100Count = m100Lines.length;

  // ── C100: document headers ──────────────────────────────────────────
  for (const doc of docs) {
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;
    c100Lines.push(buildC100({ recordNum: recordNum++, vatFile, doc, client }));
  }
  const c100Count = c100Lines.length;

  // ── D110: document line items ───────────────────────────────────────
  for (const doc of docs) {
    doc.items.forEach((item, idx) => {
      d110Lines.push(
        buildD110({
          recordNum: recordNum++,
          vatFile,
          doc,
          item,
          lineNumber: idx + 1,
        }),
      );
    });
  }
  const d110Count = d110Lines.length;

  // ── D120: payment lines (receipts + tax-invoice-receipts only) ──────
  for (const doc of docs) {
    if (doc.type === "receipt" || doc.type === "tax_invoice_receipt") {
      d120Lines.push(buildD120({ recordNum: recordNum++, vatFile, doc, lineNumber: 1 }));
    }
  }
  const d120Count = d120Lines.length;

  // ── B100: journal entries ───────────────────────────────────────────
  let txNum = 1;
  // 2-3 lines per paid document (dr customer / cr sales / [cr vat])
  for (const doc of docs) {
    if (doc.status !== "paid") continue;
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;
    const docTypeCode = DOC_TYPE_CODE[doc.type];
    const customerAcct = client ? `CLI-${client.id.slice(0, 10)}` : "CASH";

    b100Lines.push(
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
    b100Lines.push(
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
    if (Math.abs(doc.vat) > 0.001) {
      b100Lines.push(
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
    }
    txNum++;
  }
  // 2 lines per expense
  for (const e of expenses) {
    b100Lines.push(
      buildB100({
        recordNum: recordNum++,
        vatFile,
        transactionNum: txNum,
        transactionLine: 1,
        docType: "800",
        docNum: e.id.slice(0, 20),
        date: e.date,
        valueDate: e.date,
        accountCode: `EXP-${e.category}`.slice(0, 15),
        counterAccountCode: "CASH",
        details: `${e.supplier} ${e.description ?? ""}`.slice(0, 50),
        amount: e.amount,
        side: "1",
      }),
    );
    b100Lines.push(
      buildB100({
        recordNum: recordNum++,
        vatFile,
        transactionNum: txNum,
        transactionLine: 2,
        docType: "800",
        docNum: e.id.slice(0, 20),
        date: e.date,
        valueDate: e.date,
        accountCode: "CASH",
        counterAccountCode: `EXP-${e.category}`.slice(0, 15),
        details: `${e.supplier} ${e.description ?? ""}`.slice(0, 50),
        amount: e.amount,
        side: "2",
      }),
    );
    txNum++;
  }
  const b100Count = b100Lines.length;

  // ── Z900 footer ─────────────────────────────────────────────────────
  const dataRecordCount = recordNum - 1;
  const totalIncludingZ900 = dataRecordCount + 1;
  const z900Line = buildZ900({
    recordNum: recordNum++,
    vatFile,
    totalRecords: totalIncludingZ900,
  });

  // ── Assemble BKMVDATA in canonical order ────────────────────────────
  const bkmvdataText =
    buildA100(meta, totalIncludingZ900) +
    b110Lines.join("") +
    m100Lines.join("") +
    c100Lines.join("") +
    d110Lines.join("") +
    d120Lines.join("") +
    b100Lines.join("") +
    z900Line;

  const counts: RecordCounts = {
    total: totalIncludingZ900,
    c100: c100Count,
    d110: d110Count,
    d120: d120Count,
    b100: b100Count,
    b110: b110Count,
    m100: m100Count,
  };

  // ── INI.txt: A000 + summary records (one per type in BKMVDATA) ──────
  const docTotal = docs.reduce((s, d) => s + d.total, 0);
  const docItemTotal = docs.reduce(
    (s, d) => s + d.items.reduce((ss, it) => ss + it.total, 0),
    0,
  );
  const summaries = [
    c100Count > 0 ? buildSummary({ recordType: "C100", vatFile, count: c100Count, totalAmount: docTotal }) : "",
    d110Count > 0 ? buildSummary({ recordType: "D110", vatFile, count: d110Count, totalAmount: docItemTotal }) : "",
    d120Count > 0 ? buildSummary({ recordType: "D120", vatFile, count: d120Count, totalAmount: docTotal }) : "",
    m100Count > 0 ? buildSummary({ recordType: "M100", vatFile, count: m100Count }) : "",
    b100Count > 0 ? buildSummary({ recordType: "B100", vatFile, count: b100Count }) : "",
    b110Count > 0 ? buildSummary({ recordType: "B110", vatFile, count: b110Count }) : "",
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
