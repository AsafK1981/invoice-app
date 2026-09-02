import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { captureAttribution, readAttribution } from "@/lib/attribution";

// The suite runs on the `node` environment with no jsdom (see
// vitest.config.ts), so window/document are stubbed here the same way
// vitest.setup.ts already stubs localStorage. Adding jsdom just for this
// would be a dependency for one file.

const KEY = "fi_attr_v1";

function makeStorage(broken = false) {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => {
      if (broken) throw new Error("blocked");
      return map.has(k) ? map.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("blocked");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

let storage: ReturnType<typeof makeStorage>;

/** Point the stubbed window/document at a given entry. */
function land(url: string, referrer = "") {
  const u = new URL(url);
  vi.stubGlobal("window", {
    localStorage: storage,
    location: { search: u.search, pathname: u.pathname, hostname: u.hostname },
  });
  vi.stubGlobal("document", { referrer });
}

beforeEach(() => {
  storage = makeStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("first-touch attribution", () => {
  it("records a UTM link, which is the case the Facebook lane needs", () => {
    land("https://friendlyinvoice.co.il/product?utm_source=fb&utm_medium=group&utm_campaign=ani.shulman");
    captureAttribution();

    expect(readAttribution()).toMatchObject({
      signup_source: "fb",
      signup_medium: "group",
      signup_campaign: "ani.shulman",
      signup_landing: "/product",
    });
  });

  it("falls back to the referring host when there is no UTM", () => {
    // Exactly the 2026-08-28 situation: a real link, posted without a UTM.
    land("https://friendlyinvoice.co.il/product", "https://l.facebook.com/lsr");
    captureAttribution();

    const a = readAttribution();
    expect(a.signup_source).toBe("referral");
    expect(a.signup_referrer).toBe("l.facebook.com");
  });

  it("ignores a same-origin referrer, which is just internal navigation", () => {
    land("https://friendlyinvoice.co.il/pricing", "https://friendlyinvoice.co.il/product");
    captureAttribution();
    expect(readAttribution()).toEqual({});
  });

  it("keeps the FIRST touch when the visitor returns from somewhere else", () => {
    land("https://friendlyinvoice.co.il/?utm_source=fb");
    captureAttribution();
    land("https://friendlyinvoice.co.il/?utm_source=google", "https://www.google.com/");
    captureAttribution();

    // The channel that earned the user is the one that brought them first.
    expect(readAttribution().signup_source).toBe("fb");
  });

  it("does not write an empty record, so a later real source still lands", () => {
    land("https://friendlyinvoice.co.il/");
    captureAttribution();
    expect(storage._map.has(KEY)).toBe(false);

    land("https://friendlyinvoice.co.il/?utm_source=fb");
    captureAttribution();
    expect(readAttribution().signup_source).toBe("fb");
  });

  it("survives a malformed referrer", () => {
    land("https://friendlyinvoice.co.il/?utm_source=fb", "not-a-url");
    expect(() => captureAttribution()).not.toThrow();
    expect(readAttribution().signup_source).toBe("fb");
    expect(readAttribution().signup_referrer).toBeUndefined();
  });

  it("never throws when storage is blocked, and reports nothing", () => {
    // Private mode / blocked site data: the accessor itself throws.
    storage = makeStorage(true);
    land("https://friendlyinvoice.co.il/?utm_source=fb");
    expect(() => captureAttribution()).not.toThrow();
    expect(readAttribution()).toEqual({});
  });

  it("survives a corrupted record rather than breaking signup", () => {
    land("https://friendlyinvoice.co.il/");
    storage.setItem(KEY, "{not json");
    expect(() => readAttribution()).not.toThrow();
    expect(readAttribution()).toEqual({});
  });
});
