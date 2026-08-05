#!/usr/bin/env node
/**
 * Watches for the .il registry to publish the friendlyinvoice.co.il delegation.
 *
 * Context (2026-08-05): the domain is bought, attached to Vercel (apex + www),
 * and the registrar's own nameservers already serve the right records - but the
 * .il registry had not yet published the delegation, so every public resolver
 * returns NXDOMAIN and nobody can reach the domain. Until that changes the
 * cutover cannot proceed, and commit 5026125 (which repoints the ops scripts
 * and the dunning cron at the new host) MUST NOT be pushed: the dunning cron
 * would POST to a domain that does not resolve and customers would silently
 * stop receiving payment reminders.
 *
 * This exists so nobody has to remember to poll. It pushes ONE WhatsApp message
 * via Gaya the first time the domain actually serves traffic, then writes a
 * marker so it never pushes again. Silent on every other run - the domain being
 * still-undelegated is the expected state, not news.
 *
 * Run it from a scheduled task; it is cheap and side-effect free until the day
 * the answer changes.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve4 } from "node:dns/promises";

const ROOT = new URL("../", import.meta.url);
const MARKER = new URL(".domain-delegation-announced", ROOT);
const DOMAIN = "friendlyinvoice.co.il";

const env = readFileSync(new URL(".env.local", ROOT), "utf8")
  .split("\n")
  .reduce((a, line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) a[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    return a;
  }, {});

/** Resolves only once the registry publishes the delegation AND the host answers. */
async function isLive() {
  try {
    await resolve4(DOMAIN);
  } catch {
    return { live: false, why: "NXDOMAIN - registry delegation still not published" };
  }
  try {
    const res = await fetch(`https://${DOMAIN}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { live: false, why: `DNS resolves but HTTP ${res.status}` };
    return { live: true };
  } catch (e) {
    return { live: false, why: `DNS resolves but connection failed: ${e.message}` };
  }
}

const { live, why } = await isLive();

if (!live) {
  console.log(`[${new Date().toISOString()}] ${DOMAIN} not live yet - ${why}`);
  process.exit(0);
}

if (existsSync(MARKER)) {
  console.log(`[${new Date().toISOString()}] ${DOMAIN} is live; already announced, staying quiet.`);
  process.exit(0);
}

const text = [
  `✅ ${DOMAIN} עלה לאוויר - האצלת הרשם פורסמה והדומיין עונה.`,
  ``,
  `עכשיו אפשר להשלים את המעבר: NEXT_PUBLIC_SITE_ORIGIN ב-Vercel (production בלבד),`,
  `לדחוף את קומיט 5026125, redeploy, ולעדכן את Site URL ב-Supabase.`,
].join("\n");

if (!env.GAYA_PUSH_URL || !env.GAYA_PUSH_TOKEN) {
  console.error("GAYA_PUSH_URL / GAYA_PUSH_TOKEN missing in .env.local - cannot push");
  console.log(text);
  process.exit(1);
}

try {
  const res = await fetch(env.GAYA_PUSH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GAYA_PUSH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, source: "invoice-app-domain" }),
  });
  console.log(`[gaya push] ${res.status}`);
  // Only mark as announced once the push actually left, so a failed push retries.
  if (res.ok) writeFileSync(MARKER, new Date().toISOString());
} catch (e) {
  console.error(`[gaya push failed] ${e.message}`);
  process.exit(1);
}
