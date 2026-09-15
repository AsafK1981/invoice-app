import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The Tax Authority connect/callback pair against an in-memory Supabase and a
// fake gov.il token endpoint. Proves: the callback only stores credentials
// when the browser finishing the consent is the browser that started it (the
// nonce cookie set by connect derives the state), that a state works once and
// expires, that a failed credentials write never reports "connected", that the
// redirect only ever carries a short code, and that the cookie is cleared on
// every outcome.

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.TAX_AUTHORITY_CLIENT_ID = "client";
  process.env.TAX_AUTHORITY_CLIENT_SECRET = "secret";
  process.env.TAX_AUTHORITY_SOFTWARE_NUMBER = "123";
  process.env.NEXT_PUBLIC_SITE_ORIGIN = "https://friendlyinvoice.co.il"; // domain-literal-ok: test fixture
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.TAX_AUTHORITY_PROXY_BASE;
  return {
    tables: {} as Record<string, Row[]>,
    user: { id: "user-1" } as { id: string } | null,
    tokenCalls: 0,
    tokenFails: false,
    upsertError: null as { message: string } | null,
    upsertThrows: false,
  };
});

vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1" }));
vi.mock("@/lib/security-events", () => ({ emitSecurityEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/axiom-logger", () => ({ logToAxiom: vi.fn(async () => {}) }));
vi.mock("@/lib/crypto", () => ({ encryptColumn: (v: string) => `enc:${v}` }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => (h.user ? { data: { user: h.user }, error: null } : { data: { user: null }, error: { message: "no" } }),
    },
    from(table: string) {
      const rows = () => (h.tables[table] ??= []);
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "delete" = "select";
      const matching = () => rows().filter((r) => filters.every((f) => f(r)));
      const q = {
        select() { return q; },
        order() { return q; },
        delete() { op = "delete"; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        async insert(row: Row) {
          rows().push({ ...row, expires_at: new Date(Date.now() + 600_000).toISOString() });
          return { error: null };
        },
        async upsert(row: Row) {
          if (h.upsertThrows) throw new Error("socket hang up");
          if (h.upsertError) return { error: h.upsertError };
          const list = rows();
          const i = list.findIndex((r) => r.business_id === row.business_id);
          if (i >= 0) list[i] = row; else list.push(row);
          return { error: null };
        },
        async maybeSingle() {
          const found = matching();
          if (op === "delete") h.tables[table] = rows().filter((r) => !found.includes(r));
          return { data: found[0] ?? null, error: null };
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          resolve({ data: matching(), error: null });
        },
      };
      return q;
    },
  }),
}));

import { POST as connect } from "@/app/api/tax-authority/connect/route";
import { GET as callback } from "@/app/api/tax-authority/callback/route";
import { TAX_AUTHORITY_OAUTH_NONCE_COOKIE, taxAuthorityStateFromNonce } from "@/lib/tax-authority-oauth";
import { newOAuthNonce } from "@/lib/oauth-browser-binding";
import {
  TAX_AUTHORITY_CONNECT_ERROR_CODES,
  taxAuthorityConnectErrorMessage,
} from "@/lib/tax-authority-connect-errors";

const HOST = "friendlyinvoice.co.il"; // domain-literal-ok: test fixture
const ORIGIN = `https://${HOST}`;

