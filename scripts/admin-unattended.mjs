/**
 * The service-role client for scripts nobody is sitting in front of: cron jobs,
 * GitHub Actions, Task Scheduler.
 *
 *   import { adminClientUnattended } from "./admin-unattended.mjs";
 *   const sb = adminClientUnattended("backup-db.mjs");
 *
 * Same logging as scripts/admin.mjs, without the --reason requirement. A
 * scheduled job has no operator to state a reason, and failing a 03:00 backup
 * over a missing CLI flag would trade a real safeguard (off-platform backups)
 * for a paper one. The row is tagged reason 'unattended' so an automated run is
 * never mistaken for a human going looking at customer data.
 *
 * The log write is fire-and-forget by design: returning the client synchronously
 * keeps this a drop-in replacement for `import { supabase }`, and no automation
 * should stall on an audit insert.
 */
import { createServiceClient, entryScriptName, logScriptAccess } from "./lib/admin-core.mjs";

/**
 * @param {string} [scriptName] override for the logged action; defaults to the
 *   entry script's basename, which is right in nearly every case.
 * @returns {import("@supabase/supabase-js").SupabaseClient}
 */
export function adminClientUnattended(scriptName) {
  const sb = createServiceClient();
  void logScriptAccess(sb, {
    channel: "script",
    action: scriptName || entryScriptName(),
    actor: "automation",
    reason: "unattended",
    argv: process.argv.slice(2),
  });
  return sb;
}
