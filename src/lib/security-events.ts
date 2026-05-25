/**
 * Security-event emitter — sends typed events to Sentry with tags that
 * the Sentry dashboard can fan out into alerts (email / Slack).
 *
 * Info-security appendix §20 requires real-time alerting on attack
 * attempts. We tag every event with `security: true` so a single
 * "security" Sentry alert rule catches the whole class.
 *
 * Alert rules to configure in Sentry UI (one-time, on the project):
 *   1. Issue level: Error
 *      Condition: event.tags["security"] is "true"
 *      Action:    Email asafkotlar@gmail.com immediately
 *   2. Issue level: Warning, frequency
 *      Condition: tag["security_event"] is "auth_failed_burst"
 *      Frequency: more than 10 in 5 minutes
 *      Action:    Email asafkotlar@gmail.com
 */

import * as Sentry from "@sentry/nextjs";

export type SecurityEventKind =
  | "auth_failed"              // user/password mismatch, rate-limit hit
  | "auth_failed_burst"        // >5 failures from one IP in 1 min
  | "duplicate_signup_attempt" // same email signs up twice
  | "tax_authority_token_invalid"     // OAuth token rejected by gov.il
  | "tax_authority_unauthorized"      // bearer-token check failed on our route
  | "tax_authority_token_decrypt_failed" // encryption key wrong / DB tampered
  | "uniform_structure_export_burst"  // someone hammering the export route
  | "admin_action"             // admin-API hit (should be very rare)
  | "rls_anomaly"              // RLS check ran but returned unexpected shape
  | "unauthorized_api_access";        // any Bearer token check that failed

export interface SecurityEvent {
  kind: SecurityEventKind;
  ip?: string;
  userId?: string;
  businessId?: string;
  /** Free-form details — kept short, must NOT contain tokens/passwords. */
  message: string;
  /** Severity hint to Sentry. "error" pages; "warning" emails on threshold. */
  severity?: "error" | "warning" | "info";
  extra?: Record<string, string | number | boolean | null>;
}

export function emitSecurityEvent(ev: SecurityEvent): void {
  const severity = ev.severity ?? "warning";
  try {
    Sentry.withScope((scope) => {
      scope.setTag("security", "true");
      scope.setTag("security_event", ev.kind);
      if (ev.ip) scope.setTag("ip", ev.ip);
      if (ev.userId) scope.setUser({ id: ev.userId });
      if (ev.businessId) scope.setTag("business_id", ev.businessId);
      if (ev.extra) {
        for (const [k, v] of Object.entries(ev.extra)) {
          scope.setExtra(k, v);
        }
      }
      scope.setLevel(severity);
      Sentry.captureMessage(`security:${ev.kind} ${ev.message}`, severity);
    });
  } catch {
    // Sentry failures must never crash the request — security logging
    // is best-effort.
  }
  // Always mirror to console so it shows up in Vercel logs (which we
  // ship long-term per §19).
  console.warn(
    `[security] ${ev.kind} ${ev.message}`,
    { ip: ev.ip, userId: ev.userId, businessId: ev.businessId, extra: ev.extra },
  );
}
