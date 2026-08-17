#!/usr/bin/env node
/**
 * Link documents that were saved with client_id NULL (typed free-text before
 * the editor's "new client saves the client" default existed on 2026-08-14,
 * unmatched WhatsApp/assistant docs) to the client record they name.
 *
 * Why: every "this client's documents" count/sum in the app was keyed on
 * client_id only, so a client showed "1 document" while the documents list
 * showed two (Asaf's father, גינדין אנה, 2026-08-17). The app now also matches
 * unlinked docs by name/tax id at read time (src/lib/client-picker.ts
 * documentBelongsToClient); this script fixes the data itself so server-side
 * paths (portal, dunning, exports) agree too.
 *
 * Matching (per business): tax id when both sides have one, else normalized
 * name (trim, collapse whitespace, case-fold). Only a UNIQUE match links -
 * ambiguous or no match is reported, never guessed. `client_name` on the doc
 * is never touched (it's locked by the immutability trigger; client_id is not).
 *
 * Usage:
 *   node scripts/backfill-document-client-ids.mjs                 # dry run, all businesses
 *   node scripts/backfill-document-client-ids.mjs --apply         # write links
 *   node scripts/backfill-document-client-ids.mjs --business <id> # one business only
 *   node scripts/backfill-document-client-ids.mjs --business <id> --create-missing --apply
 *       also creates a client record for each distinct unmatched name in that
 *       business (name + tax id from the doc), then links its docs to it.
 */
import { supabase } from "./admin.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CREATE_MISSING = args.includes("--create-missing");
const bizIdx = args.indexOf("--business");
const ONLY_BUSINESS = bizIdx >= 0 ? args[bizIdx + 1] : null;

if (CREATE_MISSING && !ONLY_BUSINESS) {
  console.error("--create-missing requires --business <id> (creating clients is per-account, on purpose)");
  process.exit(1);
}

const normName = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
const normTax = (s) => (s || "").replace(/\D/g, "");

let q = supabase
  .from("documents")
  .select("id, business_id, number, type, status, date, client_name, client_tax_id")
  .is("client_id", null);
if (ONLY_BUSINESS) q = q.eq("business_id", ONLY_BUSINESS);
const { data: docs, error } = await q.limit(1000);
if (error) throw error;
if (docs.length === 1000) console.warn("WARNING: hit the 1000-row page; re-run after applying to catch the rest");
console.log(`${APPLY ? "APPLY" : "DRY RUN"} - ${docs.length} document(s) with client_id NULL${ONLY_BUSINESS ? ` in business ${ONLY_BUSINESS}` : ""}`);

const byBiz = new Map();
for (const d of docs) {
  if (!byBiz.has(d.business_id)) byBiz.set(d.business_id, []);
  byBiz.get(d.business_id).push(d);
}

let linked = 0, created = 0, ambiguous = 0, unmatched = 0;
for (const [bid, list] of byBiz) {
  const { data: clients, error: cErr } = await supabase
    .from("clients")
    .select("id, name, tax_id")
    .eq("business_id", bid);
  if (cErr) throw cErr;

  // Mirrors src/lib/client-picker.ts documentBelongsToClient +
  // resolveDocumentClientId: tax id when both sides have one (a candidate
  // whose own tax id CONFLICTS with the document's is never a match), else
  // normalized name; a tax-id match outranks a taxless namesake.
  const match = (d) => {
    const t = normTax(d.client_tax_id);
    const n = normName(d.client_name);
    const all = clients.filter((c) => {
      const ct = normTax(c.tax_id);
      if (t && ct) return ct === t;
      return !!n && normName(c.name) === n;
    });
    if (all.length <= 1) return all;
    const byTax = t ? all.filter((c) => normTax(c.tax_id) === t) : [];
    return byTax.length === 1 ? byTax : all;
  };

  const missing = new Map(); // tax:<id> | name:<norm> -> {name, taxId, docs[]}
  for (const d of list) {
    const m = match(d);
    const label = `${d.type}#${d.number} ${d.date} "${d.client_name}"`;
    if (m.length === 1) {
      console.log(`  link   ${label} -> client ${m[0].id} "${m[0].name}"`);
      if (APPLY) {
        // .is("client_id", null): never overwrite a link made since we read.
        const { error: uErr } = await supabase.from("documents").update({ client_id: m[0].id }).eq("id", d.id).is("client_id", null);
        if (uErr) { console.error(`  FAILED ${label}: ${uErr.message}`); continue; }
      }
      linked++;
    } else if (m.length > 1) {
      console.log(`  AMBIG  ${label} matches ${m.length} clients - left unlinked`);
      ambiguous++;
    } else {
      // Group by tax id first (two spellings of one customer share it), then
      // by normalized name. The first-seen spelling becomes the client name.
      const key = normTax(d.client_tax_id) ? `tax:${normTax(d.client_tax_id)}` : `name:${normName(d.client_name)}`;
      if (key === "name:") { unmatched++; console.log(`  SKIP   ${label} - blank client name`); continue; }
      if (!missing.has(key)) missing.set(key, { name: d.client_name.replace(/\s+/g, " ").trim(), taxId: d.client_tax_id || null, docs: [] });
      missing.get(key).docs.push(d);
    }
  }

  for (const [, m] of missing) {
    const label = `"${m.name}"${m.taxId ? ` (${m.taxId})` : ""} x${m.docs.length} doc(s)`;
    if (!(CREATE_MISSING && bid === ONLY_BUSINESS)) {
      console.log(`  NOCLI  ${label} - no client record; left unlinked (use --create-missing --business ${bid} to create)`);
      unmatched += m.docs.length;
      continue;
    }
    const id = crypto.randomUUID();
    console.log(`  create client ${id} ${label}`);
    if (APPLY) {
      const { error: iErr } = await supabase.from("clients").insert({
        id, business_id: bid, name: m.name, tax_id: m.taxId, created_at: new Date().toISOString(),
      });
      if (iErr) { console.error(`  FAILED creating ${label}: ${iErr.message}`); unmatched += m.docs.length; continue; }
      const { error: uErr } = await supabase.from("documents").update({ client_id: id }).in("id", m.docs.map((d) => d.id)).is("client_id", null);
      if (uErr) {
        // Don't leave a client record with no documents behind.
        await supabase.from("clients").delete().eq("id", id);
        console.error(`  FAILED linking docs of ${label}: ${uErr.message} (client rolled back)`);
        unmatched += m.docs.length;
        continue;
      }
    }
    created++;
    linked += m.docs.length;
  }
}
console.log(`\n${APPLY ? "done" : "would do"}: linked ${linked}, clients created ${created}, ambiguous ${ambiguous}, unmatched ${unmatched}`);
