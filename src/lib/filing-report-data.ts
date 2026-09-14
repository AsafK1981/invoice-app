"use client";

import { useCallback, useEffect, useState } from "react";
import { loadReportRows } from "./report-rows";
import { FILING_COLUMNS, mapFilingDocument, mapFilingExpense } from "./filing-rows";
import type { InvoiceDocument, Expense } from "./types";

export { mapFilingDocument, mapFilingExpense };

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
      loadReportRows("documents", FILING_COLUMNS.documents, businessId, controller.signal),
      includeExpenses ? loadReportRows("expenses", FILING_COLUMNS.expenses, businessId, controller.signal) : Promise.resolve([]),
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
