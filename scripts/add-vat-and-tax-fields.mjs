import { supabase } from "./admin.mjs";

// Try to detect what columns exist by selecting them
const { error } = await supabase.from("businesses").select("vat_rate").limit(1);

if (error && error.code === "42703") {
  console.log("\n=== ALTER TABLE NEEDED ===");
  console.log("Run this SQL in Supabase SQL Editor:");
  console.log(`
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(4,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_authority_api_key TEXT,
  ADD COLUMN IF NOT EXISTS tax_authority_cert_path TEXT;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS allocation_number TEXT;
`);
  process.exit(1);
}

console.log("Columns already exist or accessible.");
