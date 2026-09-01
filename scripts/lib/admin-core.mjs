/**
 * Shared plumbing for the service-role scripts: .env.local loading, the
 * service-role client, and the operator-access log write.
 *
 * Lives here rather than in scripts/admin.mjs because admin.mjs enforces the
 * --reason gate AT IMPORT TIME and exits the process when it is missing.
 * Anything that needs the plumbing without the gate (the unattended path used
 * by cron jobs, scripts/run-sql.mjs, a future test) imports this module.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** Parse .env.local at the repo root into a plain object. */
export function loadEnv() {
  return readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .reduce((acc, line) => {
      const [key, ...rest] = line.split("=");
      if (key) acc[key.trim()] = rest.join("=").trim();
      return acc;
    }, {});
}

/** A service-role client. Bypasses RLS: everything it touches is cross-tenant. */
export function createServiceClient(env = loadEnv()) {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * The name of the script the user actually ran, e.g. "count-data.mjs".
 * process.argv[1] is the entry script, not this module, which is exactly what
 * belongs in the log: "admin.mjs" would be the same for every row.
 */
export function entryScriptName() {
  const entry = process.argv[1];
  return entry ? basename(entry) : "unknown";
}

/**
 * Record one service-role script run in admin_access_log.
 *
 * Never throws and never blocks the script. A missing table (a machine where
 * the migration has not been applied, or run-sql.mjs applying that very
 * migration) must not stop operational work; a warning on stderr is the right
 * failure mode for an audit write that is not the point of the command.
 *
 * argv is stored WITHOUT the --reason flag pair, since the reason is its own
 * column. Only metadata goes in `detail`: never row contents.
 */
export async function logScriptAccess(
  sb,
  { channel = "script", action, actor = "asaf-cli", reason, argv = [], detail = {} } = {},
) {
  try {
    const { error } = await sb.from("admin_access_log").insert({
      actor,
      channel,
      action,
      target_user_id: null,
      target_business_id: null,
      detail: { argv, reason, ...detail },
    });
    if (error) {
      console.warn(`[admin_access_log] לא נרשמה גישה (${action}): ${error.message}`);
    }
  } catch (err) {
    console.warn(
      `[admin_access_log] לא נרשמה גישה (${action}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
