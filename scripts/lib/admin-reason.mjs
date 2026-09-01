/**
 * Reason gating for service-role scripts.
 *
 * Any script that talks to the database with SUPABASE_SERVICE_ROLE_KEY reads
 * across every tenant at once. Since 2026-08-31 that is only allowed with a
 * stated reason, and the reason is written to `admin_access_log` alongside the
 * script name and its argv.
 *
 * Kept pure and side-effect free (no env file read, no client, no process.exit)
 * so the gate itself is unit-testable: tests/admin-access-log.test.ts imports
 * this module directly. The exiting happens in scripts/admin.mjs, which is the
 * one place that must never be imported from a test.
 */

/** Shown when a script is run without a reason. One line, Hebrew, actionable. */
export const ADMIN_REASON_USAGE =
  'גישת service-role דורשת סיבה: הרץ עם --reason "תמיכה: <תיאור>" או הגדר ADMIN_REASON, כי כל גישה כזו נרשמת ביומן admin_access_log.';

/**
 * @typedef {Object} AdminReasonResult
 * @property {boolean} ok       true when a non-empty reason was supplied
 * @property {string|null} reason
 * @property {string[]} rest    argv with the --reason flag removed, so callers
 *                              can keep parsing their own arguments
 * @property {string|null} message  the error to print when ok is false
 */

/**
 * Resolve the operator's stated reason.
 *
 * Accepts `--reason "text"` and `--reason=text`, falling back to the
 * ADMIN_REASON env var (for a wrapper .bat or a one-off shell export).
 * A flag present but empty counts as absent: `--reason ""` should not buy
 * a pass that `--reason` alone would not.
 *
 * @param {string[]} argv  usually process.argv.slice(2)
 * @param {Record<string, string|undefined>} env  usually process.env
 * @returns {AdminReasonResult}
 */
export function resolveAdminReason(argv = [], env = {}) {
  const rest = [];
  let reason = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reason") {
      // Consume the next token as the value - unless it looks like another
      // long flag. A mistyped `--reason --dry-run` must NOT record
      // "--dry-run" as the reason while silently eating the safety flag
      // (GPT council seat, 2026-08-31). A reason that genuinely starts with
      // "--" can still be given as --reason="--whatever".
      const next = String(argv[i + 1] ?? "").trim();
      if (next.startsWith("--")) continue;
      reason = next;
      i++;
      continue;
    }
    if (arg.startsWith("--reason=")) {
      reason = arg.slice("--reason=".length).trim();
      continue;
    }
    rest.push(arg);
  }

  if (!reason) reason = String(env.ADMIN_REASON ?? "").trim();

  if (!reason) {
    return { ok: false, reason: null, rest, message: ADMIN_REASON_USAGE };
  }
  return { ok: true, reason, rest, message: null };
}
