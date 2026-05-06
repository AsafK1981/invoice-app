/**
 * Admin gate. The "/admin" route + the admin stats API are gated to
 * a hardcoded list of email addresses. To grant another person admin
 * access, add their email here and ship.
 *
 * This is deliberate: a database-driven role table would be more
 * flexible but adds attack surface (compromise the DB, become admin).
 * Hardcoding to source-control means the only way to add an admin is
 * a code change reviewed in git.
 */

const ADMIN_EMAILS = new Set<string>(["asafkotlar@gmail.com"]);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase().trim());
}
