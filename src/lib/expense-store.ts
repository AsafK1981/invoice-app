"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import { logAudit } from "./audit-log";
import { formatCurrency } from "./format";
import { todayInIsrael } from "./date";
import type { Expense } from "./types";

const CHANGE_EVENT = "invoice-app:expenses-changed";

function mapRow(row: Record<string, unknown>): Expense {
  return {
    id: row.id as string,
    date: (row.date as string) || todayInIsrael(),
    category: row.category as string,
    supplier: row.supplier as string,
    amount: Number(row.amount) || 0,
    description: (row.description as string) || undefined,
    vatAmount: row.vat_amount != null ? Number(row.vat_amount) : 0,
    receiptPath: (row.receipt_path as string) || undefined,
  };
}

export function useExpenses() {
  const [items, setItems] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .eq("business_id", bid)
      .order("date", { ascending: false });
    setItems((data || []).map(mapRow));
    setReady(true);
  }, []);

  useEffect(() => {
    onBusinessReady(() => fetch());
    const handler = () => fetch();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [fetch]);

  return { items, ready };
}

export const expenseStore = {
  async save(expense: Expense) {
    const bid = getBusinessId();
    if (!bid) return;

    const { data: existing } = await supabase
      .from("expenses")
      .select("id")
      .eq("id", expense.id)
      .single();

    if (existing) {
      await supabase
        .from("expenses")
        .update({
          date: expense.date,
          category: expense.category,
          supplier: expense.supplier,
          amount: expense.amount,
          description: expense.description || null,
          vat_amount: expense.vatAmount ?? 0,
          receipt_path: expense.receiptPath || null,
        })
        .eq("id", expense.id);
    } else {
      await supabase.from("expenses").insert({
        id: expense.id,
        business_id: bid,
        date: expense.date,
        category: expense.category,
        supplier: expense.supplier,
        amount: expense.amount,
        description: expense.description || null,
        vat_amount: expense.vatAmount ?? 0,
        receipt_path: expense.receiptPath || null,
      });
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

  async remove(id: string) {
    const { data: snap } = await supabase
      .from("expenses")
      .select("supplier, amount, category")
      .eq("id", id)
      .maybeSingle();
    await supabase.from("expenses").delete().eq("id", id);
    if (snap?.supplier) {
      logAudit({
        action: "expense.deleted",
        targetType: "expense",
        targetId: id,
        targetLabel: `${snap.supplier as string} · ${formatCurrency(Number(snap.amount))}`,
        payload: { category: snap.category, amount: Number(snap.amount) },
      });
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

};
