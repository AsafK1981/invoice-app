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

/**
 * Businesses that are OURS, not customers.
 *
 * The GTM north star is "signups who produced a document". Until 2026-07-27
 * the board rendered the raw `businesses` row count under that label, which is
 * a different quantity and included the founder's own account, his father's
 * עוסק מורשה (used for tax-authority testing), a seeded demo and a QA account.
 * That made the single number steering the roadmap self-congratulatory.
 *
 * Kept as an explicit ID list rather than a name regex on purpose: a real
 * customer is entitled to call their business "בדיקה", and a pattern match
 * would silently erase them from the metric.
 */
const INTERNAL_BUSINESS_IDS = new Set([
  "dc3b5b61", // אסף קוטלר - the founder's own business
  "eda11499", // קוטלרסקי ברוך - father's עוסק מורשה, used for tax-authority testing
  "957d0e04", // סטודיו נועה (דמו) - seeded demo account
  "23673f84", // עסק ביקורת בדיקה - QA/audit account
]);

const isInternal = (id) => INTERNAL_BUSINESS_IDS.has(String(id).slice(0, 8));

for (const t of ["businesses", "clients", "documents", "document_items", "expenses", "products", "audit_log"]) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
  console.log(t.padEnd(16), error ? `ERR: ${error.message}` : count);
}

const { data: docs } = await sb
  .from("documents")
  .select("type,number,date,client_name,total,business_id,status")
  .order("date", { ascending: false });

const { data: businesses } = await sb.from("businesses").select("id,name,created_at");

// THE NORTH STAR: distinct businesses that issued a real (non-draft) document,
// excluding our own accounts. Everything else printed here is context.
const realDocs = (docs || []).filter(
  (d) => d.status !== "draft" && !isInternal(d.business_id),
);
const signupsWithDoc = new Set(realDocs.map((d) => d.business_id)).size;

// Printed alongside so the gap between "signed up" and "actually issued
// something" stays visible instead of collapsing into one flattering number.
const externalBusinesses = (businesses || []).filter((b) => !isInternal(b.id)).length;
const anyDocInclInternal = new Set((docs || []).map((d) => d.business_id)).size;

console.log("");
console.log(`signups_with_doc=${signupsWithDoc}`);
console.log(`external_businesses=${externalBusinesses}`);
console.log(`businesses_with_any_doc_incl_internal=${anyDocInclInternal}`);
console.log(`internal_accounts_excluded=${INTERNAL_BUSINESS_IDS.size}`);

console.log("\nPer business:");
for (const b of (businesses || []).sort((x, y) => x.created_at.localeCompare(y.created_at))) {
  const tag = isInternal(b.id) ? "  [internal]" : "";
  const n = (docs || []).filter((d) => d.business_id === b.id).length;
  console.log(
    `  ${b.created_at.slice(0, 10)}  ${String(n).padStart(3)} docs  ${b.name || "(no name)"}${tag}`,
  );
}

console.log("\nAll documents:");
for (const d of docs || []) {
  console.log(`  ${d.date} | #${d.number} ${d.type.padEnd(20)} | ₪${d.total}  ${d.client_name}`);
}
