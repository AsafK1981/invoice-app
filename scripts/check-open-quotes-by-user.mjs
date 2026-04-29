import { supabase } from "./admin.mjs";

const { data: businesses } = await supabase
  .from("businesses")
  .select("id, name, user_id");

for (const biz of businesses) {
  const { data } = await supabase
    .from("documents")
    .select("id, type, number, status, date, client_name, subject, total")
    .eq("business_id", biz.id)
    .eq("type", "quote")
    .eq("status", "sent");

  if (data && data.length > 0) {
    console.log(`\nBusiness ${biz.name} (${biz.id}, user ${biz.user_id}):`);
    data.forEach((d) => {
      console.log(`  #${d.number} ${d.client_name} ${d.date} total=${d.total} subject="${d.subject || ""}"`);
    });
  }
}
