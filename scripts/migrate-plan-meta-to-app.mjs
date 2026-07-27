#!/usr/bin/env node
/**
 * Migration: move plan_* / polar_* fields from user_metadata (user-writable)
 * to app_metadata (admin-only).
 *
 * Background: until 2026-05-11 we stored plan_tier, plan_active,
 * polar_customer_id etc. in user_metadata. Supabase users can update
 * their own user_metadata via supabase.auth.updateUser({ data: ... }),
 * which means anyone could grant themselves Pro for free by editing
 * those fields from the browser console.
 *
 * Fix: write plan state to app_metadata (only the service role can
 * touch this). This script copies any existing values across so no
 * existing user loses their state during the cut-over.
 *
 * Idempotent, safe to run multiple times. Does not delete the
 * user_metadata values (they stay as a read-only fallback for the
 * transition window) but they are no longer trusted.
 *
 * Run: node scripts/migrate-plan-meta-to-app.mjs
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [k, ...rest] = line.split("=");
    if (k) acc[k.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing SUPABASE env vars");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(URL_, KEY);

const PLAN_FIELDS = [
  "plan_tier",
  "plan_active",
  "plan_trialing",
  "plan_trial_used",
  "plan_cancel_at_period_end",
  "plan_current_period_end",
  "plan_beta_grant",
  "plan_invite_code",
  "polar_subscription_id",
  "polar_customer_id",
  "stripe_subscription_id",
  "stripe_customer_id",
];

let page = 1;
let total = 0;
let migrated = 0;

while (true) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error("listUsers error:", error.message);
    process.exit(1);
  }
  const users = data.users || [];
  if (users.length === 0) break;

  for (const u of users) {
    total++;
    const uMeta = u.user_metadata || {};
    const aMeta = u.app_metadata || {};

    // Identify any plan_* / polar_* / stripe_* fields present in user_metadata
    // but absent in app_metadata.
    const toMigrate = {};
    let anyDelta = false;
    for (const f of PLAN_FIELDS) {
      const inUser = Object.prototype.hasOwnProperty.call(uMeta, f);
      const inApp = Object.prototype.hasOwnProperty.call(aMeta, f);
      if (inUser && !inApp) {
        toMigrate[f] = uMeta[f];
        anyDelta = true;
      }
    }

    if (!anyDelta) continue;

    const merged = { ...aMeta, ...toMigrate };
    const { error: upErr } = await sb.auth.admin.updateUserById(u.id, {
      app_metadata: merged,
    });
    if (upErr) {
      console.error("  fail", u.email, upErr.message);
      continue;
    }
    migrated++;
    console.log(
      "  ok",
      u.email,
      "moved fields:",
      Object.keys(toMigrate).join(", "),
    );
  }

  if (users.length < 200) break;
  page++;
}

console.log(`\nDone. Scanned ${total} users, migrated ${migrated}.`);
