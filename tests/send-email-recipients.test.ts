import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("resend", () => ({ Resend: class { emails = { send: vi.fn() }; } }));
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-recipients", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      }),
    },
    // No document: a request that passes validation and the rate limit ends
    // in a 404, which is enough to tell it apart from 400 / 429.
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
      return q;
    },
  }),
}));

import { parseEmailRecipients, MAX_EMAIL_RECIPIENTS } from "@/lib/email-recipients";
import { checkRate } from "@/lib/rate-limit";
import { POST } from "@/app/api/send-email/route";

const DOC = "11111111-2222-4333-8444-555555555555";
let ipCounter = 0;

function request(to: unknown) {
  ipCounter++;
  return new Request("https://friendlyinvoice.co.il/api/send-email", {
    method: "POST",
    headers: {
      authorization: "Bearer token",
      "content-type": "application/json",
      "x-real-ip": `10.0.0.${ipCounter}`,
    },
    body: JSON.stringify({ to, documentId: DOC }),
  });
}

function list(n: number) {
  return Array.from({ length: n }, (_, i) => `client${i}@example.test`).join(", ");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parseEmailRecipients", () => {
  it("accepts up to the cap, trimming and collapsing duplicates", () => {
    expect(parseEmailRecipients(" a@example.test; A@example.test,\nb@example.test ")).toEqual({
      ok: true,
      recipients: ["a@example.test", "b@example.test"],
    });
    expect(parseEmailRecipients(list(MAX_EMAIL_RECIPIENTS)).ok).toBe(true);
  });

  it("refuses more than 10 recipients with a Hebrew message", () => {
    const r = parseEmailRecipients(list(11));
    expect(r).toEqual({ ok: false, error: "אפשר לשלוח מסמך לעד 10 נמענים בכל פעם." });
  });

  it("refuses an invalid address, a header-breaking one, a missing or non-string field", () => {
    expect(parseEmailRecipients("good@example.test, not-an-email")).toEqual({
      ok: false,
      error: "כתובת מייל לא תקינה: not-an-email",
    });
    expect(parseEmailRecipients("a@example.test\r\nBcc: x@evil.test").ok).toBe(false);
    expect(parseEmailRecipients("<a@example.test>").ok).toBe(false);
    expect(parseEmailRecipients("")).toEqual({ ok: false, error: "חסר נמען" });
    expect(parseEmailRecipients(["a@example.test"])).toEqual({ ok: false, error: "חסר נמען" });
    expect(parseEmailRecipients(" , ;")).toEqual({ ok: false, error: "לא נמצאו נמענים" });
  });
});

describe("checkRate cost", () => {
  it("counts units, refuses a call that would overflow, and consumes nothing when refused", () => {
    const key = `test:${Math.random()}`;
    expect(checkRate({ key, max: 10, windowMs: 60_000, cost: 6 })).toMatchObject({ ok: true, remaining: 4 });
    expect(checkRate({ key, max: 10, windowMs: 60_000, cost: 5 })).toMatchObject({ ok: false });
    expect(checkRate({ key, max: 10, windowMs: 60_000, cost: 4 })).toMatchObject({ ok: true, remaining: 0 });
    expect(checkRate({ key: `${key}:big`, max: 10, windowMs: 60_000, cost: 11 }).ok).toBe(false);
  });
});

describe("POST /api/send-email recipients", () => {
  it("returns 400 in Hebrew for 11 recipients and for an invalid address", async () => {
    const tooMany = await POST(request(list(11)) as never);
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toContain("עד 10 נמענים");

    const invalid = await POST(request("nope") as never);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("כתובת מייל לא תקינה");
  });

  it("counts recipients, not requests, toward the 60-per-hour user limit", async () => {
    // Six requests of ten recipients use the whole hourly budget...
    for (let i = 0; i < 6; i++) {
      const res = await POST(request(list(10)) as never);
      expect(res.status).toBe(404);
    }
    // ...so even a single extra recipient is refused.
    const over = await POST(request("one@example.test") as never);
    expect(over.status).toBe(429);
    expect((await over.json()).error).toContain("60 נמענים בשעה");
  });
});
