import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FRIEND_REFERRAL,
  REFERRAL_SLUG,
  captureReferral,
  friendReferralCode,
  normalizeReferralSlug,
  readReferral,
  takeReferralVisitToReport,
} from "@/lib/attribution";
import { countFriendReferrals } from "@/lib/friend-referrals";
import { PARTNER_ACCOUNTANTS } from "@/lib/partner-accountants";

// Same window/document stubbing as tests/attribution.test.ts: the suite runs
// on the `node` environment without jsdom.

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

let storage: ReturnType<typeof makeStorage>;

function land(url: string) {
  const u = new URL(url);
  vi.stubGlobal("window", {
    localStorage: storage,
    location: { search: u.search, pathname: u.pathname, hostname: u.hostname },
  });
  vi.stubGlobal("document", { referrer: "" });
}

beforeEach(() => {
  storage = makeStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const BIZ = "3F2A9C10-7B4E-4d21-9a6f-0c1e2d3b4a59";

describe("friendReferralCode", () => {
  it("is f- plus the first 10 hex of the id, dashes dropped, lowercased", () => {
    expect(friendReferralCode(BIZ)).toBe("f-3f2a9c107b");
    expect(friendReferralCode(BIZ)).toHaveLength(12);
  });

  it("is deterministic and fits both the friend shape and the DB CHECK", () => {
    const code = friendReferralCode(BIZ);
    expect(friendReferralCode(BIZ)).toBe(code);
    expect(FRIEND_REFERRAL.test(code)).toBe(true);
    expect(REFERRAL_SLUG.test(code)).toBe(true);
    // readReferral -> businesses.referred_by goes through this normalizer.
    expect(normalizeReferralSlug(code)).toBe(code);
  });

  it("gives different businesses different codes", () => {
    expect(friendReferralCode("aaaaaaaa-0000-4000-8000-000000000000")).not.toBe(
      friendReferralCode("aaaaaaab-0000-4000-8000-000000000000"),
    );
  });
});

describe("FRIEND_REFERRAL", () => {
  it("accepts exactly f- and 10 lowercase hex", () => {
    expect(FRIEND_REFERRAL.test("f-0123456789")).toBe(true);
    expect(FRIEND_REFERRAL.test("f-abcdef0123")).toBe(true);
  });

  it("rejects everything else", () => {
    for (const bad of [
      "f-012345678", // 9
      "f-01234567890", // 11
      "f-ABCDEF0123", // uppercase
      "f-0123456g89", // not hex
      "g-0123456789",
      "f0123456789",
      "hscpa",
      "facebook",
      " f-0123456789",
      "",
    ]) {
      expect(FRIEND_REFERRAL.test(bad), bad).toBe(false);
    }
  });

  it("can never match a listed accountant slug", () => {
    for (const a of PARTNER_ACCOUNTANTS) {
      expect(FRIEND_REFERRAL.test(a.slug), a.slug).toBe(false);
    }
  });
});

describe("capturing a friend invite", () => {
  it("remembers a friend code on the home page", () => {
    land("https://friendlyinvoice.co.il/?ref=f-0123456789");
    captureReferral();
    expect(readReferral()).toBe("f-0123456789");
  });

  it("remembers a friend code on any other page too", () => {
    land("https://friendlyinvoice.co.il/pricing?ref=f-0123456789");
    captureReferral();
    expect(readReferral()).toBe("f-0123456789");
  });

  it("still ignores an accountant slug off /from-accountant", () => {
    land("https://friendlyinvoice.co.il/?ref=hscpa");
    captureReferral();
    expect(readReferral()).toBeNull();
  });

  it("keeps the first valid ref, whichever kind arrives second", () => {
    land("https://friendlyinvoice.co.il/?ref=f-0123456789");
    captureReferral();
    land("https://friendlyinvoice.co.il/from-accountant?ref=hscpa");
    captureReferral();
    expect(readReferral()).toBe("f-0123456789");

    storage = makeStorage();
    land("https://friendlyinvoice.co.il/from-accountant?ref=hscpa");
    captureReferral();
    land("https://friendlyinvoice.co.il/?ref=f-0123456789");
    captureReferral();
    expect(readReferral()).toBe("hscpa");

    storage = makeStorage();
    land("https://friendlyinvoice.co.il/?ref=f-0123456789");
    captureReferral();
    land("https://friendlyinvoice.co.il/?ref=f-abcdefabcd");
    captureReferral();
    expect(readReferral()).toBe("f-0123456789");
  });

  it("never reports a friend code as an accountant link visit", () => {
    land("https://friendlyinvoice.co.il/?ref=f-0123456789");
    expect(takeReferralVisitToReport()).toBeNull();
    // Not even when someone pastes it onto the accountant landing page.
    land("https://friendlyinvoice.co.il/from-accountant?ref=f-0123456789");
    expect(takeReferralVisitToReport()).toBeNull();
  });
});

describe("countFriendReferrals", () => {
  const INVITER = "11111111-2222-4333-8444-555555555555";
  const code = friendReferralCode(INVITER);
  const INTERNAL = "dc3b5b61-0000-4000-8000-000000000000"; // on the internal list

  it("counts joined and active for one inviter", () => {
    const rows = [
      { id: "a0000000-0000-4000-8000-000000000001", referred_by: code },
      { id: "a0000000-0000-4000-8000-000000000002", referred_by: code },
      { id: "a0000000-0000-4000-8000-000000000003", referred_by: "f-9999999999" },
      { id: "a0000000-0000-4000-8000-000000000004", referred_by: null },
    ];
    const activeIds = new Set(["a0000000-0000-4000-8000-000000000002", "a0000000-0000-4000-8000-000000000003"]);
    expect(countFriendReferrals(rows, { code, activeIds })).toEqual({ joined: 2, active: 1 });
  });

  it("never counts a self-referral", () => {
    const rows = [{ id: INVITER, referred_by: code }];
    expect(countFriendReferrals(rows, { code, activeIds: new Set([INVITER]) })).toEqual({ joined: 0, active: 0 });
    expect(countFriendReferrals(rows, { activeIds: new Set([INVITER]) })).toEqual({ joined: 0, active: 0 });
  });

  it("never counts our own accounts", () => {
    const rows = [{ id: INTERNAL, referred_by: code }];
    expect(countFriendReferrals(rows, { code, activeIds: new Set([INTERNAL]) })).toEqual({ joined: 0, active: 0 });
    // The admin route passes its own snapshot-based set instead.
    const other = "b0000000-0000-4000-8000-000000000001";
    expect(
      countFriendReferrals([{ id: other, referred_by: code }], {
        activeIds: new Set(),
        isInternal: (id) => id === other,
      }),
    ).toEqual({ joined: 0, active: 0 });
  });

  it("without a code totals every friend-shaped ref and skips accountant slugs", () => {
    const rows = [
      { id: "c0000000-0000-4000-8000-000000000001", referred_by: "f-0123456789" },
      { id: "c0000000-0000-4000-8000-000000000002", referred_by: "f-abcdefabcd" },
      { id: "c0000000-0000-4000-8000-000000000003", referred_by: "hscpa" },
    ];
    const activeIds = new Set(["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000003"]);
    expect(countFriendReferrals(rows, { activeIds })).toEqual({ joined: 2, active: 1 });
  });
});
