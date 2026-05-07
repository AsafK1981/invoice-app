/**
 * Pricing plans for MySuperFriendlyInvoiceApp.
 *
 * Two tiers (Option A from competitor research):
 *   - Basic: ₪19/mo  ·  30 docs · 1 business · 10 clients
 *   - Pro:   ₪29/mo  ·  unlimited everything
 *
 * Annual prices are 20% off (industry standard — Greeninvoice, Invoice4U,
 * Rivhit all do roughly the same).
 *
 * Trial: 14 days, no credit card required. Long enough to feel out the
 * product, short enough that people decide instead of forgetting (longer
 * trials like Invoice4U's 60 days train people to never pay).
 *
 * Internal tier IDs are kept as "free" | "pro" for backwards compatibility
 * with existing users' `plan_tier` metadata. The displayed name on the
 * "free" tier is "בסיסי" — when Stripe is configured, that tier is no
 * longer free; until then the access enforcement still treats anyone
 * without a paid subscription as a beta user.
 */

export type PlanTier = "free" | "pro";

export interface Plan {
  tier: PlanTier;
  name: string;
  /** ₪ per month, NIS, displayed value */
  priceMonthly: number;
  /** ₪ per year, NIS — typically priceMonthly * 12 * 0.8 (20% off) */
  priceYearly: number;
  description: string;
  features: string[];
  limits: {
    documentsPerMonth: number | null;
    clients: number | null;
    products: number | null;
    customGmail: boolean;
    csvImport: boolean;
    csvExport: boolean;
    charts: boolean;
    customLogo: boolean;
    multipleEmailRecipients: boolean;
  };
}

/** Free trial length in days (applied via Stripe `trial_period_days`). */
export const TRIAL_DAYS = 14;

export const PLANS: Record<PlanTier, Plan> = {
  free: {
    tier: "free",
    name: "בסיסי",
    priceMonthly: 19,
    priceYearly: 182, // 19 * 12 * 0.8 = 182.4, rounded down
    description: "מתאים לעצמאיים בתחילת הדרך",
    features: [
      "עד 30 מסמכים בחודש",
      "עד 10 לקוחות",
      "שליחת מסמכים במייל (דרך המערכת)",
      "PDF להדפסה והורדה",
      "גיבוי ענן אוטומטי",
    ],
    limits: {
      documentsPerMonth: 30,
      clients: 10,
      products: 20,
      customGmail: false,
      csvImport: false,
      csvExport: false,
      charts: false,
      customLogo: false,
      multipleEmailRecipients: false,
    },
  },
  pro: {
    tier: "pro",
    name: "Pro",
    priceMonthly: 29,
    priceYearly: 278, // 29 * 12 * 0.8 = 278.4, rounded down
    description: "ללא הגבלות, לעסקים פעילים",
    features: [
      "מסמכים ולקוחות ללא הגבלה",
      "ריבוי עסקים תחת אותו חשבון",
      "שליחה מ-Gmail האישי שלך",
      "ייבוא וייצוא לאקסל / CSV",
      "דשבורד עם גרפים מלאים",
      "לוגו עסקי על מסמכים",
      "כמה אימיילים לכל לקוח",
    ],
    limits: {
      documentsPerMonth: null,
      clients: null,
      products: null,
      customGmail: true,
      csvImport: true,
      csvExport: true,
      charts: true,
      customLogo: true,
      multipleEmailRecipients: true,
    },
  },
};

export function getPlan(tier: PlanTier | undefined | null): Plan {
  return PLANS[tier ?? "free"];
}

export type BillingInterval = "month" | "year";

export interface PlanStatus {
  tier: PlanTier;
  active: boolean;
  trialing?: boolean;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
}

export function getPlanStatus(userMetadata: Record<string, unknown> | undefined): PlanStatus {
  const tier = (userMetadata?.plan_tier as PlanTier) || "free";
  // For the beta period (before Stripe is wired), users without a paid
  // subscription are still treated as active so nobody loses access.
  // Once Stripe is fully configured this becomes:
  //   active: userMetadata?.plan_active === true
  return {
    tier,
    active: tier === "free" || userMetadata?.plan_active === true,
    trialing: userMetadata?.plan_trialing === true,
    cancelAtPeriodEnd: userMetadata?.plan_cancel_at_period_end === true,
    currentPeriodEnd: userMetadata?.plan_current_period_end as string | undefined,
    stripeSubscriptionId: userMetadata?.stripe_subscription_id as string | undefined,
    stripeCustomerId: userMetadata?.stripe_customer_id as string | undefined,
  };
}
