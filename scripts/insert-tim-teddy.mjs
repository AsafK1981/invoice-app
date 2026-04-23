import { supabase } from "./admin.mjs";

// Get all businesses so we insert for the user's business(es)
const { data: businesses, error: bizError } = await supabase
  .from("businesses")
  .select("id, name, user_id");

if (bizError) {
  console.error("Error fetching businesses:", bizError);
  process.exit(1);
}

console.log(`Found ${businesses.length} businesses`);

const clientData = businesses.map((biz) => ({
  business_id: biz.id,
  name: 'טים טדי בע"מ',
  tax_id: "516933652",
  phone: "0505113322",
  email: "avi@myteam.co.il",
  notes:
    "אימייל נוסף: amit@myteam.co.il | מס׳ לקוח חיצוני: 5285819 | תנאי תשלום: שוטף+30",
}));

const { data, error } = await supabase
  .from("clients")
  .insert(clientData)
  .select();

if (error) {
  console.error("Error inserting client:", error);
  process.exit(1);
}

console.log(`Inserted ${data.length} client record(s):`);
data.forEach((c) => console.log(`  - ${c.name} (business ${c.business_id})`));
