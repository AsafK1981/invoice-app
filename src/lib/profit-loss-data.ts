"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { ProfitLossDocument, ProfitLossExpense } from "./profit-loss";

const columns = {
  documents: "id,date,type,status,total,vat,currency,exchange_rate,total_ils,vat_ils,converted_to_id",
  expenses: "id,date,category,amount,vat_amount,is_equipment",
};
/** Exact counts detect server row caps and changing sets; errors never become empty reports. */
export async function loadProfitLossRows(table: keyof typeof columns, businessId: string, signal?: AbortSignal) {
  const rows: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  let expected: number | null = null;
  for (;;) {
    signal?.throwIfAborted();
    let query = supabase.from(table).select(columns[table], { count: "exact" })
      .eq("business_id", businessId).order("id", { ascending: true }).range(rows.length, rows.length + 499);
    if (signal) query = query.abortSignal(signal);
    const { data, error, count } = await query;
    signal?.throwIfAborted();
    if (error || !data || count === null) throw new Error("טעינת נתוני הדוח נכשלה. נסו שוב.");
    if (expected !== null && expected !== count) throw new Error("הנתונים השתנו בזמן הטעינה. יש לטעון שוב את הדוח.");
    expected = count;
    for (const row of data as unknown as Record<string, unknown>[]) {
      if (typeof row.id !== "string" || ids.has(row.id)) throw new Error("לא ניתן לאמת את שלמות נתוני הדוח. נסו שוב.");
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (!data.length || rows.length > expected) throw new Error("לא כל הנתונים נטענו. נסו שוב.");
  }
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
