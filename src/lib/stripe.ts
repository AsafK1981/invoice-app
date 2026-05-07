import Stripe from "stripe";
import type { PlanTier, BillingInterval } from "./plans";

const secretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = secretKey
  ? new Stripe(secretKey, { typescript: true })
  : null;

/**
 * Stripe Price IDs, one per (tier, interval) combo. Set in Vercel env:
 *   STRIPE_BASIC_PRICE_ID         — ₪19/mo recurring
 *   STRIPE_BASIC_YEARLY_PRICE_ID  — ₪182/yr recurring
 *   STRIPE_PRO_PRICE_ID           — ₪29/mo recurring
 *   STRIPE_PRO_YEARLY_PRICE_ID    — ₪278/yr recurring
 *
 * Until set, checkout returns 503 "Stripe not configured".
 */
const PRICE_IDS: Record<PlanTier, Record<BillingInterval, string>> = {
  free: {
    month: process.env.STRIPE_BASIC_PRICE_ID || "",
    year: process.env.STRIPE_BASIC_YEARLY_PRICE_ID || "",
  },
  pro: {
    month: process.env.STRIPE_PRO_PRICE_ID || "",
    year: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "",
  },
};

export function getPriceId(tier: PlanTier, interval: BillingInterval): string | null {
  return PRICE_IDS[tier][interval] || null;
}

/**
 * Reverse lookup — given a Stripe price ID coming back from a webhook,
 * which (tier, interval) does it represent?
 */
export function findTierByPriceId(
  priceId: string,
): { tier: PlanTier; interval: BillingInterval } | null {
  for (const tier of Object.keys(PRICE_IDS) as PlanTier[]) {
    for (const interval of ["month", "year"] as BillingInterval[]) {
      if (PRICE_IDS[tier][interval] === priceId) return { tier, interval };
    }
  }
  return null;
}

export function isStripeConfigured(): boolean {
  // Pro is the minimum a working setup needs; basic is a nice-to-have.
  return !!secretKey && !!PRICE_IDS.pro.month;
}

// Legacy export — checkout route still imports this. Points at the Pro
// monthly price ID for backwards compatibility.
export const STRIPE_PRO_PRICE_ID = PRICE_IDS.pro.month;
