#!/usr/bin/env node
// Weekly watch on the PUBLIC software registry (מרשם תוכנות לניהול מערכת
// חשבונות). Application 1369 was filed 2026-09-07; רשות המסים never states
// a processing SLA, and approval arrives silently - the software simply
// starts appearing in the registry. This is the positive signal.
//
// scripts/check-tax-emails.mjs is the other half: it catches INCOMING mail
// (a request for more information, or another cancellation). This one
// catches the good news, and would also catch approval if the notification
// email never arrives.
//
// The registry UI at secapp.taxes.gov.il/mm-find-tochna is an Angular app,
// but it is backed by a plain unauthenticated JSON endpoint (found by
// capturing its own network calls), so no browser is needed here.
//
// Zero-noise: pushes only when the software is found, and only once
// (dedup is server-side via Gaya /watch-claim, same as the email watcher).
//
// Env: GAYA_PUSH_TOKEN
// Runs in GitHub Actions: software-registry-watch.yml

const REGISTRY_API =
  "https://secapp.taxes.gov.il/MmFindTochnaApi/api/Tochnot/getAllTochnotBetokef";
const GAYA_BASE = "https://136.111.197.22.nip.io";
const SOURCE = "software-registry-watch";

// The software house entity number, per src/lib/uniform-structure/software.ts
// (UNIFORM_SOFTWARE.vendorTaxId). Compared without leading zeros because the
// registry returns it unpadded.
// REGISTRY_WATCH_ENTITY exists so the positive path can be exercised against
// a known-listed vendor without waiting for our own approval.
const ENTITY = process.env.REGISTRY_WATCH_ENTITY || "049040686";

const normalise = (v) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");

async function claimFirstTime(id) {
  const token = process.env.GAYA_PUSH_TOKEN;
  if (!token) {
    console.error("GAYA_PUSH_TOKEN missing; failing CLOSED (no push)");
    return false;
  }
  try {
    const res = await fetch(`${GAYA_BASE}/watch-claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: SOURCE, id }),
    });
    if (!res.ok) {
      console.error(`watch-claim returned ${res.status}; failing CLOSED`);
      return false;
    }
    return (await res.json()).first === true;
  } catch (err) {
    console.error(`watch-claim error: ${err.message}; failing CLOSED`);
    return false;
  }
}

async function pushWhatsApp(text) {
  const token = process.env.GAYA_PUSH_TOKEN;
  if (!token) return false;
  const res = await fetch(`${GAYA_BASE}/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // urgent: bypass Gaya's 20:30 digest. See the same flag in
    // check-tax-emails.mjs - a queued push returns 200 as well, which is how
    // the 2026-08-17 registry cancellation went unnoticed for three weeks.
    body: JSON.stringify({ text, source: SOURCE, urgent: true }),
  });
  const body = await res.text().catch(() => "");
  console.log(`push status: ${res.status} body: ${body.slice(0, 200)}`);
  if (body.includes('"queued":true') || body.includes('"queued": true')) {
    console.warn("WARNING: push was queued for the daily digest, not delivered now");
  }
  return res.ok;
}

async function main() {
  const res = await fetch(REGISTRY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`registry API returned ${res.status}`);

  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("registry API did not return an array");
  console.log(`registry holds ${rows.length} valid registrations`);

  const mine = rows.filter((r) => normalise(r.MsMisYeshutToch) === normalise(ENTITY));
  if (mine.length === 0) {
    console.log(`entity ${ENTITY} not listed yet - application still pending, staying silent`);
    return;
  }

  for (const r of mine) {
    const teuda = r.MtTochMisMezahe || r.MtTeuda || "?";
    const name = r.MtShemTochHe || r.MtShemTochEn || "?";
    const version = r.MtShemMahadura || "?";
    const tokef = r.MtTokefEshur || "?";

    // One announcement per certificate: a future edition gets a new id and
    // is therefore announced again, an unchanged one never repeats.
    if (!(await claimFirstTime(`registered:${teuda}:${version}`))) {
      console.log(`already announced ${teuda} v${version}`);
      continue;
    }

    console.log(`FOUND: ${name} v${version}, certificate ${teuda}, valid until ${tokef}`);
    await pushWhatsApp(
      `אושר. התוכנה נרשמה במרשם התוכנות של רשות המסים.\n` +
        `תוכנה: ${name}\n` +
        `מהדורה: ${version}\n` +
        `מספר תעודת רישום: ${teuda}\n` +
        `תוקף עד: ${tokef}\n\n` +
        `צריך להזין את מספר התעודה בקוד (software.ts) כדי שיופיע בקבצי המבנה האחיד.`,
    );
  }
}

main().catch((err) => {
  console.error("fatal:", err.message);
  process.exit(1);
});
