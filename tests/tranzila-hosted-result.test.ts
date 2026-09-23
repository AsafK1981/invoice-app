import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseHostedPaymentResult } from "@/lib/tranzila";

/**
 * parseHostedPaymentResult() reads the payload DirectNG sends back after a
 * hosted-page capture, to success_url_address (browser) and, in parallel, to
 * notify_url_address (server-to-server). Both carry the same full payload -
 * confirmed with Tranzila support 2026-09-23.
 *
 * The sample below is the doc page's own "Response Structure" example, field
 * for field:
 * https://docs.tranzila.com/docs/payments-and-billing/iframe-integration-directng
 * Anything this parser gets wrong is a token silently dropped on the floor,
 * which is why "did a token arrive" is asserted from several angles.
 */

const DOC_SAMPLE = {
  supplier: "friendinv",
  sum: "100",
  currency: "1",
  Response: "000",
  company: "Test Company",
  contact: "John Doe",
  email: "test@test.com",
  phone: "0500000000",
  address: "123 Main St",
  city: "Tel Aviv",
  zip: "123456",
  pdesc: "Product description",
  lang: "il",
  transaction_id: "41044",
  index: "41044",
  ccno: "4207",
  transaction_source: "1",
  Responsecv: "0",
  Responseid: "1",
  cardtype: "1",
  cardissuer: "1",
  cardacquirer: "2",
  TranzilaTK: "O5d55d2922ca4021382",
  txn_type: "debit",
  tranmode: "A",
  club_number: "088",
};

function omit(obj: Record<string, string>, key: string): Record<string, string> {
  const out = { ...obj };
  delete out[key];
  return out;
}

function form(overrides: Record<string, string> = {}, base = DOC_SAMPLE) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== "") sp.set(k, v);
  }
  return sp;
}

describe("parseHostedPaymentResult: the documented payload", () => {
  it("reads every field the doc's own sample carries", () => {
    const r = parseHostedPaymentResult(form());

    expect(r.approved).toBe(true);
    expect(r.responseCode).toBe("000");
    expect(r.token).toBe("O5d55d2922ca4021382");
    expect(r.tokenMalformed).toBe(false);
    expect(r.sum).toBe(100);
    expect(r.currency).toBe("1");
    expect(r.index).toBe("41044");
    expect(r.transactionId).toBe("41044");
    expect(r.last4).toBe("4207");
    expect(r.cardType).toBe("1");
    expect(r.terminal).toBe("friendinv");
    expect(r.tranmode).toBe("A");
  });

  it("accepts the same payload as a plain object, FormData or URLSearchParams", () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(DOC_SAMPLE)) fd.set(k, v);

    const fromObject = parseHostedPaymentResult(DOC_SAMPLE);
    const fromForm = parseHostedPaymentResult(fd);
    const fromParams = parseHostedPaymentResult(form());

    for (const r of [fromObject, fromForm, fromParams]) {
      expect(r.token).toBe("O5d55d2922ca4021382");
      expect(r.approved).toBe(true);
    }
  });

  it("is case-insensitive, so an upstream casing change cannot drop the token", () => {
    const r = parseHostedPaymentResult({
      tranzilatk: "O5d55d2922ca4021382",
      RESPONSE: "000",
      SUM: "100",
    });
    expect(r.token).toBe("O5d55d2922ca4021382");
    expect(r.approved).toBe(true);
    expect(r.sum).toBe(100);
  });

  it("returns a token for tranmode=K, the token-only capture", () => {
    // "K - create token without checking card", per the iframe parameter
    // table. The parser must not gate on tranmode.
    const r = parseHostedPaymentResult(form({ tranmode: "K" }));
    expect(r.token).toBe("O5d55d2922ca4021382");
    expect(r.tranmode).toBe("K");
  });
});

describe("parseHostedPaymentResult: no token, or a broken one", () => {
  it("reports null when TranzilaTK is absent (tokenization off)", () => {
    const rest = omit(DOC_SAMPLE, "TranzilaTK");
    const r = parseHostedPaymentResult(form({}, rest as typeof DOC_SAMPLE));
    expect(r.token).toBeNull();
    expect(r.tokenMalformed).toBe(false);
    // A real approved charge with no token is still an approved charge.
    expect(r.approved).toBe(true);
  });

  it("flags a TranzilaTK that is present but not token-shaped", () => {
    const r = parseHostedPaymentResult(form({ TranzilaTK: "err: token failed" }));
    expect(r.token).toBeNull();
    expect(r.tokenMalformed).toBe(true);
  });

  it("treats an empty TranzilaTK as absent, not malformed", () => {
    const r = parseHostedPaymentResult({ ...DOC_SAMPLE, TranzilaTK: "" });
    expect(r.token).toBeNull();
    expect(r.tokenMalformed).toBe(false);
  });

  it("reports a failure response code without pretending it succeeded", () => {
    // 004 = refusal, per Tranzila's response-code table.
    const r = parseHostedPaymentResult(form({ Response: "004", TranzilaTK: "" }));
    expect(r.approved).toBe(false);
    expect(r.responseCode).toBe("004");
    expect(r.token).toBeNull();
  });

  it("does not approve on a missing Response code", () => {
    const r = parseHostedPaymentResult(omit(DOC_SAMPLE, "Response"));
    expect(r.approved).toBe(false);
    expect(r.responseCode).toBeNull();
  });

  it("does not approve on a truthy-but-wrong code like '0' or '00'", () => {
    for (const code of ["0", "00", "0000", " 000"]) {
      expect(parseHostedPaymentResult({ Response: code }).approved).toBe(false);
    }
  });

  it("survives an empty payload without throwing", () => {
    const r = parseHostedPaymentResult(new URLSearchParams());
    expect(r.approved).toBe(false);
    expect(r.token).toBeNull();
    expect(r.sum).toBeNull();
    expect(r.last4).toBeNull();
    expect(Object.keys(r.raw)).toHaveLength(0);
  });
});

