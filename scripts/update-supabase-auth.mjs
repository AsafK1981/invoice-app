import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [key, ...rest] = line.split("=");
    if (key) acc[key.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = env.SUPABASE_PROJECT_REF;

const NEW_SITE_URL = "https://mysuperfriendlyinvoiceapp.vercel.app";
const REDIRECT_URLS = [
  "https://mysuperfriendlyinvoiceapp.vercel.app/**",
  "https://invoice-app-ochre-five.vercel.app/**",
  "http://localhost:3000/**",
].join(",");

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

// Get current config
const getRes = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
  { headers }
);
const current = await getRes.json();
if (!getRes.ok) {
  console.error("Get auth config failed:", current);
  process.exit(1);
}

console.log("Current Site URL:", current.site_url);
console.log("Current Redirect URLs:", current.uri_allow_list);

// Update
const updateRes = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
  {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      site_url: NEW_SITE_URL,
      uri_allow_list: REDIRECT_URLS,
    }),
  }
);

const updated = await updateRes.json();
if (!updateRes.ok) {
  console.error("Update failed:", updated);
  process.exit(1);
}

console.log("\n✓ Updated:");
console.log("  Site URL:", updated.site_url);
console.log("  Redirect URLs:", updated.uri_allow_list);
