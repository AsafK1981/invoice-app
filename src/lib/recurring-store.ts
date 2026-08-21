"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { logAudit } from "./audit-log";
import type { DocumentType } from "./types";

export interface RecurringTemplate {
  id: string;
  clientId: string;
  clientName: string;
  documentType: DocumentType;
  subject: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  frequency: "monthly" | "weekly";
  /**
   * The day the charge recurs on: 1-31 for monthly, 0-6 (Sunday-Saturday) for
   * weekly. Optional - templates created before this existed simply keep
   * recurring on whatever day they were created, which is what they do today.
   */
  anchorDay?: number;
  nextDue: string;
  active: boolean;
  createdAt: string;
}

const CHANGE_EVENT = "invoice-app:recurring-changed";

/**
 * Recurring templates live in a single user_metadata JSON blob, so every
 * mutation is a read-modify-write with no row-level merge. Two concurrent
 * mutations (generate from two templates at once, or a save while another
 * is in flight) would otherwise read the same baseline and the second
 * updateUser would clobber the first: a lost update.
 *
 * serializeWrite runs mutations one at a time. Each one re-reads the freshest
 * metadata inside its own callback (after the previous write has persisted),
 * so updates compose instead of overwriting. Exported for direct testing.
 * (Note: this guards a single session/tab; truly concurrent edits from two
 * separate tabs/devices still need a row-backed table, a larger change.)
 */
let writeChain: Promise<unknown> = Promise.resolve();
export function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function getTemplates(): Promise<RecurringTemplate[]> {
  const { data: { user } } = await supabase.auth.getUser();
  return (user?.user_metadata?.recurring_templates as RecurringTemplate[]) || [];
}

export async function saveTemplate(template: RecurringTemplate) {
  return serializeWrite(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    const existing = (user.user_metadata?.recurring_templates as RecurringTemplate[]) || [];
    const idx = existing.findIndex((t) => t.id === template.id);
    const next = [...existing];
    if (idx >= 0) next[idx] = template;
    else next.push(template);
    await supabase.auth.updateUser({
      data: { ...user.user_metadata, recurring_templates: next },
    });
    window.dispatchEvent(new Event(CHANGE_EVENT));
  });
}

export async function deleteTemplate(id: string) {
  return serializeWrite(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const existing = (user.user_metadata?.recurring_templates as RecurringTemplate[]) || [];
    const removed = existing.find((t) => t.id === id);
    if (removed) {
      logAudit({
        action: "recurring.deleted",
        targetType: "recurring",
        targetId: id,
        targetLabel: `${removed.clientName} · ${removed.subject || removed.frequency}`,
      });
    }
    await supabase.auth.updateUser({
      data: {
        ...user.user_metadata,
        recurring_templates: existing.filter((t) => t.id !== id),
      },
    });
    window.dispatchEvent(new Event(CHANGE_EVENT));
  });
}

export function useRecurringTemplates() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = () => {
      getTemplates().then((t) => {
        setTemplates(t);
        setReady(true);
      });
    };
    load();
    window.addEventListener(CHANGE_EVENT, load);
    return () => window.removeEventListener(CHANGE_EVENT, load);
  }, []);

  return { templates, ready };
}

/**
 * The first date on or after `from` that lands on the template's anchor day.
 * Used when a template is created: picking "the 1st of the month" on the 21st
 * should schedule the 1st of NEXT month, not today.
 *
 * Monthly anchors past the end of a short month clamp to that month's last day
 * (anchor 31 therefore means "last day of every month"), and the clamp is
 * applied per month rather than carried forward, so a 31st template stays on
 * the 31st in March after being served on Feb 28.
 */
export function nextDueFromAnchor(
  from: string,
  frequency: "monthly" | "weekly",
  anchorDay: number,
): string {
  const [y, m, d] = from.split("-").map(Number);
  if (frequency === "weekly") {
    const fromDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const delta = (anchorDay - fromDow + 7) % 7;
    return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
  }
  const lastThisMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayThisMonth = Math.min(anchorDay, lastThisMonth);
  if (dayThisMonth >= d) {
    return new Date(Date.UTC(y, m - 1, dayThisMonth)).toISOString().slice(0, 10);
  }
  const lastNextMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, lastNextMonth)))
    .toISOString()
    .slice(0, 10);
}

export function calculateNextDue(
  currentDue: string,
  frequency: "monthly" | "weekly" | "yearly",
  anchorDay?: number,
): string {
  const [y, m, d] = currentDue.split("-").map(Number);
  if (frequency === "weekly") {
    return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  }
  // Monthly OR yearly: advance N calendar months (1 for monthly, 12 for
  // yearly), clamping the day to the target month's last day so the 29th-31st
  // don't overflow into the month after (plain setMonth turns Jan 31 + 1 month
  // into Mar 3, silently skipping months for end-of-month templates; the same
  // clamp keeps Feb-29 yearly renewals from drifting to Mar-1). All math in UTC
  // to stay stable regardless of the runtime timezone.
  const monthsToAdd = frequency === "yearly" ? 12 : 1;
  const targetMonth = m - 1 + monthsToAdd; // 0-based index of the target month
  const targetYear = y + Math.floor(targetMonth / 12);
  const normMonth = targetMonth % 12;
  const lastDay = new Date(Date.UTC(targetYear, normMonth + 1, 0)).getUTCDate();
  // Advance from the anchor day when the template has one, so a month that
  // clamped (Feb 28 for a 31st template) doesn't permanently pull the template
  // back to the 28th. Without an anchor, advance from the current due day -
  // the behaviour every existing template already has.
  const day = Math.min(anchorDay ?? d, lastDay);
  return new Date(Date.UTC(targetYear, normMonth, day)).toISOString().slice(0, 10);
}
