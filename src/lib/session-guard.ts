/**
 * Stops a signed-in user's data request from going out unauthenticated.
 *
 * supabase-js resolves the bearer token per request, and its fallback when
 * there is no session is the ANON KEY, not an error:
 *
 *     const { data } = await this.auth.getSession()
 *     return data.session?.access_token ?? this.supabaseKey
 *
 * (SupabaseClient._getAccessToken, v2.103.3 - verified against the installed
 * bundle.) getSession() resolves to `session: null` on a whole family of
 * ordinary mobile events: storage holding no/invalid session, or an expired
 * access token whose refresh failed on a flaky connection (GoTrueClient
 * __loadSession). None of them throw.
 *
 * The result is the worst possible split under row-level security:
 *
 *   - READS fail OPEN   - PostgREST returns 200 with zero rows and NO error,
 *                         which is indistinguishable from "this user really
 *                         has no data".
 *   - WRITES fail CLOSED - "new row violates row-level security policy".
 *
 * Verified against production with the anon key: the SELECT came back
 * `data: null, error: null`, the INSERT came back with exactly the error
 * string from Sentry issue INVOICE-APP-J (2026-09-15, /onboarding, iOS).
 *
 * Code that trusts an empty read then acts on it - "this user has no
 * business, create one", "no rows, so send them to onboarding" - is not
 * making a mistake it could reasonably have avoided at the call site. The
 * request simply lied to it. So the invariant lives here, at the single
 * choke point every PostgREST request passes through, instead of in the
 * ~40 places that read tenant data.
 *
 * What the guard does NOT do: block anonymous requests in general. It only
 * engages when the browser HAS a stored session (so a real user is signed
 * in) and the outgoing request would nonetheless carry the anon key. A
 * genuinely signed-out visitor is passed straight through, exactly as
 * before.
 */

/** PostgREST-shaped error code the guard reports. */
export const SESSION_LOST_CODE = "SESSION_LOST";

export const SESSION_LOST_MESSAGE =
  "ההתחברות שלך פגה. רענן את הדף והתחבר מחדש.";

/**
 * Only tenant data goes through row-level security. Auth, storage, realtime
 * and edge functions must pass through untouched: /auth/v1 in particular is
 * how the guard recovers a token, and intercepting it would recurse into
 * itself and can deadlock against GoTrue's navigator.locks.
 */
export function isTenantDataRequest(url: string): boolean {
  return url.includes("/rest/v1/");
}

/**
 * True when the Authorization header carries the anon key rather than a
 * user's access token - including the case of no header at all, which
 * PostgREST also treats as the anon role.
 */
export function isAnonAuthorization(
  authorization: string | null | undefined,
  anonKey: string,
): boolean {
  if (!authorization) return true;
  return authorization.trim() === `Bearer ${anonKey}`;
}

/**
 * The whole decision, as a pure function, so it can be unit-tested without a
 * browser: "recover" means this request must not be sent as-is.
 */
export function guardDecision(input: {
  url: string;
  authorization: string | null | undefined;
  anonKey: string;
  hasStoredSession: boolean;
}): "pass" | "recover" {
  if (!isTenantDataRequest(input.url)) return "pass";
  // No stored session means the visitor really is signed out. Nothing is
  // being degraded, so nothing is blocked.
  if (!input.hasStoredSession) return "pass";
  return isAnonAuthorization(input.authorization, input.anonKey) ? "recover" : "pass";
}

/**
 * Whether this browser believes a user is signed in.
 *
 * Read straight from storage rather than through auth.getSession(), because
 * getSession() is the call that just failed - and because it takes GoTrue's
 * lock, which must not be taken from inside a fetch. supabase-js persists
 * under `sb-<project-ref>-auth-token`.
 */
export function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const value = window.localStorage.getItem(key);
      if (value && value !== "null" && value.length > 2) return true;
    }
  } catch {
    // Private mode / blocked storage. Treat as signed out and pass through:
    // a user who cannot persist a session was never going to be degraded
    // from one.
  }
  return false;
}

/**
 * The refusal, shaped as a PostgREST error response.
 *
 * Deliberately a Response and not a thrown error. postgrest-js converts a
 * rejected fetch into an error result anyway, but on GET it first burns
 * DEFAULT_MAX_RETRIES with backoff - and a thrown error is exactly the
 * unhandled-rejection shape this whole change exists to remove. A 401 is
 * not in postgrest's retry list, so it comes back immediately, as an
 * ordinary `error` object that every call site can already handle.
 */
export function sessionLostResponse(): Response {
  return new Response(
    JSON.stringify({
      message: SESSION_LOST_MESSAGE,
      code: SESSION_LOST_CODE,
      details:
        "Blocked a request that would have been sent with the anon key while a session was present.",
      hint: "",
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

/** True for the error shape produced by sessionLostResponse(). */
export function isSessionLost(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === SESSION_LOST_CODE;
}

type TokenRecovery = () => Promise<string | null>;

/**
 * Wraps fetch with the guard.
 *
 * `recoverToken` is injected rather than imported so this module never
 * depends on the Supabase client it is being installed into (which would be
 * a cycle), and so the wrapper is testable with a fake.
 */
export function createGuardedFetch(options: {
  anonKey: string;
  recoverToken: TokenRecovery;
  baseFetch?: typeof fetch;
  storedSession?: () => boolean;
}): typeof fetch {
  const base = options.baseFetch ?? fetch;
  const stored = options.storedSession ?? hasStoredSession;

  return async function guardedFetch(input, init) {
    // postgrest-js always calls fetch(urlString, init); the other shapes are
    // handled defensively so the guard can never be the thing that breaks a
    // request it does not understand.
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );

    const decision = guardDecision({
      url,
      authorization: headers.get("Authorization"),
      anonKey: options.anonKey,
      hasStoredSession: stored(),
    });

    if (decision === "pass") return base(input, init);

    const token = await options.recoverToken();
    if (!token) return sessionLostResponse();

    headers.set("Authorization", `Bearer ${token}`);
    if (input instanceof Request) {
      return base(new Request(input, { headers }), init);
    }
    return base(input, { ...init, headers });
  };
}
