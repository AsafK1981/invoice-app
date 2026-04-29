import { supabase } from "./admin.mjs";

// Delete the empty test quote (total=0, garbled subject) on Asaf's Google account
const { data: docs } = await supabase
  .from("documents")
  .select("id, number, client_name, subject, total")
  .eq("type", "quote")
  .eq("status", "sent")
  .eq("total", 0);

if (!docs || docs.length === 0) {
  console.log("No empty quotes found.");
  process.exit(0);
}

console.log(`Found ${docs.length} empty quote(s):`);
docs.forEach((d) => {
  console.log(`  #${d.number} ${d.client_name} subject="${d.subject || ""}"`);
});

const ids = docs.map((d) => d.id);
await supabase.from("document_items").delete().in("document_id", ids);
const { error } = await supabase.from("documents").delete().in("id", ids);

if (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
console.log(`✓ Deleted ${ids.length} empty quote(s)`);
