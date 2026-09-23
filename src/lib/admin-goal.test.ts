import { describe, expect, it } from "vitest";
import {
  GOAL,
  GROSS_PER_SUBSCRIBER_ILS,
  endOfMonth,
  goalPathOn,
  goalStatus,
  nextMilestoneDate,
} from "./admin-goal";

describe("GOAL", () => {
  it("is 2,500 subscribers for ₪50,000 gross, a blended ₪20 each", () => {
    expect(GOAL.subscribers).toBe(2500);
    expect(GOAL.grossMonthlyIls).toBe(50000);
    expect(GROSS_PER_SUBSCRIBER_ILS).toBe(20);
  });
});

describe("endOfMonth", () => {
  it("returns the last day of the month, including February and December", () => {
    expect(endOfMonth("2026-09-23")).toBe("2026-09-30");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2026-12-05")).toBe("2026-12-31");
  });

  it("walks forward whole months", () => {
    expect(endOfMonth("2026-09-23", 1)).toBe("2026-10-31");
    expect(endOfMonth("2026-12-23", 1)).toBe("2027-01-31");
  });
});

describe("goalPathOn", () => {
  it("is zero up to the start and the goal from the deadline on", () => {
    expect(goalPathOn("2026-09-23")).toBe(0);
    expect(goalPathOn(GOAL.startedOn)).toBe(0);
    expect(goalPathOn(GOAL.deadline)).toBe(GOAL.subscribers);
    expect(goalPathOn("2031-01-01")).toBe(GOAL.subscribers);
  });

  it("compounds: halfway through the runway it is well under half the goal", () => {
    // 1,095 days from 2026-10-01 to 2029-09-30; 2028-04-01 is day 548.
    // (sqrt(20) - 1) / 19 = 18.3% of the goal.
    const mid = goalPathOn("2028-04-01");
    expect(mid).toBeGreaterThan(440);
    expect(mid).toBeLessThan(470);
  });

  it("year by year: ~225, ~840, 2,500", () => {
    expect(goalPathOn("2027-09-30")).toBeGreaterThan(215);
    expect(goalPathOn("2027-09-30")).toBeLessThan(235);
    expect(goalPathOn("2028-09-30")).toBeGreaterThan(825);
    expect(goalPathOn("2028-09-30")).toBeLessThan(855);
  });

  it("never decreases from one month end to the next", () => {
    let prev = 0;
    for (let i = 0; i < 40; i++) {
      const next = goalPathOn(endOfMonth("2026-09-01", i));
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  it("asks for about a dozen in the first month, hundreds a month in the last year", () => {
    const firstMonth = goalPathOn("2026-10-31");
    expect(firstMonth).toBeGreaterThanOrEqual(8);
    expect(firstMonth).toBeLessThanOrEqual(14);
    expect(goalPathOn("2029-08-31") - goalPathOn("2029-07-31")).toBeGreaterThan(180);
    expect(goalPathOn("2029-09-30") - goalPathOn("2029-08-31")).toBeGreaterThan(200);
  });
});

describe("nextMilestoneDate", () => {
  it("targets this month end when two weeks or more remain", () => {
    expect(nextMilestoneDate("2026-10-01")).toBe("2026-10-31");
    expect(nextMilestoneDate("2026-10-17")).toBe("2026-10-31");
  });

  it("skips to next month end when the current one is under two weeks away", () => {
    expect(nextMilestoneDate("2026-09-23")).toBe("2026-10-31");
    expect(nextMilestoneDate("2026-10-18")).toBe("2026-11-30");
  });
});

describe("goalStatus", () => {
  it("describes zero subscribers on the day the goal was set", () => {
    const s = goalStatus(0, 0, "2026-09-23");
    expect(s.paying).toBe(0);
    expect(s.percentOfGoal).toBe(0);
    expect(s.expectedToday).toBe(0);
    expect(s.aheadBy).toBe(0);
    expect(s.milestone.date).toBe("2026-10-31");
    expect(s.milestone.target).toBe(goalPathOn("2026-10-31"));
    expect(s.milestone.toGo).toBe(s.milestone.target);
    expect(s.milestone.daysLeft).toBe(38);
    expect(s.monthsToDeadline).toBe(36);
    expect(s.paceNext30d).toBeGreaterThan(0);
  });

  it("never asks for a negative number once ahead of the curve", () => {
    const s = goalStatus(400, 8000, "2028-01-15");
    expect(s.aheadBy).toBeGreaterThan(0);
    expect(s.milestone.toGo).toBe(0);
    expect(s.paceNext30d).toBeGreaterThanOrEqual(0);
  });

  it("caps the share of goal at 100 and the months left at zero", () => {
    const s = goalStatus(3000, 60000, "2030-01-01");
    expect(s.percentOfGoal).toBe(100);
    expect(s.monthsToDeadline).toBe(0);
    expect(s.milestone.toGo).toBe(0);
  });

  it("reports a fractional percent for a small base", () => {
    expect(goalStatus(11, 220, "2026-10-31").percentOfGoal).toBe(0.4);
  });

  it("flags falling behind once the runway has started", () => {
    const s = goalStatus(2, 40, "2027-01-15");
    expect(s.expectedToday).toBeGreaterThan(2);
    expect(s.aheadBy).toBeLessThan(0);
    expect(s.milestone.toGo).toBeGreaterThan(0);
  });
});
