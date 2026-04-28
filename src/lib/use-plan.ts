"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getPlan, getPlanStatus, type Plan, type PlanStatus } from "./plans";

export function usePlan(): { plan: Plan; status: PlanStatus; ready: boolean } {
  const [status, setStatus] = useState<PlanStatus>({ tier: "free", active: true });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setStatus(getPlanStatus(user?.user_metadata));
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setStatus(getPlanStatus(session?.user?.user_metadata));
    });
    return () => subscription.unsubscribe();
  }, []);

  return { plan: getPlan(status.tier), status, ready };
}
