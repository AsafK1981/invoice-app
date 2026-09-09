"use client";

import { useCallback, useEffect, useState } from "react";
import { loadReportRows } from "./report-rows";
import { mapProfitLossDocument, mapProfitLossExpense } from "./profit-loss-data";
import type { InvoiceDocument, Expense } from "./types";

const columns = {
  documents: "id,date,type,status,number,client_id,client_name,client_tax_id,subtotal,vat,total,currency,exchange_rate,subtotal_ils,vat_ils,total_ils,converted_to_id,allocation_number,zero_rated,rounding",
  expenses: "id,date,category,supplier,description,amount,vat_amount,is_equipment,supplier_tax_id,reference,allocation_number",
};
const numeric = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
const text = (value: unknown) => typeof value === "string" ? value : "";

export function mapFilingDocument(row: Record<string, unknown>): InvoiceDocument {
  return {
    ...mapProfitLossDocument(row), number: numeric(row.number), clientId: text(row.client_id),
    clientName: text(row.client_name), clientTaxId: text(row.client_tax_id), items: [],
    subtotal: numeric(row.subtotal), subtotalIls: row.subtotal_ils == null ? undefined : numeric(row.subtotal_ils),
    allocationNumber: text(row.allocation_number), zeroRated: row.zero_rated === true,
    rounding: row.rounding == null ? 0 : numeric(row.rounding),
  };
}
export function mapFilingExpense(row: Record<string, unknown>): Expense {
  return { ...mapProfitLossExpense(row), supplier: text(row.supplier), description: text(row.description), supplierTaxId: text(row.supplier_tax_id), reference: text(row.reference), allocationNumber: text(row.allocation_number) };
}
type Data = { businessId: string; includeExpenses: boolean; documents: InvoiceDocument[]; expenses: Expense[] };

/** Reporting must never turn a failed/truncated request into a clean empty return. */
export function useFilingReportData(businessId: string, includeExpenses = true) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const retry = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setData(null);
    setError("");
    if (businessId) Promise.all([
      loadReportRows("documents", columns.documents, businessId, controller.signal),
      includeExpenses ? loadReportRows("expenses", columns.expenses, businessId, controller.signal) : Promise.resolve([]),
    ]).then(([documents, expenses]) => {
      if (active) setData({ businessId, includeExpenses, documents: documents.map(mapFilingDocument), expenses: expenses.map(mapFilingExpense) });
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : "טעינת נתוני הדוח נכשלה."); });
    return () => { active = false; controller.abort(); };
  }, [businessId, version, includeExpenses]);
  useEffect(() => {
    const events = ["invoice-app:documents-changed", ...(includeExpenses ? ["invoice-app:expenses-changed"] : [])];
    events.forEach((event) => window.addEventListener(event, retry));
    return () => events.forEach((event) => window.removeEventListener(event, retry));
  }, [retry, includeExpenses]);
  return { data: data?.businessId === businessId && data.includeExpenses === includeExpenses ? data : null, error, retry };
}
