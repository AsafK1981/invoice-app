import { describe, it, expect, vi } from "vitest";
import {
  SESSION_LOST_CODE,
  createGuardedFetch,
  guardDecision,
  isAnonAuthorization,
  isSessionLost,
  isTenantDataRequest,
  sessionLostResponse,
} from "@/lib/session-guard";

const ANON = "anon-key-abc123";
const REST = "https://ddrlnwwuzehatjfachgu.supabase.co/rest/v1/businesses?select=id";
const AUTH = "https://ddrlnwwuzehatjfachgu.supabase.co/auth/v1/token?grant_type=refresh_token";

describe("isTenantDataRequest", () => {
  it("matches PostgREST and nothing else", () => {
    expect(isTenantDataRequest(REST)).toBe(true);
    expect(isTenantDataRequest(AUTH)).toBe(false);
    expect(isTenantDataRequest("https://x.supabase.co/storage/v1/object/logo.png")).toBe(false);
    expect(isTenantDataRequest("https://x.supabase.co/realtime/v1/websocket")).toBe(false);
    expect(isTenantDataRequest("https://x.supabase.co/functions/v1/hello")).toBe(false);
  });
});

describe("isAnonAuthorization", () => {
  it("treats the anon key, and a missing header, as anonymous", () => {
    expect(isAnonAuthorization(`Bearer ${ANON}`, ANON)).toBe(true);
    expect(isAnonAuthorization(null, ANON)).toBe(true);
    expect(isAnonAuthorization("", ANON)).toBe(true);
  });

  it("treats a user access token as authenticated", () => {
    expect(isAnonAuthorization("Bearer eyJhbGciOiJIUzI1NiJ9.user.token", ANON)).toBe(false);
  });
});

describe("guardDecision", () => {
  it("blocks the exact shape that produced the RLS violation", () => {
    // A signed-in user whose data request is about to go out with the anon
    // key. Under RLS this read would answer 0 rows with no error, and the
    // insert that followed it would be rejected.
    expect(
      guardDecision({
        url: REST,
        authorization: `Bearer ${ANON}`,
        anonKey: ANON,
        hasStoredSession: true,
      }),
    ).toBe("recover");
  });

  it("leaves a genuinely signed-out visitor alone", () => {
    expect(
      guardDecision({
        url: REST,
        authorization: `Bearer ${ANON}`,
        anonKey: ANON,
        hasStoredSession: false,
      }),
    ).toBe("pass");
  });

  it("never touches auth requests, which is how the token is recovered", () => {
    expect(
      guardDecision({
        url: AUTH,
        authorization: `Bearer ${ANON}`,
        anonKey: ANON,
        hasStoredSession: true,
      }),
    ).toBe("pass");
  });

  it("passes an already-authenticated data request straight through", () => {
    expect(
      guardDecision({
        url: REST,
        authorization: "Bearer real.user.token",
        anonKey: ANON,
        hasStoredSession: true,
      }),
    ).toBe("pass");
  });
});

describe("sessionLostResponse", () => {
  it("is a 401 carrying a PostgREST-shaped error body", async () => {
    const res = sessionLostResponse();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe(SESSION_LOST_CODE);
    expect(body.message).toContain("ההתחברות שלך פגה");
    expect(isSessionLost(body)).toBe(true);
    expect(isSessionLost({ code: "23505" })).toBe(false);
    expect(isSessionLost(null)).toBe(false);
  });
});

describe("createGuardedFetch", () => {
  function setup(opts: { stored: boolean; recovered: string | null }) {
    const base = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("[]", { status: 200 }),
    );
    const recoverToken = vi.fn(async () => opts.recovered);
    const guarded = createGuardedFetch({
      anonKey: ANON,
      recoverToken,
      baseFetch: base as unknown as typeof fetch,
      storedSession: () => opts.stored,
    });
    return { base, recoverToken, guarded };
  }

  it("retries with the recovered token instead of sending the anon key", async () => {
    const { base, recoverToken, guarded } = setup({ stored: true, recovered: "fresh.token" });

    const res = await guarded(REST, { headers: { Authorization: `Bearer ${ANON}` } });

    expect(res.status).toBe(200);
    expect(recoverToken).toHaveBeenCalledOnce();
    const sentHeaders = new Headers(base.mock.calls[0][1]?.headers);
    expect(sentHeaders.get("Authorization")).toBe("Bearer fresh.token");
  });

  it("refuses rather than letting the request go out unauthenticated", async () => {
    const { base, guarded } = setup({ stored: true, recovered: null });

    const res = await guarded(REST, { headers: { Authorization: `Bearer ${ANON}` } });

    expect(base).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe(SESSION_LOST_CODE);
  });

  it("does not interfere when nobody is signed in", async () => {
    const { base, recoverToken, guarded } = setup({ stored: false, recovered: null });

    await guarded(REST, { headers: { Authorization: `Bearer ${ANON}` } });

    expect(recoverToken).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledOnce();
  });

  it("does not intercept the auth endpoint it depends on", async () => {
    const { base, recoverToken, guarded } = setup({ stored: true, recovered: null });

    await guarded(AUTH, { headers: { Authorization: `Bearer ${ANON}` } });

    expect(recoverToken).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledOnce();
  });
});