describe("parseHostedPaymentResult: card data is reduced to last 4", () => {
  it("keeps only the trailing 4 digits if a terminal sends a masked PAN", () => {
    const r = parseHostedPaymentResult(form({ ccno: "458021xxxxxx4245" }));
    expect(r.last4).toBe("4245");
  });

  it("keeps only the trailing 4 digits if a terminal sends a full PAN", () => {
    const r = parseHostedPaymentResult(form({ ccno: "4580458045804580" }));
    expect(r.last4).toBe("4580");
    expect(r.last4!.length).toBe(4);
  });
});

describe("parseHostedPaymentResult: the undocumented expiry", () => {
  it("reads expmonth/expyear when a terminal sends them", () => {
    // NOT in the doc page's field list, but CONFIRMED present on a real
    // 2026-09-23 capture. Still read defensively: a token with no expiry is a
    // data gap the cron must skip, never a value to guess.
    const r = parseHostedPaymentResult(form({ expmonth: "7", expyear: "27" }));
    expect(r.expireMonth).toBe(7);
    expect(r.expireYear).toBe(2027);
  });

  it("reports null expiry on the documented payload, which has none", () => {
    const r = parseHostedPaymentResult(form());
    expect(r.expireMonth).toBeNull();
    expect(r.expireYear).toBeNull();
  });

  it("rejects an out-of-range month rather than passing it to chargeToken", () => {
    expect(parseHostedPaymentResult(form({ expmonth: "13" })).expireMonth).toBeNull();
    expect(parseHostedPaymentResult(form({ expmonth: "0" })).expireMonth).toBeNull();
  });
});

describe("tranzila callback + notify routes", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Unique IP per call so the per-IP rate limiter never colours a result. */
  let ipSeq = 0;
  function post(body: URLSearchParams, url = "https://x.test/api/tranzila/notify") {
    return new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-real-ip": `10.0.0.${++ipSeq % 250}`,
      },
      body: body.toString(),
    });
  }

  /** What the route logged, joined. The summary lives here now, not in the
   * response body: telling an unauthenticated caller what we made of their
   * payload would turn these endpoints into oracles. */
  function loggedText(): string {
    const calls = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls;
    return calls.map((c: unknown[]) => c.map(String).join(" ")).join("|");
  }

  it("notify answers a uniform body that gives nothing away", async () => {
    const { POST } = await import("@/app/api/tranzila/notify/route");
    const res = await POST(post(form()));
    expect(res.status).toBe(200);
    const text = await res.text();

    // Same answer for a real capture, a replay and a probe.
    expect(JSON.parse(text)).toEqual({ ok: true, received: true });
    expect(text).not.toContain("O5d55d2922ca4021382");

    // The detail is logged instead, redacted: last 4 and field NAMES only.
    const logged = loggedText();
    expect(logged).toContain('"tokenReceived":true');
    expect(logged).toContain('"last4":"4207"');
    expect(logged).not.toContain("O5d55d2922ca4021382");
  });

  it("logs plainly when no token arrived", async () => {
    const { POST } = await import("@/app/api/tranzila/notify/route");
    const res = await POST(post(form({ TranzilaTK: "", Response: "004" })));
    expect(res.status).toBe(200);
    const logged = loggedText();
    expect(logged).toContain('"tokenReceived":false');
    expect(logged).toContain('"approved":false');
    expect(logged).toContain('"responseCode":"004"');
  });

  it("accepts the payload on the query string via GET", async () => {
    const { GET } = await import("@/app/api/tranzila/notify/route");
    const req = new Request(`https://x.test/api/tranzila/notify?${form().toString()}`, {
      headers: { "x-real-ip": `10.0.1.${++ipSeq % 250}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(loggedText()).toContain('"method":"GET"');
    expect(loggedText()).toContain('"tokenReceived":true');
  });

  it("returns 200 on an empty or junk POST instead of inviting retries", async () => {
    const { POST } = await import("@/app/api/tranzila/notify/route");
    const res = await POST(post(new URLSearchParams()));
    expect(res.status).toBe(200);
    expect(loggedText()).toContain('"tokenReceived":false');
  });

  it("the browser callback redirects instead of rendering the result", async () => {
    const { POST } = await import("@/app/api/tranzila/callback/route");
    const res = await POST(post(form(), "https://x.test/api/tranzila/callback"));
    // 303 so Tranzila's POST becomes a GET on the React page.
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/billing?success=1");
  });

  it("the callback still renders the diagnostic table on ?diag=1", async () => {
    const { POST } = await import("@/app/api/tranzila/callback/route");
    const res = await POST(post(form(), "https://x.test/api/tranzila/callback?diag=1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Token received");
    expect(html).not.toContain("O5d55d2922ca4021382");
  });

  it("refuses an oversized body", async () => {
    const { POST } = await import("@/app/api/tranzila/notify/route");
    const big = new URLSearchParams({ TranzilaTK: "x".repeat(40_000) });
    const res = await POST(post(big));
    expect(res.status).toBe(413);
  });

  it("never logs the token", async () => {
    const { POST } = await import("@/app/api/tranzila/notify/route");
    await POST(post(form()));
    const logged = loggedText();
    expect(logged).not.toContain("O5d55d2922ca4021382");
    expect(logged).toContain("tokenReceived");
  });
});
