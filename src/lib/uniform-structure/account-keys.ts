// One id-to-key map for every B110 account row and every B100 posting that
// names it. Fields 1403 / 1364 / 1365 are X(15): keys are at most 15
// characters, unique, never a reserved standard account, and the same between
// runs of the same data. Before this map the client and expense keys were
// built separately at each site and two long names silently became one account.

export const ACCOUNT_KEY_WIDTH = 15;

/**
 * `raws` in priority order (the caller decides it). Natural key first
 * (`prefix` + the first `rawWidth` characters, which is what every file carried
 * before), so a file that never collided keeps its keys. When several values
 * share a natural key, the first in order keeps it and the rest get the key
 * cut to 12 characters plus "~NN" (base 36).
 */
export function assignAccountKeys(prefix: string, raws: Iterable<string>, rawWidth: number, reserved: Iterable<string> = []): Map<string, string> {
  const used = new Set(reserved);
  const keys = new Map<string, string>();
  const groups = new Map<string, string[]>();
  for (const raw of new Set(raws)) {
    const natural = `${prefix}${raw.slice(0, rawWidth)}`.slice(0, ACCOUNT_KEY_WIDTH);
    groups.set(natural, [...(groups.get(natural) ?? []), raw]);
  }
  for (const [natural, group] of groups) {
    if (used.has(natural)) continue;
    keys.set(group[0], natural);
    used.add(natural);
  }
  for (const [natural, group] of groups) {
    for (const raw of group) {
      if (keys.has(raw)) continue;
      for (let n = 1; n < 36 * 36; n++) {
        const candidate = `${natural.slice(0, ACCOUNT_KEY_WIDTH - 3)}~${n.toString(36).padStart(2, "0")}`;
        if (used.has(candidate)) continue;
        keys.set(raw, candidate);
        used.add(candidate);
        break;
      }
    }
  }
  return keys;
}

/** Plain code-unit order: the same on every machine and locale. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface AccountKeys {
  client(id: string): string;
  expense(category: string): string;
}

/**
 * Clients ordered by creation time, then id (the older client keeps the
 * natural key); categories ordered by name. Pass every category of the
 * business, not only the year's, so a category keeps its key across years.
 */
export function buildAccountKeys(
  clients: Iterable<{ id: string; createdAt?: string }>,
  categories: Iterable<string | { category: string; date?: string }>,
  reserved: Iterable<string>,
): AccountKeys {
  const reservedList = [...reserved];
  const orderedClients = [...clients]
    .sort((a, b) => compare(a.createdAt ?? "", b.createdAt ?? "") || compare(a.id, b.id))
    .map((c) => c.id);
  const clientKeys = assignAccountKeys("CLI-", orderedClients, 10, reservedList);
  // Earliest use first, then name: an older category keeps its natural key
  // when a newer one with the same prefix appears later.
  const firstUse = new Map<string, string>();
  for (const entry of categories) {
    const category = typeof entry === "string" ? entry : entry.category ?? "";
    const date = typeof entry === "string" ? "" : entry.date ?? "";
    const known = firstUse.get(category);
    if (known === undefined || (date && (!known || date < known))) firstUse.set(category, date);
  }
  const orderedCategories = [...firstUse.entries()]
    .sort(([a, aDate], [b, bDate]) => compare(aDate || "9999", bDate || "9999") || compare(a, b))
    .map(([category]) => category);
  const expenseKeys = assignAccountKeys("EXP-", orderedCategories, 11, [...reservedList, ...clientKeys.values()]);
  return {
    client: (id) => clientKeys.get(id) ?? `CLI-${id.slice(0, 10)}`,
    expense: (category) => expenseKeys.get(category ?? "") ?? `EXP-${String(category ?? "").slice(0, 11)}`,
  };
}
