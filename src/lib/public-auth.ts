"use client";

import { useSyncExternalStore } from "react";
import { createPublicAuthStore, schedulePublicAuth, SIGNED_OUT_SNAPSHOT } from "./public-auth-store";

const store = createPublicAuthStore(
  async () => {
    const { supabase } = await import("./supabase");
    // Startup emits SIGNED_IN. Let it finish before subscribing so it does
    // not invalidate and repeat our first verified user read.
    await supabase.auth.initialize();
    return supabase.auth;
  },
  schedulePublicAuth,
);
const getServerSnapshot = () => SIGNED_OUT_SNAPSHOT;

/** Public presentation only; protected routes continue to use useRequireAuth. */
export function useOptionalUser() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}
