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
const id = process.argv[2] || "5e63db32-5d64-4096-9a7a-6f5389106f23";

const { data, error } = await sb.from("documents").select("*").eq("id", id).single();
if (error) {
  console.error(error);
  process.exit(1);
}
console.log("columns:", Object.keys(data).join(", "));
console.log("---");
console.log(JSON.stringify(data, null, 2));
