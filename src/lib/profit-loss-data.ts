"use client";

import { useCallback, useEffect, useState } from "react";
import { loadReportRows } from "./report-rows";
import type { ProfitLossDocument, ProfitLossExpense } from "./profit-loss";

const columns = {
  documents: "id,date,type,status,total,vat,currency,exchange_rate,total_ils,vat_ils,converted_to_id",
  expenses: "id,date,category,amount,vat_amount,is_equipment",
};
export function loadProfitLossRows(table: keyof typeof columns, businessId: string, signal?: AbortSignal) {
  return loadReportRows(table, columns[table], businessId, signal);
}
const number = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
const optionalNumber = (value: unknown) => value == null ? undefined : number(value);
export function mapProfitLossDocument(row: Record<string, unknown>): ProfitLossDocument {
  if (!["receipt", "tax_invoice", "tax_invoice_receipt", "credit_note", "quote", "proforma"].includes(String(row.type)) || !["draft", "sent", "paid", "cancelled"].includes(String(row.status))) throw new Error("נמצא סוג מסמך או סטטוס לא תקין. לא ניתן להפיק דוח מלא.");
  return { id: String(row.id), date: typeof row.date === "string" ? row.date : "", type: row.type as ProfitLossDocument["type"], status: row.status as ProfitLossDocument["status"], total: number(row.total), vat: number(row.vat), currency: row.currency == null ? undefined : String(row.currency), exchangeRate: optionalNumber(row.exchange_rate), totalIls: optionalNumber(row.total_ils), vatIls: optionalNumber(row.vat_ils), convertedToId: typeof row.converted_to_id === "string" ? row.converted_to_id : undefined };
}
export function mapProfitLossExpense(row: Record<string, unknown>): ProfitLossExpense {
  if (row.is_equipment != null && typeof row.is_equipment !== "boolean") throw new Error("סיווג ציוד לא תקין. לא ניתן להפיק דוח מלא.");
  return { id: String(row.id), date: typeof row.date === "string" ? row.date : "", category: typeof row.category === "string" ? row.category : "", amount: number(row.amount), vatAmount: optionalNumber(row.vat_amount), isEquipment: row.is_equipment === true };
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
