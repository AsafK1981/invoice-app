import Papa from "papaparse";
import type { InvoiceDocument, Expense, Client } from "./types";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "./types";

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

export function exportDocuments(documents: InvoiceDocument[]) {
  const rows = documents.map((d) => ({
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
    "הערות": d.notes || "",
  }));

  const csv = Papa.unparse(rows);
  const date = new Date().toISOString().slice(0, 10);
  download(`documents-${date}.csv`, csv);
}

export function exportExpenses(expenses: Expense[]) {
  const rows = expenses.map((e) => ({
    "תאריך": e.date,
    "קטגוריה": e.category,
    "ספק": e.supplier,
    "סכום": e.amount,
    "תיאור": e.description || "",
  }));
  const csv = Papa.unparse(rows);
  const date = new Date().toISOString().slice(0, 10);
  download(`expenses-${date}.csv`, csv);
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
