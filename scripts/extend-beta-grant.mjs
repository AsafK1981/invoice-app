#!/usr/bin/env node
/**
 * Extend (or grant) a beta Pro grant for one user by email.
 *
 *   node scripts/extend-beta-grant.mjs <email> <YYYY-MM-DD>
 *
 * Sets app_metadata: plan_tier=pro, plan_active=true, plan_beta_grant=true,
 * plan_current_period_end=<date>. Keeps every other app_metadata key.
 * Also bumps beta_invite_redemptions.expires_at for that user if a row exists,
 * so the invite ledger agrees with the grant. Uses the service role via .env.local.
 *
 * First use 2026-08-17: Asaf's father (vardakot@gmail.com) - beta grant had
 * expired 2026-08-11 and Asaf wants him on all features indefinitely.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const [email, until] = process.argv.slice(2);
if (!email || !/^\d{4}-\d{2}-\d{2}$/.test(until || "")) {
  console.error("usage: node scripts/extend-beta-grant.mjs <email> <YYYY-MM-DD>");
  process.exit(1);
}
const untilIso = new Date(`${until}T23:59:59.000Z`).toISOString();

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw listErr;
const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`no user with email ${email}`);
  process.exit(1);
}
const before = user.app_metadata || {};
const { data, error } = await admin.auth.admin.updateUserById(user.id, {
  app_metadata: {
    ...before,
    plan_tier: "pro",
    plan_active: true,
    plan_beta_grant: true,
    plan_current_period_end: untilIso,
  },
});
if (error) throw error;

const { data: red } = await admin
  .from("beta_invite_redemptions")
  .update({ expires_at: untilIso })
  .eq("user_id", user.id)
  .select("id");

console.log(
  JSON.stringify(
    {
      email,
      userId: user.id,
      before: {
        plan_tier: before.plan_tier,
        plan_active: before.plan_active,
        plan_beta_grant: before.plan_beta_grant,
        plan_current_period_end: before.plan_current_period_end,
      },
      after: {
        plan_tier: data.user.app_metadata.plan_tier,
        plan_active: data.user.app_metadata.plan_active,
        plan_beta_grant: data.user.app_metadata.plan_beta_grant,
        plan_current_period_end: data.user.app_metadata.plan_current_period_end,
      },
      redemptionRowsUpdated: red?.length ?? 0,
    },
    null,
    2,
  ),
);
