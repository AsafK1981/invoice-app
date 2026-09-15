// Orchestrator that assembles a complete מבנה אחיד export from raw
// app data (documents, items, clients, expenses, business profile).
//
// Returns the two file contents as Windows-1255 Buffers ready to ship
// in a ZIP archive: INI.txt (header / counts) + BKMVDATA.txt (data).
//
// Field positions and record layouts are governed by horaot_131.pdf
// (the official OPENFORMAT 1.31 spec, see docs/uniform-structure/).

import { toWindows1255 } from "./encode";
import { UNIFORM_SOFTWARE } from "./software";
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
import { buildAccountKeys } from "./account-keys";
import { journalRounding, uniformAmounts, uniformLineAmounts } from "./amounts";
import { documentVatPercent, uniformDocumentLines } from "./lines";
import { normalizeBusinessNumber } from "../israeli-id";
import { isCountableRevenue, type Business, type Client, type Expense, type InvoiceDocument } from "../types";

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
  /** Section 2.6 of the spec: count + money total per נספח 1 document type. */
  docTypeSummary: DocTypeSummaryRow[];
  generatedAt: Date;
}

export interface DocTypeSummaryRow {
  /** נספח 1 document code ("305", "400", ...). */
  code: string;
  label: string;
  count: number;
  /** Money total in shekels (the C100 1223 amounts), 0 for unmanaged types. */
  total: number;
}

/**
 * נספח 1 of the spec, in its order. Section 2.6 wants a row for EVERY type
 * listed there, with zeros for the ones the software does not manage, so
 * the auditor sees "not managed" rather than "forgot to report".
 */
export const APPENDIX_1_DOC_TYPES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "100", label: "הזמנה" },
  { code: "200", label: "תעודת משלוח" },
  { code: "205", label: "תעודת משלוח סוכן" },
  { code: "210", label: "תעודת החזרה" },
  { code: "300", label: "חשבונית / חשבונית עסקה" },
  { code: "305", label: "חשבונית מס" },
  { code: "310", label: "חשבונית ריכוז" },
  { code: "320", label: "חשבונית מס / קבלה" },
  { code: "330", label: "חשבונית מס זיכוי" },
  { code: "340", label: "חשבונית שריון" },
  { code: "345", label: "חשבונית סוכן" },
  { code: "400", label: "קבלה" },
  { code: "405", label: "קבלה על תרומות" },
  { code: "410", label: "יציאה מקופה" },
  { code: "420", label: "הפקדת בנק" },
  { code: "500", label: "הזמנת רכש" },
  { code: "600", label: "תעודת משלוח רכש" },
  { code: "610", label: "החזרת רכש" },
  { code: "700", label: "חשבונית מס רכש" },
  { code: "710", label: "זיכוי רכש" },
  { code: "800", label: "יתרת פתיחה" },
  { code: "810", label: "כניסה כללית למלאי" },
  { code: "820", label: "יציאה כללית מהמלאי" },
  { code: "830", label: "העברה בין מחסנים" },
  { code: "840", label: "עדכון בעקבות ספירה" },
  { code: "900", label: "כניסה - דוח ייצור" },
  { code: "910", label: "יציאה - דוח ייצור" },
];

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

/**
 * The declared account for a stored הפרש עיגול. Written only when some
 * document posts to it, and every posting is capped at that document's stored
 * rounding (journalRounding), so it can never hide any other gap.
 */
export const ROUNDING_ACCOUNT = { code: "ROUNDING", name: "הפרשי עיגול", tbCode: "INCOME", tbDesc: "הכנסות" };

