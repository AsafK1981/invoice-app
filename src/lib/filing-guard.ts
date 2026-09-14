// Pure half of scripts/filing-preflight-guard.mjs. Only codes and business
// counts pass through here: messages can embed amounts and never leave the
// guard process.

export type GuardCounts = Record<string, number>;

export interface GuardChange {
  code: string;
  before: number;
  after: number;
}

export function countAffectedBusinesses(perBusiness: readonly (readonly string[])[]): GuardCounts {
  const counts: GuardCounts = {};
  for (const codes of perBusiness) for (const code of new Set(codes)) counts[code] = (counts[code] ?? 0) + 1;
  return counts;
}

/** Zero-noise: a code is worth a push only when it is new or more businesses hit it than last time. */
export function newOrGrownCodes(previous: GuardCounts, next: GuardCounts): GuardChange[] {
  return Object.entries(next)
    .filter(([code, after]) => after > (previous[code] ?? 0))
    .map(([code, after]) => ({ code, before: previous[code] ?? 0, after }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function formatGuardTable(counts: GuardCounts): string {
  const rows = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return ["code\tbusinessesAffected", ...(rows.length ? rows.map(([code, n]) => `${code}\t${n}`) : ["(none)"])].join("\n");
}

export function formatGuardPush(changes: readonly GuardChange[], periodLabel: string): string {
  return [
    `בדיקות דוחות ההגשה, ${periodLabel}: בדיקה חוסמת חדשה או מתרחבת`,
    ...changes.map((c) => `${c.code}: ${c.before} -> ${c.after} עסקים`),
  ].join("\n");
}

/**
 * Keeps report families apart in one state file. PCN874 codes stay bare (the
 * existing state keeps comparing); the others are "invoices:<code>" and
 * "uniform:<code>".
 */
export function prefixCodes(prefix: string, codes: readonly string[]): string[] {
  return codes.map((code) => `${prefix}:${code}`);
}
