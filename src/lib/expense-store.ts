"use client";

import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import { createSharedStore } from "./shared-store";
import { loadAllPages, type RowPage } from "./report-rows";
import { STORE_LOAD_MESSAGES } from "./store-load";
import { logAudit } from "./audit-log";
import { formatCurrency } from "./format";
import { todayInIsrael } from "./date";
import { filingBusinessNumberSave } from "./business-number-hint";
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
    supplierTaxId: (row.supplier_tax_id as string) || undefined,
    reference: (row.reference as string) || undefined,
    isEquipment: Boolean(row.is_equipment),
    allocationNumber: (row.allocation_number as string) || undefined,
    source: (row.source as string) || "manual",
    sourceRef: (row.source_ref as string) || undefined,
  };
}

/** The channels allowed in expenses.source (mirrors the DB CHECK constraint). */
const EXPENSE_SOURCES = ["manual", "scan", "whatsapp", "email"] as const;

/** The VAT-filing columns, shared by insert and update so they can never drift apart. */
function filingColumns(expense: Expense) {
  return {
    supplier_tax_id: expense.supplierTaxId?.replace(/\D/g, "") || null,
    reference: expense.reference?.trim() || null,
    is_equipment: expense.isEquipment ?? false,
    allocation_number: expense.allocationNumber?.replace(/\D/g, "") || null,
  };
}

export async function fetchExpenses(): Promise<Expense[] | undefined> {
  const bid = getBusinessId();
  if (!bid) return undefined;
  // Paged and throwing on failure, same as fetchDocuments in document-store.ts.
  const rows = await loadAllPages((from, to) => supabase
    .from("expenses")
    .select("*", { count: "exact" })
    .eq("business_id", bid)
    .order("date", { ascending: false })
    // Same-day rows newest first, then id so pages can never overlap.
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to) as unknown as PromiseLike<RowPage>, STORE_LOAD_MESSAGES.expenses);
  return rows.map(mapRow);
}

// One shared fetch + snapshot for every useExpenses() consumer on the page.
// See document-store.ts's documentsStore for the full rationale.
const expensesStore = createSharedStore<Expense[]>(fetchExpenses, [], (refetch) => {
  // First subscriber only (browser only): load once the business id is known,
  // and reload on every change event - one listener for all consumers.
  onBusinessReady(() => refetch());
  window.addEventListener(CHANGE_EVENT, () => refetch());
});

export function useExpenses() {
  const snapshot = useSyncExternalStore(
    expensesStore.subscribe,
    expensesStore.getSnapshot,
    expensesStore.getServerSnapshot,
  );
  return { items: snapshot.data, ready: snapshot.ready, error: snapshot.error, retry: retryExpenses };
}

function retryExpenses() {
  void expensesStore.refetch();
}

export const expenseStore = {
  async save(expense: Expense, options?: { importBatchId: string }) {
    const bid = getBusinessId();
    if (!bid) {
      if (options) throw new Error("אין עסק פעיל - רענן את הדף ונסה שוב");
      return;
    }

    // maybeSingle + a checked error, same as clientStore.save: `.single()`
    // reports a genuine "new expense" as an error, which forced the error
    // field to be discarded and made a refused read look identical to a new
    // row. The INSERT that followed then failed on the primary key with a raw
    // Postgres message instead of saying what went wrong.
    const { data: existing, error: lookupError } = await supabase
      .from("expenses")
      .select("id")
      .eq("id", expense.id)
      .maybeSingle();
    if (lookupError) {
      throw new Error("לא הצלחנו לבדוק אם ההוצאה כבר קיימת. רענן את הדף ונסה שוב.");
    }

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
          ...filingColumns(expense),
        })
        .eq("id", expense.id);
    } else {
      const { error } = await supabase.from("expenses").insert({
        id: expense.id,
        business_id: bid,
        ...(options ? { import_batch_id: options.importBatchId } : {}),
        date: expense.date,
        category: expense.category,
        supplier: expense.supplier,
        amount: expense.amount,
        description: expense.description || null,
        vat_amount: expense.vatAmount ?? 0,
        receipt_path: expense.receiptPath || null,
        ...filingColumns(expense),
        // Provenance is set once, at insert. The UPDATE branch above
        // deliberately leaves source / source_ref alone: editing an expense
        // that arrived by email must not rewrite where it came from, and must
        // not drop the source_ref that stops the same mail being booked twice.
        // An unknown value would fail the DB CHECK, so it falls back to manual.
        source: (EXPENSE_SOURCES as readonly string[]).includes(expense.source || "")
          ? expense.source
          : "manual",
        source_ref: expense.sourceRef || null,
      });
      // Used to be `if (error && options) throw error` - on the manual path
      // (no options) a failed INSERT was swallowed and the change event fired
      // anyway, so the form closed, the toast said saved, and the expense was
      // never written. Silent data loss. An error is an error on every path.
      if (error) throw error;
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

/**
 * Inline fixes from the VAT report's "what's left" panel: one narrow UPDATE of
 * only the named filing fields, on every listed expense (a supplier's number
 * belongs to all its expenses; there is no suppliers table). Same RLS client
 * as save(), but it throws on an error or a partial write so the panel can
 * say why nothing changed.
 */
export async function updateExpenseFilingFields(
  ids: readonly string[],
  patch: { supplierTaxId?: string; reference?: string; allocationNumber?: string; date?: string },
): Promise<void> {
  const columns: Record<string, string | null> = {};
  if (patch.supplierTaxId !== undefined) {
    // Judged raw, never digit-stripped: "51333333X6" must not become a valid-looking number.
    const number = filingBusinessNumberSave(patch.supplierTaxId, { allowEmpty: true });
    if (!number.ok) throw new Error(number.message);
    columns.supplier_tax_id = number.value;
  }
  if (patch.reference !== undefined) columns.reference = patch.reference.trim() || null;
  if (patch.allocationNumber !== undefined) columns.allocation_number = patch.allocationNumber.replace(/\D/g, "") || null;
  if (patch.date !== undefined) columns.date = patch.date;
  if (ids.length === 0 || Object.keys(columns).length === 0) return;
  const { data, error } = await supabase.from("expenses").update(columns).in("id", [...ids]).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length !== ids.length) {
    // Some rows may have changed (a grouped supplier update): broadcast first so
    // the report refetches what was written, then say that the rest was not.
    window.dispatchEvent(new Event(CHANGE_EVENT));
    throw new Error("חלק מההוצאות לא עודכנו. רענן את הדף ונסה שוב.");
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
