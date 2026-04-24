import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [key, ...rest] = line.split("=");
    if (key) acc[key.trim()] = rest.join("=").trim();
    return acc;
  }, {});

// Use Supabase REST directly with service_role to run SQL via pg_meta isn't available
// Instead, we use the PostgREST approach: create the table using a migration through pg
// But we don't have the DB password. Let's use HTTP calls to Supabase Management API...
// Simplest: just call supabase.from().select() to check if table exists, and if not, skip migration
// (handle schema via a different path)

// Actually, for table creation, we need DDL access. Let me try calling rpc.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Check if table exists by trying to query it
const { error } = await supabase.from("user_email_settings").select("*").limit(1);

if (error && error.code === "42P01") {
  console.log("Table does not exist. Create it via Supabase SQL Editor with this SQL:");
  console.log(`
CREATE TABLE user_email_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  provider TEXT NOT NULL DEFAULT 'resend',
  from_email TEXT,
  encrypted_credentials TEXT,
  oauth_refresh_token TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own email settings" ON user_email_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  `);
  process.exit(1);
}

console.log("Table exists:", error ? "has other error: " + error.message : "yes");
