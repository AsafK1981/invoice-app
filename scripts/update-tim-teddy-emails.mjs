import { supabase } from "./admin.mjs";

const { data, error } = await supabase
  .from("clients")
  .update({
    email: "avi@myteam.co.il, amit@myteam.co.il",
    notes: "מס׳ לקוח חיצוני: 5285819 | תנאי תשלום: שוטף+30",
  })
  .eq("name", 'טים טדי בע"מ')
  .select();

if (error) {
  console.error("Error:", error);
  process.exit(1);
}

console.log(`Updated ${data.length} client record(s) with both emails`);
data.forEach((c) => console.log(`  - ${c.name}: ${c.email}`));
