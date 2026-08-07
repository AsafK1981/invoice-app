// Read-only: propose a 1:1 invoice→receipt linking for Asaf's business,
// matching equal-amount docs by nearest later (or same-day) receipt date,
// then show how each year's counted income would change if applied.
import { supabase } from "./admin.mjs";

const BUSINESS = process.argv[2];
if (!BUSINESS) throw new Error("usage: node propose-double-count-links.mjs <business_id>");

const { data: docs, error } = await supabase
  .from("documents")
  .select("id,client_id,client_name,type,status,number,date,total,converted_to_id")
  .eq("business_id", BUSINESS)
  .neq("status", "draft")
  .neq("status", "cancelled");
if (error) throw error;

const convertTargets = new Set(docs.filter((d) => d.converted_to_id).map((d) => d.converted_to_id));
const invoices = docs
  .filter((d) => d.type === "tax_invoice" && !d.converted_to_id && d.status === "paid")
  .sort((a, b) => a.date.localeCompare(b.date));
const freeReceipts = docs
  .filter((d) => (d.type === "receipt" || d.type === "tax_invoice_receipt") && !convertTargets.has(d.id))
  .sort((a, b) => a.date.localeCompare(b.date));

const used = new Set();
const links = [];
const unmatched = [];
for (const inv of invoices) {
  const cands = freeReceipts.filter(
    (r) =>
      !used.has(r.id) &&
      (inv.client_id ? r.client_id === inv.client_id : r.client_name === inv.client_name) &&
      r.date >= inv.date &&
      Math.abs(r.total - inv.total) < 0.01,
  );
  if (cands.length === 0) { unmatched.push(inv); continue; }
  const pick = cands[0]; // earliest receipt on/after the invoice date
  used.add(pick.id);
  links.push({ invoice: inv, receipt: pick });
}

console.log("PROPOSED LINKS (invoice -> receipt):");
for (const { invoice: i, receipt: r } of links) {
  console.log(
    ` חשבונית #${i.number} ${i.date} ₪${i.total}  ->  ${r.type} #${r.number} ${r.date} ₪${r.total}`,
  );
}
console.log("\nPAID INVOICES WITH NO MATCHING RECEIPT (stay counted as income):");
for (const i of unmatched) console.log(` #${i.number} ${i.date} ₪${i.total}`);

// Year impact: counted income before/after (invoice stops counting once linked)
const year = (d) => d.date.slice(0, 4);
const counted = (list) => {
  const by = {};
  for (const d of list) by[year(d)] = (by[year(d)] ?? 0) + d.total;
  return by;
};
const linkedInvoiceIds = new Set(links.map((l) => l.invoice.id));
const countableNow = docs.filter(
  (d) => d.status === "paid" && !d.converted_to_id &&
    ["receipt", "tax_invoice", "tax_invoice_receipt"].includes(d.type),
);
const countableAfter = countableNow.filter((d) => !linkedInvoiceIds.has(d.id));
const before = counted(countableNow);
const after = counted(countableAfter);
console.log("\nYEARLY COUNTED INCOME, BEFORE -> AFTER:");
for (const y of Object.keys(before).sort()) {
  console.log(` ${y}: ₪${before[y]} -> ₪${after[y] ?? 0}  (Δ ₪${(after[y] ?? 0) - before[y]})`);
}
console.log("\nJSON=" + JSON.stringify(links.map((l) => ({ invoiceId: l.invoice.id, receiptId: l.receipt.id }))));
