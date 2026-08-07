// Read-only scan: find paid/sent tax invoices with no linked receipt
// (converted_to_id is null) that have a suspiciously similar standalone
// receipt for the same client - i.e. income that today counts twice.
// A pair is flagged when the receipt total is within 1% of the invoice
// total (or exactly the pre-VAT subtotal) and dated on/after the invoice.
import { supabase } from "./admin.mjs";

const { data: docs, error } = await supabase
  .from("documents")
  .select("id,business_id,client_id,client_name,type,status,number,date,total,subtotal,converted_to_id")
  .in("type", ["tax_invoice", "receipt", "tax_invoice_receipt"])
  .neq("status", "draft")
  .neq("status", "cancelled");
if (error) throw error;

const { data: businesses } = await supabase.from("businesses").select("id,name");
const bizName = new Map((businesses ?? []).map((b) => [b.id, b.name]));

const convertTargets = new Set(docs.filter((d) => d.converted_to_id).map((d) => d.converted_to_id));

const invoices = docs.filter(
  (d) => d.type === "tax_invoice" && !d.converted_to_id,
);
const receipts = docs.filter(
  (d) => (d.type === "receipt" || d.type === "tax_invoice_receipt") && !convertTargets.has(d.id),
);

const pairs = [];
for (const inv of invoices) {
  for (const rec of receipts) {
    if (rec.business_id !== inv.business_id) continue;
    if (inv.client_id ? rec.client_id !== inv.client_id : rec.client_name !== inv.client_name) continue;
    if (rec.date < inv.date) continue;
    const close = (a, b) => a > 0 && Math.abs(a - b) / a <= 0.01;
    if (close(inv.total, rec.total) || close(inv.subtotal, rec.total)) {
      pairs.push({
        business: bizName.get(inv.business_id) ?? inv.business_id,
        client: inv.client_name,
        invoice: `#${inv.number} ${inv.date} ₪${inv.total} (${inv.status})`,
        receipt: `${rec.type} #${rec.number} ${rec.date} ₪${rec.total} (${rec.status})`,
        invoiceCounted: inv.status === "paid",
        ids: { invoice: inv.id, receipt: rec.id },
      });
    }
  }
}

console.log(`invoices without linked receipt: ${invoices.length}`);
console.log(`standalone receipts checked: ${receipts.length}`);
console.log(`suspected double-count pairs: ${pairs.length}`);
for (const p of pairs) console.log(JSON.stringify(p, null, 1));
