export type PlanTier = "free" | "pro";

export interface Plan {
  tier: PlanTier;
  name: string;
  priceMonthly: number;
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

export const PLANS: Record<PlanTier, Plan> = {
  free: {
    tier: "free",
    name: "חינם",
    priceMonthly: 0,
    description: "מתאים לעצמאיים בתחילת הדרך",
    features: [
      "עד 5 מסמכים בחודש",
      "עד 3 לקוחות",
      "שליחת מסמכים במייל (דרך המערכת)",
      "PDF להדפסה והורדה",
      "עברית מלאה ו-RTL",
    ],
    limits: {
      documentsPerMonth: 5,
      clients: 3,
      products: 5,
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
    description: "ללא הגבלות, לעסקים פעילים",
    features: [
      "מסמכים ולקוחות ללא הגבלה",
      "שליחה מ-Gmail האישי שלך",
      "ייבוא וייצוא לאקסל / CSV",
      "דשבורד עם גרפים מלאים",
      "לוגו עסקי על מסמכים",
      "כמה אימיילים לכל לקוח",
      "תמיכה לעוסק פטור ועוסק מורשה",
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

export interface PlanStatus {
  tier: PlanTier;
  active: boolean;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
}

export function getPlanStatus(userMetadata: Record<string, unknown> | undefined): PlanStatus {
  const tier = (userMetadata?.plan_tier as PlanTier) || "free";
  return {
    tier,
    active: tier === "free" || userMetadata?.plan_active === true,
    cancelAtPeriodEnd: userMetadata?.plan_cancel_at_period_end === true,
    currentPeriodEnd: userMetadata?.plan_current_period_end as string | undefined,
    stripeSubscriptionId: userMetadata?.stripe_subscription_id as string | undefined,
    stripeCustomerId: userMetadata?.stripe_customer_id as string | undefined,
  };
}
