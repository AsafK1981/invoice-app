import { supabase } from "./supabase";

/** One page of rows as PostgREST returns it for a `count: "exact"` select. */
export type RowPage = { data: unknown[] | null; error: unknown; count: number | null };

/** The Hebrew messages a paged load throws; reports and the shared stores word them differently. */
export type PagedLoadMessages = { failed: string; changed: string; unverified: string; incomplete: string };

const REPORT_MESSAGES: PagedLoadMessages = {
  failed: "טעינת נתוני הדוח נכשלה. נסו שוב.",
  changed: "הנתונים השתנו בזמן הטעינה. יש לטעון שוב את הדוח.",
  unverified: "לא ניתן לאמת את שלמות נתוני הדוח. נסו שוב.",
  incomplete: "לא כל הנתונים נטענו. נסו שוב.",
};

export const PAGE_SIZE = 500;

/**
 * Loads EVERY row, page by page. PostgREST silently caps an unpaginated
 * select at 1,000 rows, so a single select loses the oldest rows of a user
 * with a big import. `page(from, to)` runs one ranged `count: "exact"` query
 * whose order must be total (end on a unique column such as id), or pages
 * could overlap. Throws instead of returning a partial or empty list: on a
 * query error, on a count that moves mid-load, on a duplicated id, or when
 * the pages stop short of the count.
 */
export async function loadAllPages(
  page: (from: number, to: number) => PromiseLike<RowPage>,
  messages: PagedLoadMessages,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  // A row added or removed while a multi-page load runs (a cron-created
  // expense, a document issued in another tab) moves the count. That is not a
  // failure, so the load starts over from page 0; only a count that keeps
  // moving through three attempts is reported.
  for (let attempt = 1; ; attempt++) {
    try {
      return await loadAllPagesOnce(page, messages, signal);
    } catch (err) {
      if (attempt >= 3 || !(err instanceof CountChangedError)) throw err instanceof CountChangedError ? new Error(messages.changed) : err;
    }
  }
}

class CountChangedError extends Error {}

async function loadAllPagesOnce(
  page: (from: number, to: number) => PromiseLike<RowPage>,
  messages: PagedLoadMessages,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  let expected: number | null = null;
  for (;;) {
    signal?.throwIfAborted();
    const { data, error, count } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    signal?.throwIfAborted();
    if (error || !data || count === null) throw new Error(messages.failed);
    if (expected !== null && expected !== count) throw new CountChangedError(messages.changed);
    expected = count;
    for (const row of data as Record<string, unknown>[]) {
      if (typeof row.id !== "string" || ids.has(row.id)) throw new Error(messages.unverified);
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (!data.length || rows.length > expected) throw new Error(messages.incomplete);
  }
}

/** Detect server row caps and count drift; errors never become empty reports. */
export async function loadReportRows(table: "documents" | "expenses" | "clients", columns: string, businessId: string, signal?: AbortSignal) {
  return loadAllPages((from, to) => {
    let query = supabase.from(table).select(columns, { count: "exact" })
      .eq("business_id", businessId).order("id", { ascending: true }).range(from, to);
    if (signal) query = query.abortSignal(signal);
    return query as unknown as PromiseLike<RowPage>;
  }, REPORT_MESSAGES, signal);
}
