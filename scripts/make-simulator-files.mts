// Builds the registration package for מרשם תוכנות לניהול מערכת חשבונות
// (רשות המסים): the INI.TXT + BKMVDATA.TXT pair the simulator wants, laid out
// in the spec folder OPENFRMT/<dealer>.<YY>/<MMDDhhmm>/, plus the printed
// outputs of sections 2.6 and 5.4 rendered from the SAME run through the
// app's own report component, so the printouts reconcile with the files
// (רישום תוכנות insists on that).
//
//   npx tsx scripts/make-simulator-files.mts <out-dir>
//
// Writes:
//   <out-dir>/OPENFRMT/<dealer>.<YY>/<MMDDhhmm>/INI.TXT + BKMVDATA.TXT
//   <out-dir>/report.json           what the app sends in X-Uniform-Report
//   <out-dir>/printouts-2.6-5.4.html  print this to PDF (A4)
//
// Then upload both files at
//   https://secapp.taxes.gov.il/TmbakmmsmlNew/frmCheckFiles.aspx
// (charset "Windows (ANSI) ISO-8859-8-I", no login needed). The simulator
// needs 2000+ records and a BKMVDATA under 4 MB. Field 1006 (registration
// number) is 00000000 until the certificate is issued; רישום תוכנות confirmed
// (2026-09-07) that this is the right value for a first registration and that
// the one INI finding it causes is expected - note "רישום לראשונה" on the
// defect report.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildUniformStructure } from "../src/lib/uniform-structure/builder";
import { generateSampleDataset } from "../src/lib/uniform-structure/sample-data";
import { UNIFORM_SOFTWARE } from "../src/lib/uniform-structure/software";
import { ReportBody, type UniformReportData } from "../src/components/uniform-structure-report";
import type { Business } from "../src/lib/types";

const out = process.argv[2];
if (!out) { console.error("usage: npx tsx scripts/make-simulator-files.mts <out-dir>"); process.exit(1); }

// The demo business the synthetic dataset belongs to. Its dealer number is the
// software house's own, so A000 field 1004 (dealer) and 1007 (vendor) agree.
const business: Business = {
  id: "biz",
  name: "חשבונית ידידותית - עסק לדוגמה",
  businessType: "authorized",
  taxId: UNIFORM_SOFTWARE.vendorTaxId,
  address: "התלת\"ן 12, עודים",
} as Business;
const taxYear = new Date().getFullYear();
const fromDate = `${taxYear}-01-01`;
const toDate = `${taxYear}-12-31`;

const sample = generateSampleDataset({ business, taxYear });
const r = buildUniformStructure({
  business,
  documents: sample.documents,
  clients: sample.clients,
  expenses: sample.expenses,
  taxYear,
  fromDate,
  toDate,
});

// Same layout as the app's ZIP (see api/uniform-structure/export/route.ts).
const pad = (n: number) => String(n).padStart(2, "0");
const at = r.generatedAt;
const dealer = business.taxId.replace(/\D/g, "").slice(0, 8).padStart(8, "0");
const path = `OPENFRMT/${dealer}.${String(at.getFullYear()).slice(-2)}/${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}`;
mkdirSync(`${out}/${path}`, { recursive: true });
writeFileSync(`${out}/${path}/INI.TXT`, r.ini);
writeFileSync(`${out}/${path}/BKMVDATA.TXT`, r.bkmvdata);

const report: UniformReportData = {
  generatedAt: at.toISOString(),
  path,
  fromDate,
  toDate,
  taxYear,
  sample: false, // the package is the real submission, not an in-app demo
  software: {
    name: UNIFORM_SOFTWARE.name,
    version: UNIFORM_SOFTWARE.version,
    registrationNumber: UNIFORM_SOFTWARE.registrationNumber,
  },
  counts: r.counts,
  docTypes: r.docTypeSummary.map((d) => [d.code, d.count, d.total]),
};
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));

// The printouts: the app's ReportBody, its own CSS block, Heebo, A4.
const css = readFileSync("src/app/app-skin.css", "utf8");
const start = css.indexOf("/* ===== דוח הפקה - מבנה אחיד");
const usrCss = start >= 0 ? css.slice(start) : "";
const body = renderToStaticMarkup(
  createElement(ReportBody, { report, businessName: business.name, taxId: business.taxId }),
);
const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>פלטים לאימות נתונים - סעיפים 2.6 ו-5.4</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 15mm; }
  body { margin: 0; font-family: Heebo, Arial, sans-serif; color: #1c1917; background: #fff; }
  .usr-print-head { margin-bottom: 1rem; }
  .usr-print-biz { font-weight: 700; }
  .usr-print-title { font-size: 1.2rem; font-weight: 700; margin: 0.15rem 0 0; }
  ${usrCss}
</style>
</head>
<body>
<section class="usr-print" dir="rtl">
  <header class="usr-print-head">
    <div class="usr-print-biz">${business.name}</div>
    <h1 class="usr-print-title">דוח הפקה - קבצים במבנה אחיד (גרסה 1.31)</h1>
  </header>
  ${body}
</section>
</body>
</html>
`;
writeFileSync(`${out}/printouts-2.6-5.4.html`, html);

console.log(JSON.stringify({
  path,
  software: report.software,
  counts: r.counts,
  docs: sample.documents.length,
  clients: sample.clients.length,
  expenses: sample.expenses.length,
  iniBytes: r.ini.length,
  bkmvBytes: r.bkmvdata.length,
}));
