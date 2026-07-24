/**
 * Pricing plans for MySuperFriendlyInvoiceApp.
 *
 * Two tiers (Option A from competitor research):
 *   - Basic: ₪15/mo  (₪149/yr)  ·  30 docs · 1 business · 10 clients
 *   - Pro:   ₪25/mo  (₪250/yr)  ·  unlimited everything
 *
 * Annual prices are chosen round-ish numbers below 12× the monthly rate,
 * landing at roughly a ~17% discount (Basic: ₪149 vs ₪180 = ~17% off;
 * Pro: ₪250 vs ₪300 = ~17% off) — in line with what Greeninvoice,
 * Invoice4U and Rivhit offer on annual billing.
 *
 * Trial: 30 days, no credit card required. Long enough to feel out the
 * product, short enough that people decide instead of forgetting (longer
 * trials like Invoice4U's 60 days train people to never pay).
 *
 * Internal tier IDs are kept as "free" | "pro" for backwards compatibility
 * with existing users' `plan_tier` metadata. The displayed name on the
 * "free" tier is "בסיסי" — once a payment provider is wired up, that
 * tier is no longer free; until then the access enforcement still treats
 * anyone without a paid subscription as a beta user.
 */

export type PlanTier = "free" | "pro";

export interface Plan {
  tier: PlanTier;
  name: string;
  /** ₪ per month, NIS, displayed value */
  priceMonthly: number;
  /** ₪ per year, NIS — a chosen round-ish price below 12× monthly (~17% off) */
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

/** Free trial length in days (applied via the payment provider's trial period). */
export const TRIAL_DAYS = 30;

export const PLANS: Record<PlanTier, Plan> = {
  free: {
    tier: "free",
    name: "בסיסי",
    priceMonthly: 15,
    priceYearly: 149, // chosen annual price (~17% below 15 * 12 = 180)
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
    priceMonthly: 25,
    priceYearly: 250, // chosen annual price (~17% below 25 * 12 = 300)
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
  /** Which processor backs this subscription. Provider-agnostic so a new
   * processor can be added without another refactor. */
  paymentProvider?: "grow" | "polar" | "stripe";
  /** True if this user got their access via a beta invite, not a paid Polar sub. */
  betaGrant?: boolean;
  /** Invite code they redeemed, if any. */
  betaInviteCode?: string;
  /** Days remaining until grant or subscription period ends. Negative = expired. Null = no end date set. */
  daysRemaining?: number | null;
  /** True if the user's beta grant expired — they revert to the free tier with basic limits. */
  betaExpired?: boolean;
}

/**
 * Source of truth for plan status.
 *
 * **Security:** `app_metadata` (admin/service-role only) takes precedence
 * over `user_metadata` (user-writable). Supabase users can update their
 * own `user_metadata` directly from a browser console — they cannot
 * touch `app_metadata`. So we always write plan_* into `app_metadata`,
 * and we read from `app_metadata` first.
 *
 * We still merge `user_metadata` as a fallback so any users whose plan
 * fields haven't been migrated yet aren't suddenly logged out — but
 * `app_metadata` overrides anything they might have placed in
 * `user_metadata` themselves.
 */
export function getPlanStatus(
  user:
    | {
        user_metadata?: Record<string, unknown> | null;
        app_metadata?: Record<string, unknown> | null;
      }
    | null
    | undefined,
): PlanStatus {
  // Merge with app_metadata winning on key conflict. user_metadata is
  // kept only as a fallback for users predating the migration.
  const meta: Record<string, unknown> = {
    ...(user?.user_metadata || {}),
    ...(user?.app_metadata || {}),
  };

  const rawTier = (meta.plan_tier as PlanTier) || "free";
  const isBetaGrant = meta.plan_beta_grant === true;
  const periodEnd = meta.plan_current_period_end as string | undefined;
  const periodEndMs = periodEnd ? new Date(periodEnd).getTime() : null;
  const now = Date.now();

  // A beta grant that's past its end date should NOT keep granting Pro
  // access. We treat the user as free-tier with basic limits — friendly
  // degradation rather than a hard lockout (so they can still see their
  // historical data and decide whether to subscribe).
  const betaExpired = isBetaGrant && periodEndMs !== null && periodEndMs < now;

  const effectiveTier: PlanTier = betaExpired ? "free" : rawTier;
  const isActive =
    !betaExpired && (effectiveTier === "free" || meta.plan_active === true);

  const daysRemaining =
    periodEndMs !== null ? Math.ceil((periodEndMs - now) / (24 * 60 * 60 * 1000)) : null;

  return {
    tier: effectiveTier,
    active: isActive,
    trialing: meta.plan_trialing === true,
    cancelAtPeriodEnd: meta.plan_cancel_at_period_end === true,
    currentPeriodEnd: periodEnd,
    subscriptionId:
      (meta.provider_subscription_id as string | undefined) ||
      (meta.polar_subscription_id as string | undefined) ||
      (meta.stripe_subscription_id as string | undefined),
    customerId:
      (meta.provider_customer_id as string | undefined) ||
      (meta.polar_customer_id as string | undefined) ||
      (meta.stripe_customer_id as string | undefined),
    paymentProvider:
      (meta.payment_provider as "grow" | "polar" | "stripe" | undefined) ||
      (meta.polar_subscription_id ? "polar" : undefined),
    betaGrant: isBetaGrant && !betaExpired,
    betaInviteCode: meta.plan_invite_code as string | undefined,
    daysRemaining,
    betaExpired,
  };
}
