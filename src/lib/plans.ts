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
  subscriptionId?: string;
  customerId?: string;
  /** True if this user got their access via a beta invite, not a paid Polar sub. */
  betaGrant?: boolean;
  /** Invite code they redeemed, if any. */
  betaInviteCode?: string;
  /** Days remaining until grant or subscription period ends. Negative = expired. Null = no end date set. */
  daysRemaining?: number | null;
  /** True if the user's beta grant expired — they revert to the free tier with basic limits. */
  betaExpired?: boolean;
}

export function getPlanStatus(userMetadata: Record<string, unknown> | undefined): PlanStatus {
  const rawTier = (userMetadata?.plan_tier as PlanTier) || "free";
  const isBetaGrant = userMetadata?.plan_beta_grant === true;
  const periodEnd = userMetadata?.plan_current_period_end as string | undefined;
  const periodEndMs = periodEnd ? new Date(periodEnd).getTime() : null;
  const now = Date.now();

  // A beta grant that's past its end date should NOT keep granting Pro
  // access. We treat the user as free-tier with basic limits — friendly
  // degradation rather than a hard lockout (so they can still see their
  // historical data and decide whether to subscribe).
  const betaExpired = isBetaGrant && periodEndMs !== null && periodEndMs < now;

  const effectiveTier: PlanTier = betaExpired ? "free" : rawTier;
  const isActive =
    !betaExpired &&
    (effectiveTier === "free" || userMetadata?.plan_active === true);

  const daysRemaining =
    periodEndMs !== null ? Math.ceil((periodEndMs - now) / (24 * 60 * 60 * 1000)) : null;

  return {
    tier: effectiveTier,
    active: isActive,
    trialing: userMetadata?.plan_trialing === true,
    cancelAtPeriodEnd: userMetadata?.plan_cancel_at_period_end === true,
    currentPeriodEnd: periodEnd,
    subscriptionId:
      (userMetadata?.polar_subscription_id as string | undefined) ||
      (userMetadata?.stripe_subscription_id as string | undefined),
    customerId:
      (userMetadata?.polar_customer_id as string | undefined) ||
      (userMetadata?.stripe_customer_id as string | undefined),
    betaGrant: isBetaGrant && !betaExpired,
    betaInviteCode: userMetadata?.plan_invite_code as string | undefined,
    daysRemaining,
    betaExpired,
  };
}
