import { supabase } from "./admin.mjs";

const { data: counters } = await supabase.from("document_counters").select("*").limit(10);
console.log("document_counters sample:", JSON.stringify(counters, null, 2));

const { data: docs } = await supabase.from("documents").select("*").limit(1);
if (docs?.[0]) console.log("document columns:", Object.keys(docs[0]));

const { data: business } = await supabase.from("businesses").select("*").limit(1);
if (business?.[0]) console.log("business columns:", Object.keys(business[0]));

// Check if there's a settings table
const { data: settings, error: settingsErr } = await supabase.from("business_settings").select("*").limit(1);
console.log("business_settings:", settings, "err:", settingsErr?.message);
