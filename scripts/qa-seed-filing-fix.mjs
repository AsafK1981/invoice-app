// QA helper for the friendly filing report E2E. Lynkeus QA tenant only, synthetic rows.
//   seed:  make the QA business a VAT filer with an EMPTY business number and park
//          three expenses in the last ended bi-monthly period:
//          two for one supplier with a bad-checksum number (one grouped fix),
//          one above the allocation threshold without an allocation number.
//          The QA tenant's own rows in that period that would block the file on
//          their own (a sale without a customer number, an input without supplier
//          details) get synthetic valid values so the E2E can reach a download;
//          every original value is kept in the snapshot.
//   clean: remove those expenses and restore business_type / tax_id and every
//          temporarily filled value, then print what is left (counts only).
//
//   node scripts/qa-seed-filing-fix.mjs --reason "QA: filing fix E2E" seed
//   node scripts/qa-seed-filing-fix.mjs --reason "QA: filing fix E2E" clean
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { supabase } from "./admin.mjs";

const mode = process.argv.includes("clean") ? "clean" : "seed";
const keys = JSON.parse(fs.readFileSync("C:/Users/asafk/agents/lynkeus/state/keys.json", "utf8"));
const SNAPSHOT = new URL("../.qa-filing-fix-snapshot.json", import.meta.url);
const TAG = "qa-filing-fix";

const { data: biz, error: bizError } = await supabase.from("businesses").select("id, business_type, tax_id").eq("id", keys.businessId).maybeSingle();
if (bizError) throw bizError;
if (!biz) throw new Error("QA business not found");

const { error: removeError } = await supabase.from("expenses").delete().eq("business_id", biz.id).eq("description", TAG);
if (removeError) throw removeError;

if (mode === "clean") {
  if (fs.existsSync(SNAPSHOT)) {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    const { error } = await supabase.from("businesses").update({ business_type: snap.business_type, tax_id: snap.tax_id }).eq("id", biz.id);
    if (error) throw error;
    for (const d of snap.documents ?? []) {
      const { error: docError } = await supabase.from("documents").update({ client_tax_id: d.client_tax_id }).eq("id", d.id).eq("business_id", biz.id);
      if (docError) throw docError;
    }
    for (const e of snap.expenses ?? []) {
      const { error: expError } = await supabase.from("expenses").update({ supplier_tax_id: e.supplier_tax_id, reference: e.reference }).eq("id", e.id).eq("business_id", biz.id);
      if (expError) throw expError;
    }
    const docsBack = await Promise.all((snap.documents ?? []).map((d) => supabase.from("documents").select("client_tax_id").eq("id", d.id).maybeSingle()));
    const expsBack = await Promise.all((snap.expenses ?? []).map((e) => supabase.from("expenses").select("supplier_tax_id, reference").eq("id", e.id).maybeSingle()));
    const docsOk = docsBack.every((r, i) => (r.data?.client_tax_id ?? null) === snap.documents[i].client_tax_id);
    const expsOk = expsBack.every((r, i) => (r.data?.supplier_tax_id ?? null) === snap.expenses[i].supplier_tax_id && (r.data?.reference ?? null) === snap.expenses[i].reference);
    const { data: bizBack } = await supabase.from("businesses").select("business_type, tax_id").eq("id", biz.id).maybeSingle();
    const bizOk = bizBack?.business_type === snap.business_type && (bizBack?.tax_id ?? "") === snap.tax_id;
    console.log(`restore verified: business ${bizOk}, documents ${docsOk} (${docsBack.length}), expenses ${expsOk} (${expsBack.length})`);
    if (!bizOk || !docsOk || !expsOk) process.exit(1);
    fs.rmSync(SNAPSHOT);
  }
  const { data: restored } = await supabase.from("businesses").select("business_type, tax_id").eq("id", biz.id).maybeSingle();
  const { count } = await supabase.from("expenses").select("id", { count: "exact", head: true }).eq("business_id", biz.id).eq("description", TAG);
  console.log(`QA business is ${restored?.business_type}, business number ${restored?.tax_id ? "set" : "empty"}; seeded expenses left: ${count}`);
  process.exit(0);
}

