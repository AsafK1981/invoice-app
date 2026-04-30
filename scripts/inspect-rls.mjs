import { supabase } from "./admin.mjs";

const { data, error } = await supabase.rpc("exec_sql_safe_for_admin_only", {
  sql: "SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr, pg_get_expr(polwithcheck, polrelid) AS check_expr FROM pg_policy WHERE polrelid = 'public.document_counters'::regclass;"
}).catch(() => ({ data: null, error: { message: "no rpc" } }));

console.log("RLS via RPC:", data, error);

// Try a direct SELECT through service role to inspect via meta API
const r = await fetch(`${process.env.SUPABASE_URL || ""}`, {});
console.log(r);
