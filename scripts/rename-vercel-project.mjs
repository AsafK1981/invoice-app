import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [key, ...rest] = line.split("=");
    if (key) acc[key.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const TOKEN = env.VERCEL_ACCESS_TOKEN;
const NEW_NAME = "mysuperfriendlyinvoiceapp";
const CURRENT_NAME = "invoice-app";

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

// Step 1: List projects to find the project id
const listRes = await fetch("https://api.vercel.com/v9/projects", { headers });
const listData = await listRes.json();

if (!listRes.ok) {
  console.error("List projects failed:", listData);
  process.exit(1);
}

const project = listData.projects?.find((p) => p.name === CURRENT_NAME);
if (!project) {
  console.error(`Project "${CURRENT_NAME}" not found.`);
  console.log("Available projects:", listData.projects?.map((p) => p.name));
  process.exit(1);
}

console.log(`Found project: ${project.name} (id: ${project.id})`);

// Step 2: Rename
const renameRes = await fetch(`https://api.vercel.com/v9/projects/${project.id}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ name: NEW_NAME }),
});

const renameData = await renameRes.json();
if (!renameRes.ok) {
  console.error("Rename failed:", renameData);
  process.exit(1);
}

console.log(`✓ Renamed: ${CURRENT_NAME} → ${renameData.name}`);
console.log("\nNew URLs:");
console.log(`  https://${NEW_NAME}.vercel.app`);
console.log(`\nProject ID: ${renameData.id}`);
