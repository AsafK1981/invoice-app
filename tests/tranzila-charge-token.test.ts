import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * chargeToken() charges a saved TranzilaTK server-to-server (2026-09-23).
 *
 * These tests exist because there is NO other way to exercise it: Tranzila
 * has no test cards - their test terminal validates a real card - so the
 * first live run costs real money on a real card. Everything the docs and
 * support confirmed about the request is therefore pinned here against a
 * mocked `fetch`, so a regression shows up in CI rather than on someone's
 * statement.
 *
 * What each block pins:
 *   - the token goes in `card_number` (the single fact support answered),
 *   - the terminal is the TOKEN terminal when one is configured,
 *   - a decline returns, it does not throw,
 *   - garbage arguments are refused before anything reaches the network,
 *   - the token never appears in a log line.
 *
 * The module snapshots env at import time, so every test re-imports.
 */

const APP_KEY = "test-app-key";
const APP_SECRET = "test-app-secret";
const TOKEN = "O5d55d2922ca4021382";

async function loadTranzila(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv("TRANZILA_TERMINAL", "friendinv");
  vi.stubEnv("TRANZILA_PASSWORD", "test-pw");
  vi.stubEnv("TRANZILA_TOKEN_TERMINAL", "friendinvtok");
  vi.stubEnv("TRANZILA_APP_KEY", APP_KEY);
  vi.stubEnv("TRANZILA_APP_SECRET", APP_SECRET);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return await import("@/lib/tranzila");
}

