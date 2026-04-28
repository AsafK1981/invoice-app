"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
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
  const date = new Date(currentDue);
  if (frequency === "monthly") {
    date.setMonth(date.getMonth() + 1);
  } else {
    date.setDate(date.getDate() + 7);
  }
  return date.toISOString().slice(0, 10);
}
