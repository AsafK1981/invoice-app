#!/usr/bin/env node
/**
 * Sending-domain status + verification trigger for friendlyinvoice.co.il.
 *
 * Background (2026-08-11): every mail the product sends - including the
 * signup confirmation, which is mandatory (`mailer_autoconfirm` is off) -
 * is relayed through Gmail SMTP from a personal address. That authenticates
 * fine (the envelope is a gmail.com address, so Google's own SPF/DKIM
 * apply), but it means the brand never appears in the FROM line and the
 * whole product is capped by one Gmail account's daily sending limit.
 *
 * The fix is to send from the domain via Resend. Everything on the Resend
 * side is already done - the domain exists in the account and its records
 * are known. The one step that cannot be automated from here is publishing
 * those records: friendlyinvoice.co.il is served by ns1/2/3.dtnt.info
 * (Domain The Net), not by Vercel, and no API credentials for that
 * registrar exist on this machine.
 *
 * So: publish the records in the registrar's DNS panel, then run
 *
 *     node scripts/verify-sending-domain.mjs
 *
 * It prints exactly which records are still missing, asks Resend to
 * re-check, and tells you when the domain is verified. Read-only apart
 * from the verify trigger, and safe to run repeatedly.
 */
import fs from "node:fs";
import path from "node:path";

const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const KEY = get("RESEND_API_KEY");
if (!KEY) {
  console.error("Missing RESEND_API_KEY in .env.local");
  process.exit(1);
}

const DOMAIN = "friendlyinvoice.co.il";
const api = async (p, init) => {
  const res = await fetch(`https://api.resend.com${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const list = await api("/domains");
const found = (list.body.data || []).find((d) => d.name === DOMAIN);
if (!found) {
  console.error(`${DOMAIN} is not in this Resend account. Add it first.`);
  process.exit(1);
}

// Ask Resend to re-check DNS before reporting, so a run right after the
// records go live reflects reality instead of the last cached result.
await api(`/domains/${found.id}/verify`, { method: "POST" });
const { body: domain } = await api(`/domains/${found.id}`);

console.log(`domain:  ${domain.name}`);
console.log(`status:  ${domain.status}`);
console.log("");

const pending = (domain.records || []).filter((r) => r.status !== "verified");
if (!pending.length && domain.status === "verified") {
  console.log("All records verified. The domain can send.");
  console.log("Next: point Supabase auth SMTP and the app's senders at it.");
  process.exit(0);
}

console.log("Records still to publish (host names are relative to the zone):");
for (const r of pending) {
  const host = r.name === "" || r.name === "@" ? "@" : r.name;
  console.log("");
  console.log(`  type:     ${r.type}`);
  console.log(`  host:     ${host}`);
  if (r.priority != null) console.log(`  priority: ${r.priority}`);
  console.log(`  value:    ${r.value}`);
  console.log(`  status:   ${r.status}`);
}
console.log("");
console.log("Publish these, wait for propagation, then run this script again.");
