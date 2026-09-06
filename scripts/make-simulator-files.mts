// Builds the INI.TXT + BKMVDATA.TXT pair that רשות המסים's simulator wants
// for the software-registry application (מרשם תוכנות לניהול מערכת חשבונות):
// the same synthetic dataset and builder the app's "מבנה אחיד: קובץ דוגמה"
// export uses, written to a folder instead of a ZIP.
//
//   npx tsx scripts/make-simulator-files.mts <out-dir>
//
// Then upload both files at
//   https://secapp.taxes.gov.il/TmbakmmsmlNew/frmCheckFiles.aspx
// (charset "Windows (ANSI) ISO-8859-8-I", no login needed). The simulator
// needs 2000+ records and a BKMVDATA under 4 MB. Field 1006 (registration
// number) stays 00000000 until the certificate is issued - that single INI
// finding is expected before registration (verified 2026-09-06).
import { writeFileSync } from "node:fs";
import { buildUniformStructure } from "../src/lib/uniform-structure/builder";
import { generateSampleDataset } from "../src/lib/uniform-structure/sample-data";
import type { Business } from "../src/lib/types";
const out = process.argv[2];
if (!out) { console.error("usage: npx tsx scripts/make-simulator-files.mts <out-dir>"); process.exit(1); }
const business: Business = { id: "biz", name: "חשבונית ידידותית - עסק לדוגמה", businessType: "authorized", taxId: "049040686", address: "התלת\"ן 12, עודים" } as Business;
const taxYear = 2026;
const sample = generateSampleDataset({ business, taxYear });
const r = buildUniformStructure({ business, documents: sample.documents, clients: sample.clients, expenses: sample.expenses, taxYear, fromDate: `${taxYear}-01-01`, toDate: `${taxYear}-12-31`, softwareName: "MySuperFriendlyInvoiceApp", softwareVersion: "1.0", softwareVendorName: "Asaf Kotler", softwareVendorTaxId: "049040686", softwareRegistrationNumber: "" });
writeFileSync(`${out}/INI.TXT`, r.ini); writeFileSync(`${out}/BKMVDATA.TXT`, r.bkmvdata);
console.log(JSON.stringify({ counts: r.counts, docs: sample.documents.length, clients: sample.clients.length, expenses: sample.expenses.length, iniBytes: r.ini.length, bkmvBytes: r.bkmvdata.length }));
