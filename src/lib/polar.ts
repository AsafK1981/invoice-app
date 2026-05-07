import { Polar } from "@polar-sh/sdk";
import type { PlanTier, BillingInterval } from "./plans";

const accessToken = process.env.POLAR_ACCESS_TOKEN;
const server: "production" | "sandbox" =
  process.env.POLAR_MODE === "sandbox" ? "sandbox" : "production";

/**
 * Polar SDK singleton. Null until POLAR_ACCESS_TOKEN is set in Vercel env;
 * route handlers must check `polar` before calling it.
 */
export const polar = accessToken ? new Polar({ accessToken, server }) : null;

/**
 * Polar Product IDs, one per (tier, interval) combo. Filled in by the user
 * after creating the four products in the Polar dashboard (or by us via
 * the API once the access token lands). Vercel env vars:
 *
 *   POLAR_BASIC_MONTHLY_PRODUCT_ID
 *   POLAR_BASIC_YEARLY_PRODUCT_ID
 *   POLAR_PRO_MONTHLY_PRODUCT_ID
 *   POLAR_PRO_YEARLY_PRODUCT_ID
 *
 * Note: tier ID "free" is the internal name for the Basic display tier
 * (kept for backwards compat with existing user_metadata.plan_tier).
 */
const PRODUCT_IDS: Record<PlanTier, Record<BillingInterval, string>> = {
  free: {
    month: process.env.POLAR_BASIC_MONTHLY_PRODUCT_ID || "",
    year: process.env.POLAR_BASIC_YEARLY_PRODUCT_ID || "",
  },
  pro: {
    month: process.env.POLAR_PRO_MONTHLY_PRODUCT_ID || "",
    year: process.env.POLAR_PRO_YEARLY_PRODUCT_ID || "",
  },
};

export function getProductId(tier: PlanTier, interval: BillingInterval): string | null {
  return PRODUCT_IDS[tier][interval] || null;
}

/**
 * Reverse lookup — given a Polar product ID returned by a webhook,
 * which (tier, interval) does it represent? Returns null if the ID
 * doesn't match anything we configured.
 */
export function findTierByProductId(
  productId: string,
): { tier: PlanTier; interval: BillingInterval } | null {
  for (const tier of Object.keys(PRODUCT_IDS) as PlanTier[]) {
    for (const interval of ["month", "year"] as BillingInterval[]) {
      if (PRODUCT_IDS[tier][interval] === productId) return { tier, interval };
    }
  }
  return null;
}

export function isPolarConfigured(): boolean {
  // Pro monthly is the minimum a working setup needs.
  return !!polar && !!PRODUCT_IDS.pro.month;
}
