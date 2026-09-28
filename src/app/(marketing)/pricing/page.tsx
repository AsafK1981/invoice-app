import { shekel } from "@/lib/format";
import Link from "next/link";
import { ArrowRight, ArrowLeft, Check, Minus } from "lucide-react";
import { Ltr, LtrText } from "@/components/ui/ltr";
import { pageMetadata } from "@/lib/page-metadata";
import {
  graph,
  organization,
  breadcrumbList,
  softwareApplication,
  faqPage,
} from "@/lib/jsonld";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";
import JsonLd from "../components/JsonLd";
import RelatedLinks from "../components/RelatedLinks";
import SignupLink from "../components/SignupLink";
import IncludedFeatures from "../components/IncludedFeatures";
import { PRICING_INCLUDED } from "../advantages";
import { PLANS } from "@/lib/plans";

export const metadata = pageMetadata({
  path: "/pricing",
  title: `מחירים - חינם בהשקה, אחר כך ${shekel("15-25")} לחודש`,
  ogTitle: "מחירים | חשבונית ידידותית",
  description:
    `בתקופת ההשקה הכול חינם, בלי כרטיס אשראי. בהמשך: מסלול בסיסי ב-${shekel("15")} לחודש (עד 30 מסמכים) או Pro ב-${shekel("25")} לחודש (ללא הגבלה), עם חודש ראשון חינם למצטרפים בהשקה.`,
  keywords: [
    "מחיר תוכנת חשבוניות",
    "כמה עולה תוכנת חשבוניות",
    "תוכנת חשבוניות בחינם",
    "מחיר חשבונית לעוסק פטור",
  ],
});

/**
 * Pricing-relevant subset of the homepage FAQ (FAQ_ITEMS in
 * src/app/(marketing)/page.tsx), copied verbatim rather than imported: this
 * codebase's established pattern for pricing facts is copy-with-verification
 * (see ComparisonViewV2's own hardcoded 15/25/30, and jsonld.ts's
 * softwareApplication() featureList) rather than cross-page data imports.
 * Do not let this drift from the source - if the homepage FAQ answers
 * change, update here too.
 */
const PRICING_FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "מה קורה כשתקופת ההשקה נגמרת?",
    a: "שום חיוב לא קורה אוטומטית. כדי לעבור למסלול בתשלום צריך להירשם ולאשר את הפרטים בעצמכם דרך עמוד החיוב, ומי שהצטרף בתקופת ההשקה מקבל את החודש הראשון בתשלום חינם.",
  },
  {
    q: "האם צריך כרטיס אשראי כדי להתחיל?",
    a: "לא. אפשר להתחיל להשתמש במערכת בלי להזין פרטי אשראי.",
  },
  {
    q: "האם אפשר לבטל בכל עת?",
    a: "כן. ביטול נעשה בלחיצה מתוך עמוד \"חיוב ומסלולים\", והגישה נשארת פעילה עד סוף התקופה ששולמה.",
  },
];

/**
 * "מה כלול" - rendered from the SHARED advantage cards in
 * ../advantages.tsx, the same array the homepage grid and spotlight band
 * render (2026-08-24, Asaf: "למה פה זה בלי צבעים ובדף הראשי זה עם צבעים...
 * אני צריך שזה יראה בדיוק אותו דבר באותן צבעים ובאותם אייקונים ושזה ירשום
 * אותו דבר"). Since 2026-09-28 they render as a compact strip of small
 * tiles (IncludedFeatures) that open one shared panel with the full card
 * copy; PRICING_INCLUDED only names which twelve appear, in what order, and
 * the short tile label of each.
 */

type CellValue = string | boolean;

/**
 * The comparison table's rows. `launch` is what the launch period gives
 * today (every Pro feature, free, no card), `basic`/`pro` read the tiers'
 * limits from src/lib/plans.ts. `true`/`false` render as a check / a muted
 * minus; strings render as-is.
 */
