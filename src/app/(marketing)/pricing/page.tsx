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
import { PLANS, STARTER_PLAN, type PlanTier } from "@/lib/plans";

export const metadata = pageMetadata({
  path: "/pricing",
  title: "מחירים - חינם לתמיד עד 5 מסמכים בחודש",
  ogTitle: "מחירים | חשבונית ידידותית",
  description:
    `חינם לתמיד עד 5 מסמכים בחודש, בלי כרטיס אשראי. מעבר לזה: מסלול בסיסי ב-${shekel("15")} לחודש (עד 30 מסמכים) או Pro ב-${shekel("25")} לחודש (ללא הגבלה). בתקופת ההשקה הכול פתוח בלי הגבלה, ולמצטרפים בהשקה החודש הראשון בתשלום חינם.`,
  keywords: [
    "מחיר תוכנת חשבוניות",
    "כמה עולה תוכנת חשבוניות",
    "תוכנת חשבוניות בחינם",
    "תוכנת חשבוניות חינם לתמיד",
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
    a: "שום חיוב לא קורה אוטומטית. מי שמוציא עד 5 מסמכים בחודש ממשיך בחינם, לתמיד. מי שצריך יותר בוחר מסלול בתשלום דרך עמוד החיוב, ומי שהצטרף בתקופת ההשקה מקבל את החודש הראשון בתשלום חינם.",
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

/** A comparison column: the display-only free tier or a chargeable tier. */
type PlanColumn = "starter" | PlanTier;

/**
 * The plan comparison rows, one per parameter, read from src/lib/plans.ts so
 * this section cannot drift from /billing. Three columns since 2026-10-01:
 * the permanent free tier (STARTER_PLAN, up to 5 documents a month) next to
 * the two paid tiers. `true`/`false` render as a check disc / a muted minus;
 * strings as-is.
 */
const PLAN_ROWS: ({ label: string } & Record<PlanColumn, CellValue>)[] = (() => {
  const s = STARTER_PLAN.limits;
  const b = PLANS.free.limits;
  const p = PLANS.pro.limits;
  const count = (n: number | null) => (n === null ? "ללא הגבלה" : `עד ${n}`);
  const all = { starter: true, free: true, pro: true };
  const flag = (pick: (l: typeof b) => boolean) => ({
    starter: pick(s),
    free: pick(b),
    pro: pick(p),
  });
  return [
    {
      label: "מסמכים בחודש",
      starter: count(s.documentsPerMonth),
      free: count(b.documentsPerMonth),
      pro: count(p.documentsPerMonth),
    },
    { label: "לקוחות", starter: count(s.clients), free: count(b.clients), pro: count(p.clients) },
    { label: "שליחת מסמכים במייל", ...all },
    { label: "PDF להדפסה והורדה", ...all },
    { label: "גיבוי ענן אוטומטי", ...all },
    { label: "שליחה מ-Gmail האישי", ...flag((l) => l.customGmail) },
    { label: "ייבוא וייצוא לאקסל", ...flag((l) => l.csvImport && l.csvExport) },
    { label: "מסך ראשי עם גרפים", ...flag((l) => l.charts) },
    { label: "לוגו עסקי על המסמכים", ...flag((l) => l.customLogo) },
    { label: "כמה אימיילים לכל לקוח", ...flag((l) => l.multipleEmailRecipients) },
  ];
})();

function Cell({ v }: { v: CellValue }) {
  if (v === true)
    return (
      <span className="yes" role="img" aria-label="כלול">
        <Check strokeWidth={3} />
      </span>
    );
  if (v === false)
    return (
      <span className="no" role="img" aria-label="לא כלול">
        <Minus strokeWidth={3} />
      </span>
    );
  return (
    <span className="val">
      <LtrText text={v} />
    </span>
  );
}

/**
 * One plan column of the comparison. Its rows are the same PLAN_ROWS the
 * labels column lists, at the same fixed height, so the three cards and the
 * labels read as one spine on desktop; on a phone the labels column hides and
 * each row shows its own `.lbl` instead.
 */
function PlanCard({ tier }: { tier: PlanColumn }) {
  const plan = tier === "starter" ? STARTER_PLAN : PLANS[tier];
  const pro = tier === "pro";
  const starter = tier === "starter";
  return (
    <div className={`v2-plan-card${pro ? " pro" : ""}`}>
      <div className="head">
        {pro ? <span className="pill">ללא הגבלה</span> : null}
        {starter ? <span className="pill">בלי כרטיס אשראי</span> : null}
        <span className="name">
          <LtrText text={plan.name} />
        </span>
        <span className="price">
          {shekel(String(plan.priceMonthly))}
          <small>{starter ? "לתמיד" : "לחודש"}</small>
        </span>
        <span className="desc">{plan.description}</span>
      </div>
      {PLAN_ROWS.map((row) => (
        <div className="row" key={row.label}>
          <span className="lbl">
            <LtrText text={row.label} />
          </span>
          <Cell v={row[tier]} />
        </div>
      ))}
      <div className="foot">
        <SignupLink className={`v2-plan-btn${pro ? "" : " ghost"}`}>
          התחילו בחינם
        </SignupLink>
      </div>
    </div>
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
 * standard sub-page chrome. Every number in the plan cards (0/15/25 ₪,
 * 5/30 docs, 10 clients, unlimited Pro) is read from src/lib/plans.ts, the same source
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
            עד 5 מסמכים בחודש המערכת חינם לתמיד. מי שמצטרף עכשיו, בתקופת
            ההשקה, מקבל את כל התכונות בלי הגבלה ובלי כרטיס אשראי - כולל חודש
            ראשון במתנה במסלול בתשלום, כשהוא ייכנס לתוקף.
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

        {/* Plans: three cards on a shared spine (2026-09-29 direction A,
            widened to three columns on 2026-10-01 for the permanent free
            tier). A labels column and the plan cards share one fixed row
            height, so every parameter reads once, across, with no table
            chrome. */}
        <section className="v2-cmp-sec">
          <div className="v2-cmp-h">
            <h2>המסלולים</h2>
            <span className="ln" />
          </div>

          <div className="v2-plans-hero">
            <p className="big">
              <span className="v2-gold">חינם לתמיד</span> עד 5 מסמכים בחודש
            </p>
            <p className="sub">
              צריכים יותר? בסיסי או <Ltr>Pro</Ltr>, ולמצטרפים בתקופת ההשקה
              החודש הראשון בתשלום חינם, כשהמסלולים ייכנסו לתוקף. ביטול בכל עת.
            </p>
          </div>

          <div className="v2-plans">
            <div className="v2-plans-labels" aria-hidden="true">
              <div className="head">
                <span>מה כלול</span>
              </div>
              {PLAN_ROWS.map((row) => (
                <div className="row" key={row.label}>
                  {/* One span: the row is a flex container, which drops the
                      whitespace text nodes LtrText emits around Latin words. */}
                  <span>
                    <LtrText text={row.label} />
                  </span>
                </div>
              ))}
            </div>
            <PlanCard tier="starter" />
            <PlanCard tier="free" />
            <PlanCard tier="pro" />
          </div>
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

        {/* Two cards, so the desktop two-up grid is symmetric (2026-09-29,
            Asaf: one lone card in a two-column grid "לא נראה טוב"). */}
        <RelatedLinks
          targets={{
            posts: ["hashbonit-digitalit-chinam-2026"],
            vs: ["greeninvoice"],
          }}
          heading="כדאי לקרוא גם"
        />

        <section className="v2-cmp-cta">
          <h2>מוכנים להתחיל? זה חינם</h2>
          <p>
            עד 5 מסמכים בחודש חינם לתמיד, בלי כרטיס אשראי. בתקופת ההשקה הכול
            פתוח: כל הפיצ׳רים של <Ltr>Pro</Ltr>. כשנתחיל לגבות נעדכן מראש, בלי
            הפתעות.
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
