// QA helper: enable the email inbox for the Lynkeus QA business and park a few
// synthetic items in email_inbox_items so /expenses and /settings can be
// screenshotted. Metadata only, synthetic content, QA tenant only.
//
//   node scripts/qa-seed-email-inbox.mjs --reason "email inbox QA" seed
//   node scripts/qa-seed-email-inbox.mjs --reason "email inbox QA" clean
import fs from "node:fs";
import { supabase } from "./admin.mjs";

const mode = process.argv.includes("clean") ? "clean" : "seed";
const keys = JSON.parse(fs.readFileSync("C:/Users/asafk/agents/lynkeus/state/keys.json", "utf8"));

const { data: users, error: uErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (uErr) throw uErr;
const qa = users.users.find((u) => u.email === keys.email);
if (!qa) throw new Error("QA user not found");
const { data: biz, error: bErr } = await supabase.from("businesses").select("id, inbox_token, inbox_enabled").eq("user_id", qa.id).maybeSingle();
if (bErr) throw bErr;
if (!biz) throw new Error("QA business not found");

if (mode === "clean") {
  const { error } = await supabase.from("email_inbox_items").delete().eq("business_id", biz.id).like("email_id", "qa-%");
  if (error) throw error;
  await supabase.from("expenses").delete().eq("business_id", biz.id).eq("source", "email");
  console.log("cleaned QA items");
  process.exit(0);
}

const token = biz.inbox_token || "qa" + Math.random().toString(36).slice(2, 10);
await supabase.from("businesses").update({ inbox_token: token, inbox_enabled: true }).eq("id", biz.id);

const rows = [
  {
    business_id: biz.id, email_id: "qa-1", message_id: "<qa-1@example.com>", from_address: "billing@cloud-example.com",
    subject: "חשבונית מס 4471 - אחסון ענן", attachment_name: "invoice-4471.pdf", attachment_type: "application/pdf",
    status: "pending", scan: { vendor: "ענן ישראל בע\"מ", amount: 351, vatAmount: 54, date: "2026-09-02", category: "תוכנה ומנויים", description: "אחסון ענן - ספטמבר", unreadFields: [], legibility: "good", documentKind: "tax_invoice" },
  },
  {
    business_id: biz.id, email_id: "qa-2", message_id: "<qa-2@example.com>", from_address: "office@print-example.co.il",
    subject: "קבלה על הזמנה 98211", attachment_name: "receipt.jpg", attachment_type: "image/jpeg",
    status: "pending", scan: { vendor: "דפוס הדר", amount: null, vatAmount: null, date: "2026-09-04", category: "ציוד משרדי", description: "כרטיסי ביקור", unreadFields: ["amount"], legibility: "partial", documentKind: "receipt" },
  },
  {
    business_id: biz.id, email_id: "qa-3", message_id: "<qa-3@example.com>", from_address: "forwarding-noreply@google.com",
    subject: "(#734118276) Gmail Forwarding Confirmation - Receive Mail from qa@example.com",
    status: "failed", reason: "gmail_verification", detail: "https://mail-settings.google.com/mail/vf-example",
  },
  {
    business_id: biz.id, email_id: "qa-4", message_id: "<qa-4@example.com>", from_address: "newsletter@example.com",
    subject: "העדכון השבועי שלנו", status: "failed", reason: "no_attachment",
  },
];
// attachment_index is part of the dedupe key (one row per attachment, not per
// mail), so it has to be spelled out for the upsert to find its conflict.
const { error } = await supabase
  .from("email_inbox_items")
  .upsert(rows.map((r) => ({ attachment_index: 0, ...r })), {
    onConflict: "business_id,message_id,attachment_index",
  });
if (error) throw error;
console.log("seeded", rows.length, "items; address:", `${token}@friendlyinvoice.co.il`);
