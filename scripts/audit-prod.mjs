#!/usr/bin/env node
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [k, ...rest] = line.split("=");
    if (k) acc[k.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const VERCEL_TOKEN = env.VERCEL_ACCESS_TOKEN;
const SUPA_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const SUPA_REF = env.SUPABASE_PROJECT_REF;
const VERCEL_PROJECT_ID = "prj_TvmyEkfULUU4vcQSvEySbrEhuqGB";
const PROD_URL = "https://mysuperfriendlyinvoiceapp.vercel.app";

const sectionArg = process.argv[2] || "all";

async function jget(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  if (!r.ok) return { ok: false, status: r.status, text };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: true, data: text };
  }
}

async function sql(query) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${SUPA_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const text = await r.text();
  if (!r.ok) return { ok: false, status: r.status, text };
  return { ok: true, data: JSON.parse(text) };
}

async function checkVercel() {
  console.log("\n=== VERCEL ===");
  // Project info
  const proj = await jget(
    `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}`,
    VERCEL_TOKEN
  );
  if (proj.ok) {
    console.log("project.name:", proj.data.name);
    console.log("project.framework:", proj.data.framework);
  } else {
    console.log("project fetch failed", proj.status, proj.text);
  }

  // Latest production deployment
  const deps = await jget(
    `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=5&target=production&state=READY`,
    VERCEL_TOKEN
  );
  if (!deps.ok) {
    console.log("deps fetch failed", deps.status, deps.text);
    return;
  }
  const latest = deps.data.deployments[0];
  if (!latest) {
    console.log("No prod deployments found");
    return;
  }
  console.log("latest deployment:", {
    uid: latest.uid,
    url: latest.url,
    state: latest.state,
    createdAt: new Date(latest.created).toISOString(),
    ageHours: ((Date.now() - latest.created) / 3600000).toFixed(1),
  });

  // Runtime logs - try v1 endpoint
  const since = Date.now() - 24 * 3600 * 1000;
  const logs = await jget(
    `https://api.vercel.com/v1/projects/${VERCEL_PROJECT_ID}/runtime-logs?from=${since}&to=${Date.now()}&limit=200`,
    VERCEL_TOKEN
  );
  if (!logs.ok) {
    console.log("runtime-logs not available:", logs.status);
    // Try deployment events instead
    const ev = await jget(
      `https://api.vercel.com/v3/deployments/${latest.uid}/events?builds=0&limit=200`,
      VERCEL_TOKEN
    );
    if (ev.ok) {
      const items = Array.isArray(ev.data) ? ev.data : ev.data.events || [];
      console.log("deployment events count:", items.length);
      const errors = items.filter(
        (e) =>
          e.type === "error" ||
          (e.payload?.statusCode && e.payload.statusCode >= 500) ||
          e.payload?.text?.includes?.("Error") ||
          e.payload?.text?.includes?.("Unhandled")
      );
      console.log("error-ish events:", errors.length);
      errors.slice(0, 10).forEach((e) => {
        console.log(
          "-",
          e.type,
          e.payload?.statusCode ?? "",
          (e.payload?.text || JSON.stringify(e.payload)).slice(0, 200)
        );
      });
    } else {
      console.log("events also failed", ev.status, ev.text?.slice(0, 200));
    }
  } else {
    const items = Array.isArray(logs.data) ? logs.data : logs.data.logs || [];
    console.log("runtime logs (24h):", items.length);
    const bad = items.filter(
      (l) =>
        l.level === "error" ||
        l.statusCode >= 500 ||
        /unhandled|exception|timeout/i.test(l.message || "")
    );
    console.log("error logs:", bad.length);
    bad.slice(0, 15).forEach((l) =>
      console.log(
        "-",
        l.level,
        l.statusCode,
        (l.message || "").slice(0, 200)
      )
    );
  }
}

async function checkAuthConfig() {
  console.log("\n=== SUPABASE AUTH CONFIG ===");
  const r = await jget(
    `https://api.supabase.com/v1/projects/${SUPA_REF}/config/auth`,
    SUPA_TOKEN
  );
  if (!r.ok) {
    console.log("FAILED", r.status, r.text);
    return;
  }
  const c = r.data;
  const keys = [
    "site_url",
    "uri_allow_list",
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_sender_name",
    "smtp_admin_email",
    "mailer_otp_exp",
    "mailer_subjects_confirmation",
    "mailer_subjects_recovery",
    "mailer_autoconfirm",
    "external_email_enabled",
    "disable_signup",
  ];
  for (const k of keys) {
    console.log(k + ":", JSON.stringify(c[k]));
  }
  // template snippets
  for (const k of [
    "mailer_templates_confirmation_content",
    "mailer_templates_recovery_content",
    "mailer_templates_invite_content",
  ]) {
    const v = c[k];
    if (v) {
      const hasName = /MyFriendlyInvoiceApp/i.test(v);
      // The old brand surviving here means the remote Supabase template was
      // never re-pushed after the rename (scripts/update-email-templates.mjs).
      const hasStaleName = /MySuperFriendlyInvoiceApp/i.test(v);
      console.log(
        k + ":",
        hasStaleName
          ? "STALE — still says MySuperFriendlyInvoiceApp"
          : hasName
            ? "has MyFriendlyInvoiceApp"
            : "missing brand",
        "len=" + v.length
      );
    } else {
      console.log(k + ": (default)");
    }
  }
}

