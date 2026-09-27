import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  captureAttribution,
  captureReferral,
  clearReferral,
  normalizeReferralSlug,
  readAttribution,
  readReferral,
} from "@/lib/attribution";

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

describe("accountant referral (/from-accountant?ref=)", () => {
  it("remembers a valid slug and hands it to signup metadata", () => {
    land("https://friendlyinvoice.co.il/from-accountant?ref=hscpa");
    captureReferral();
    expect(readReferral()).toBe("hscpa");
    expect(readAttribution()).toMatchObject({ signup_ref: "hscpa" });
  });

  it("keeps the first accountant when a second link arrives later", () => {
    land("https://friendlyinvoice.co.il/from-accountant?ref=hscpa");
    captureReferral();
    land("https://friendlyinvoice.co.il/from-accountant?ref=oritax");
    captureReferral();
    expect(readReferral()).toBe("hscpa");
  });

  it("ignores a slug the DB CHECK would reject, so a bad link cannot poison the row", () => {
    land("https://friendlyinvoice.co.il/from-accountant?ref=Not%20A%20Slug!");
    captureReferral();
    expect(readReferral()).toBeNull();
    expect(readAttribution()).toEqual({});
  });

  it("normalizes case and whitespace, rejects everything else", () => {
    expect(normalizeReferralSlug(" HSCPA ")).toBe("hscpa");
    expect(normalizeReferralSlug("keren-veber")).toBe("keren-veber");
    expect(normalizeReferralSlug("-lead")).toBeNull();
    expect(normalizeReferralSlug("a")).toBeNull();
    expect(normalizeReferralSlug("x".repeat(33))).toBeNull();
    expect(normalizeReferralSlug(null)).toBeNull();
  });

  it("ignores ?ref= on any page other than /from-accountant, so a generic ref cannot block a real one", () => {
    land("https://friendlyinvoice.co.il/pricing?ref=facebook");
    captureReferral();
    expect(readReferral()).toBeNull();
    land("https://friendlyinvoice.co.il/from-accountant/?ref=hscpa");
    captureReferral();
    expect(readReferral()).toBe("hscpa");
  });

  it("overwrites a malformed stored value instead of letting it block a real referral", () => {
    storage.setItem("fi_ref_v1", "{not json");
    land("https://friendlyinvoice.co.il/from-accountant?ref=hscpa");
    captureReferral();
    expect(readReferral()).toBe("hscpa");
  });

  it("forgets the referral once cleared, so the next signup on this browser starts clean", () => {
    land("https://friendlyinvoice.co.il/from-accountant?ref=hscpa");
    captureReferral();
    clearReferral();
    expect(readReferral()).toBeNull();
    expect(readAttribution()).toEqual({});
  });

  it("is a no-op without a ref and survives blocked storage", () => {
    land("https://friendlyinvoice.co.il/from-accountant");
    captureReferral();
    expect(readReferral()).toBeNull();
    storage = makeStorage(true);
    land("https://friendlyinvoice.co.il/from-accountant?ref=hscpa");
    expect(() => captureReferral()).not.toThrow();
    expect(readReferral()).toBeNull();
  });
});