function approvedResponse() {
  return {
    error_code: 0,
    message: "success",
    transaction_result: {
      processor_response_code: "000",
      transaction_id: 12345,
      auth_number: "0587923",
      card_type: 2,
      card_type_name: "Visa",
      currency_code: "ILS",
      last_4: "4580",
      card_mask: "458021xxxxxx4580",
      amount: 39,
      txn_type: "debit",
      tranmode: "A",
      token: "f1057849hg8495838",
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockJson(payload: unknown, status = 200) {
  fetchMock.mockResolvedValue({
    status,
    text: async () => JSON.stringify(payload),
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastRequest() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return {
    url: String(url),
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

describe("chargeToken: the request Tranzila actually accepts", () => {
  it("posts the saved token in card_number, not in a token field", async () => {
    const { chargeToken } = await loadTranzila();
    mockJson(approvedResponse());

    await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    const req = lastRequest();
    expect(req.url).toBe("https://api.tranzila.com/v1/transaction/credit_card/create");
    // The one fact Tranzila support answered in writing on 2026-09-23.
    expect(req.body.card_number).toBe(TOKEN);
    // The shapes that were guessed at before the answer arrived.
    expect(req.body).not.toHaveProperty("token");
    expect(req.body).not.toHaveProperty("TranzilaTK");
    // My Billing / STO v2 must not creep back in.
    expect(req.url).not.toContain("/sto");
    expect(req.body.txn_type).not.toBe("sto");
  });

  it("sends the documented required body and nothing card-sensitive", async () => {
    const { chargeToken } = await loadTranzila();
    mockJson(approvedResponse());

    await chargeToken({
      token: TOKEN,
      sum: 39.9,
      expireMonth: 7,
      expireYear: 2027,
      description: "מנוי חודשי",
    });

    const { body } = lastRequest();
    expect(body).toEqual({
      terminal_name: "friendinvtok",
      txn_type: "debit",
      txn_currency_code: "ILS",
      card_number: TOKEN,
      expire_month: 7,
      expire_year: 2027,
      payment_plan: 1,
      response_language: "english",
      items: [{ name: "מנוי חודשי", type: "I", unit_price: 39.9, units_number: 1 }],
    });
    // We never store a CVV, so we can never send one.
    expect(body).not.toHaveProperty("cvv");
  });

  it("authenticates with the four HMAC headers, no TranzilaPW", async () => {
    const { chargeToken } = await loadTranzila();
    mockJson(approvedResponse());

    await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    const { headers, body } = lastRequest();
    expect(headers["X-tranzila-api-app-key"]).toBe(APP_KEY);
    expect(headers["X-tranzila-api-nonce"]).toMatch(/^[0-9a-f]{80}$/);
    expect(headers["X-tranzila-api-request-time"]).toMatch(/^\d{10}$/);
    expect(headers["X-tranzila-api-access-token"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers["Content-Type"]).toBe("application/json");
    // The legacy transaction password has nothing to do with API v1.
    expect(body).not.toHaveProperty("TranzilaPW");
    expect(body).not.toHaveProperty("supplier");
    expect(JSON.stringify(headers)).not.toContain(APP_SECRET);
  });

  it("charges the clearing terminal when no token terminal is configured", async () => {
    const { chargeToken } = await loadTranzila({ TRANZILA_TOKEN_TERMINAL: "" });
    mockJson(approvedResponse());

    await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    expect(lastRequest().body.terminal_name).toBe("friendinv");
  });

  it("normalises a two-digit expiry year rather than sending year 27", async () => {
    const { chargeToken } = await loadTranzila();
    mockJson(approvedResponse());

    await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 27 });

    expect(lastRequest().body.expire_year).toBe(2027);
  });

  it("labels the line item generically when no description is given", async () => {
    const { chargeToken } = await loadTranzila();
    mockJson(approvedResponse());

    await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    const items = lastRequest().body.items as { name: string }[];
    expect(items[0].name).toBe("Subscription");
  });
});

describe("chargeToken: reading the answer", () => {
  it("reports success only when the API accepted AND the processor approved", async () => {
    const { chargeToken } = await loadTranzila();
    mockJson(approvedResponse());

    const res = await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    expect(res.success).toBe(true);
    expect(res.errorCode).toBe(0);
    expect(res.message).toBe("success");
    expect(res.processorResponseCode).toBe("000");
    expect(res.transactionId).toBe("12345");
    expect(res.authorizationNumber).toBe("0587923");
    expect(res.last4).toBe("4580");
    expect(res.amount).toBe(39);
  });

  it("returns a decline instead of throwing", async () => {
    const { chargeToken } = await loadTranzila();
    mockJson({
      error_code: 0,
      message: "success",
      transaction_result: {
        processor_response_code: "004",
        transaction_id: 12346,
        auth_number: "",
        last_4: "4580",
      },
    });

    const res = await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    expect(res.success).toBe(false);
    expect(res.processorResponseCode).toBe("004");
    expect(res.last4).toBe("4580");
    expect(res.raw.status).toBe(200);
  });

  it("treats an application-level error_code as a failure, not a charge", async () => {
    const { chargeToken } = await loadTranzila();
    // 20111 = "Provided token check failure", straight from the doc page's
    // application-error table. The likely real-world failure for a dead token.
    mockJson({ error_code: 20111, message: "Provided token check failure" });

    const res = await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe(20111);
    expect(res.message).toBe("Provided token check failure");
    expect(res.processorResponseCode).toBeNull();
  });

  it("fails closed when the processor code is missing entirely", async () => {
    const { chargeToken } = await loadTranzila();
    // A well-formed-looking success with no processor verdict must never be
    // read as "the customer was charged".
    mockJson({ error_code: 0, message: "success", transaction_result: {} });

    const res = await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    expect(res.success).toBe(false);
  });

  it("fails closed on a non-JSON body", async () => {
    const { chargeToken } = await loadTranzila();
    fetchMock.mockResolvedValue({ status: 502, text: async () => "<html>bad gateway</html>" });

    const res = await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBeNull();
    expect(res.raw.raw).toContain("bad gateway");
  });

  it("throws TranzilaApiError on a transport failure", async () => {
    const { chargeToken, TranzilaApiError } = await loadTranzila();
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 }),
    ).rejects.toBeInstanceOf(TranzilaApiError);
  });
});

describe("chargeToken: refuses to put nonsense on the wire", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["an empty token", { token: "" }],
    ["a token with punctuation", { token: "not a token!" }],
    ["a zero amount", { sum: 0 }],
    ["a negative amount", { sum: -39 }],
    ["month 0", { expireMonth: 0 }],
    ["month 13", { expireMonth: 13 }],
    ["a nonsense year", { expireYear: 1899 }],
  ];

  for (const [label, override] of bad) {
    it(`rejects ${label} without calling fetch`, async () => {
      const { chargeToken, TranzilaApiError } = await loadTranzila();
      const opts = { token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027, ...override };

      await expect(chargeToken(opts as never)).rejects.toBeInstanceOf(TranzilaApiError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("does not leak the token into the rejection message", async () => {
    const { chargeToken } = await loadTranzila();
    const err = await chargeToken({
      token: "short",
      sum: 39,
      expireMonth: 7,
      expireYear: 2027,
    }).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("short");
  });

  it("throws when the JSON API credentials are missing", async () => {
    const { chargeToken, TranzilaApiError } = await loadTranzila({ TRANZILA_APP_KEY: "" });
    await expect(
      chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 }),
    ).rejects.toBeInstanceOf(TranzilaApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when no terminal at all is configured", async () => {
    const { chargeToken, TranzilaApiError } = await loadTranzila({
      TRANZILA_TERMINAL: "",
      TRANZILA_TOKEN_TERMINAL: "",
    });
    await expect(
      chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 }),
    ).rejects.toBeInstanceOf(TranzilaApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("redactTranzilaSecrets: a reusable token is a credential", () => {
  it("blanks the token the create response echoes back", async () => {
    const { redactTranzilaSecrets } = await loadTranzila();
    const out = redactTranzilaSecrets(JSON.stringify(approvedResponse()));
    expect(out).not.toContain("f1057849hg8495838");
    expect(out).toContain('"token":"[redacted]"');
    // The safe fields survive - they are what makes a log useful.
    expect(out).toContain('"last_4":"4580"');
    expect(out).toContain('"processor_response_code":"000"');
  });

  it("blanks card_number, which on the request side IS the token", async () => {
    const { redactTranzilaSecrets } = await loadTranzila();
    const out = redactTranzilaSecrets(`{"card_number": "${TOKEN}", "expire_month": 7}`);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("expire_month");
  });

  it("keeps the charge token out of the console", async () => {
    const { chargeToken } = await loadTranzila();
    mockJson(approvedResponse());

    await chargeToken({ token: TOKEN, sum: 39, expireMonth: 7, expireYear: 2027 });

    const logged = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(logged).not.toContain("f1057849hg8495838");
    expect(logged).toContain("[redacted]");
  });
});
