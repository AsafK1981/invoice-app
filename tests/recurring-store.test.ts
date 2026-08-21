import { describe, it, expect } from "vitest";
import { calculateNextDue, nextDueFromAnchor, serializeWrite } from "@/lib/recurring-store";

describe("calculateNextDue: weekly", () => {
  it("adds 7 days", () => {
    expect(calculateNextDue("2026-01-15", "weekly")).toBe("2026-01-22");
  });
  it("rolls across a month boundary", () => {
    expect(calculateNextDue("2026-01-31", "weekly")).toBe("2026-02-07");
  });
});

describe("calculateNextDue: monthly (end-of-month must not overflow)", () => {
  it("Jan 31 -> Feb 28 (does NOT spill to March)", () => {
    expect(calculateNextDue("2026-01-31", "monthly")).toBe("2026-02-28");
  });
  it("Jan 31 -> Feb 29 in a leap year", () => {
    expect(calculateNextDue("2028-01-31", "monthly")).toBe("2028-02-29");
  });
  it("Mar 31 -> Apr 30", () => {
    expect(calculateNextDue("2026-03-31", "monthly")).toBe("2026-04-30");
  });
  it("keeps a mid-month day as-is", () => {
    expect(calculateNextDue("2026-03-15", "monthly")).toBe("2026-04-15");
  });
  it("rolls December -> January of next year", () => {
    expect(calculateNextDue("2026-12-15", "monthly")).toBe("2027-01-15");
  });
  it("Dec 31 -> Jan 31 next year (31-day target keeps the 31st)", () => {
    expect(calculateNextDue("2026-12-31", "monthly")).toBe("2027-01-31");
  });
});

describe("nextDueFromAnchor: first due date for a chosen billing day", () => {
  it("picks next month when the chosen day already passed", () => {
    expect(nextDueFromAnchor("2026-08-21", "monthly", 1)).toBe("2026-09-01");
  });
  it("picks this month when the chosen day is still ahead", () => {
    expect(nextDueFromAnchor("2026-08-21", "monthly", 25)).toBe("2026-08-25");
  });
  it("is due today when the chosen day is today", () => {
    expect(nextDueFromAnchor("2026-08-21", "monthly", 21)).toBe("2026-08-21");
  });
  it("clamps a 31st anchor to a short month's last day", () => {
    expect(nextDueFromAnchor("2026-02-01", "monthly", 31)).toBe("2026-02-28");
  });
  it("rolls December -> January for a passed anchor", () => {
    expect(nextDueFromAnchor("2026-12-20", "monthly", 5)).toBe("2027-01-05");
  });
  it("weekly: finds the next occurrence of the chosen weekday", () => {
    // 2026-08-21 is a Friday (5); next Monday (1) is 2026-08-24.
    expect(nextDueFromAnchor("2026-08-21", "weekly", 1)).toBe("2026-08-24");
  });
  it("weekly: today counts when it is already the chosen weekday", () => {
    expect(nextDueFromAnchor("2026-08-21", "weekly", 5)).toBe("2026-08-21");
  });
});

describe("calculateNextDue: an anchor day survives a short month", () => {
  it("Feb 28 advances back to the 31st, not to Mar 28", () => {
    expect(calculateNextDue("2026-02-28", "monthly", 31)).toBe("2026-03-31");
  });
  it("mid-month anchors behave the same as before", () => {
    expect(calculateNextDue("2026-03-15", "monthly", 15)).toBe("2026-04-15");
  });
});

describe("serializeWrite: no lost update under concurrency", () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("runs read-modify-write mutations sequentially so updates compose", async () => {
    let store: string[] = [];
    // Each op simulates read -> (window for a race) -> write back.
    const op = (item: string, readDelay: number) =>
      serializeWrite(async () => {
        const baseline = [...store];
        await delay(readDelay);
        store = [...baseline, item];
      });
    // Fire concurrently; the slow one starts first. Without serialization the
    // fast op would commit, then the slow op would overwrite with its stale
    // baseline and drop it (lost update).
    await Promise.all([op("A", 30), op("B", 5)]);
    expect([...store].sort()).toEqual(["A", "B"]);
  });

  it("a throwing mutation does not break the chain for the next one", async () => {
    const ran: string[] = [];
    await Promise.allSettled([
      serializeWrite(async () => {
        throw new Error("boom");
      }),
      serializeWrite(async () => {
        ran.push("next");
      }),
    ]);
    expect(ran).toEqual(["next"]);
  });
});
