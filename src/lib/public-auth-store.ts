import type { User } from "@supabase/supabase-js";

export type PublicAuthSnapshot = { user: User | null; checked: boolean };
export const SIGNED_OUT_SNAPSHOT: PublicAuthSnapshot = { user: null, checked: false };
type AuthReader = {
  getUser: () => Promise<{ data: { user: User | null }; error?: unknown }>;
  onAuthStateChange: (callback: (event: string) => void) => { data: { subscription: { unsubscribe: () => void } } };
};

/** One verified reader for every public header, footer and CTA. */
export function createPublicAuthStore(loadAuth: () => Promise<AuthReader>, schedule: (start: () => void) => () => void) {
  let snapshot = SIGNED_OUT_SNAPSHOT;
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  const publish = (user: User | null, checked = true) => {
    snapshot = { user, checked };
    listeners.forEach(listener => listener());
  };
  function start() {
    let active = true;
    let revision = 0;
    let reading = false;
    let queued = false;
    let unsubscribe: (() => void) | undefined;
    const cancel = schedule(() => {
      void loadAuth().then(auth => {
        if (!active) return;
        const verify = async () => {
          if (!active) return;
          if (reading) { queued = true; return; }
          reading = true;
          const version = revision;
          try {
            const result = await auth.getUser();
            if (active && version === revision) publish(result.error ? null : result.data.user);
          } catch {
            if (active && version === revision) publish(null);
          } finally {
            reading = false;
            if (active && queued) { queued = false; void verify(); }
          }
        };
        const { data: { subscription } } = auth.onAuthStateChange(event => {
          // The initial explicit server check already covers this local hint.
          if (!active || event === "INITIAL_SESSION") return;
          revision++;
          if (event === "SIGNED_OUT") {
            queued = false;
            publish(null);
          } else {
            // Leave Supabase's synchronous auth callback before calling getUser.
            const eventRevision = revision;
            queueMicrotask(() => { if (active && eventRevision === revision) void verify(); });
          }
        });
        unsubscribe = () => subscription.unsubscribe();
        void verify();
      }).catch(() => { if (active) publish(null); });
    });
    return () => { active = false; cancel(); unsubscribe?.(); };
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) stop = start();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { stop?.(); stop = undefined; snapshot = SIGNED_OUT_SNAPSHOT; }
      };
    },
  };
}

/** The storage value is only a scheduling hint, never an authenticated user. */
export function schedulePublicAuth(start: () => void): () => void {
  let sessionKey: string;
  try {
    sessionKey = 'sb-' + new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0] + '-auth-token';
    if (window.localStorage.getItem(sessionKey)) { start(); return () => {}; }
  } catch {
    start();
    return () => {};
  }
  let started = false;
  let idleId: number | undefined;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (idleId !== undefined) window.cancelIdleCallback(idleId);
    if (timerId !== undefined) clearTimeout(timerId);
    window.removeEventListener("pointerdown", run);
    window.removeEventListener("keydown", run);
    window.removeEventListener("touchstart", run);
    window.removeEventListener("storage", onStorage);
  };
  const run = () => { if (!started) { started = true; clear(); start(); } };
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === sessionKey) run(); };
  window.addEventListener("pointerdown", run, { passive: true });
  window.addEventListener("keydown", run);
  window.addEventListener("touchstart", run, { passive: true });
  window.addEventListener("storage", onStorage);
  if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(run, { timeout: 2500 });
  else timerId = setTimeout(run, 2500);
  return () => { started = true; clear(); };
}