if (fs.existsSync(SNAPSHOT)) throw new Error("a previous seed was not cleaned: run clean first");

const now = new Date();
let period = Math.floor(now.getMonth() / 2) - 1;
let year = now.getFullYear();
if (period < 0) {
  period += 6;
  year -= 1;
}
const first = period * 2;
const iso = (month0, day) => `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const start = iso(first, 1);
const end = iso(first + 1, new Date(year, first + 2, 0).getDate());

const validIsraeli = (raw) => {
  const text = String(raw ?? "");
  if (!/^[\d\s.-]*$/.test(text)) return false;
  const digits = text.replace(/\D/g, "");
  if (!digits || digits.length > 9 || /^0+$/.test(digits)) return false;
  const padded = digits.padStart(9, "0");
  let total = 0;
  for (let i = 0; i < 9; i++) {
    let x = Number(padded[i]) * (i % 2 ? 2 : 1);
    if (x > 9) x -= 9;
    total += x;
  }
  return total % 10 === 0;
};

const { data: ownDocs, error: ownDocsError } = await supabase.from("documents").select("id, client_tax_id, type, status, date")
  .eq("business_id", biz.id).gte("date", start).lte("date", end).in("type", ["tax_invoice", "tax_invoice_receipt", "credit_note"]);
if (ownDocsError) throw ownDocsError;
const docsToFill = ownDocs.filter((d) => d.status !== "draft" && d.status !== "cancelled" && !validIsraeli(d.client_tax_id));
const { data: ownExpenses, error: ownExpensesError } = await supabase.from("expenses").select("id, supplier_tax_id, reference, vat_amount, description")
  .eq("business_id", biz.id).gte("date", start).lte("date", end).gt("vat_amount", 0);
if (ownExpensesError) throw ownExpensesError;
const expensesToFill = ownExpenses.filter((e) => e.description !== TAG && (!validIsraeli(e.supplier_tax_id) || !/\d/.test(e.reference ?? "")));

fs.writeFileSync(SNAPSHOT, JSON.stringify({
  business_type: biz.business_type,
  tax_id: biz.tax_id ?? "",
  documents: docsToFill.map((d) => ({ id: d.id, client_tax_id: d.client_tax_id ?? null })),
  expenses: expensesToFill.map((e) => ({ id: e.id, supplier_tax_id: e.supplier_tax_id ?? null, reference: e.reference ?? null })),
}));

const { error: bizUpdateError } = await supabase.from("businesses").update({ business_type: "authorized", tax_id: "" }).eq("id", biz.id);
if (bizUpdateError) throw bizUpdateError;
for (const d of docsToFill) {
  const { error } = await supabase.from("documents").update({ client_tax_id: "514993666" }).eq("id", d.id);
  if (error) throw error;
}
for (const [i, e] of expensesToFill.entries()) {
  const patch = {
    ...(validIsraeli(e.supplier_tax_id) ? {} : { supplier_tax_id: "513333336" }),
    ...(/\d/.test(e.reference ?? "") ? {} : { reference: `QA-${7100 + i}` }),
  };
  const { error } = await supabase.from("expenses").update(patch).eq("id", e.id);
  if (error) throw error;
}
console.log(`temporarily filled ${docsToFill.length} QA documents and ${expensesToFill.length} QA expenses in the period`);

const rows = [
  { date: iso(first, 12), supplier: "ספק בדיקה QA", supplier_tax_id: "513333337", reference: "INV-5001", amount: 2360, vat_amount: 360 },
  { date: iso(first + 1, 8), supplier: "ספק בדיקה QA", supplier_tax_id: "513333337", reference: "INV-5002", amount: 2360, vat_amount: 360 },
  { date: iso(first + 1, 15), supplier: "ספק הקצאה QA", supplier_tax_id: "514993666", reference: "A-9001", amount: 14160, vat_amount: 2160 },
].map((row) => ({ id: randomUUID(), business_id: biz.id, category: "אחר", description: TAG, is_equipment: false, source: "manual", ...row }));

const { error: insertError } = await supabase.from("expenses").insert(rows);
if (insertError) throw insertError;
console.log(`seeded ${rows.length} expenses in ${start}..${end}; QA business is authorized with an empty business number (was ${biz.business_type})`);
