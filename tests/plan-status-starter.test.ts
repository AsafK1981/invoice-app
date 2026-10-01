import { describe, it, expect } from "vitest";
import { getPlanStatus, PLANS, STARTER_PLAN } from "@/lib/plans";

/**
 * PlanStatus.starter: is this user on the permanent free tier ("חינם")?
 *
 * Rule: no active paid entitlement, i.e. app_metadata.plan_active is not true
 * OR the beta grant expired. Each case below mirrors the app_metadata a real
 * write path leaves behind (invite redeem, billing webhook, the recurring
 * billing cron's downgrade(), the hosted-checkout callback).
 */

const DAY = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 30 * DAY).toISOString();
const past = () => new Date(Date.now() - 3 * DAY).toISOString();

const status = (app_metadata: Record<string, unknown>, user_metadata = {}) =>
  getPlanStatus({ app_metadata, user_metadata });

describe("getPlanStatus().starter", () => {
  it("never subscribed (empty app_metadata) is starter", () => {
    expect(status({}).starter).toBe(true);
    expect(getPlanStatus(null).starter).toBe(true);
    expect(getPlanStatus(undefined).starter).toBe(true);
    expect(getPlanStatus({ app_metadata: null }).starter).toBe(true);
  });

  it("paid Basic, active, is not starter", () => {
    const s = status({
      plan_tier: "free",
      plan_active: true,
      plan_trialing: false,
      plan_beta_grant: false,
      plan_current_period_end: future(),
    });
    expect(s.starter).toBe(false);
    expect(s.tier).toBe("free");
    expect(s.active).toBe(true);
  });

  it("paid Pro, active, is not starter", () => {
    const s = status({
      plan_tier: "pro",
      plan_active: true,
      plan_trialing: false,
      plan_beta_grant: false,
      plan_current_period_end: future(),
    });
    expect(s.starter).toBe(false);
    expect(s.tier).toBe("pro");
  });

  it("trialing is not starter", () => {
    const s = status({
      plan_tier: "pro",
      plan_active: true,
      plan_trialing: true,
      plan_current_period_end: future(),
    });
    expect(s.starter).toBe(false);
    expect(s.trialing).toBe(true);
  });

  it("lapsed Pro (cron downgrade keeps plan_tier pro, plan_active false) is starter", () => {
    const s = status({ plan_tier: "pro", plan_active: false, plan_trialing: false });
    expect(s.starter).toBe(true);
    // Existing semantics unchanged: still tier pro, inactive.
    expect(s.tier).toBe("pro");
    expect(s.active).toBe(false);
  });

  it("cancelled via webhook (plan_tier free, plan_active false) is starter", () => {
    const s = status({
      plan_tier: "free",
      plan_active: false,
      plan_trialing: false,
      plan_beta_grant: false,
    });
    expect(s.starter).toBe(true);
    // Existing semantics unchanged: the free tier reads as active.
    expect(s.tier).toBe("free");
    expect(s.active).toBe(true);
  });

  it("active beta grant is not starter", () => {
    const s = status({
      plan_tier: "pro",
      plan_active: true,
      plan_beta_grant: true,
      plan_current_period_end: future(),
    });
    expect(s.starter).toBe(false);
    expect(s.betaGrant).toBe(true);
  });

  it("expired beta grant is starter, even though plan_active is still true", () => {
    const s = status({
      plan_tier: "pro",
      plan_active: true,
      plan_beta_grant: true,
      plan_current_period_end: past(),
    });
    expect(s.starter).toBe(true);
    expect(s.betaExpired).toBe(true);
    expect(s.tier).toBe("free");
    expect(s.active).toBe(false);
  });

  it("user_metadata can never influence it", () => {
    const spoof = { plan_tier: "pro", plan_active: true, plan_beta_grant: true };
    expect(status({}, spoof).starter).toBe(true);
    // ...and the reverse: a user cannot make a paying user look free either.
    const paying = { plan_tier: "pro", plan_active: true, plan_current_period_end: future() };
    expect(status(paying, { plan_active: false }).starter).toBe(false);
    // A non-boolean plan_active is not an entitlement.
    expect(status({ plan_tier: "pro", plan_active: "true" }).starter).toBe(true);
  });
});

describe("STARTER_PLAN", () => {
  it("is free forever, 5 documents a month, otherwise Basic's limits", () => {
    expect(STARTER_PLAN.priceMonthly).toBe(0);
    expect(STARTER_PLAN.priceYearly).toBe(0);
    expect(STARTER_PLAN.limits.documentsPerMonth).toBe(5);
    expect({ ...STARTER_PLAN.limits, documentsPerMonth: 30 }).toEqual(PLANS.free.limits);
  });

  it("is not a chargeable tier", () => {
    expect(Object.keys(PLANS).sort()).toEqual(["free", "pro"]);
  });
});
