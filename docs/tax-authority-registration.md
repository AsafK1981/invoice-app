# Tax Authority "Israel Invoice" — Software House Registration

This is the **single source of truth** for the registration process with
רשות המיסים for our integration with the "חשבונית ישראל" (Israel Invoice)
API. Fill out the values below once; copy from here into the gov.il forms.

The same details should be reused on every form / email exchange so the
Tax Authority sees a coherent application.

---

## Standard application values

| Field | Value |
| --- | --- |
| **Software (English)** | MySuperFriendlyInvoiceApp |
| **Software (Hebrew)** | MySuperFriendlyInvoiceApp — אפליקציית חשבוניות |
| **Software type** | Web SaaS (Next.js + Supabase, hosted on Vercel) |
| **Production URL** | https://mysuperfriendlyinvoiceapp.vercel.app |
| **OAuth callback URL** | https://mysuperfriendlyinvoiceapp.vercel.app/api/tax-authority/callback |
| **Status page** | https://mysuperfriendlyinvoiceapp.vercel.app/status |
| **Privacy policy** | https://mysuperfriendlyinvoiceapp.vercel.app/privacy |
| **Terms of service** | https://mysuperfriendlyinvoiceapp.vercel.app/terms |
| **Security.txt** | https://mysuperfriendlyinvoiceapp.vercel.app/.well-known/security.txt |
| **Vendor name** | Asaf Kotler (sole proprietor / עוסק) |
| **Vendor type** | יחיד / עוסק פטור |
| **Vendor tax ID** | _<fill in your 9-digit ID number>_ |
| **Vendor address** | התלת"ן 12, עודים |
| **Vendor postal code** | _<lookup needed — Udim>_ |
| **Phone** | +972 54 900 0684 |
| **Technical contact email** | asafkotlar@gmail.com |
| **Support contact email** | asafkotlar@gmail.com |

## Hebrew description (paste into "תיאור התוכנה" / app description fields)

```
MySuperFriendlyInvoiceApp היא אפליקציית web לניהול חשבוניות וקבלות לעצמאיים
בישראל. האפליקציה מאפשרת הפקה של חשבוניות מס, קבלות, חשבוניות מס/קבלה,
חשבונות עסקה, וחשבוניות זיכוי. כוללת ניהול לקוחות, מוצרים, הוצאות, דוחות
שנתיים, ויצוא נתונים לאקסל. מטרת החיבור ל-API של רשות המיסים: קבלת מספרי
הקצאה לחשבוניות מס במסגרת רפורמת "חשבונית ישראל".
```

## Server IPs (if asked — Vercel runs from many edges, give a representative)

Vercel doesn't pin static IPs for serverless functions. Mention this if
asked; if the Tax Authority requires whitelisting we will request a
Vercel "static IP" add-on or move the integration to a fixed-IP egress.

## Required APIs / scopes

For our integration, request access to:

- **`Invoices`** — POST `/Invoices/v1/Approval` (the allocation-number endpoint)
- _Optional later:_ `VATReportApi` (VAT periodic reports)
- _Optional later:_ `invoice-information` (reverse lookup by allocation number)

---

## Process — step by step

### Step 1: Register at the developer portal

URL: https://openapi-portal.taxes.gov.il/shaam/production/user/register

Fields: see standard values above. After submitting, confirm the
verification email sent to `asafkotlar@gmail.com`.

### Step 2: Create an app and request API access

Once logged in:

1. Profile → "Create an App" (or `+ New App`)
2. Name: `MySuperFriendlyInvoiceApp`
3. Description: paste the Hebrew block above
4. Callback URL: paste from the table
5. Select APIs: check `Invoices`
6. Submit

The portal will issue a **`client_id`** and **`client_secret`** — keep
these safe.

### Step 3: Get the `Accounting_Software_Number`

If the portal does not automatically issue this:

Email `apisupport@taxes.gov.il` with:

```
Subject: בקשה לקבלת Accounting_Software_Number עבור MySuperFriendlyInvoiceApp

שלום,

שמי אסף קוטלר. נרשמתי לפורטל ה-API ויצרתי אפליקציה בשם
"MySuperFriendlyInvoiceApp" עם Client ID: <paste your client_id>.

אבקש לקבל את ה-Accounting_Software_Number המוקצה לאפליקציה זו לצורך
בקשת מספרי הקצאה לחשבוניות מס (Invoice_Type 305, 320, 330) במסגרת
רפורמת חשבונית ישראל.

פרטי האפליקציה:
- שם: MySuperFriendlyInvoiceApp
- URL: https://mysuperfriendlyinvoiceapp.vercel.app
- סוג: SaaS לעצמאיים בישראל
- Callback: https://mysuperfriendlyinvoiceapp.vercel.app/api/tax-authority/callback

אני זמין במייל זה ובטלפון +972 54 900 0684.

תודה,
אסף קוטלר
```

### Step 4: Set env vars in Vercel

Once `client_id`, `client_secret`, and `Accounting_Software_Number` are
all in hand, set in Vercel project env (production + preview):

```
TAX_AUTHORITY_CLIENT_ID=<value>
TAX_AUTHORITY_CLIENT_SECRET=<value>
TAX_AUTHORITY_SOFTWARE_NUMBER=<value>
TAX_AUTHORITY_ENV=sandbox        # flip to "production" after live testing
```

Trigger a redeploy. The `<TaxAuthoritySection />` in `/settings` flips
from "coming soon" to "Connect to Tax Authority" automatically.

### Step 5: Sandbox testing

Use a sandbox-only עוסק מורשה account that the Tax Authority issues
during onboarding. Verify:

1. OAuth handshake completes (settings card shows "Connected")
2. Create a fake tax invoice ≥ ₪10,000
3. Hit "קבל אוטומטית" on the doc page
4. Allocation number lands on the document

### Step 6: Flip to production

After 1-2 weeks of stable sandbox use:

1. Email `apisupport@taxes.gov.il` requesting production access
2. They flip a flag on our `client_id`
3. Update `TAX_AUTHORITY_ENV=production`
4. Redeploy

---

## Separate (non-blocking): Software Registry

The "מרשם תוכנות לניהול מערכת חשבונות" registration at
https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system
is a separate process that issues an official certificate (תעודת רישום
תוכנה). It takes up to **90 days** to process and is not required for
API access — but it lets businesses verify our app at
misim.gov.il/mm_tocna/.

Worth submitting in parallel; not on the critical path.

---

## Contact info collected

- API support: `apisupport@taxes.gov.il`
- General SHAAM contact: https://secapp.taxes.gov.il/sr-pniyot-shaam
- Developer portal: https://openapi-portal.taxes.gov.il/
- Production API: https://openapi.taxes.gov.il/shaam/production
- Sandbox API: https://openapi.taxes.gov.il/shaam/tsandbox
- ITA endpoints (production): https://ita-api.taxes.gov.il/shaam/production
- ITA endpoints (sandbox): https://ita-api.taxes.gov.il/shaam/tsandbox
