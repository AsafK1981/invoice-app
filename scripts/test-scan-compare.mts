// A/B the receipt scanner (src/lib/expense-scan.ts) against REAL receipts in
// Storage. Costs money (one Anthropic call per receipt per model) - run only
// with Asaf's approval. Usage:
//   SCRATCH=<dir> npx tsx scripts/test-scan-compare.mts [model1,model2]
// Default models: claude-sonnet-5,claude-opus-5. Writes results.json to $SCRATCH.
// 2026-08-17 baseline: 4/4 receipts read identically and correctly by both.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { supabase } from "./admin.mjs";
import { scanExpenseEvidence, normalizeMediaType } from "../src/lib/expense-scan";

const env = readFileSync(".env.local", "utf8").split("\n").reduce((a: Record<string,string>, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) a[m[1]] = m[2]; return a; }, {});
const apiKey = env.ANTHROPIC_API_KEY;

const files = [
  "b33b7a8d-2453-4b71-9813-10a385ad854f/11be02b9-9a7d-44b0-997c-9f3d15692faf.jpg",
  "b33b7a8d-2453-4b71-9813-10a385ad854f/763f982d-db23-4d18-8142-0fa1ff0eea0c.jpg",
  "b33b7a8d-2453-4b71-9813-10a385ad854f/91dce70f-8a85-4537-9993-1bc16db2b3aa.jpg",
  "aeb7aaeb-a21a-42a1-bdaa-3ef0235f1068/e21fc417-8084-4950-825b-7ae875a13f81.pdf",
];
const outDir = process.env.SCRATCH!;
mkdirSync(outDir, { recursive: true });
const models = (process.argv[2] || "claude-sonnet-5,claude-opus-5").split(",");
const today = "2026-08-17";
const results: any[] = [];
for (const path of files) {
  const { data, error } = await supabase.storage.from("expense-receipts").download(path);
  if (error || !data) { console.error("download failed", path, error?.message); continue; }
  const buf = Buffer.from(await data.arrayBuffer());
  const local = `${outDir}/${path.split("/")[1]}`;
  writeFileSync(local, buf);
  const mediaType = normalizeMediaType(path.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  for (const model of models) {
    process.env.SCAN_MODEL_OVERRIDE = model;
    const t0 = Date.now();
    try {
      const r = await scanExpenseEvidence({ apiKey, data: buf.toString("base64"), mediaType, today });
      results.push({ file: path.split("/")[1], model, ms: Date.now() - t0, ...(r.ok ? { ok: true, ...r.fields } : { ok: false, reason: r.reason, message: r.message, raw: r.raw?.slice(0, 400) }) });
    } catch (e: any) {
      results.push({ file: path.split("/")[1], model, ok: false, error: e?.message?.slice(0, 300) });
    }
  }
}
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