const PLAN_ROWS: {
  label: string;
  launch: CellValue;
  basic: CellValue;
  pro: CellValue;
  trial?: true;
}[] = (() => {
  const b = PLANS.free.limits;
  const p = PLANS.pro.limits;
  const count = (n: number | null) => (n === null ? "ללא הגבלה" : `עד ${n}`);
  return [
    { label: "מסמכים בחודש", launch: "ללא הגבלה", basic: count(b.documentsPerMonth), pro: count(p.documentsPerMonth) },
    { label: "לקוחות", launch: "ללא הגבלה", basic: count(b.clients), pro: count(p.clients) },
    { label: "שליחת מסמכים במייל דרך המערכת", launch: true, basic: true, pro: true },
    { label: "PDF להדפסה והורדה", launch: true, basic: true, pro: true },
    { label: "גיבוי ענן אוטומטי", launch: true, basic: true, pro: true },
    { label: "שליחה מ-Gmail האישי שלכם", launch: true, basic: b.customGmail, pro: p.customGmail },
    { label: "ייבוא וייצוא לאקסל / CSV", launch: true, basic: b.csvImport && b.csvExport, pro: p.csvImport && p.csvExport },
    { label: "מסך ראשי עם גרפים מלאים", launch: true, basic: b.charts, pro: p.charts },
    { label: "לוגו עסקי על המסמכים", launch: true, basic: b.customLogo, pro: p.customLogo },
    { label: "כמה אימיילים לכל לקוח", launch: true, basic: b.multipleEmailRecipients, pro: p.multipleEmailRecipients },
    { label: "כרטיס אשראי", launch: "לא צריך", basic: "בהרשמה למסלול", pro: "בהרשמה למסלול" },
    { label: "למצטרפים בהשקה", launch: "הכול חינם", basic: "חודש ראשון חינם", pro: "חודש ראשון חינם", trial: true },
  ];
})();

function Cell({ v }: { v: CellValue }) {
  if (v === true)
    return (
      <span className="yes" aria-label="כלול">
        <Check strokeWidth={2.5} />
      </span>
    );
  if (v === false)
    return (
      <span className="no" aria-label="לא כלול">
        <Minus strokeWidth={2.5} />
      </span>
    );
  return (
    <span className="val">
      <LtrText text={v} />
    </span>
  );
}

/**
 * /pricing - a dedicated pricing page, replacing the "מחירים" nav links'
 * previous target of /#pricing (the homepage's pricing section, which keeps
 * its `id="pricing"` so old deep links still resolve).
 *
 * Wired like /vs and /accessibility (HeaderV2 + FooterV2 + the shared
 * `.v2-cmp` wide container), not like the homepage's HeaderLight/ml-theme:
 * this is a secondary page, not the landing page, so it gets the site's
 * standard sub-page chrome. Every number on this page (15/25 ₪, 30 docs,
 * 10 clients, unlimited Pro) is read from src/lib/plans.ts, the same source
 * ComparisonViewV2 and the homepage's pricing band already draw from.
 */
