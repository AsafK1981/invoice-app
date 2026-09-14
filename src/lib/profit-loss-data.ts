"use client";

import { useCallback, useEffect, useState } from "react";
import { loadReportRows } from "./report-rows";
import type { ProfitLossDocument, ProfitLossExpense } from "./profit-loss";
import { mapProfitLossDocument, mapProfitLossExpense } from "./profit-loss-rows";

export { mapProfitLossDocument, mapProfitLossExpense };

const columns = {
  documents: "id,date,type,status,total,vat,currency,exchange_rate,total_ils,vat_ils,converted_to_id",
  expenses: "id,date,category,amount,vat_amount,is_equipment",
};
export function loadProfitLossRows(table: keyof typeof columns, businessId: string, signal?: AbortSignal) {
  return loadReportRows(table, columns[table], businessId, signal);
}
type Data = { businessId: string; documents: ProfitLossDocument[]; expenses: ProfitLossExpense[] };
export function useProfitLossData(businessId: string) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const retry = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setData(null);
    setError("");
    if (businessId) Promise.all([loadProfitLossRows("documents", businessId, controller.signal), loadProfitLossRows("expenses", businessId, controller.signal)])
      .then(([documents, expenses]) => { if (active) setData({ businessId, documents: documents.map(mapProfitLossDocument), expenses: expenses.map(mapProfitLossExpense) }); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "טעינת הנתונים נכשלה."); });
    return () => { active = false; controller.abort(); };
  }, [businessId, version]);
  return { data: data?.businessId === businessId ? data : null, error, retry };
}
