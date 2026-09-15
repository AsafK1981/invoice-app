import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The Gmail connect/callback pair against a fake Supabase and a fake Google
// token endpoint: proves the callback only attaches a mailbox when the browser
// that finishes the consent is the browser that started it (nonce cookie set
// by connect, its hash inside the signed state), and that the cookie is
// cleared on every outcome.

const h = vi.hoisted(() => {
  process.env.COLUMN_ENCRYPTION_KEY = "test-column-key-0123456789abcdef0123456789abcdef";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  return {
    tokenCalls: 0,
    saved: [] as Array<{ business_id: string; email: string }>,
  };
});

vi.mock("@/lib/rate-limit", () => ({
  checkRate: () => ({ ok: true }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/email-inbox-server", () => ({
  resolveInboxCaller: async () => ({
    ok: true,
    admin: {},
    business: { id: "biz-1" },
    userId: "user-1",
  }),
}));

vi.mock("@/lib/crypto", () => ({
  encryptColumn: (v: string) => `enc:${v}`,
  decryptColumn: (v: string) => v.replace(/^enc:/, ""),
  decryptColumnOrNull: (v: string | null) => (v ? v.replace(/^enc:/, "") : null),
}));

vi.mock("@/lib/cron", () => ({
  cronAdminClient: () => ({
    from(table: string) {
      const q = {
        select() { return q; },
        eq() { return q; },
        async maybeSingle() {
          if (table === "businesses") return { data: { id: "biz-1" }, error: null };
          return { data: null, error: null };
        },
        async upsert(row: { business_id: string; email: string }) {
          h.saved.push({ business_id: row.business_id, email: row.email });
          return { error: null };
        },
      };
      return q;
    },
  }),
}));

import { POST as connect } from "@/app/api/gmail/connect/route";
import { GET as callback } from "@/app/api/gmail/callback/route";
import { GMAIL_OAUTH_NONCE_COOKIE, OAUTH_STATE_TTL_MS } from "@/lib/gmail-connect";

const ORIGIN = "http://localhost:3000";

function idToken(email: string): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "none" })}.${b({ email })}.sig`;
}

async function startConnect(): Promise<{ state: string; nonce: string; setCookie: string }> {
  const res = await connect(
    new NextRequest(`${ORIGIN}/api/gmail/connect`, {
      method: "POST",
      headers: { authorization: "Bearer t", host: "localhost:3000" },
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; url: string };
  const state = new URL(body.url).searchParams.get("state") ?? "";
  const cookie = res.cookies.get(GMAIL_OAUTH_NONCE_COOKIE);
  expect(cookie?.value).toBeTruthy();
  return { state, nonce: cookie?.value ?? "", setCookie: res.headers.get("set-cookie") ?? "" };
}

function callbackReq(state: string, cookieNonce?: string): NextRequest {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (cookieNonce !== undefined) headers.cookie = `${GMAIL_OAUTH_NONCE_COOKIE}=${cookieNonce}`;
  return new NextRequest(`${ORIGIN}/api/gmail/callback?code=the-code&state=${encodeURIComponent(state)}`, { headers });
}

function expectCookieCleared(res: Response) {
  const sc = res.headers.get("set-cookie") ?? "";
  expect(sc).toContain(`${GMAIL_OAUTH_NONCE_COOKIE}=;`);
  expect(sc).toMatch(/Max-Age=0/i);
  expect(sc).toMatch(/Path=\/api\/gmail\/callback/i);
}

beforeEach(() => {
  h.tokenCalls = 0;
  h.saved = [];
  vi.useRealTimers();
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      h.tokenCalls++;
      return new Response(
        JSON.stringify({
          access_token: "at",
          refresh_token: "rt",
          scope: "https://www.googleapis.com/auth/gmail.readonly openid email",
          id_token: idToken("owner@example.com"),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

describe("POST /api/gmail/connect", () => {
  it("sets an HttpOnly, Secure, Lax nonce cookie scoped to the callback, and keeps the raw nonce out of the URL", async () => {
    const { state, nonce, setCookie } = await startConnect();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\/api\/gmail\/callback/i);
    expect(setCookie).toMatch(/Max-Age=600/i);
    expect(state).not.toContain(nonce);
    expect(Buffer.from(state.split(".")[0], "base64url").toString("utf8")).not.toContain(nonce);
  });
});

describe("GET /api/gmail/callback", () => {
  it("proceeds and saves the mailbox when the browser brings the matching cookie", async () => {
    const { state, nonce } = await startConnect();
    const res = await callback(callbackReq(state, nonce));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("gmail=connected");
    expect(h.tokenCalls).toBe(1);
    expect(h.saved).toEqual([{ business_id: "biz-1", email: "owner@example.com" }]);
    expectCookieCleared(res);
  });

  it("rejects before the code exchange when the cookie is missing", async () => {
    const { state } = await startConnect();
    const res = await callback(callbackReq(state));
    expect(res.headers.get("location")).toContain("gmail=browser");
    expect(h.tokenCalls).toBe(0);
    expect(h.saved).toEqual([]);
    expectCookieCleared(res);
  });

  it("rejects a cookie that belongs to a different connect attempt", async () => {
    const first = await startConnect();
    const second = await startConnect();
    const res = await callback(callbackReq(first.state, second.nonce));
    expect(res.headers.get("location")).toContain("gmail=browser");
    expect(h.tokenCalls).toBe(0);
    expect(h.saved).toEqual([]);
    expectCookieCleared(res);
  });

  it("rejects an expired state even with the matching cookie", async () => {
    const { state, nonce } = await startConnect();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + OAUTH_STATE_TTL_MS + 1000);
    const res = await callback(callbackReq(state, nonce));
    vi.useRealTimers();
    expect(res.headers.get("location")).toContain("gmail=error");
    expect(h.tokenCalls).toBe(0);
    expect(h.saved).toEqual([]);
    expectCookieCleared(res);
  });

  it("clears the cookie when Google reports an error", async () => {
    const res = await callback(
      new NextRequest(`${ORIGIN}/api/gmail/callback?error=access_denied`, { headers: { host: "localhost:3000" } }),
    );
    expect(res.headers.get("location")).toContain("gmail=error");
    expectCookieCleared(res);
  });
});
