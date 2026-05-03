import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .reduce((a, l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) a[m[1]] = m[2];
    return a;
  }, {});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
for (const t of ["businesses", "clients", "documents", "document_items", "expenses", "products", "audit_log"]) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
  console.log(t.padEnd(16), error ? `ERR: ${error.message}` : count);
}
const { data: docs } = await sb
  .from("documents")
  .select("type,number,date,client_name,total")
  .order("date", { ascending: false });
console.log("\nAll documents:");
for (const d of docs || []) {
  console.log(`  ${d.date} | #${d.number} ${d.type.padEnd(20)} | ₪${d.total}  ${d.client_name}`);
}
