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

// Ask Resend to re-check DNS, then WAIT for the answer. Verification is
// asynchronous: reading the status straight after the POST always returns
// "pending", and this script used to report that as "records still to
// publish". From 2026-08-20 to 2026-09-16 the records were in fact live the
// whole time and the domain sat unverified for a month because every run said
// otherwise. Checked on 2026-09-16: it flipped to verified about 35 seconds
// after the trigger.
const trigger = await api(`/domains/${found.id}/verify`, { method: "POST" });
if (trigger.status >= 400) {
  console.error(`Resend refused the verify request (${trigger.status}):`, trigger.body);
  process.exit(1);
}
let domain;
for (let waited = 0; ; waited += 10) {
  ({ body: domain } = await api(`/domains/${found.id}`));
  if (domain.status !== "pending" || waited >= 180) break;
  process.stdout.write(waited === 0 ? "waiting for Resend to check DNS" : ".");
  await new Promise((r) => setTimeout(r, 10_000));
}
console.log("");

console.log(`domain:  ${domain.name}`);
console.log(`status:  ${domain.status}`);
console.log("");

const pending = (domain.records || []).filter((r) => r.status !== "verified");
if (!pending.length && domain.status === "verified") {
  console.log("All records verified. The domain can send.");
  console.log("Next: point Supabase auth SMTP and the app's senders at it.");
  process.exit(0);
}

// "not verified" is not the same as "not published": say which one it is by
// asking public DNS, instead of telling someone to publish records that are
// already live.
console.log(`Not verified yet (Resend status: ${domain.status}). Records Resend has not accepted:`);
for (const r of pending) {
  const host = r.name === "" || r.name === "@" ? "@" : r.name;
  console.log("");
  console.log(`  type:     ${r.type}`);
  console.log(`  host:     ${host}`);
  if (r.priority != null) console.log(`  priority: ${r.priority}`);
  console.log(`  value:    ${r.value}`);
  console.log(`  status:   ${r.status}`);
  console.log(`  public DNS: ${await publicDnsHas(r) ? "PUBLISHED (matches)" : "missing or different"}`);
}
console.log("");
console.log(
  "Records marked PUBLISHED are live; just run this script again later. " +
    "Publish only the ones marked missing.",
);

/** Whether Google's public resolver already returns this record's value. */
async function publicDnsHas(record) {
  const fqdn = record.name ? `${record.name}.${DOMAIN}` : DOMAIN;
  try {
    const res = await fetch(`https://dns.google/resolve?name=${fqdn}&type=${record.type}`, {
      headers: { accept: "application/dns-json" },
    });
    const body = await res.json();
    const want = String(record.value).replace(/"/g, "").trim();
    return (body.Answer || []).some((a) => String(a.data).replace(/"/g, "").includes(want));
  } catch {
    return false;
  }
}
