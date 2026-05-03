import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [k, ...rest] = line.split("=");
    if (k) acc[k.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const sql = `
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  target_label text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_business_id_created_at_idx
  ON audit_log(business_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own audit log" ON audit_log;
DROP POLICY IF EXISTS "Users can insert own audit log" ON audit_log;

CREATE POLICY "Users can view own audit log" ON audit_log
  FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT id FROM businesses WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own audit log" ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (
    SELECT id FROM businesses WHERE user_id = auth.uid()
  ));
`;

const res = await fetch(
  `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  }
);
console.log("Result:", JSON.stringify(await res.json()).slice(0, 300));