async function checkDb() {
  console.log("\n=== DB INTEGRITY ===");
  // RPCs
  const rpcs = await sql(`
    SELECT n.nspname AS schema, p.proname AS name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('create_document_atomic','get_next_doc_number')
    ORDER BY 1,2;
  `);
  console.log("RPCs:", JSON.stringify(rpcs.data));

  // RLS
  const rls = await sql(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('documents','document_items','document_counters','clients','products','expenses','businesses')
      AND relkind='r'
    ORDER BY relname;
  `);
  console.log("RLS:", JSON.stringify(rls.data));

  // orphan documents
  const orphanBiz = await sql(`
    SELECT COUNT(*) AS cnt FROM documents d
    LEFT JOIN businesses b ON b.id = d.business_id
    WHERE b.id IS NULL;
  `);
  console.log("orphan docs (no business):", JSON.stringify(orphanBiz.data));

  const orphanClient = await sql(`
    SELECT COUNT(*) AS cnt FROM documents d
    WHERE d.client_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = d.client_id);
  `);
  console.log(
    "orphan docs (deleted client):",
    JSON.stringify(orphanClient.data)
  );

  // duplicate numbering
  const dup = await sql(`
    SELECT business_id, type, number, COUNT(*) AS c
    FROM documents
    GROUP BY business_id, type, number
    HAVING COUNT(*) > 1
    LIMIT 20;
  `);
  console.log("dup doc numbers:", JSON.stringify(dup.data));

  // total counts
  const counts = await sql(`
    SELECT
      (SELECT COUNT(*) FROM documents) AS documents,
      (SELECT COUNT(*) FROM document_items) AS document_items,
      (SELECT COUNT(*) FROM businesses) AS businesses,
      (SELECT COUNT(*) FROM clients) AS clients,
      (SELECT COUNT(*) FROM products) AS products;
  `);
  console.log("counts:", JSON.stringify(counts.data));
}

async function checkRoutes() {
  console.log("\n=== ROUTE STATUS ===");
  const paths = [
    "/",
    "/login",
    "/auth/confirm",
    "/dashboard",
    "/settings",
    "/documents/new/quote",
    "/recurring",
    "/billing",
    "/privacy",
    "/terms",
    "/view/51e02d40-b068-4425-aff5-90b684e72ef4",
    "/view/8ce5656b-3839-4b5f-85d2-5ca548ff73e6",
  ];
  for (const p of paths) {
    try {
      const r = await fetch(PROD_URL + p, {
        redirect: "manual",
        headers: { "user-agent": "audit-script" },
      });
      let titleInfo = "";
      let metaInfo = "";
      if (r.status === 200) {
        const txt = await r.text();
        const titleMatch = txt.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const ogMatch = txt.match(
          /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i
        );
        const descMatch = txt.match(
          /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i
        );
        titleInfo = ` | title="${(titleMatch?.[1] || "").trim().slice(0, 80)}"`;
        if (ogMatch) titleInfo += ` | og="${ogMatch[1].slice(0, 60)}"`;
        if (descMatch) metaInfo = ` | desc="${descMatch[1].slice(0, 60)}"`;
        if (/invoice-app-ochre-five|localhost:3000/i.test(txt)) {
          titleInfo += " ⚠ CONTAINS_OLD_URL";
        }
      } else {
        const loc = r.headers.get("location");
        if (loc) titleInfo = ` -> ${loc}`;
      }
      console.log(`${r.status} ${p}${titleInfo}${metaInfo}`);
    } catch (e) {
      console.log(`ERR  ${p} ${e.message}`);
    }
  }
}

async function checkSaaSChecklist() {
  console.log("\n=== SAAS CHECKLIST ===");
  // manifest.json
  try {
    const r = await fetch(PROD_URL + "/manifest.json");
    if (r.ok) {
      const j = await r.json();
      console.log(
        "manifest:",
        JSON.stringify({
          name: j.name,
          short_name: j.short_name,
          start_url: j.start_url,
        })
      );
    } else if (r.status === 404) {
      const r2 = await fetch(PROD_URL + "/site.webmanifest");
      console.log("manifest.json missing, /site.webmanifest:", r2.status);
    } else {
      console.log("manifest:", r.status);
    }
  } catch (e) {
    console.log("manifest err:", e.message);
  }

  // favicon
  try {
    const r = await fetch(PROD_URL + "/favicon.ico");
    const buf = await r.arrayBuffer();
    console.log("favicon.ico:", r.status, "size=" + buf.byteLength);
  } catch (e) {
    console.log("favicon err:", e.message);
  }

  // robots
  try {
    const r = await fetch(PROD_URL + "/robots.txt");
    if (r.ok) {
      const t = await r.text();
      console.log("robots.txt:", t.slice(0, 200).replace(/\n/g, " | "));
    } else {
      console.log("robots.txt:", r.status);
    }
  } catch (e) {
    console.log("robots err:", e.message);
  }
}

if (sectionArg === "vercel" || sectionArg === "all") await checkVercel();
if (sectionArg === "auth" || sectionArg === "all") await checkAuthConfig();
if (sectionArg === "db" || sectionArg === "all") await checkDb();
if (sectionArg === "routes" || sectionArg === "all") await checkRoutes();
if (sectionArg === "saas" || sectionArg === "all") await checkSaaSChecklist();
