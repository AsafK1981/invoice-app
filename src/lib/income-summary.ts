import { countsAsIncome } from "./revenue";
import type { DocumentStatus, DocumentType } from "./types";

/**
 * Aggregates a period's income the way the rest of the app counts it.
 *
 * This lives here rather than inline in /api/assistant so the assistant
 * quotes the same number as the dashboard. The rule is the app-wide one in
 * revenue.ts (`countsAsIncome`): paid revenue documents MINUS credit notes.
 * A credit note is stored negative and saved "sent", never "paid", so it
 * counts by issue date whatever its status. (Until 2026-09-15 this gate let
 * only paid documents through, which never subtracted a real credit note;
 * the owner settled the rule that day.)
 */
export interface IncomeRow {
  type: string;
  status: string;
  /** Native-currency total. Already negative on credit notes. */
  total: unknown;
  /** ILS-normalized total on foreign-currency documents; null when ILS. */
  total_ils?: unknown;
  client_name?: string | null;
  converted_to_id?: string | null;
}

export interface IncomeSummary {
  total: number;
  documentCount: number;
  topClients: { client: string; amount: number }[];
}

function money(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function summarizeIncome(rows: IncomeRow[], topClientLimit = 10): IncomeSummary {
  const countable = rows.filter(
    (d) =>
      countsAsIncome({
        type: d.type as DocumentType,
        status: d.status as DocumentStatus,
        convertedToId: d.converted_to_id ?? undefined,
      }),
  );

  let total = 0;
  const byClient = new Map<string, number>();
  for (const d of countable) {
    // Plain sum, no per-type sign handling. The editor already stores credit
    // notes negative (receipt-editor.tsx applies `sign = -1` to subtotal, vat
    // and total), so they subtract on their own - negating them here would
    // turn a refund into extra income. Prefer total_ils: `total` is in the
    // document's own currency, and summing a USD invoice as shekels overstates
    // income. Both choices mirror the dashboard's
    // `sum + (d.totalIls ?? d.total)`.
    const amount = money(d.total_ils ?? d.total);
    total += amount;
    const key = d.client_name || "ללא לקוח";
    byClient.set(key, (byClient.get(key) || 0) + amount);
  }

  const topClients = [...byClient.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topClientLimit)
    .map(([client, amount]) => ({ client, amount: round2(amount) }));

  return { total: round2(total), documentCount: countable.length, topClients };
}
