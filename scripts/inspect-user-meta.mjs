import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .reduce((a, l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) a[m[1]] = m[2];
    return a;
  }, {});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = process.argv[2] || "asafkotlar@gmail.com";
const { data, error } = await sb.auth.admin.listUsers();
if (error) { console.error(error); process.exit(1); }
const u = data.users.find((x) => x.email === email);
if (!u) { console.error("user not found"); process.exit(1); }
console.log("id:", u.id);
console.log("email:", u.email);
console.log("user_metadata:");
const meta = u.user_metadata || {};
for (const [k, v] of Object.entries(meta)) {
  if (k.includes("password")) console.log("  " + k + ":", v ? "<set len=" + String(v).length + ">" : "(empty)");
  else console.log("  " + k + ":", v);
}
