/**
 * Turns a free-text search box into a PostgREST `.or()` filter string that
 * matches Supabase's `.or()` calling convention: `col.ilike.%term%,col2.ilike.%term%`.
 *
 * Mirrors the semantics the client-side search helpers (matchClient /
 * matchExpense / matchProduct / matchDocument) already use: split the query
 * into whitespace-separated terms, every term must match (AND), and a term
 * matches if ANY of the given columns contains it case-insensitively (OR).
 * Multiple terms are applied as separate `.or()` calls chained onto the same
 * query builder, which PostgREST ANDs together - so the net effect is the
 * same "every term, any column" logic as the in-memory version.
 *
 * `%`, `,` and `()` are stripped from each term: they are PostgREST's own
 * wildcard/separator/grouping syntax, and a raw one typed by a user would
 * either do nothing (harmless) or break the filter string (a real bug this
 * function exists to prevent). Empty terms after stripping are dropped.
 */
export function searchTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[%,()]/g, "").trim())
    .filter(Boolean);
}

/** Builds the `.or(...)` argument for one term across the given columns. */
export function ilikeOrClause(columns: string[], term: string): string {
  const like = `%${term}%`;
  return columns.map((col) => `${col}.ilike.${like}`).join(",");
}
