export interface UniformPage<T> { data: T[] | null; count: number | null; error: unknown }

/** Every page must match an exact, stable count; never export a truncated query. */
export async function loadUniformPages<T extends { id: string }>(fetchPage: (from: number, to: number) => PromiseLike<UniformPage<T>>): Promise<T[]> {
  const rows: T[] = [];
  const ids = new Set<string>();
  let expected: number | undefined;
  for (let from = 0; ; from += 500) {
    const page = await fetchPage(from, from + 499);
    if (page.error || !page.data || page.count == null || (expected !== undefined && page.count !== expected)) throw new Error("Incomplete report data");
    expected = page.count;
    if (page.data.length !== Math.min(500, expected - from)) throw new Error("Incomplete report page");
    for (const row of page.data) {
      if (ids.has(row.id)) throw new Error("Unstable report pagination");
      ids.add(row.id); rows.push(row);
    }
    if (rows.length === expected) return rows;
  }
}