export function buildUniformStructure(input: UniformInput): UniformOutput {
  // The dealer number goes into every record. The preflight blocks a number
  // the shared normalizer refuses, so this is the padded 9-digit form (an
  // 8-digit עוסק is 0XXXXXXXX in the file, exactly as in PCN874).
  const dealerVat = normalizeBusinessNumber(input.business.taxId).value ?? input.business.taxId;
  const meta: FileMeta = {
    business: { ...input.business, taxId: dealerVat },
    taxYear: input.taxYear,
    generatedAt: new Date(),
    // Software identity as registered at רשות המסים - see software.ts for
    // why the name is not the consumer brand and where the version comes from.
    softwareName: input.softwareName ?? UNIFORM_SOFTWARE.name,
    softwareVersion: input.softwareVersion ?? UNIFORM_SOFTWARE.version,
    softwareVendorName: input.softwareVendorName ?? UNIFORM_SOFTWARE.vendorName,
    softwareVendorTaxId: input.softwareVendorTaxId ?? UNIFORM_SOFTWARE.vendorTaxId,
    softwareRegistrationNumber: input.softwareRegistrationNumber ?? UNIFORM_SOFTWARE.registrationNumber,
    fromDate: input.fromDate,
    toDate: input.toDate,
  };

  // Filter to the requested year window.
  const fromMs = new Date(input.fromDate).getTime();
  const toMs = new Date(input.toDate).getTime() + 86_400_000 - 1;
  // Drafts are not issued documents: they never enter the file, its totals or
  // its journal. A cancelled issued document stays (C100 1228 marks it).
  const docs = input.documents.filter((d) => {
    if (d.status === "draft") return false;
    const t = new Date(d.date).getTime();
    return t >= fromMs && t <= toMs;
  });
  const expenses = input.expenses.filter((e) => {
    const t = new Date(e.date).getTime();
    return t >= fromMs && t <= toMs;
  });

  const clientById = new Map(input.clients.map((c) => [c.id, c]));

  // Fields 1234 / 1273 / 1323 tie D110 and D120 rows to their C100 header.
  // The document NUMBER is not unique across types (receipt 1001 and quote
  // 1001 coexist), so every document gets its own sequential link id.
  const docLinkId = new Map<string, number>();
  docs.forEach((d, i) => docLinkId.set(d.id, i + 1));
  const linkOf = (d: InvoiceDocument) => docLinkId.get(d.id) ?? 0;

  // Collect unique items across all docs for M100 master records.
  const uniqueItems = new Map<string, { code: string; description: string }>();
  for (const doc of docs) {
    for (const item of uniformDocumentLines(doc).items) {
      const key = item.description.trim();
      if (!uniqueItems.has(key)) {
        const code = item.productId
          ? item.productId.slice(0, 20)
          : `ITM-${(uniqueItems.size + 1).toString().padStart(6, "0")}`;
        uniqueItems.set(key, { code, description: key });
      }
    }
  }

  // One id-to-key map feeds every B110 row and every B100 posting below.
  // Clients in creation order; categories from EVERY expense the export
  // loaded (all years), so a category keeps its key from one tax year to the next.
  const accountKeys = buildAccountKeys(
    input.clients,
    input.expenses.map((e) => ({ category: e.category ?? "", date: e.date })),
    [...STANDARD_ACCOUNTS.map((a) => a.code), ROUNDING_ACCOUNT.code],
  );

  // B100 journal documents, decided up front: whether any of them posts a
  // rounding line decides whether the rounding account row exists.
  //
  // isCountableRevenue() excludes documents with convertedToId set (e.g. a
  // quote/proforma marked "paid" on conversion into the receipt/tax invoice
  // that actually represents the revenue) - without it this ledger would
  // book the same money twice, once under the source doc and once under the
  // converted target. C100/D110 below intentionally do NOT apply this
  // filter: they're a registry of every document number issued, not a
  // revenue ledger, so converted docs still belong there.
  const journalDocs = docs.filter((d) => d.status === "paid" && isCountableRevenue(d));
  const roundingByDoc = new Map(journalDocs.map((d) => [d.id, journalRounding(uniformAmounts(d))]));
  const needsRoundingAccount = [...roundingByDoc.values()].some((value) => Math.abs(value) >= 0.005);

  // Sequence numbers are monotonic across the entire BKMVDATA file.
  let recordNum = 2; // 1 = A100

  // ── B110 chart of accounts (standard + per-client + per-category) ───
  const b110Lines: string[] = [];
  for (const acct of needsRoundingAccount ? [...STANDARD_ACCOUNTS, ROUNDING_ACCOUNT] : STANDARD_ACCOUNTS) {
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
        accountKey: accountKeys.client(c.id),
        accountName: c.name,
        trialBalanceCode: "CUSTOMERS",
        trialBalanceDesc: "לקוחות",
        customerSupplierVat: c.taxId,
      }),
    );
  }
  // One expense account per category, never merged: every B100 account key
  // (field 1364) must resolve to its own B110 row.
  for (const category of new Set(expenses.map((e) => e.category ?? ""))) {
    b110Lines.push(
      buildB110({
        recordNum: recordNum++,
        meta,
        accountKey: accountKeys.expense(category),
        accountName: `הוצאות ${category}`.slice(0, 50),
        trialBalanceCode: "EXPENSES",
        trialBalanceDesc: "הוצאות",
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
  // Section 2.6 printout: one row per נספח 1 type, over the SAME documents
  // that became C100 records, so the printed totals reconcile with the file.
  const perType = new Map<string, { count: number; total: number }>();
  for (const doc of docs) {
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;
    c100Lines.push(buildC100({ recordNum: recordNum++, meta, doc, client, linkField: linkOf(doc) }));
    const code = DOC_TYPE_CODE[doc.type];
    const row = perType.get(code) ?? { count: 0, total: 0 };
    row.count += 1;
    row.total += uniformAmounts(doc).total;
    perType.set(code, row);
  }
  const c100Count = c100Lines.length;
  const docTypeSummary: DocTypeSummaryRow[] = APPENDIX_1_DOC_TYPES.map((t) => ({
    code: t.code,
    label: t.label,
    count: perType.get(t.code)?.count ?? 0,
    total: Math.round((perType.get(t.code)?.total ?? 0) * 100) / 100,
  }));

  // ── D110 document line items ───────────────────────────────────────
  const d110Lines: string[] = [];
  for (const doc of docs) {
    // A plain receipt (400) records money received, not goods or services
    // sold, so its detail rows are D120 payment lines only. The simulator
    // treats a D110 under a 400 header as an orphan ("לא נמצאה רשומת
    // כותרת מסמך"). A tax-invoice-receipt (320) keeps both kinds of rows.
    if (doc.type === "receipt") continue;
    const { items: docLines } = uniformDocumentLines(doc);
    const lineAmounts = uniformLineAmounts({ ...doc, items: docLines });
    docLines.forEach((item, idx) => {
      d110Lines.push(
        buildD110({
          recordNum: recordNum++,
          meta,
          doc,
          item,
          lineNumber: idx + 1,
          linkField: linkOf(doc),
          itemCode: uniqueItems.get(item.description.trim())?.code ?? "",
          amounts: lineAmounts[idx],
          // 1268: the document VAT rate on every line (0 for zero-rated or exempt).
          vatPercent: documentVatPercent(doc),
        }),
      );
    });
  }
  const d110Count = d110Lines.length;

  // ── D120 payment lines ─────────────────────────────────────────────
  const d120Lines: string[] = [];
  for (const doc of docs) {
    if (doc.type === "receipt" || doc.type === "tax_invoice_receipt") {
      d120Lines.push(buildD120({ recordNum: recordNum++, meta, doc, lineNumber: 1, linkField: linkOf(doc) }));
    }
  }
  const d120Count = d120Lines.length;

  // ── B100 journal entries ───────────────────────────────────────────
  // Each paid document: dr customer / cr sales / [cr vat] / [cr rounding]
  // Each expense: dr expense / cr cash
  const b100Lines: string[] = [];
  let txNum = 1;

  for (const doc of journalDocs) {
    const client = doc.clientId ? clientById.get(doc.clientId) || null : null;
    const docTypeCode = DOC_TYPE_CODE[doc.type];
    const customerAcct = client ? accountKeys.client(client.id) : "CASH";
    const amounts = uniformAmounts(doc);
    const details = `${doc.clientName} ${doc.subject ?? ""}`.slice(0, 50);
    let transactionLine = 1;
    // 1368 is in shekels. A foreign-currency document also carries its
    // currency (1367) and the same line in that currency (1369).
    const post = (accountKey: string, counterAccountKey: string, side: "1" | "2", amount: number, native: number, lineDetails = details) => {
      b100Lines.push(
        buildB100({
          recordNum: recordNum++,
          meta,
          transactionNum: txNum,
          transactionLine: transactionLine++,
          docRefNum: String(doc.number),
          docTypeRef: docTypeCode,
          date: doc.date,
          valueDate: doc.date,
          accountKey,
          counterAccountKey,
          details: lineDetails,
          amount,
          side,
          ...(amounts.foreign ? { foreignCurrency: amounts.currency, foreignAmount: native } : {}),
        }),
      );
    };
    post(customerAcct, "SALES-000", "1", amounts.total, doc.total);
    post("SALES-000", customerAcct, "2", amounts.subtotal, doc.subtotal);
    if (Math.abs(amounts.vat) > 0.001) post("VAT-COL", customerAcct, "2", amounts.vat, doc.vat, "מע״מ עסקאות");
    const rounding = roundingByDoc.get(doc.id) ?? 0;
    if (Math.abs(rounding) >= 0.005) post(ROUNDING_ACCOUNT.code, customerAcct, "2", rounding, doc.rounding ?? 0, "הפרש עיגול");
    txNum++;
  }

  for (const e of expenses) {
    const expenseAcct = accountKeys.expense(e.category ?? "");
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
        accountKey: expenseAcct,
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
        counterAccountKey: expenseAcct,
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
    docTypeSummary,
    generatedAt: meta.generatedAt,
  };
}