export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={graph(
          organization(),
          breadcrumbList([
            { name: "בית", path: "/" },
            { name: "מחירים", path: "/pricing" },
          ]),
          softwareApplication(),
          faqPage(PRICING_FAQ_ITEMS),
        )}
      />

      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      <main id="main-content" className="v2-cmp">
        <Link href="/" className="v2-back">
          <ArrowRight />
          חזרה לעמוד הבית
        </Link>

        <div className="v2-vs-head">
          <div className="v2-eyebrow-row">
            <i className="ln" />
            <span>מחירים</span>
            <i className="ln r" />
          </div>
          <h1 className="v2-h1">
            תמחור פשוט שגדל איתכם, <br />
            <span className="v2-gold">ובתקופת ההשקה הכול חינם</span>
          </h1>
          <p className="v2-lede">
            מי שמצטרף עכשיו, בתקופת ההשקה, מקבל את כל התכונות בחינם ובלי
            כרטיס אשראי - כולל חודש ראשון במתנה במסלול בתשלום, כשהוא ייכנס
            לתוקף.
          </p>
        </div>

        {/* Launch banner: the same heading and the same three "בלי" promises
            as the homepage's pricing band, and now the same SHAPE too -
            centred title over one horizontal check row (2026-08-24). It used
            to borrow `.v2-str`, the /vs strengths checklist, which stacks its
            items right-aligned: inside a 1112px panel that left three short
            lines hugging the right edge and two thirds of the box empty. The
            homepage's `.ml-price-frees` was a centred row all along. */}
        <section className="v2-cmp-sec">
          <div className="v2-panel v2-launch">
            <h3>בתקופת ההשקה, הכול חינם</h3>
            <ul>
              <li>
                <Check strokeWidth={2.5} />
                <span>בלי הגבלת מסמכים</span>
              </li>
              <li>
                <Check strokeWidth={2.5} />
                <span>בלי כרטיס אשראי</span>
              </li>
              <li>
                <Check strokeWidth={2.5} />
                <span>בלי התחייבות</span>
              </li>
            </ul>
          </div>
        </section>

        {/* One comparison table instead of two plan cards (2026-09-28, Asaf:
            "לסדר אותו לטבלה אחת שמראה את אותם פרמטרים... לכל תוכנית"). Every
            row is the same parameter across three columns: what the launch
            period gives today (everything, free), then בסיסי and Pro as they
            will apply later. Limits and feature flags are read from
            src/lib/plans.ts so the table cannot drift from /billing. */}
        <section className="v2-cmp-sec">
          <div className="v2-cmp-h">
            <h2>מה מקבלים בכל מסלול</h2>
            <span className="ln" />
          </div>

          <div className="v2-plan-table-wrap">
            <table className="v2-plan-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">פרמטר</span>
                  </th>
                  <th scope="col">
                    <span className="name">עכשיו, בהשקה</span>
                    <span className="price">חינם</span>
                  </th>
                  <th scope="col">
                    <span className="name">{PLANS.free.name}</span>
                    <span className="price">{shekel(String(PLANS.free.priceMonthly))} לחודש</span>
                  </th>
                  <th scope="col" className="win">
                    <span className="pill">ללא הגבלה</span>
                    <span className="name">
                      <Ltr>{PLANS.pro.name}</Ltr>
                    </span>
                    <span className="price">{shekel(String(PLANS.pro.priceMonthly))} לחודש</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {PLAN_ROWS.map((row) => (
                  <tr key={row.label} className={row.trial ? "trial" : undefined}>
                    <th scope="row">
                      <LtrText text={row.label} />
                    </th>
                    <td>
                      <Cell v={row.launch} />
                    </td>
                    <td>
                      <Cell v={row.basic} />
                    </td>
                    <td className="win">
                      <Cell v={row.pro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="v2-plan-foot">
            כשנתחיל לגבות נעדכן מראש. ביטול בכל עת, בלי התחייבות.
          </p>
        </section>

        {/* What's included, drawn from real features - see FEATURES comment
            above for the verification note. */}
        <section className="v2-cmp-sec">
          <div className="v2-cmp-h">
            <h2>מה כלול</h2>
            <span className="ln" />
          </div>

          <IncludedFeatures items={PRICING_INCLUDED} />
        </section>

        {/* Pricing-specific FAQ */}
        <section className="v2-cmp-sec">
          <div className="v2-cmp-h">
            <h2>שאלות נפוצות על המחיר</h2>
            <span className="ln" />
          </div>

          <div className="v2-faq">
            {PRICING_FAQ_ITEMS.map((item) => (
              <div className="v2-faq-item" key={item.q}>
                <p className="v2-faq-q">{item.q}</p>
                <p className="v2-faq-a">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        <RelatedLinks
          targets={{ posts: ["hashbonit-digitalit-chinam-2026"] }}
          heading="כדאי לקרוא גם"
        />

        <section className="v2-cmp-cta">
          <h2>מוכנים להתחיל? זה חינם עכשיו</h2>
          <p>
            בתקופת ההשקה הכול פתוח: כל הפיצ׳רים של <Ltr>Pro</Ltr>, בלי כרטיס
            אשראי. כשנתחיל לגבות נעדכן מראש, בלי הפתעות.
          </p>
          <div className="row">
            <SignupLink className="v2-cta">
              התחילו בחינם
            </SignupLink>
            <Link href="/vs" className="ghost">
              <ArrowLeft />
              השוו אותנו למתחרים
            </Link>
          </div>
        </section>
      </main>

      <FooterV2 />
    </>
  );
}
