/**
 * Paged loading of every row of a PostgREST select.
 *
 * This file deliberately imports nothing: the browser stores, the reports and
 * the server-side portal route all need the same completeness guarantees, and
 * the portal runs in a route handler where the browser Supabase client must
 * not be imported. `report-rows.ts` re-exports everything here, so the
 * existing `@/lib/report-rows` imports keep working.
 */

/** One page of rows as PostgREST returns it for a `count: "exact"` select. */
export type RowPage = { data: unknown[] | null; error: unknown; count: number | null };

/** The Hebrew messages a paged load throws; reports and the shared stores word them differently. */
export type PagedLoadMessages = { failed: string; changed: string; unverified: string; incomplete: string };

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
