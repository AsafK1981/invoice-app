import Papa from "papaparse";
import type { InvoiceDocument, Expense, Client } from "./types";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "./types";
import { formatDate } from "./format";
import type { OpenReceivablesResult } from "./capital-declaration";

function download(filename: string, content: string) {
  const bom = "﻿";
  const blob = new Blob([bom + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportDocuments(documents: InvoiceDocument[], suffix?: string) {
  const rows = documents.map((d) => ({
    "מספר": d.number,
    "סוג": DOCUMENT_TYPE_LABELS[d.type],
    "תאריך": d.date,
    "לקוח": d.clientName,
    "נושא": d.subject || "",
    "סטטוס": DOCUMENT_STATUS_LABELS[d.status],
    // No currency column in this export, so a raw native-currency total
    // would silently misreport a USD invoice as that many shekels once
    // mixed into the same column as ILS documents; `totalIls` normalizes it.
    "סכום ביניים": d.subtotalIls ?? d.subtotal,
    "מע״מ": d.vatIls ?? d.vat,
    "סה״כ": d.totalIls ?? d.total,
    "אמצעי תשלום": d.paymentMethod ? PAYMENT_METHOD_LABELS[d.paymentMethod] : "",
    "הערות": d.notes || "",
  }));

  const csv = Papa.unparse(rows);
  const date = new Date().toISOString().slice(0, 10);
  const tag = suffix ? `-${suffix}` : "";
  download(`documents${tag}-${date}.csv`, csv);
}

export function exportExpenses(expenses: Expense[], suffix?: string) {
  const rows = expenses.map((e) => ({
    "תאריך": e.date,
    "קטגוריה": e.category,
    "ספק": e.supplier,
    "סכום": e.amount,
    "תיאור": e.description || "",
  }));
  const csv = Papa.unparse(rows);
  const date = new Date().toISOString().slice(0, 10);
  const tag = suffix ? `-${suffix}` : "";
  download(`expenses${tag}-${date}.csv`, csv);
}

/** The reports page's month-by-month table (income / expenses / profit). */
export function exportMonthlySummary(
  rows: {
    month: string;
    label: string;
    income: number;
    expenses: number;
    docs?: number;
    margin?: number | null;
    cumulative?: number;
  }[],
  suffix?: string,
) {
  const out = rows.map((r) => ({
    "חודש": r.label,
    "מסמכים": r.docs ?? "",
    "הכנסות": Math.round(r.income * 100) / 100,
    "הוצאות": Math.round(r.expenses * 100) / 100,
    "רווח": Math.round((r.income - r.expenses) * 100) / 100,
    "שולי רווח %": r.margin ?? "",
    "רווח מצטבר": r.cumulative === undefined ? "" : Math.round(r.cumulative * 100) / 100,
  }));
  const csv = Papa.unparse(out);
  const date = new Date().toISOString().slice(0, 10);
  const tag = suffix ? `-${suffix}` : "";
  download(`monthly-summary${tag}-${date}.csv`, csv);
}

/**
 * Draft export for the הצהרת הון (capital declaration) helper: the business
 * slice ONLY (declared income per year + open receivables), plus an explicit
 * checklist of everything the app does not know. Every row shares the same
 * three columns on purpose so a single Papa.unparse call keeps a consistent
 * header no matter which section a row came from.
 *
 * This is a DRAFT for an accountant, not a filled form - the header row and
 * the checklist rows say so in plain text, because a CSV loses whatever
 * on-screen disclaimer surrounded it.
 */
export function exportCapitalDeclarationDraft(params: {
  asOfDate: string;
  yearRows: { year: number; income: number; expenses: number; profit: number }[];
  receivables: OpenReceivablesResult;
  notCoveredCategories: string[];
}) {
  const { asOfDate, yearRows, receivables, notCoveredCategories } = params;
  type Row = { "מקטע": string; "תיאור": string; "ערך": string | number };
  const rows: Row[] = [];

  rows.push({
    "מקטע": "כותרת",
    "תיאור": "טיוטת הכנה להצהרת הון (טופס 1219) - חלק עסקי בלבד, לא הצהרה מלאה",
    "ערך": `נכון לתאריך ${formatDate(asOfDate)}`,
  });
  rows.push({
    "מקטע": "כותרת",
    "תיאור": "המערכת אינה מכירה נכסים אישיים (בנק, נדל״ן, ניירות ערך, רכבים, הלוואות)",
    "ערך": "יש להשלים בנפרד ולאמת מול רואה חשבון",
  });

  for (const r of yearRows) {
    rows.push({ "מקטע": "הכנסות עסקיות מוצהרות", "תיאור": `הכנסות ${r.year}`, "ערך": r.income });
    rows.push({ "מקטע": "הכנסות עסקיות מוצהרות", "תיאור": `הוצאות ${r.year}`, "ערך": r.expenses });
    rows.push({ "מקטע": "הכנסות עסקיות מוצהרות", "תיאור": `רווח נקי ${r.year}`, "ערך": r.profit });
  }

  rows.push({
    "מקטע": "חייבים פתוחים (נכס בהצהרת הון)",
    "תיאור": `סה״כ חייבים פתוחים נכון ל-${formatDate(asOfDate)} (${receivables.count} מסמכים)`,
    "ערך": receivables.total,
  });
  for (const d of receivables.docs) {
    rows.push({
      "מקטע": "חייבים פתוחים (נכס בהצהרת הון)",
      "תיאור": `${DOCUMENT_TYPE_LABELS[d.type]} #${d.number} · ${d.clientName} · ${formatDate(d.date)}`,
      "ערך": d.totalIls ?? d.total,
    });
  }

  for (const cat of notCoveredCategories) {
    rows.push({
      "מקטע": "עדיין לא מכוסה - למלא בנפרד",
      "תיאור": cat,
      "ערך": "לא ידוע למערכת",
    });
  }

  const csv = Papa.unparse(rows);
  const date = new Date().toISOString().slice(0, 10);
  download(`הצהרת-הון-טיוטה-עסקית-${date}.csv`, csv);
}

export function exportClients(clients: Client[]) {
  const rows = clients.map((c) => ({
    "שם": c.name,
    "ח.פ / ת.ז": c.taxId || "",
    "כתובת": c.address || "",
    "טלפון": c.phone || "",
    "אימייל": c.email || "",
    "הערות": c.notes || "",
    "נוסף בתאריך": c.createdAt,
  }));
  const csv = Papa.unparse(rows);
  const date = new Date().toISOString().slice(0, 10);
  download(`clients-${date}.csv`, csv);
}
