import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = secretKey
  ? new Stripe(secretKey, { typescript: true })
  : null;

export const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || "";

export function isStripeConfigured(): boolean {
  return !!secretKey && !!STRIPE_PRO_PRICE_ID;
}