async function startConnect(): Promise<{ state: string; nonce: string; setCookie: string }> {
  const res = await connect(
    new NextRequest(`${ORIGIN}/api/tax-authority/connect`, {
      method: "POST",
      headers: { authorization: "Bearer t", host: HOST },
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; url: string };
  const authorize = new URL(body.url);
  expect(authorize.searchParams.get("redirect_uri")).toBe(
    "https://mysuperfriendlyinvoiceapp.vercel.app/api/tax-authority/callback", // domain-literal-ok: registered redirect_uri
  );
  const state = authorize.searchParams.get("state") ?? "";
  const nonce = res.cookies.get(TAX_AUTHORITY_OAUTH_NONCE_COOKIE)?.value ?? "";
  expect(nonce).toBeTruthy();
  return { state, nonce, setCookie: res.headers.get("set-cookie") ?? "" };
}

function callbackReq(query: string, cookieNonce?: string, host = HOST): NextRequest {
  const headers: Record<string, string> = { host };
  if (cookieNonce !== undefined) headers.cookie = `${TAX_AUTHORITY_OAUTH_NONCE_COOKIE}=${cookieNonce}`;
  return new NextRequest(`https://${host}/api/tax-authority/callback?${query}`, { headers });
}

const q = (state: string) => `code=the-code&state=${encodeURIComponent(state)}`;
const creds = () => h.tables.tax_authority_credentials ?? [];
const states = () => h.tables.tax_authority_oauth_states ?? [];

function expectCookieCleared(res: Response) {
  const sc = res.headers.get("set-cookie") ?? "";
  expect(sc).toContain(`${TAX_AUTHORITY_OAUTH_NONCE_COOKIE}=;`);
  expect(sc).toMatch(/Max-Age=0/i);
  expect(sc).toMatch(/Path=\/api\/tax-authority\/callback/i);
}

function expectErrorCode(res: Response, code: string) {
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("location") ?? "");
  expect(loc.origin).toBe(ORIGIN);
  expect(loc.pathname).toBe("/settings");
  expect(loc.searchParams.get("tax_authority")).toBe("error");
  expect(loc.searchParams.get("reason")).toBe(code);
  expect([...loc.searchParams.keys()].sort()).toEqual(["reason", "tax_authority"]);
  expect(TAX_AUTHORITY_CONNECT_ERROR_CODES as readonly string[]).toContain(code);
}

beforeEach(() => {
  h.tables = { businesses: [{ id: "biz-1", user_id: "user-1", business_type: "authorized", created_at: "2026-01-01" }] };
  h.user = { id: "user-1" };
  h.tokenCalls = 0;
  h.tokenFails = false;
  h.upsertError = null;
  h.upsertThrows = false;
  vi.useRealTimers();
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).includes("/longtimetoken/oauth2/token")) {
      h.tokenCalls++;
      if (h.tokenFails) return new Response("internal detail from gov: stack at Foo.bar", { status: 500 });
      return new Response(
        JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "Bearer", vat_number: "515555555" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

describe("POST /api/tax-authority/connect", () => {
  it("sets an HttpOnly, Secure, Lax nonce cookie scoped to the callback and stores a state derived from it", async () => {
    const { state, nonce, setCookie } = await startConnect();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\/api\/tax-authority\/callback/i);
    expect(setCookie).toMatch(/Max-Age=600/i);
    expect(state).toMatch(/^[0-9a-f]{48}$/);
    expect(state).toBe(taxAuthorityStateFromNonce(nonce));
    expect(state).not.toContain(nonce);
    expect(states().map((r) => r.state)).toEqual([state]);
    expect(states()[0]).toMatchObject({ business_id: "biz-1", user_id: "user-1" });
  });

  it("sets no cookie for an unauthenticated caller", async () => {
    h.user = null;
    const res = await connect(
      new NextRequest(`${ORIGIN}/api/tax-authority/connect`, { method: "POST", headers: { authorization: "Bearer t" } }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET /api/tax-authority/callback", () => {
  it("happy path: matching cookie exchanges, stores encrypted credentials, consumes the state, reports connected", async () => {
    const { state, nonce } = await startConnect();
    const res = await callback(callbackReq(q(state), nonce));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/settings?tax_authority=connected`);
    expect(h.tokenCalls).toBe(1);
    expect(creds()).toHaveLength(1);
    expect(creds()[0]).toMatchObject({ business_id: "biz-1", access_token: "enc:at", refresh_token: "enc:rt", vat_number: "515555555" });
    expect(states()).toEqual([]);
    expectCookieCleared(res);
  });

  it("rejects a missing cookie before any state lookup or token exchange", async () => {
    const { state } = await startConnect();
    const res = await callback(callbackReq(q(state)));
    expectErrorCode(res, "browser_mismatch");
    expect(h.tokenCalls).toBe(0);
    expect(creds()).toEqual([]);
    expect(states()).toHaveLength(1); // untouched
    expectCookieCleared(res);
  });

  it("rejects a cookie from a different attempt (another browser) before token exchange", async () => {
    const first = await startConnect();
    const res = await callback(callbackReq(q(first.state), newOAuthNonce()));
    expectErrorCode(res, "browser_mismatch");
    expect(h.tokenCalls).toBe(0);
    expect(creds()).toEqual([]);
    expectCookieCleared(res);
  });

  it("rejects a used state: the second callback with the same cookie finds nothing", async () => {
    const { state, nonce } = await startConnect();
    await callback(callbackReq(q(state), nonce));
    h.tokenCalls = 0;
    const res = await callback(callbackReq(q(state), nonce));
    expectErrorCode(res, "invalid_state");
    expect(h.tokenCalls).toBe(0);
    expectCookieCleared(res);
  });

  it("rejects a matching cookie whose state row was never issued", async () => {
    const nonce = newOAuthNonce();
    const res = await callback(callbackReq(q(taxAuthorityStateFromNonce(nonce)), nonce));
    expectErrorCode(res, "invalid_state");
    expect(h.tokenCalls).toBe(0);
  });

  it("rejects an expired state and removes the row", async () => {
    const { state, nonce } = await startConnect();
    states()[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await callback(callbackReq(q(state), nonce));
    expectErrorCode(res, "expired_state");
    expect(h.tokenCalls).toBe(0);
    expect(creds()).toEqual([]);
    expect(states()).toEqual([]);
    expectCookieCleared(res);
  });

  it("rejects a state whose business no longer belongs to its user", async () => {
    const { state, nonce } = await startConnect();
    h.tables.businesses[0].user_id = "someone-else";
    const res = await callback(callbackReq(q(state), nonce));
    expectErrorCode(res, "invalid_state");
    expect(h.tokenCalls).toBe(0);
    expect(creds()).toEqual([]);
  });

  it("does not report connected when the credentials upsert returns an error", async () => {
    const { state, nonce } = await startConnect();
    h.upsertError = { message: "violates check constraint secret_detail" };
    const res = await callback(callbackReq(q(state), nonce));
    expectErrorCode(res, "save_failed");
    expect(res.headers.get("location")).not.toContain("connected");
    expect(res.headers.get("location")).not.toContain("secret_detail");
    expectCookieCleared(res);
  });

  it("does not report connected when the credentials upsert throws", async () => {
    const { state, nonce } = await startConnect();
    h.upsertThrows = true;
    const res = await callback(callbackReq(q(state), nonce));
    expectErrorCode(res, "save_failed");
  });

  it("puts only a code in the URL when the token exchange fails", async () => {
    const { state, nonce } = await startConnect();
    h.tokenFails = true;
    const res = await callback(callbackReq(q(state), nonce));
    expectErrorCode(res, "exchange_failed");
    const loc = decodeURIComponent(res.headers.get("location") ?? "");
    expect(loc).not.toMatch(/gov|stack|שגיאה/);
    expect(creds()).toEqual([]);
    expectCookieCleared(res);
  });

  it("maps provider errors to codes and never echoes the provider text", async () => {
    const denied = await callback(callbackReq("error=access_denied&error_description=hello%20world"));
    expectErrorCode(denied, "denied");
    expectCookieCleared(denied);
    const other = await callback(callbackReq(`error=${encodeURIComponent("<b>call 03-1234567</b>")}`));
    expectErrorCode(other, "provider_error");
    expect(other.headers.get("location")).not.toContain("1234567");
  });

  it("rejects missing params and malformed states with codes", async () => {
    expectErrorCode(await callback(callbackReq("state=abc")), "missing_params");
    expectErrorCode(await callback(callbackReq("code=x&state=not-hex", "n")), "invalid_state");
  });

  it("hops from the registered legacy host to the canonical host without consuming anything", async () => {
    const { state, nonce } = await startConnect();
    const legacy = "mysuperfriendlyinvoiceapp.vercel.app"; // domain-literal-ok: registered redirect host
    const res = await callback(callbackReq(q(state), undefined, legacy));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/api/tax-authority/callback?${q(state)}`);
    expect(states()).toHaveLength(1);
    expect(h.tokenCalls).toBe(0);
    // ...and on the canonical host, where the cookie lives, it completes.
    const done = await callback(callbackReq(q(state), nonce));
    expect(done.headers.get("location")).toBe(`${ORIGIN}/settings?tax_authority=connected`);
  });
});

describe("connect error messages", () => {
  it("has Hebrew text for every code and never shows an unknown reason verbatim", () => {
    for (const code of TAX_AUTHORITY_CONNECT_ERROR_CODES) {
      expect(taxAuthorityConnectErrorMessage(code)).toMatch(/[֐-׿]/);
    }
    expect(taxAuthorityConnectErrorMessage("<script>x</script>")).not.toContain("script");
    expect(taxAuthorityConnectErrorMessage(null)).toMatch(/[֐-׿]/);
  });
});
