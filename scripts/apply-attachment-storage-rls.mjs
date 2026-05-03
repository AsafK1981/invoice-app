import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [k, ...rest] = line.split("=");
    if (k) acc[k.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const sql = `
DROP POLICY IF EXISTS "Users can read own document attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own document attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own document attachments" ON storage.objects;

CREATE POLICY "Users can read own document attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'document-attachments'
    AND (substring(name FROM '^([^/]+)'))::uuid IN (
      SELECT d.id FROM documents d
      JOIN businesses b ON b.id = d.business_id
      WHERE b.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can upload own document attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document-attachments'
    AND (substring(name FROM '^([^/]+)'))::uuid IN (
      SELECT d.id FROM documents d
      JOIN businesses b ON b.id = d.business_id
      WHERE b.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own document attachments" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'document-attachments'
    AND (substring(name FROM '^([^/]+)'))::uuid IN (
      SELECT d.id FROM documents d
      JOIN businesses b ON b.id = d.business_id
      WHERE b.user_id = auth.uid()
    )
  );
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
