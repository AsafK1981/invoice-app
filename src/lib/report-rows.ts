import { supabase } from "./supabase";

/** Detect server row caps and count drift; errors never become empty reports. */
export async function loadReportRows(table: "documents" | "expenses" | "clients", columns: string, businessId: string, signal?: AbortSignal) {
  const rows: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  let expected: number | null = null;
  for (;;) {
    signal?.throwIfAborted();
    let query = supabase.from(table).select(columns, { count: "exact" })
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
