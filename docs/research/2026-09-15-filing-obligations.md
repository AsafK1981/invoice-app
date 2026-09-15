# Filing obligations for Israeli freelancers (2026)

Researched 2026-09-15 for the `/obligations` calendar (`src/lib/ita/filing-calendar.ts`).
gov.il blocks headless fetchers (Cloudflare 403), so official pages were read in a real
Chrome window (`govil-text.mjs` pattern: non-headless Chrome, throwaway profile, CDP
`document.body.innerText`). Confidence: **verified** = read on the official page itself;
**kolzchut** = kolzchut.org.il; **secondary** = accounting firms or software vendors.

## Verified on official pages

| Fact | Source |
|---|---|
| By law: periodic VAT report and income-tax advances due on the 15th, deductions on the 16th, detailed VAT report on the 23rd. The 2026 table of actual dates (holiday shifts) is copied into `OFFICIAL_DEADLINES`. A statutory date on Friday, Saturday or Sunday moves to the following Monday (section 4). | "קביעת מועדי הדיווח והתשלום - שנת המס 2026", published 15.10.2025, https://www.gov.il/he/pages/pa151025-2 |
| Online VAT periodic reports: "ניתן לדווח ולשלם עד ל-19 בכל חודש (במקום עד ל-15 בכל חודש)". Login: personal-area username and password, or smart card. | https://www.gov.il/he/service/reporting-or-payment-of-vat-reports |
| Advances: "דיווח שיוגש עד ה-19 לחודש בשעה 18:30 - ייחשב דיווח במועד". Pay by card or bank transfer. | https://www.gov.il/he/service/itc-payment-online-incometax |
| Detailed VAT report service exists; for dealers required to file it, volunteers, and refund reports above the regulation 23(ג) amount. | https://www.gov.il/he/service/detailed-vat-reporting |
| Annual report for tax year 2025: 29.5.2026 for non-online filers, 30.6.2026 for online filers. The 2026 page does not exist yet (404 on 2026-09-15). | https://www.gov.il/he/service/reporting-and-payment-2025-annual-tax-report-for-individuals |
| Capital declaration: only for whoever received a demand from the assessing office. | https://www.gov.il/he/service/itc1219 |
| National insurance payments portal for the self-employed. | https://b2b.btl.gov.il/BTL.ILG.Payments/HomePage.aspx |
| Exempt dealer declaration service page. | https://www.gov.il/he/service/vat-declarationisexempt (search result on gov.il; the old misim.gov.il address timed out) |

## Kolzchut / secondary (shown with softer wording in the app)

- Exempt dealer annual declaration by 31 January (תקנה 15 לתקנות מע"מ רישום). Kolzchut, high.
- Exempt dealer ceiling 2026: 122,833 ₪ (already in `tax-thresholds`). Kolzchut + bizportal, high.
- Bi-monthly VAT reporting up to 1,775,000 ₪ turnover from 1.1.2026 (kolzchut, citing section 67(א2)(1)); several CPA blogs still cite ~1.5M. The app does not state a threshold; the owner picks the cadence.
- Detailed VAT reporting for individuals with annual turnover above 500,000 ₪ from 1.1.2026. Secondary (amir-cpa, bitancpa), medium-high; shown as "בדקו מול רואה החשבון".
- National insurance advances: the 15th of the month for the previous month, the 22nd by standing order. Kolzchut, high.
- Annual report statutory date 30 April after the tax year; extensions announced yearly. Kolzchut, high.
- Capital declaration: 120 days from the demand. Secondary, medium-high; shown as "בדרך כלל".
- Mandatory pension for the self-employed (2017 law): ages 21-60, born after 1961, at least six months of activity, deposits by 31 December. Kolzchut + secondary, medium.

## Not modelled / open

- Holiday shifts for years without a published table (the app shows the statutory date and says so).
- "עסק זעיר" shortened annual report (https://www.gov.il/he/service/report-and-payment-for-micro-business-owner) appeared in search; not researched yet.
- National insurance registration window when starting a business (kolzchut says "at the start", a secondary source says 90 days). Not shown.
