// Smoke test for the מבנה אחיד generator. Loads fake input, runs the
// builder, prints record-level summary, dumps INI.txt + BKMVDATA.txt
// to ./tmp so we can eyeball the shape.
//
// Run with: npx tsx scripts/smoke-uniform-structure.ts

import { buildUniformStructure } from "../src/lib/uniform-structure/builder";
import { writeFileSync, mkdirSync } from "node:fs";
import type { Business, Client, Expense, InvoiceDocument } from "../src/lib/types";

const business: Business = {
  id: "biz-1",
  name: "אסף קוטלר",
  businessType: "exempt",
  taxId: "049040686",
  address: "התלת״ן 12, עודים",
};

const clients: Client[] = [
  { id: "client-1", name: "לקוח מבחן בע״מ", taxId: "514000000", createdAt: "2026-01-01" },
  { id: "client-2", name: "אנונימי", createdAt: "2026-01-15" },
];

const documents: InvoiceDocument[] = [
  {
    id: "doc-1",
    type: "receipt",
    number: 1001,
    date: "2026-03-15",
    clientId: "client-1",
    clientName: "לקוח מבחן בע״מ",
    status: "paid",
    items: [
      { id: "it-1", description: "שירותי ייעוץ - מרץ 2026", quantity: 10, unitPrice: 350, total: 3500 },
    ],
    subtotal: 3500,
    vat: 0,
    total: 3500,
    paymentMethod: "bank_transfer",
  },
  {
    id: "doc-2",
    type: "tax_invoice",
    number: 201,
    date: "2026-04-02",
    clientId: "client-2",
    clientName: "אנונימי",
    status: "paid",
    items: [
      { id: "it-2", description: "פיתוח אתר", quantity: 1, unitPrice: 5000, total: 5000 },
      { id: "it-3", description: "תחזוקה חודשית", quantity: 1, unitPrice: 500, total: 500 },
    ],
    subtotal: 5500,
    vat: 935,
    total: 6435,
  },
];

const expenses: Expense[] = [
  {
    id: "exp-1",
    date: "2026-02-10",
    category: "תוכנה",
    supplier: "Vercel Inc",
    amount: 20,
    description: "Vercel Hobby subscription",
    vatAmount: 0,
  },
];

const result = buildUniformStructure({
  business,
  documents,
  clients,
  expenses,
  taxYear: 2026,
  fromDate: "2026-01-01",
  toDate: "2026-12-31",
});

mkdirSync("./tmp", { recursive: true });
writeFileSync("./tmp/INI.txt", result.ini);
writeFileSync("./tmp/BKMVDATA.txt", result.bkmvdata);
writeFileSync("./tmp/INI.preview.txt", result.iniText);
writeFileSync("./tmp/BKMVDATA.preview.txt", result.bkmvdataText);

console.log("✓ Files written to ./tmp/");
console.log("  - INI.txt          (Windows-1255):", result.ini.length, "bytes");
console.log("  - BKMVDATA.txt     (Windows-1255):", result.bkmvdata.length, "bytes");
console.log();
console.log("Record counts:");
console.log("  total:", result.counts.total);
console.log("  C100 (documents):", result.counts.c100);
console.log("  D110 (items):", result.counts.d110);
console.log("  D120 (payments):", result.counts.d120);
console.log("  B100 (journal):", result.counts.b100);
console.log("  B110 (accounts):", result.counts.b110);
console.log();
console.log("BKMVDATA.txt records (first 8):");
result.bkmvdataText.split("\r\n").slice(0, 8).forEach((line: string, i: number) => {
  if (!line) return;
  console.log(`  [${String(i).padStart(2)}] code=${line.slice(0, 4)} len=${String(line.length).padStart(4)}  first50="${line.slice(0, 50)}"`);
});
console.log();
console.log("INI.txt:");
console.log(`  code=${result.iniText.slice(0, 4)} len=${result.iniText.replace(/\r\n$/, "").length}`);
console.log(`  preview: "${result.iniText.slice(0, 100)}..."`);
