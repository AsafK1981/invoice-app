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
  nextDue: string;
  active: boolean;
  createdAt: string;
}

const CHANGE_EVENT = "invoice-app:recurring-changed";

export async function getTemplates(): Promise<RecurringTemplate[]> {
  const { data: { user } } = await supabase.auth.getUser();
  return (user?.user_metadata?.recurring_templates as RecurringTemplate[]) || [];
}

export async function saveTemplate(template: RecurringTemplate) {
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
}

export async function deleteTemplate(id: string) {
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

export function calculateNextDue(currentDue: string, frequency: "monthly" | "weekly"): string {
  const [y, m, d] = currentDue.split("-").map(Number);
  if (frequency === "weekly") {
    return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  }
  // Monthly: advance one calendar month, clamping the day to the target
  // month's last day so the 29th–31st don't overflow into the month after
  // (plain setMonth turns Jan 31 + 1 month into Mar 3, silently skipping
  // months for end-of-month templates). All math in UTC to stay stable
  // regardless of the runtime timezone.
  const targetMonth = m; // 0-based index of next month = (m-1) + 1
  const targetYear = y + Math.floor(targetMonth / 12);
  const normMonth = targetMonth % 12;
  const lastDay = new Date(Date.UTC(targetYear, normMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(targetYear, normMonth, day)).toISOString().slice(0, 10);
}
