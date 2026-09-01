/**
 * The service-role client every ad-hoc script imports.
 *
 *   import { supabase } from "./admin.mjs";
 *
 * Since 2026-08-31 importing this module is itself a gated action. It bypasses
 * RLS, so a script that imports it can read every tenant's data at once, and
 * until now nothing recorded that this ever happened. Two things now do:
 *
 *   1. A reason is mandatory. Run with --reason "תמיכה: <תיאור>" (or set
 *      ADMIN_REASON). No reason, no client: the process exits 1 before a
 *      connection is opened.
 *   2. One row lands in admin_access_log with the script name, the argv and
 *      the reason. Warn-and-continue if the write fails, so a missing table
 *      never blocks operational work.
 *
 * The gate runs at import time on purpose: existing scripts import a ready-made
 * `supabase` binding at the top of the file, and a gate they had to remember to
 * call would be a gate that half of them skip.
 *
 * FOR AUTOMATION (cron, GitHub Actions, anything unattended) import
 * ./admin-unattended.mjs instead. A scheduled job has no human to state a
 * reason, and a nightly backup that exits 1 at 03:00 is worse than an
 * unattended-tagged log row.
 */
import { resolveAdminReason } from "./lib/admin-reason.mjs";
import { createServiceClient, entryScriptName, logScriptAccess } from "./lib/admin-core.mjs";

const gate = resolveAdminReason(process.argv.slice(2), process.env);
if (!gate.ok) {
  console.error(gate.message);
  process.exit(1);
}

const supabase = createServiceClient();

await logScriptAccess(supabase, {
  channel: "script",
  action: entryScriptName(),
  reason: gate.reason,
  argv: gate.rest,
});

export { supabase };
/** The reason this run stated, in case a script wants to echo or reuse it. */
export const adminReason = gate.reason;
