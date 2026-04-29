import { supabase } from "./admin.mjs";

const { data } = await supabase
  .from("documents")
  .select("id, type, number, status, date, client_name, subject, total")
  .eq("type", "quote")
  .eq("status", "sent");

console.log(`Found ${data?.length || 0} open quotes:`);
data?.forEach((d) => {
  console.log(`  #${d.number} ${d.client_name} ${d.date} total=${d.total} subject="${d.subject || ""}"`);
});
