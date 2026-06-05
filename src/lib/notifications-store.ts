"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  mapNotificationRow,
  type Notification,
  type NotificationKind,
  type NotificationRow,
} from "./notifications";

const CHANGE_EVENT = "invoice-app:notifications-changed";

export function useNotifications(limit = 20) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [ready, setReady] = useState(false);

  const fetchList = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    const rows = (data || []) as NotificationRow[];
    setItems(rows.map(mapNotificationRow));

    const { count } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .is("read_at", null);
    setUnreadCount(count || 0);

    setReady(true);
  }, [limit]);

  useEffect(() => {
    fetchList();
    // Re-fetch on focus + on global change event. No realtime channel —
    // polling on focus is more than enough for this use case and avoids
    // the always-on WebSocket cost.
    const onChange = () => fetchList();
    const onFocus = () => fetchList();
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchList]);

  return { items, unreadCount, ready, refetch: fetchList };
}

export async function markRead(id: string): Promise<void> {
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export async function markAllRead(): Promise<void> {
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

interface CreateClientArgs {
  businessId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  documentId?: string;
}

/** Client-side notification create. Uses RLS — user can only write their
 *  own notifications for their own business. Used by the bank-import
 *  matcher and other in-browser producers. */
export async function createNotificationClient(args: CreateClientArgs): Promise<void> {
  try {
    await supabase.from("notifications").insert({
      business_id: args.businessId,
      user_id: args.userId,
      kind: args.kind,
      title: args.title,
      body: args.body || null,
      href: args.href || null,
      document_id: args.documentId || null,
    });
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (err) {
    console.warn("[notifications] client write failed:", err);
  }
}
