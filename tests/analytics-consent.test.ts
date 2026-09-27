import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  CONSENT_KEY,
  clearConsent,
  hasAnalyticsConsent,
  isAnalyticsPath,
  readConsent,
  sanitizePageLocation,
  writeConsent,
} from "@/lib/analytics-consent";

// Node environment, no jsdom (see vitest.config.ts). A window with a fresh
// in-memory localStorage is stubbed per test (afterEach unstubs globals, which
// also drops vitest.setup.ts's shared stub), the same way
// tests/attribution.test.ts does it.

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analytics consent storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  it("reports no choice on a first visit", () => {
    expect(readConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("round-trips an accept in the documented v1 shape", () => {
    writeConsent(true);
    const raw = JSON.parse(window.localStorage.getItem(CONSENT_KEY)!);
    expect(raw).toMatchObject({ v: 1, analytics: true });
    expect(new Date(raw.at).toString()).not.toBe("Invalid Date");
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it("a decline is a stored choice, but not consent", () => {
    writeConsent(false);
    expect(readConsent()?.analytics).toBe(false);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("clearing forgets the choice so the banner shows again", () => {
    writeConsent(true);
    clearConsent();
    expect(readConsent()).toBeNull();
  });

  it("never reads a malformed or foreign record as a yes", () => {
    for (const bad of [
      "{not json",
      "true",
      "null",
      JSON.stringify({ analytics: true }), // no version
      JSON.stringify({ v: 2, analytics: true }),
      JSON.stringify({ v: 1, analytics: "yes" }),
    ]) {
      window.localStorage.setItem(CONSENT_KEY, bad);
      expect(hasAnalyticsConsent()).toBe(false);
    }
  });

  it("never throws when storage itself throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("window", { localStorage: throwing });
    expect(() => writeConsent(true)).not.toThrow();
    expect(() => clearConsent()).not.toThrow();
    expect(readConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });
});

describe("analytics route allowlist", () => {
  it.each([
    "/",
    "/product",
    "/pricing",
    "/blog",
    "/blog/some-post",
    "/vs",
    "/vs/greeninvoice",
    "/privacy",
    "/login",
    "/onboarding",
    "/pricing/",
    "/blog/", // trailing slash normalises to the /blog index
  ])("allows %s", (p) => {
    expect(isAnalyticsPath(p)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/documents/new",
    "/documents/123",
    "/clients/abc/statement",
    "/settings",
    "/admin",
    "/view/3f1c2d4e-0000-0000-0000-000000000000",
    "/portal/abc",
    "/invite/abc",
    "/verify/abc",
    "/auth/google-complete",
    "/reset-password",
    "/onboarding/extra",
    "/login/anything",
    "/vsx",
    "/blogger",
    "",
  ])("blocks %s", (p) => {
    expect(isAnalyticsPath(p)).toBe(false);
  });

  it("blocks null/undefined", () => {
    expect(isAnalyticsPath(null)).toBe(false);
    expect(isAnalyticsPath(undefined)).toBe(false);
  });

  it("covers every page in the (marketing) route group", () => {
    // Guard against drift: a new marketing page must be opted in on purpose,
    // and this is where forgetting it shows up.
    const root = path.resolve(__dirname, "../src/app/(marketing)");
    const routes: string[] = [];
    const walk = (dir: string, segs: string[]) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), [...segs, entry.name]);
        } else if (entry.name === "page.tsx") {
          const url =
            "/" +
            segs
              .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
              .map((s) => (s.startsWith("[") ? "sample-slug" : s))
              .join("/");
          routes.push(url);
        }
      }
    };
    walk(root, []);
    expect(routes.length).toBeGreaterThan(10);
    const missing = routes.filter((r) => !isAnalyticsPath(r));
    expect(missing).toEqual([]);
  });
});

describe("sanitizePageLocation", () => {
  it("keeps campaign parameters and drops everything else", () => {
    expect(
      sanitizePageLocation(
        "https://friendlyinvoice.co.il/login?next=%2Fdocuments%2F1&utm_source=fb&email=a%40b.c#x",
      ),
    ).toBe("https://friendlyinvoice.co.il/login?utm_source=fb");
  });

  it("returns a bare URL when there is nothing to keep", () => {
    expect(sanitizePageLocation("https://friendlyinvoice.co.il/pricing?x=1")).toBe(
      "https://friendlyinvoice.co.il/pricing",
    );
  });

  it("returns an empty string for garbage instead of throwing", () => {
    expect(sanitizePageLocation("not a url")).toBe("");
  });
});
