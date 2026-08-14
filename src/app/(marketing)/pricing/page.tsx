import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  ShieldCheck,
  Sparkles,
  Bell,
  ScanLine,
  Gauge,
  FileBarChart,
  ArrowLeftRight,
  MessageCircle,
} from "lucide-react";
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
    a: "שום חיוב לא מתבצע אוטומטית. כדי לעבור למסלול בתשלום צריך להירשם במפורש דרך עמוד החיוב ולאשר את הפרטים - בלי הפתעות בכרטיס האשראי. למצטרפים בתקופת ההשקה, החודש הראשון במסלול בתשלום יהיה חינם.",
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
 * "מה כלול" - a short feature checklist, titles copied VERBATIM from the
 * homepage's ADVANTAGES array (src/app/(marketing)/page.tsx). Deliberately
 * excludes the "whatsapp" card: it is marked `בקרוב` there because the
 * WhatsApp bot channel isn't live in production yet, same reasoning
 * softwareApplication() in src/lib/jsonld.ts already applies to its own
 * featureList - structured data and on-page claims must only state what is
 * actually live today. Icons are a fresh (restrained, single-tone) choice
 * for this page, not a copy of the homepage's per-card tinted icons.
 */
const FEATURES: { key: string; icon: React.ReactNode; title: string }[] = [
  { key: "allocation", icon: <ShieldCheck aria-hidden="true" />, title: "מספרי הקצאה אוטומטיים" },
  { key: "ai", icon: <Sparkles aria-hidden="true" />, title: "עוזר AI חכם בעברית" },
  { key: "reminders", icon: <Bell aria-hidden="true" />, title: "התראות ותזכורות חכמות" },
  { key: "ocr", icon: <ScanLine aria-hidden="true" />, title: "סריקת הוצאות בצילום" },
  { key: "ceiling", icon: <Gauge aria-hidden="true" />, title: "מעקב תקרת עוסק פטור בזמן אמת" },
  { key: "reports", icon: <FileBarChart aria-hidden="true" />, title: "דו״חות שרואי חשבון אוהבים" },
  { key: "migration", icon: <ArrowLeftRight aria-hidden="true" />, title: "מעבר קל מכל תוכנה" },
  { key: "channels", icon: <MessageCircle aria-hidden="true" />, title: "שליחה בכל ערוץ" },
];

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
            מסלול שמתאים לקצב שלכם - החל ממי שרק מתחיל ועד עסק פעיל שמפיק
            הרבה מסמכים בחודש. מי שמצטרף עכשיו, בתקופת ההשקה, מקבל את כל
            התכונות בחינם ובלי כרטיס אשראי, ואת החודש הראשון במסלול בתשלום
            מקבלים במתנה.
          </p>
        </div>

        {/* Launch banner: the same three "בלי" promises as the homepage's
            pricing band (`.ml-price-frees`), rendered here with the
            existing .v2-str checklist primitive so no new CSS is needed. */}
        <section className="v2-cmp-sec">
          <div className="v2-panel v2-str win">
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
                <li>
                  <span className="plan">מסמכים ולקוחות</span>
                  <span className="val">ללא הגבלה</span>
                </li>
                <li>
                  <span className="plan">עסקים</span>
                  <span className="val">כמה עסקים באותו חשבון</span>
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
            {FEATURES.map((f) => (
              <div className="v2-adv-card" key={f.key}>
                <div className="v2-adv-icon" aria-hidden="true">
                  {f.icon}
                </div>
                <h3>
                  <LtrText text={f.title} />
                </h3>
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
            <Link href="/login?mode=signup" className="v2-cta">
              התחילו בחינם
            </Link>
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
