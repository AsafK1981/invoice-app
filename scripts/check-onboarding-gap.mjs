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

const { data: users } = await sb.auth.admin.listUsers({ perPage: 50 });
const { data: businesses } = await sb.from("businesses").select("user_id, name, created_at, business_type, vat_rate");
const { data: docs } = await sb.from("documents").select("user_id, created_at");
const { data: clients } = await sb.from("clients").select("user_id, created_at");
const { data: products } = await sb.from("products").select("user_id, created_at");

const docsByUser = {};
const clientsByUser = {};
const productsByUser = {};
for (const d of docs || []) docsByUser[d.user_id] = (docsByUser[d.user_id] || 0) + 1;
for (const c of clients || []) clientsByUser[c.user_id] = (clientsByUser[c.user_id] || 0) + 1;
for (const p of products || []) productsByUser[p.user_id] = (productsByUser[p.user_id] || 0) + 1;

console.log("\nUser activity:");
console.log("=" .repeat(120));
for (const u of users.users || []) {
  const b = (businesses || []).find((x) => x.user_id === u.id);
  const docCount = docsByUser[u.id] || 0;
  const clientCount = clientsByUser[u.id] || 0;
  const productCount = productsByUser[u.id] || 0;
  const signedUp = new Date(u.created_at).toISOString().slice(0, 10);
  const lastSignIn = u.last_sign_in_at ? new Date(u.last_sign_in_at).toISOString().slice(0, 16) : "never";
  const businessName = b?.name || "no business";
  const businessType = b?.business_type || "?";
  const onboarded = u.user_metadata?.onboarded_at ? "✓" : "✗";
  console.log(
    `${signedUp} | ${u.email?.padEnd(30)} | biz="${businessName}" (${businessType}) | onb:${onboarded} | docs:${docCount} clients:${clientCount} products:${productCount} | last:${lastSignIn}`,
  );
}
