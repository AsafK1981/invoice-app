import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * These tests exist because the ingest call was wrong in three ways at once
 * for months and nobody could tell, since the logger swallowed every error
 * (2026-09-02). Each assertion below pins one of the three faults:
 *
 *   - host must be the dataset's EDGE deployment, not the control plane
 *     (api.eu.axiom.co 403s; api.axiom.co answers "must use the
 *     eu-central-1 edge deployment domain")
 *   - path must be /v1/ingest/<dataset>, not /v1/datasets/<dataset>/ingest
 *   - a non-2xx response must be reported, never swallowed
 *
 * The module reads its config at import time, so every test stubs the env
 * and re-imports rather than sharing one instance.
 */

async function loadLogger(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv("AXIOM_INGEST_TOKEN", "test-token");
  vi.stubEnv("AXIOM_DATASET", "testdataset");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return await import("@/lib/axiom-logger");
}

/** logToAxiom never awaits; let the deferred POST run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("logToAxiom: the ingest call Axiom actually accepts", () => {
  it("posts to the dataset's edge host on /v1/ingest/<dataset>", async () => {
    const { logToAxiom } = await loadLogger();
    logToAxiom({ kind: "unit-test" });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe("https://eu-central-1.aws.edge.axiom.co/v1/ingest/testdataset");
    // The two shapes that were live and delivered nothing.
    expect(url).not.toContain("api.eu.axiom.co");
    expect(url).not.toContain("/v1/datasets/");
  });

  it("does not reuse AXIOM_API_BASE, which belongs to the archive's query", async () => {
    // Regression guard: collapsing ingest and query onto one variable is the
    // original bug, and repointing that variable would break the cold tier.
    const { logToAxiom } = await loadLogger({ AXIOM_API_BASE: "https://api.axiom.co" });
    logToAxiom({ kind: "unit-test" });
    await flush();
    expect(String(fetchMock.mock.calls[0][0])).toContain("edge.axiom.co");
  });

  it("honours AXIOM_INGEST_URL when the dataset moves", async () => {
    const { logToAxiom } = await loadLogger({ AXIOM_INGEST_URL: "https://elsewhere.example" });
    logToAxiom({ kind: "unit-test" });
    await flush();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://elsewhere.example/v1/ingest/testdataset");
  });

  it("sends a JSON array and stamps _time", async () => {
    const { logToAxiom } = await loadLogger();
    logToAxiom({ kind: "unit-test", code: "448" });
    await flush();

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].kind).toBe("unit-test");
    expect(body[0].code).toBe("448");
    expect(typeof body[0]._time).toBe("string");
  });

  it("reports a rejected ingest instead of swallowing it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" });

    const { logToAxiom } = await loadLogger();
    logToAxiom({ kind: "unit-test" });
    await flush();

    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0].join(" "))).toContain("403");
  });

  it("never throws when the network fails, and never blocks the caller", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    const { logToAxiom } = await loadLogger();
    expect(() => logToAxiom({ kind: "unit-test" })).not.toThrow();
    await flush();
  });

  it("stays silent when ingest is not configured", async () => {
    vi.resetModules();
    vi.stubEnv("AXIOM_INGEST_TOKEN", "");
    const { logToAxiom } = await import("@/lib/axiom-logger");
    logToAxiom({ kind: "unit-test" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
