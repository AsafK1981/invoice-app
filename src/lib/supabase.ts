import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createGuardedFetch } from "./session-guard";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * How long the guard will wait for a token before refusing the request.
 * Short on purpose: the point is to fail fast and visibly, not to hang the
 * UI behind a refresh that is not coming back.
 */
const RECOVER_TIMEOUT_MS = 4000;

/**
 * Set after createClient below. The guard needs the client to refresh a
 * session, and the client needs the guard to fetch - so the reference is
 * resolved lazily instead of at module evaluation.
 */
let client: SupabaseClient | null = null;

/**
 * One refresh at a time, shared by every request that arrives while it is in
 * flight. A page load fires several queries at once, and without this each
 * one would independently hammer /auth/v1/token with the same refresh token
 * - which is how a single expired token turns into a burst of failures.
 */
let recovering: Promise<string | null> | null = null;

async function attemptRecovery(): Promise<string | null> {
  if (!client) return null;
  try {
    // getSession() first: by the time the guard runs, a refresh started by
    // another request may already have finished, in which case there is
    // nothing to do.
    const { data } = await client.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
    const { data: refreshed } = await client.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function recoverToken(): Promise<string | null> {
  if (!recovering) {
    const inFlight = Promise.race([
      attemptRecovery(),
      // Both auth calls take GoTrue's navigator.locks lock. A caller that
      // reaches the guard from inside an onAuthStateChange callback could
      // therefore be waiting on a lock its own stack holds; the timeout
      // means that degrades into a clean refusal instead of a hung request.
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RECOVER_TIMEOUT_MS)),
    ]);
    recovering = inFlight;
    inFlight.finally(() => {
      if (recovering === inFlight) recovering = null;
    });
  }
  return recovering;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: createGuardedFetch({ anonKey: supabaseAnonKey, recoverToken }),
  },
});

client = supabase;
