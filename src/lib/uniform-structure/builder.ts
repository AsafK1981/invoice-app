// Orchestrator that assembles a complete מבנה אחיד export from raw
// app data (documents, items, clients, expenses, business profile).
//
// Returns the two file contents as Windows-1255 Buffers ready to ship
// in a ZIP archive: INI.txt (header / counts) + BKMVDATA.txt (data).
//
// Field positions and record layouts are governed by horaot_131.pdf
// (the official OPENFORMAT 1.31 spec — see docs/uniform-structure/).

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
  fromDate: string;
  toDate: string;
  softwareName?: string;
  softwareVersion?: string;
  softwareVendorName?: string;
  softwareVendorTaxId?: string;
  softwareRegistrationNumber?: string;
}

export interface UniformOutput {
  ini: Buffer;
  bkmvdata: Buffer;
  iniText: string;
  bkmvdataText: string;
  counts: RecordCounts;
}

/**
 * Minimal synthetic chart of accounts. Each account becomes a B110
 * record and gets referenced by B100 journal entries.
 */
const STANDARD_ACCOUNTS = [
  { code: "SALES-000", name: "הכנסות ממכירות", tbCode: "INCOME", tbDesc: "הכנסות" },
  { code: "VAT-COL", name: "מע״מ עסקאות", tbCode: "VAT-OUT", tbDesc: "מע״מ עסקאות" },
  { code: "VAT-INP", name: "מע״מ תשומות", tbCode: "VAT-IN", tbDesc: "מע״מ תשומות" },
  { code: "CASH", name: "מזומן", tbCode: "ASSETS", tbDesc: "מזומנים ושווי מזומנים" },
  { code: "BANK", name: "בנק", tbCode: "ASSETS", tbDesc: "מזומנים ושווי מזומנים" },
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

  // Collect unique items across all docs for M100 master records.
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

  // Sequence numbers are monotonic across the entire BKMVDATA file.
  let recordNum = 2; // 1 = A100

  // ── B110 chart of accounts (standard + per-client) ──────────────────
  const b110Lines: string[] = [];
  for (const acct of STANDARD_ACCOUNTS) {
    b110Lines.push(
      buildB110({
        recordNum: recordNum++,
        meta,
        accountKey: acct.code,
        accountName: acct.name,
        trialBalanceCode: acct.tbCode,
        trialBalanceDesc: acct.tbDesc,
      }),
    );
  }
  for (const c of input.clients) {
    b110Lines.push(
      buildB110({
        recordNum: recordNum++,
        meta,
        accountKey: `CLI-${c.id.slice(0, 10)}`,
        accountName: c.name,
        trialBalanceCode: "CUSTOMERS",
        trialBalanceDesc: "לקוחות",
        customerSupplierVat: c.taxId,
      }),
    );
  }
  const b110Count = b110Lines.length;

  // ── M100 inventory items ───────────────────────────────────────────
  const m100Lines: string[] = [];
  for (const item of uniqueItems.values()) {
    m100Lines.push(
      buildM100({
        recordNum: recordNum++,
        meta,
        itemCode: item.code,
        itemDescription: item.description,
      }),
    );
  }
  const m100Count = m100Lines.length;

  // ── C100 document headers ──────────────────────────────────────────
  const c100Lines: string[] = [];
  for (const doc of docs) {
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;
    c100Lines.push(buildC100({ recordNum: recordNum++, meta, doc, client }));
  }
  const c100Count = c100Lines.length;

  // ── D110 document line items ───────────────────────────────────────
  const d110Lines: string[] = [];
  for (const doc of docs) {
    doc.items.forEach((item, idx) => {
      d110Lines.push(
        buildD110({
          recordNum: recordNum++,
          meta,
          doc,
          item,
          lineNumber: idx + 1,
        }),
      );
    });
  }
  const d110Count = d110Lines.length;

  // ── D120 payment lines ─────────────────────────────────────────────
  const d120Lines: string[] = [];
  for (const doc of docs) {
    if (doc.type === "receipt" || doc.type === "tax_invoice_receipt") {
      d120Lines.push(buildD120({ recordNum: recordNum++, meta, doc, lineNumber: 1 }));
    }
  }
  const d120Count = d120Lines.length;

  // ── B100 journal entries ───────────────────────────────────────────
  // Each paid document: dr customer / cr sales / [cr vat]
  // Each expense: dr expense / cr cash
  const b100Lines: string[] = [];
  let txNum = 1;

  for (const doc of docs) {
    if (doc.status !== "paid") continue;
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;
    const docTypeCode = DOC_TYPE_CODE[doc.type];
    const customerAcct = client ? `CLI-${client.id.slice(0, 10)}` : "CASH";

    b100Lines.push(
      buildB100({
        recordNum: recordNum++,
        meta,
        transactionNum: txNum,
        transactionLine: 1,
        docRefNum: String(doc.number),
        docTypeRef: docTypeCode,
        date: doc.date,
        valueDate: doc.date,
        accountKey: customerAcct,
        counterAccountKey: "SALES-000",
        details: `${doc.clientName} ${doc.subject ?? ""}`.slice(0, 50),
        amount: doc.total,
        side: "1",
      }),
    );
    b100Lines.push(
      buildB100({
        recordNum: recordNum++,
        meta,
        transactionNum: txNum,
        transactionLine: 2,
        docRefNum: String(doc.number),
        docTypeRef: docTypeCode,
        date: doc.date,
        valueDate: doc.date,
        accountKey: "SALES-000",
        counterAccountKey: customerAcct,
        details: `${doc.clientName} ${doc.subject ?? ""}`.slice(0, 50),
        amount: doc.subtotal,
        side: "2",
      }),
    );
    if (Math.abs(doc.vat) > 0.001) {
      b100Lines.push(
        buildB100({
          recordNum: recordNum++,
          meta,
          transactionNum: txNum,
          transactionLine: 3,
          docRefNum: String(doc.number),
          docTypeRef: docTypeCode,
          date: doc.date,
          valueDate: doc.date,
          accountKey: "VAT-COL",
          counterAccountKey: customerAcct,
          details: "מע״מ עסקאות",
          amount: doc.vat,
          side: "2",
        }),
      );
    }
    txNum++;
  }

  for (const e of expenses) {
    b100Lines.push(
      buildB100({
        recordNum: recordNum++,
        meta,
        transactionNum: txNum,
        transactionLine: 1,
        docRefNum: e.id.slice(0, 20),
        docTypeRef: "800",
        date: e.date,
        valueDate: e.date,
        accountKey: `EXP-${e.category}`.slice(0, 15),
        counterAccountKey: "CASH",
        details: `${e.supplier} ${e.description ?? ""}`.slice(0, 50),
        amount: e.amount,
        side: "1",
      }),
    );
    b100Lines.push(
      buildB100({
        recordNum: recordNum++,
        meta,
        transactionNum: txNum,
        transactionLine: 2,
        docRefNum: e.id.slice(0, 20),
        docTypeRef: "800",
        date: e.date,
        valueDate: e.date,
        accountKey: "CASH",
        counterAccountKey: `EXP-${e.category}`.slice(0, 15),
        details: `${e.supplier} ${e.description ?? ""}`.slice(0, 50),
        amount: e.amount,
        side: "2",
      }),
    );
    txNum++;
  }
  const b100Count = b100Lines.length;

  // ── Z900 footer ────────────────────────────────────────────────────
  const totalIncludingZ900 = recordNum; // recordNum is the next free slot = Z900's number
  const z900Line = buildZ900({
    recordNum: recordNum++,
    meta,
    totalRecords: totalIncludingZ900,
  });

  // ── Final BKMVDATA assembly ────────────────────────────────────────
  const bkmvdataText =
    buildA100({ recordNum: 1, meta }) +
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

  // ── INI.txt: A000 + summary records (one per type in BKMVDATA) ─────
  const summaries = [
    c100Count > 0 ? buildSummary({ recordType: "C100", count: c100Count }) : "",
    d110Count > 0 ? buildSummary({ recordType: "D110", count: d110Count }) : "",
    d120Count > 0 ? buildSummary({ recordType: "D120", count: d120Count }) : "",
    m100Count > 0 ? buildSummary({ recordType: "M100", count: m100Count }) : "",
    b100Count > 0 ? buildSummary({ recordType: "B100", count: b100Count }) : "",
    b110Count > 0 ? buildSummary({ recordType: "B110", count: b110Count }) : "",
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
