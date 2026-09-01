import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Operator access journal (table `admin_access_log`, migration
 * scripts/migrations/20260831-admin-access-log.sql).
 *
 * `audit_log` answers "what did this user do in their own account". This
 * answers the question no table answered before: "when did the operator reach
 * across tenants, through which door, and why". Every route under
 * /api/admin/* calls this right after its admin check passes.
 *
 * Two rules hold this together:
 *
 *  1. Metadata only. `detail` may carry a reason, a route, counts, argv - never
 *    a client name, document subject, or amount. The whole point of the change
 *    this file belongs to is that the operator stops touching tenant content,
 *    so the journal must not become the place that content collects.
 *
 *  2. Logging never breaks the caller. A failed insert is warned about and
 *    swallowed. A missing table (a fresh local DB, a migration not yet applied)
 *    must not 500 the admin dashboard, and losing an audit row is strictly less
 *    bad than losing the ability to run the platform.
 */

export type AdminAccessChannel = "admin_ui" | "admin_api" | "script" | "sql";

export interface AdminAccessEntry {
  /** Signed-in admin's email, or a stable CLI identity for scripts. */
  actor: string;
  channel: AdminAccessChannel;
  /** Route + method for admin_api, script basename for script. */
  action: string;
  /** Only when the access targeted one specific tenant. */
  targetUserId?: string | null;
  targetBusinessId?: string | null;
  /** Metadata only, never customer content. */
  detail?: Record<string, unknown> | null;
}

export interface AdminAccessRow {
  actor: string;
  channel: AdminAccessChannel;
  action: string;
  target_user_id: string | null;
  target_business_id: string | null;
  detail: Record<string, unknown> | null;
}

/**
 * Pure mapping from the caller-facing entry to the DB row. Split out from the
 * insert so the payload shape can be asserted in a test without a database.
 */
export function buildAdminAccessRow(entry: AdminAccessEntry): AdminAccessRow {
  return {
    actor: entry.actor || "unknown",
    channel: entry.channel,
    action: entry.action,
    target_user_id: entry.targetUserId ?? null,
    target_business_id: entry.targetBusinessId ?? null,
    detail: entry.detail ?? null,
  };
}

/**
 * Write one operator-access row. Requires a service-role client: the table has
 * RLS on with no policies, so an anon/authenticated client silently writes
 * nothing. Awaited by callers, but never throws.
 */
export async function logAdminAccess(
  sb: SupabaseClient,
  entry: AdminAccessEntry,
): Promise<void> {
  const row = buildAdminAccessRow(entry);
  try {
    const { error } = await sb.from("admin_access_log").insert(row);
    if (error) {
      console.warn(`admin_access_log insert failed (${row.action}): ${error.message}`);
    }
  } catch (err) {
    console.warn(
      `admin_access_log insert threw (${row.action}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
