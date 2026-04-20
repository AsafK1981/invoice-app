"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import type { Expense } from "./types";

const CHANGE_EVENT = "invoice-app:expenses-changed";

function mapRow(row: Record<string, unknown>): Expense {
  return {
    id: row.id as string,
    date: (row.date as string) || new Date().toISOString().slice(0, 10),
    category: row.category as string,
    supplier: row.supplier as string,
    amount: Number(row.amount) || 0,
    description: (row.description as string) || undefined,
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
      });
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

  async remove(id: string) {
    await supabase.from("expenses").delete().eq("id", id);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

};
