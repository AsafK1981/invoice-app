import { normalizeReferralSlug } from "./attribution";

/**
 * Joining the in-app accountant directory from the form on /accountants.
 *
 * The first FOUNDING_SLOTS accountants are listed right away as founding
 * partners, without waiting for a first referred client (Asaf, 2026-09-30:
 * "appear in the list once a client of yours signs up" was too far away to
 * move anyone). After that the directory order is still earned: most ACTIVE
 * referred clients first (see rankPartnerAccountants). Who is a founding
 * partner is decided when the operator lists them (`founding: true` in
 * PARTNER_ACCOUNTANTS), never by a counter over unreviewed submissions.
 *
 * Pure validation lives here so the route and the tests share it. Every limit
 * mirrors a CHECK on public.partner_applications.
 */
export const FOUNDING_SLOTS = 10;

export interface PartnerApplication {
  name: string;
  office: string | null;
  city: string;
  email: string;
  phone: string | null;
  website: string | null;
  ref: string | null;
}

export type PartnerApplicationResult =
  | { ok: true; value: PartnerApplication }
  | { ok: false; error: string };

// Same strict shape the portal uses: no `%` / `_`, which are SQL wildcards.
const EMAIL_RE = /^[a-zA-Z0-9.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_RE = /^[0-9+\-\s()]{7,30}$/;
const SITE_RE = /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max + 1) : "";
}

/** Length the way Postgres char_length counts it: code points, not UTF-16 units. */
function chars(value: string): number {
  return Array.from(value).length;
}

export function validatePartnerApplication(raw: unknown): PartnerApplicationResult {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // Honeypot: a field no person sees. A filled one is a bot; answer like any
  // other invalid form so it learns nothing.
  if (text(body.company, 200)) return { ok: false, error: "הטופס לא נשלח. נסו שוב." };

  if (body.consent !== true) {
    return { ok: false, error: "צריך לאשר את פרסום הפרטים ברשימה" };
  }

  const name = text(body.name, 80);
  if (chars(name) < 2 || name.length > 80) return { ok: false, error: "נא למלא שם מלא" };

  const city = text(body.city, 60);
  if (chars(city) < 2 || city.length > 60) return { ok: false, error: "נא למלא עיר" };

  const email = text(body.email, 160).toLowerCase();
  if (email.length > 160 || !EMAIL_RE.test(email)) return { ok: false, error: "כתובת המייל לא תקינה" };

  const office = text(body.office, 100);
  if (office.length > 100) return { ok: false, error: "שם המשרד ארוך מדי" };

  const phone = text(body.phone, 30);
  if (phone && !PHONE_RE.test(phone)) return { ok: false, error: "מספר הטלפון לא תקין" };

  let website = text(body.website, 200);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && (website.length > 200 || !SITE_RE.test(website))) {
    return { ok: false, error: "כתובת האתר לא תקינה" };
  }

  return {
    ok: true,
    value: {
      name,
      office: office || null,
      city,
      email,
      phone: phone || null,
      website: website || null,
      ref: normalizeReferralSlug(typeof body.ref === "string" ? body.ref : null),
    },
  };
}
