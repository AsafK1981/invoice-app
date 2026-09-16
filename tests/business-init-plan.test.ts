import { describe, it, expect } from "vitest";
import { planBusinessInit, type LookupOutcome } from "@/lib/business-init";

const HIT: LookupOutcome = { status: "hit", id: "biz-1" };
const MISS: LookupOutcome = { status: "miss" };
const SKIPPED: LookupOutcome = { status: "skipped" };
const FAILED: LookupOutcome = { status: "failed", message: "boom" };

describe("planBusinessInit", () => {
  it("uses the cached business when it still belongs to this user", () => {
    expect(planBusinessInit({ cached: HIT, existing: SKIPPED })).toEqual({
      action: "use",
      id: "biz-1",
    });
  });

  it("uses the business found by user_id when there was no cached id", () => {
    expect(planBusinessInit({ cached: SKIPPED, existing: HIT })).toEqual({
      action: "use",
      id: "biz-1",
    });
  });

  it("creates only after a read that genuinely succeeded and came back empty", () => {
    expect(planBusinessInit({ cached: SKIPPED, existing: MISS })).toEqual({ action: "create" });
    expect(planBusinessInit({ cached: MISS, existing: MISS })).toEqual({ action: "create" });
  });

  // This is the regression. A request that loses its access token is answered
  // by RLS with zero rows and no error; the old code read that as "this user
  // has no business" and tried to INSERT, which the same RLS then rejected -
  // Sentry INVOICE-APP-J. A read that failed must never reach "create".
  it("never creates a business off the back of a failed lookup", () => {
    expect(planBusinessInit({ cached: SKIPPED, existing: FAILED })).toEqual({
      action: "fail",
      message: "boom",
    });
    expect(planBusinessInit({ cached: FAILED, existing: FAILED })).toEqual({
      action: "fail",
      message: "boom",
    });
  });

  it("fails rather than creating when the authoritative lookup never ran", () => {
    const plan = planBusinessInit({ cached: FAILED, existing: SKIPPED });
    expect(plan.action).toBe("fail");
  });

  it("prefers the cached hit even if the authoritative lookup failed", () => {
    expect(planBusinessInit({ cached: HIT, existing: FAILED })).toEqual({
      action: "use",
      id: "biz-1",
    });
  });

  it("only ever returns use, create or fail", () => {
    const outcomes: LookupOutcome[] = [HIT, MISS, SKIPPED, FAILED];
    for (const cached of outcomes) {
      for (const existing of outcomes) {
        const plan = planBusinessInit({ cached, existing });
        expect(["use", "create", "fail"]).toContain(plan.action);
        // The invariant, stated exhaustively: "create" requires a successful
        // empty authoritative read. Nothing else may produce it.
        if (plan.action === "create") expect(existing.status).toBe("miss");
      }
    }
  });
});
