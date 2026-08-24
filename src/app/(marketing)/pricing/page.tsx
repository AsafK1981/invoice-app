import Link from "next/link";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
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
import { PRICING_ADVANTAGES } from "../advantages";

export const metadata = pageMetadata({
  path: "/pricing",
  title: "מחירים - חינם בהשקה, אחר כך 15-25 ₪ לחודש",
  ogTitle: "מחירים | חשבונית ידידותית",
  description:
    "בתקופת ההשקה הכול חינם, בלי כרטיס אשראי. בהמשך: מסלול בסיסי ב-15 ₪ לחודש (עד 30 מסמכים) או Pro ב-25 ₪ לחודש (ללא הגבלה), עם חודש ראשון חינם למצטרפים בהשקה.",
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
 * אותו דבר"). This page previously re-typed nine titles by hand with its own
 * flat gold icons and no body copy; that is what drifted. Nothing here picks
 * icons, colors or wording any more - PRICING_ADVANTAGES only names which
 * nine cards appear and in what order.
 */

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

        {/* Plan cards: reuses .v2-price-grid/.v2-price-card verbatim, the
            same primitive ComparisonViewV2 uses for the "us" column. */}
        <section className="v2-cmp-sec">
          <div className="v2-cmp-h">
            <h2>המסלולים שיהיו בתוקף בהמשך</h2>
            <span className="ln" />
          </div>

          <div className="v2-price-grid">
            <div className="v2-price-card">
              <h3>בסיסי</h3>
              <ul>
                <li>
                  <span className="plan">מחיר</span>
                  <span className="val">₪15 לחודש</span>
                </li>
                <li>
                  <span className="plan">מסמכים</span>
                  <span className="val">עד 30 בחודש</span>
                </li>
                <li>
                  <span className="plan">לקוחות</span>
                  <span className="val">עד 10</span>
                </li>
                <li className="trial">
                  <span className="plan">למצטרפים בהשקה</span>
                  <span className="val">חודש ראשון חינם</span>
                </li>
              </ul>
            </div>

            <div className="v2-price-card win">
              <span className="badge">ללא הגבלה</span>
              <h3>
                <Ltr>Pro</Ltr>
              </h3>
              <ul>
                <li>
                  <span className="plan">מחיר</span>
                  <span className="val">₪25 לחודש</span>
                </li>
                {/* Same three rows as בסיסי above, in the same order, so the
                    two cards read as one table and the only difference the eye
                    has to catch is 30 -> ללא הגבלה and 10 -> ללא הגבלה. The
                    "כמה עסקים באותו חשבון" row that used to sit here was
                    removed 2026-08-24 (Asaf: "תעיף מיד את העסקים... אני לא
                    מעוניין בזה"); it was also the only row with no counterpart
                    in the בסיסי card, which is what made the two cards look
                    misaligned. */}
                <li>
                  <span className="plan">מסמכים</span>
                  <span className="val">ללא הגבלה</span>
                </li>
                <li>
                  <span className="plan">לקוחות</span>
                  <span className="val">ללא הגבלה</span>
                </li>
                <li className="trial">
                  <span className="plan">למצטרפים בהשקה</span>
                  <span className="val">חודש ראשון חינם</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* What's included, drawn from real features - see FEATURES comment
            above for the verification note. */}
        <section className="v2-cmp-sec">
          <div className="v2-cmp-h">
            <h2>מה כלול</h2>
            <span className="ln" />
          </div>

          <div className="v2-adv-grid">
            {PRICING_ADVANTAGES.map((f) => (
              <div
                className={`v2-adv-card${f.flagship ? " is-flagship" : ""}${f.tone ? ` v2-adv-card--${f.tone}` : ""}`}
                key={f.key}
              >
                <div
                  className={`v2-adv-icon${f.tone ? ` v2-adv-icon--${f.tone}` : ""}`}
                  aria-hidden="true"
                >
                  {f.icon}
                </div>
                <h3>
                  <LtrText text={f.title} />
                  {f.soon ? <span className="v2-adv-soon">בבטא סגורה</span> : null}
                </h3>
                <p>
                  <LtrText text={f.body} />
                </p>
              </div>
            ))}
          </div>
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
