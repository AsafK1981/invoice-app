import { supabase } from "./admin.mjs";

// ============ INVOICE4U EXPORT DATA ============
const ACCOUNT = {
  name: "אסף קוטלר",
  taxId: "049040686",
  phone: "0549000684",
  email: "asafkotlar@gmail.com",
  businessType: "exempt",
  address: "",
};

const CUSTOMERS = [
  { name: "סחרך" },
  // Tim Teddy already exists - won't re-add
];

const DOCUMENTS = [
  {
    number: 30036,
    type: "receipt",
    date: "2026-03-31",
    clientName: 'טים טדי בע"מ',
    total: 1550.0,
    description: "שירותים - מרץ 2026",
  },
  {
    number: 30037,
    type: "receipt",
    date: "2026-04-14",
    clientName: 'טים טדי בע"מ',
    total: 6200.0,
    description: "שירותים - אפריל 2026",
  },
];
// ================================================

// Find the Google account user (the one matching user's email)
const { data: usersList, error: usersError } = await supabase.auth.admin.listUsers();
if (usersError) {
  console.error("Error listing users:", usersError);
  process.exit(1);
}

const googleUser = usersList.users.find(
  (u) => u.email === ACCOUNT.email && u.app_metadata?.provider === "google",
);
const primaryUser = googleUser || usersList.users.find((u) => u.email === ACCOUNT.email) || usersList.users[0];

console.log(`Using user: ${primaryUser.email} (${primaryUser.id})`);

// Find that user's business
const { data: business } = await supabase
  .from("businesses")
  .select("*")
  .eq("user_id", primaryUser.id)
  .single();

if (!business) {
  console.error("No business found for user");
  process.exit(1);
}

console.log(`Business: ${business.name} (${business.id})`);

// 1. Update business with real account info
console.log("\n[1/4] Updating business details...");
const { error: bizError } = await supabase
  .from("businesses")
  .update({
    name: ACCOUNT.name,
    tax_id: ACCOUNT.taxId,
    phone: ACCOUNT.phone,
    email: ACCOUNT.email,
    business_type: ACCOUNT.businessType,
  })
  .eq("id", business.id);

if (bizError) console.error("Error:", bizError);
else console.log("  ✓ Business updated");

// 2. Add missing customers (skip if already exists by name)
console.log("\n[2/4] Adding customers...");
const { data: existingClients } = await supabase
  .from("clients")
  .select("name")
  .eq("business_id", business.id);

const existingNames = new Set((existingClients || []).map((c) => c.name));

for (const cust of CUSTOMERS) {
  if (existingNames.has(cust.name)) {
    console.log(`  - ${cust.name}: already exists, skipping`);
    continue;
  }
  const { error } = await supabase.from("clients").insert({
    business_id: business.id,
    name: cust.name,
  });
  if (error) console.error(`  ✗ ${cust.name}:`, error.message);
  else console.log(`  ✓ ${cust.name}: added`);
}

// 3. Import documents
console.log("\n[3/4] Importing documents...");
const { data: clients } = await supabase
  .from("clients")
  .select("id, name")
  .eq("business_id", business.id);

const clientByName = new Map((clients || []).map((c) => [c.name, c.id]));

for (const doc of DOCUMENTS) {
  // Check if already exists
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("business_id", business.id)
    .eq("number", doc.number)
    .eq("type", doc.type)
    .maybeSingle();

  if (existing) {
    console.log(`  - #${doc.number}: already exists, skipping`);
    continue;
  }

  const clientId = clientByName.get(doc.clientName);

  const { data: inserted, error } = await supabase
    .from("documents")
    .insert({
      business_id: business.id,
      type: doc.type,
      number: doc.number,
      date: doc.date,
      client_id: clientId || null,
      client_name: doc.clientName,
      status: "paid",
      subtotal: doc.total,
      vat: 0,
      total: doc.total,
      payment_method: "bank_transfer",
      subject: doc.description,
    })
    .select()
    .single();

  if (error) {
    console.error(`  ✗ #${doc.number}:`, error.message);
    continue;
  }

  // Add a line item
  await supabase.from("document_items").insert({
    document_id: inserted.id,
    description: doc.description,
    quantity: 1,
    unit_price: doc.total,
    total: doc.total,
    sort_order: 0,
  });

  console.log(`  ✓ #${doc.number}: ${doc.clientName} - ₪${doc.total}`);
}

// 4. Update document counter so next receipt continues from 30038
console.log("\n[4/4] Updating document counter...");
const { data: existingCounter } = await supabase
  .from("document_counters")
  .select("*")
  .eq("business_id", business.id)
  .eq("doc_type", "receipt")
  .maybeSingle();

if (existingCounter) {
  await supabase
    .from("document_counters")
    .update({ next_number: 30038 })
    .eq("id", existingCounter.id);
} else {
  await supabase.from("document_counters").insert({
    business_id: business.id,
    doc_type: "receipt",
    next_number: 30038,
  });
}
console.log("  ✓ Next receipt number: 30038");

console.log("\n✅ Done!");
