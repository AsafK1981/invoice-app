"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { createActivityPager, INITIAL_ACTIVITY_STATE } from "./admin-activity-pager";

export function useAdminActivityPager() {
  const [state, setState] = useState(INITIAL_ACTIVITY_STATE);
  const pager = useMemo(() => createActivityPager(async (cursor, signal) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("No session");
    const response = await fetch("/api/admin/activity?limit=60" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), {
      cache: "no-store", signal, headers: { Authorization: "Bearer " + session.access_token },
    });
    const page = await response.json();
    if (!response.ok || !page.ok || !Array.isArray(page.events)) throw new Error("Activity unavailable");
    return { events: page.events, nextCursor: page.nextCursor ?? null };
  }, setState), []);
  useEffect(() => () => pager.dispose(), [pager]);
  return { state, pager };
}
