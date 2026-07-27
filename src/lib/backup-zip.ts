"use client";

import JSZip from "jszip";
import Papa from "papaparse";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  BUSINESS_TYPE_LABELS,
  type Business,
  type Client,
  type Product,
  type InvoiceDocument,
  type Expense,
} from "./types";

interface BackupInput {
  business: Business;
  clients: Client[];
  products: Product[];
  documents: InvoiceDocument[];
  expenses: Expense[];
}

// UTF-8 BOM keeps Hebrew rendering correct when the CSV is opened in
// Excel; the existing CSV exports do the same.
const BOM = "﻿";

/**
 * Builds a single ZIP archive with the user's full data set as CSVs +
 * a JSON snapshot of the business profile. Triggered before any
 * destructive "delete all" action so the user can keep a copy.
 *
 * Format inside the zip:
 *   - business.json
 *   - clients.csv
 *   - products.csv
 *   - documents.csv
 *   - document-items.csv  (one row per line item, references doc number)
 *   - expenses.csv
 *   - README.txt
 *
 * Filename: backup-<business name>-<yyyy-mm-dd>.zip
 */
export async function downloadFullBackupZip(input: BackupInput): Promise<void> {
  const zip = new JSZip();
  const date = new Date().toISOString().slice(0, 10);

  // 1) Business profile snapshot as JSON. Easier than CSV for a
  //    single record with optional fields + nested keys.
  zip.file(
    "business.json",
    JSON.stringify(
      {
        name: input.business.name,
        businessType: input.business.businessType,
        businessTypeLabel: BUSINESS_TYPE_LABELS[input.business.businessType],
        taxId: input.business.taxId,
        address: input.business.address,
        phone: input.business.phone || null,
        email: input.business.email || null,
        bankName: input.business.bankName || null,
        bankBranch: input.business.bankBranch || null,
        bankAccount: input.business.bankAccount || null,
        paymentNotes: input.business.paymentNotes || null,
        defaultDocNotes: input.business.defaultDocNotes || null,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  // 2) Clients.
  zip.file(
    "clients.csv",
    BOM +
      Papa.unparse(
        input.clients.map((c) => ({
          "שם": c.name,
          "ח.פ / ת.ז": c.taxId || "",
          "כתובת": c.address || "",
          "טלפון": c.phone || "",
          "אימייל": c.email || "",
          "הערות": c.notes || "",
          "נוסף בתאריך": c.createdAt,
        })),
      ),
  );

  // 3) Products.
  zip.file(
    "products.csv",
    BOM +
      Papa.unparse(
        input.products.map((p) => ({
          "שם": p.name,
          "תיאור": p.description || "",
          "מחיר": p.price,
          "יחידה": p.unit,
        })),
      ),
  );

  // 4) Documents header rows.
  zip.file(
    "documents.csv",
    BOM +
      Papa.unparse(
        input.documents.map((d) => ({
          "מספר": d.number,
          "סוג": DOCUMENT_TYPE_LABELS[d.type],
          "תאריך": d.date,
          "לקוח": d.clientName,
          "נושא": d.subject || "",
          "סטטוס": DOCUMENT_STATUS_LABELS[d.status],
          "סכום ביניים": d.subtotal,
          "מע״מ": d.vat,
          "סה״כ": d.total,
          "אמצעי תשלום": d.paymentMethod ? PAYMENT_METHOD_LABELS[d.paymentMethod] : "",
          "אסמכתת תשלום": d.paymentReference || "",
          "שולם בתאריך": d.paidAt ? d.paidAt.slice(0, 10) : "",
          "נשלח בתאריך": d.emailedAt ? d.emailedAt.slice(0, 10) : "",
          "נפתח בתאריך": d.emailOpenedAt ? d.emailOpenedAt.slice(0, 10) : "",
          "אושר בתאריך": d.approvedAt ? d.approvedAt.slice(0, 10) : "",
          "מספר הקצאה": d.allocationNumber || "",
          "הערות": d.notes || "",
        })),
      ),
  );

  // 5) Document items, one row each, uses doc number + type as the
  // human-readable reference (id would survive a re-import but means
  // nothing to a person reading the CSV).
  const itemRows: Array<Record<string, string | number>> = [];
  for (const d of input.documents) {
    for (const it of d.items) {
      itemRows.push({
        "מסמך - מספר": d.number,
        "מסמך - סוג": DOCUMENT_TYPE_LABELS[d.type],
        "מסמך - תאריך": d.date,
        "מסמך - לקוח": d.clientName,
        "תיאור": it.description,
        "כמות": it.quantity,
        "מחיר יחידה": it.unitPrice,
        "סה״כ": it.total,
      });
    }
  }
  zip.file("document-items.csv", BOM + Papa.unparse(itemRows));

  // 6) Expenses.
  zip.file(
    "expenses.csv",
    BOM +
      Papa.unparse(
        input.expenses.map((e) => ({
          "תאריך": e.date,
          "קטגוריה": e.category,
          "ספק": e.supplier,
          "סכום": e.amount,
          "מע״מ": e.vatAmount || 0,
          "תיאור": e.description || "",
          "נתיב קבלה": e.receiptPath || "",
        })),
      ),
  );

  // 7) README: context for a future-you who finds this zip in a folder
  // a year from now and wonders what it is.
  zip.file(
    "README.txt",
    [
      `גיבוי MySuperFriendlyInvoiceApp`,
      `עסק: ${input.business.name}`,
      `יוצא בתאריך: ${date}`,
      ``,
      `קבצים:`,
      `  business.json       - פרטי העסק (שם, ע.מ, פרטי בנק)`,
      `  clients.csv         - ${input.clients.length} לקוחות`,
      `  products.csv        - ${input.products.length} מוצרים/שירותים`,
      `  documents.csv       - ${input.documents.length} מסמכים (חשבוניות / קבלות / הצעות)`,
      `  document-items.csv  - ${itemRows.length} שורות פירוט בתוך המסמכים`,
      `  expenses.csv        - ${input.expenses.length} הוצאות`,
      ``,
      `הקבצים מקודדים UTF-8 עם BOM כך שייפתחו נכון ב-Excel וב-Numbers.`,
      `קבצים מצורפים (PDFים, צילומי קבלות) שמורים ב-Storage של Supabase`,
      `ולא נכללים בגיבוי הזה.`,
    ].join("\n"),
  );

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const safeName = (input.business.name || "business").replace(/[\\/:*?"<>|]/g, "-");
  const filename = `backup-${safeName}-${date}.zip`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
