// The filing-deadline reminder for ONE business: claim -> load the period's
// rows (only when a VAT or advance reminder is due) -> resolve the amounts ->
// build the text -> send -> release what failed. Server-only (service_role
// client passed in), no Next.js imports, so the daily cron
// (src/app/api/cron/filing-reminders/route.ts) is a thin loop and a script can
// run it for a single business with a chosen `today` and a recording `send`.
//
// Privacy: amounts are computed from the owner's own documents and expenses
// and written only into the owner's notification. Logs carry ids only, never
// an amount, a client name or a subject.
//
// Spec: docs/superpowers/specs/2026-09-27-filing-reminder-amounts-design.md

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business, Expense, InvoiceDocument } from "./types";
import { createNotificationForBusiness } from "./notifications-server";
import { mapFilingRow, stringMap } from "./filing-settings";
import { planFilingReminders, reminderText, type PlannedReminder } from "./filing-reminders";
import { periodOfOccurrence, resolveReminderAmount, type ReminderAmount } from "./filing-amounts";
import { filingRange } from "./periodic-filing";
import { FILING_COLUMNS, mapFilingDocument, mapFilingExpense } from "./filing-rows";
import { loadAllPages, type PagedLoadMessages, type RowPage } from "./paged-load";

export interface BusinessReminderOutcome {
  planned: number;
  sent: number;
  withAmount: number;
  failedClaim: boolean;
  failedSends: number;
}

export interface ReminderBusiness {
  id: string;
  taxId: string;
  businessType: Business["businessType"];
  incomeTaxAdvanceRate?: number;
}

// Thrown by loadAllPages and caught in loadPeriodRows; never shown to anyone.
const ROW_MESSAGES: PagedLoadMessages = {
  failed: "טעינת השורות נכשלה.",
  changed: "השורות השתנו בזמן הטעינה.",
  unverified: "לא ניתן לאמת את שלמות השורות.",
  incomplete: "לא כל השורות נטענו.",
};

const needsRows = (item: PlannedReminder) => item.occurrence.id === "vat_periodic" || item.occurrence.id === "income_tax_advance";

/** A figure the owner can act on (pay / refund / zero), as opposed to a missing one. */
const carriesFigure = (a: ReminderAmount | null) => !!a && a.status !== "missing";

export async function remindBusiness(args: {
  admin: SupabaseClient;
  /** The business's filing_preferences row. */
  row: Record<string, unknown>;
  business: ReminderBusiness;
  /** ISO date in Israel time. */
  today: string;
  send?: typeof createNotificationForBusiness;
}): Promise<BusinessReminderOutcome> {
  const { admin, business, today } = args;
  const send = args.send ?? createNotificationForBusiness;
  const businessId = business.id;
  const outcome: BusinessReminderOutcome = { planned: 0, sent: 0, withAmount: 0, failedClaim: false, failedSends: 0 };

  // Claim first. The update is conditional on the row's updated_at (the
  // guard trigger bumps it on every write), so two overlapping runs, or an
  // owner saving at the same moment, cannot both win with a stale map.
  // A lost race re-reads the row once and plans again from fresh data.
  let current: Record<string, unknown> | null = args.row;
  let plan: PlannedReminder[] = [];
  let claimed: Record<string, string> | null = null;
  let settings = mapFilingRow(current).settings;
  for (let attempt = 0; attempt < 2 && current; attempt++) {
    const mapped = mapFilingRow(current);
    settings = mapped.settings;
    const reminded = stringMap(current.reminded);
    plan = planFilingReminders({ businessType: business.businessType, settings, filed: mapped.filed, reminded, today });
    if (plan.length === 0) break;
    const next = { ...reminded };
    const claimedAt = new Date().toISOString();
    for (const item of plan) next[item.occurrence.key] = claimedAt;
    const claim = await admin
      .from("filing_preferences")
      .update({ reminded: next })
      .eq("business_id", businessId)
      .eq("updated_at", current.updated_at as string)
      .select("business_id");
    if (claim.error) {
      console.error("[filing-reminders] claim failed", { businessId, error: claim.error.message });
      break;
    }
    if (claim.data && claim.data.length > 0) {
      claimed = next;
      break;
    }
    const fresh = await admin.from("filing_preferences").select("*").eq("business_id", businessId).maybeSingle();
    current = (fresh.data as Record<string, unknown> | null) ?? null;
  }
  outcome.planned = plan.length;
  if (plan.length === 0) return outcome;
  if (!claimed) {
    outcome.failedClaim = true;
    return outcome;
  }

  // Rows for the VAT / advance figures: one load over the union of the
  // planned periods, and only when such a reminder is due.
  let rows: { documents: InvoiceDocument[]; expenses: Expense[] } | null = null;
  const rowItems = plan.filter(needsRows);
  if (rowItems.length > 0) {
    const range = unionRange(rowItems);
    try {
      rows = range ? await loadPeriodRows(admin, businessId, range.start, range.end) : null;
    } catch {
      // A throw (network, or a mapper meeting an unexpected row) must not stop
      // the reminders: they go out with the plain text instead.
      rows = null;
      console.error("[filing-reminders] rows failed", { businessId });
    }
  }

  // Noon UTC is the same calendar day in Israel, so the report's "has the
  // period ended" and PCN date checks see exactly `today`.
  const todayDate = new Date(`${today}T12:00:00Z`);
  const released: string[] = [];
  for (const item of plan) {
    const key = item.occurrence.key;
    let amount: ReminderAmount | null = null;
    if (needsRows(item) && !rows) {
      console.error("[filing-reminders] amount failed", { businessId, key });
    } else {
      try {
        amount = resolveReminderAmount({
          occurrence: item.occurrence,
          business,
          settings,
          documents: rows?.documents ?? [],
          expenses: rows?.expenses ?? [],
          today: todayDate,
        });
      } catch {
        amount = null;
        console.error("[filing-reminders] amount failed", { businessId, key });
      }
    }
    const { title, body, href } = reminderText(item.occurrence, today, amount);
    const ok = await send({ businessId, kind: "filing_deadline", title, body, href });
    if (ok) {
      outcome.sent++;
      if (carriesFigure(amount)) outcome.withAmount++;
    } else {
      outcome.failedSends++;
      released.push(key);
    }
  }

  if (released.length > 0) await releaseKeys(admin, businessId, released);
  return outcome;
}

