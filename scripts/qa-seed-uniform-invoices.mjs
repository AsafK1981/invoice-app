// QA helper for the uniform structure + invoices-period E2E. Lynkeus QA tenant only.
//   seed:  snapshot and empty the QA business number (the E2E fixes it inline
//          with an 8-digit number without its leading zero) and add one
//          synthetic client with a foreign id (a note, never a blocker).
//   clean: delete that client, restore the business number, verify the
//          restore, print counts only.
//
//   node scripts/qa-seed-uniform-invoices.mjs --reason "QA: uniform + invoices-period E2E" seed
//   node scripts/qa-seed-uniform-invoices.mjs --reason "QA: uniform + invoices-period E2E" clean
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { supabase } from "./admin.mjs";

const mode = process.argv.includes("clean") ? "clean" : "seed";
const keys = JSON.parse(fs.readFileSync("C:/Users/asafk/agents/lynkeus/state/keys.json", "utf8"));
const SNAPSHOT = new URL("../.qa-uniform-invoices-snapshot.json", import.meta.url);
const TAG = "qa-uniform-invoices";

const { data: biz, error: bizError } = await supabase.from("businesses").select("id, tax_id").eq("id", keys.businessId).maybeSingle();
if (bizError) throw bizError;
if (!biz) throw new Error("QA business not found");

const { error: removeError } = await supabase.from("clients").delete().eq("business_id", biz.id).eq("notes", TAG);
if (removeError) throw removeError;

if (mode === "clean") {
  if (fs.existsSync(SNAPSHOT)) {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    const { error } = await supabase.from("businesses").update({ tax_id: snap.tax_id }).eq("id", biz.id);
    if (error) throw error;
    const { data: back } = await supabase.from("businesses").select("tax_id").eq("id", biz.id).maybeSingle();
    const ok = (back?.tax_id ?? "") === snap.tax_id;
    console.log(`restore verified: business number ${ok}`);
    if (!ok) process.exit(1);
    fs.rmSync(SNAPSHOT);
  }
  const { count } = await supabase.from("clients").select("id", { count: "exact", head: true }).eq("business_id", biz.id).eq("notes", TAG);
  console.log(`seeded clients left: ${count}`);
  process.exit(0);
}

if (fs.existsSync(SNAPSHOT)) throw new Error("a previous seed was not cleaned: run clean first");
fs.writeFileSync(SNAPSHOT, JSON.stringify({ tax_id: biz.tax_id ?? "" }));

const { error: bizUpdateError } = await supabase.from("businesses").update({ tax_id: "" }).eq("id", biz.id);
if (bizUpdateError) throw bizUpdateError;
const { error: clientError } = await supabase.from("clients").insert({ id: randomUUID(), business_id: biz.id, name: "לקוח חו״ל QA", tax_id: "DE123456789", notes: TAG });
if (clientError) throw clientError;
console.log("QA business number emptied; one foreign-id client added");
