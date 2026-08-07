// Apply approved invoice→receipt links (converted_to_id) for the pairs in
// the JSON file produced by propose-double-count-links.mjs. Idempotent:
// skips invoices already linked. converted_to_id is not an immutability-
// guarded field, so the trigger allows this on issued documents.
import { readFileSync } from "node:fs";
import { supabase } from "./admin.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: node apply-double-count-links.mjs <links.json>");
const links = JSON.parse(readFileSync(file, "utf8"));

let applied = 0, skipped = 0;
for (const { invoiceId, receiptId } of links) {
  const { data: inv } = await supabase
    .from("documents")
    .select("id,number,converted_to_id,type")
    .eq("id", invoiceId)
    .single();
  if (!inv || inv.type !== "tax_invoice") throw new Error(`not a tax_invoice: ${invoiceId}`);
  if (inv.converted_to_id) { skipped++; continue; }
  const { error } = await supabase
    .from("documents")
    .update({ converted_to_id: receiptId })
    .eq("id", invoiceId);
  if (error) throw new Error(`link failed for #${inv.number}: ${error.message}`);
  applied++;
  console.log(`linked invoice #${inv.number} -> receipt ${receiptId}`);
}
console.log(`done: ${applied} linked, ${skipped} already linked`);
