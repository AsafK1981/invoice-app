"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";

export type AuditAction =
  | "document.created"
  | "document.status_changed"
  | "document.number_changed"
  | "document.deleted"
  | "client.deleted"
  | "product.deleted"
  | "expense.deleted"
  | "data.cleared"
  | "recurring.deleted"
  | "attachment.deleted";

export type AuditTargetType = "document" | "client" | "product" | "expense" | "recurring" | "attachment" | "all";

export interface AuditEntry {
  id: string;
  businessId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string;
  targetLabel?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

const CHANGE_EVENT = "invoice-app:audit-log-changed";

function mapRow(row: Record<string, unknown>): AuditEntry {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    action: row.action as AuditAction,
    targetType: row.target_type as AuditTargetType,
    targetId: (row.target_id as string) || undefined,
    targetLabel: (row.target_label as string) || undefined,
    payload: (row.payload as Record<string, unknown>) || undefined,
    createdAt: row.created_at as string,
  };
}

/**
 * Fire-and-forget audit log write. Failures are swallowed (with a console
 * warning); the audit log is not critical to the operation that triggered
 * it, so we never block user actions on it.
 */
export async function logAudit(args: {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string;
  targetLabel?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const bid = getBusinessId();
  if (!bid) return;
  try {
    const { error } = await supabase.from("audit_log").insert({
      business_id: bid,
      action: args.action,
      target_type: args.targetType,
      target_id: args.targetId || null,
      target_label: args.targetLabel || null,
      payload: args.payload || null,
    });
    if (error) console.warn("[audit] insert failed:", error.message);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  } catch (err) {
    console.warn("[audit] threw:", err);
  }
}

export function useAuditLog(limit = 100) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [ready, setReady] = useState(false);

  const fetchList = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    const { data } = await supabase
      .from("audit_log")
      .select("*")
      .eq("business_id", bid)
      .order("created_at", { ascending: false })
      .limit(limit);
    setEntries((data || []).map(mapRow));
    setReady(true);
  }, [limit]);

  useEffect(() => {
    onBusinessReady(() => fetchList());
    const handler = () => fetchList();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [fetchList]);

  return { entries, ready, refetch: fetchList };
}

const ACTION_LABELS: Record<AuditAction, string> = {
  "document.created": "מסמך נוצר",
  "document.status_changed": "סטטוס מסמך עודכן",
  "document.number_changed": "מספר מסמך שונה",
  "document.deleted": "מסמך נמחק",
  "client.deleted": "לקוח נמחק",
  "product.deleted": "מוצר נמחק",
  "expense.deleted": "הוצאה נמחקה",
  "data.cleared": "כל הנתונים נמחקו",
  "recurring.deleted": "תבנית חוזרת נמחקה",
  "attachment.deleted": "קובץ מצורף נמחק",
};

export function formatAuditAction(action: AuditAction): string {
  return ACTION_LABELS[action] || action;
}
