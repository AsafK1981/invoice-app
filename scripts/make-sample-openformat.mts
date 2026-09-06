// Build a small, realistic מבנה אחיד ZIP (BKMVDATA.TXT + INI.TXT) from the
// app's own record builders, for testing the import side by hand:
//
//   npx tsx scripts/make-sample-openformat.mts [out.zip]
//
// Drop the resulting ZIP on /migrate ("ייבוא הכל בלחיצה אחת") and the zone
// should detect it as N documents. Encoded Windows-1255 like real vendors do.
import JSZip from "jszip";
import { writeFileSync } from "node:fs";
import { buildC100, buildD110, type FileMeta } from "../src/lib/uniform-structure/records";
import { toWindows1255 } from "../src/lib/uniform-structure/encode";
import type { Business, Client, InvoiceDocument } from "../src/lib/types";

const out = process.argv[2] ?? "sample-openformat.zip";
const business = { taxId: "512345678", name: "סטודיו דוגמה" } as unknown as Business;
const meta = { business, taxYear: 2026, generatedAt: new Date(), softwareName: "sample" } as unknown as FileMeta;
const clients: Record<string, Client> = {
  a: { id: "c-a", name: "גין דין ענה", taxId: "034567891", phone: "054-9000684", address: "" } as unknown as Client,
  b: { id: "c-b", name: "פיניש הפקות בע\"מ", taxId: "515555555", phone: "03-5555555", address: "" } as unknown as Client,
};

type Row = { type: InvoiceDocument["type"]; number: number; date: string; client: keyof typeof clients; desc: string; subtotal: number; vat: number; status?: string };
const rows: Row[] = [
  { type: "tax_invoice_receipt", number: 9001, date: "2026-06-03T12:00:00", client: "a", desc: "שכר דירה - יוני 2026", subtotal: 4500, vat: 0, status: "paid" },
  { type: "tax_invoice", number: 9004, date: "2026-07-02T12:00:00", client: "b", desc: "הופעות - חשבונית עבור חודש יוני", subtotal: 4359, vat: 741 },
  { type: "receipt", number: 9002, date: "2026-07-03T12:00:00", client: "a", desc: "שכר דירה - יולי 2026", subtotal: 4500, vat: 0, status: "paid" },
  { type: "credit_note", number: 9005, date: "2026-07-20T12:00:00", client: "b", desc: "זיכוי - ביטול הופעה", subtotal: -1000, vat: -170 },
  { type: "tax_invoice", number: 9006, date: "2026-08-02T12:00:00", client: "b", desc: "הופעות - חשבונית עבור חודש יולי", subtotal: 4359, vat: 741, status: "cancelled" },
];

let rec = 1;
let text = "A100" + " ".repeat(90) + "\r\n";
for (const r of rows) {
  const doc = {
    id: `d-${r.number}`, type: r.type, number: r.number, date: r.date, clientName: clients[r.client].name,
    subtotal: r.subtotal, vat: r.vat, total: r.subtotal + r.vat, status: r.status ?? "sent", items: [],
  } as unknown as InvoiceDocument;
  const linkField = rows.indexOf(r) + 1;
  text += buildC100({ recordNum: ++rec, meta, doc, client: clients[r.client], linkField });
  text += buildD110({ recordNum: ++rec, meta, doc, item: { id: "i", description: r.desc, quantity: 1, unitPrice: r.subtotal, total: r.subtotal } as never, lineNumber: 1, linkField, itemCode: "ITM-000001" });
}
text += "Z900" + " ".repeat(40) + "\r\n";

const zip = new JSZip();
zip.file("OPENFRMT/51234567.26/BKMVDATA.TXT", toWindows1255(text));
zip.file("OPENFRMT/51234567.26/INI.TXT", toWindows1255("A000" + " ".repeat(60) + "\r\n"));
const buf = await zip.generateAsync({ type: "nodebuffer" });
writeFileSync(out, buf);
console.log(`wrote ${out} (${buf.length} bytes, ${rows.length} documents)`);
