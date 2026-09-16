import { supabase } from "./supabase";
import { loadAllPages, PAGE_SIZE, type PagedLoadMessages, type RowPage } from "./paged-load";

// The paging machinery itself moved to ./paged-load, which imports nothing, so
// the server-side portal route can share it without pulling in the browser
// Supabase client. Re-exported here because six modules import it from this
// path.
export { loadAllPages, PAGE_SIZE };
export type { PagedLoadMessages, RowPage };

const REPORT_MESSAGES: PagedLoadMessages = {
  failed: "טעינת נתוני הדוח נכשלה. נסו שוב.",
  changed: "הנתונים השתנו בזמן הטעינה. יש לטעון שוב את הדוח.",
  unverified: "לא ניתן לאמת את שלמות נתוני הדוח. נסו שוב.",
  incomplete: "לא כל הנתונים נטענו. נסו שוב.",
};

/** Detect server row caps and count drift; errors never become empty reports. */
export async function loadReportRows(table: "documents" | "expenses" | "clients", columns: string, businessId: string, signal?: AbortSignal) {
  return loadAllPages((from, to) => {
    let query = supabase.from(table).select(columns, { count: "exact" })
      .eq("business_id", businessId).order("id", { ascending: true }).range(from, to);
    if (signal) query = query.abortSignal(signal);
    return query as unknown as PromiseLike<RowPage>;
  }, REPORT_MESSAGES, signal);
}