/** The date span covering every planned VAT / advance period, or null if one of them is not a filing period. */
function unionRange(items: PlannedReminder[]): { start: string; end: string } | null {
  let start = "";
  let end = "";
  for (const item of items) {
    const period = periodOfOccurrence(item.occurrence);
    const range = period ? filingRange(period) : null;
    if (!range) return null;
    if (!start || range.start < start) start = range.start;
    if (!end || range.end > end) end = range.end;
  }
  return start && end ? { start, end } : null;
}

/**
 * Give failed sends their keys back so tomorrow's run retries them. A
 * compare-and-swap on the FRESH row: only the released keys are removed from
 * the map as stored now, so a key another run claimed in the meantime is
 * never overwritten. A lost race re-reads once more, then gives up (the
 * reminder is lost rather than repeated).
 */
async function releaseKeys(admin: SupabaseClient, businessId: string, keys: string[]): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const fresh = await admin.from("filing_preferences").select("*").eq("business_id", businessId).maybeSingle();
    const row = (fresh.data as Record<string, unknown> | null) ?? null;
    if (fresh.error || !row) break;
    const reminded = stringMap(row.reminded);
    for (const key of keys) delete reminded[key];
    const release = await admin
      .from("filing_preferences")
      .update({ reminded })
      .eq("business_id", businessId)
      .eq("updated_at", row.updated_at as string)
      .select("business_id");
    if (release.error) break;
    if (release.data && release.data.length > 0) return;
  }
  console.error("[filing-reminders] could not release failed reminders", { businessId, keys });
}

/**
 * The business's documents and expenses dated inside [start, end], every row
 * (loadAllPages refuses a partial list). Null on any failure, including a
 * mapper meeting an unexpected row.
 */
async function loadPeriodRows(
  admin: SupabaseClient,
  businessId: string,
  start: string,
  end: string,
): Promise<{ documents: InvoiceDocument[]; expenses: Expense[] } | null> {
  const page = (table: "documents" | "expenses", columns: string) => (from: number, to: number) =>
    admin
      .from(table)
      .select(columns, { count: "exact" })
      .eq("business_id", businessId)
      .gte("date", start)
      .lte("date", end)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<RowPage>;
  try {
    const documents = await loadAllPages(page("documents", FILING_COLUMNS.documents), ROW_MESSAGES);
    const expenses = await loadAllPages(page("expenses", FILING_COLUMNS.expenses), ROW_MESSAGES);
    return { documents: documents.map(mapFilingDocument), expenses: expenses.map(mapFilingExpense) };
  } catch {
    console.error("[filing-reminders] rows failed", { businessId });
    return null;
  }
}
