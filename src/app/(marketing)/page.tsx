import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  MessageCircle,
  ScanLine,
  Gauge,
  FileBarChart,
  ArrowLeftRight,
} from "lucide-react";
import { Ltr, LtrText } from "@/components/ui/ltr";
import { COMPETITORS } from "@/lib/comparison-data";
import HeaderLight from "./components/HeaderLight";
import FooterLight from "./components/FooterLight";
import RedirectIfAuthed from "./components/RedirectIfAuthed";
import JsonLd from "./components/JsonLd";
import { graph, organization, website, softwareApplication, faqPage } from "@/lib/jsonld";
import "./marketing-light.css";

/**
 * Landing-page FAQ. Every answer is a factual claim about THIS app, verified
 * against the actual code before writing (not generic SaaS marketing copy):
 *   - launch-period billing: no plan-enforcement/auto-charge code exists;
 *     the only way to start paying is the explicit checkout flow in
 *     src/app/api/billing/checkout/route.ts, which always requires the user
 *     to click "subscribe" and complete a hosted checkout.
 *   - no credit card required to start: src/lib/plans.ts docstring
 *     ("Trial: 30 days, no credit card required") + the /billing page's
 *     own launch-period banner.
 *   - cancel anytime: src/app/(app)/billing/page.tsx cancel flow keeps
 *     access until period end, no lock-in.
 *   - allocation numbers: src/lib/tax-authority.ts + the one-click flow in
 *     src/app/api/tax-authority/request-allocation/route.ts (server-side
 *     API call to רשות המסים, not a manual copy/paste form).
 * This list is also fed into faqPage() below so the same questions are
 * eligible for a rich FAQ result, kept in sync by construction, no
 * duplicate copy to drift. UNCHANGED by the 2026-08-10 "warm friendly"
 * redesign - only its container's paint job changed, see `.ml-faq` in
 * marketing-light.css.
 */
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "מה קורה כשתקופת ההשקה נגמרת?",
    a: "שום חיוב לא מתבצע אוטומטית. כדי לעבור למסלול בתשלום צריך להירשם במפורש דרך עמוד החיוב ולאשר את הפרטים - בלי הפתעות בכרטיס האשראי.",
  },
  {
    q: "האם צריך כרטיס אשראי כדי להתחיל?",
    a: "לא. אפשר להתחיל להשתמש במערכת בלי להזין פרטי אשראי.",
  },
  {
    q: "האם אפשר לבטל בכל עת?",
    a: "כן. ביטול נעשה בלחיצה מתוך עמוד \"חיוב ומסלולים\", והגישה נשארת פעילה עד סוף התקופה ששולמה.",
  },
  {
    q: "האם המסמכים עומדים בדרישות רשות המסים?",
    a: "כן. המערכת שומרת מספור רציף לכל סוג מסמך, מסמנת נכון מקור מול העתק לפי הוראות ניהול ספרים, ותומכת בבקשת מספר הקצאה מרשות המסים כשנדרש.",
  },
  {
    q: "מה זה מספר הקצאה ואיך זה עובד כאן?",
    a: "זה מספר שרשות המסים מנפיקה לחשבוניות מעל סכום מסוים (מ-2026: מעל 5,000 ש\"ח לפני מע\"מ ללקוח עסקי), נדרש כדי שהלקוח יוכל לנכות מע\"מ. אחרי חיבור חד-פעמי מול רשות המסים, המערכת מבקשת את המספר ישירות מולה בלחיצה אחת, בלי טפסים ידניים.",
  },
];

/**
 * "כל מה שיש רק אצלנו" - the competitive-advantage grid, now positioned
 * high on the page (right after the hero) per the approved warm redesign.
 * Cards state OUR capabilities only (no competitor names - the comparison
 * strip below hands off to the /vs pages for the head-to-head).
 *
 * `tone` gives every non-flagship card its own soft-tinted icon tile
 * (Asaf 2026-08-10: the approved mockup shipped with 8 of 9 tiles dull and
 * near-identical; he asked for every card to get real, distinct color).
 * Formula: tile background = Tailwind `*-100`, icon stroke = `*-600`, see
 * `.ml-adv-icon--*` in marketing-light.css. The allocation card keeps no
 * `tone` - it is the one `flagship` card and gets the full brand-gradient
 * tile with a white glyph instead, the strongest treatment on the page.
 *
 * Body copy: kept the previous (verified) copy for every card except
 * "allocation" and "whatsapp", where the approved mockup's phrasing is
 * strictly tighter without dropping any verified fact. The rest keep
 * specifics the mockup's copy did not carry (VAT/date OCR + Bit/bank
 * screenshots, credit-note-aware ceiling tracking, the named report list,
 * the migration wizards) rather than trade accuracy for brevity.
 */
type AdvantageTone =
  | "violet"
  | "amber"
  | "green"
  | "pink"
  | "teal"
  | "indigo"
  | "sky"
  | "orange";

type Advantage = {
  key: string;
  icon: ReactNode;
  title: string;
  body: string;
  tone?: AdvantageTone;
  flagship?: true;
  comingSoon?: boolean;
};

const ADVANTAGES: Advantage[] = [
  {
    key: "allocation",
    flagship: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    title: "מספרי הקצאה אוטומטיים",
    body: "המערכת מבקשת מספר הקצאה מרשות המסים ומקבלת אותו תוך שניות, ישירות מתוך המסמך.",
  },
  {
    key: "ai",
    tone: "violet",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
        <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
      </svg>
    ),
    title: "עוזר AI חכם בעברית",
    body: "שאלו בשפה חופשית: כמה הכנסתי החודש? איפה החשבונית של דנה? העוזר מוצא, עונה ומכין טיוטות - ואתם רק מאשרים.",
  },
  {
    key: "reminders",
    tone: "amber",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3a5 5 0 0 0-5 5c0 5.5-2 7-2 7h14s-2-1.5-2-7a5 5 0 0 0-5-5z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
    ),
    title: "התראות ותזכורות חכמות",
    body: "תזכורת חודשית להוציא מסמכים בימים ובשעה שאתם בוחרים, ותזכורות תשלום אוטומטיות ללקוחות שמאחרים - במייל ובאפליקציה.",
  },
  {
    key: "whatsapp",
    tone: "green",
    comingSoon: true,
    icon: <MessageCircle aria-hidden="true" />,
    title: "וואטסאפ בלי לפתוח את האפליקציה",
    body: "מוציאים קבלה ורושמים הוצאה ישירות מתוך הצ'אט, בלי להתחבר בכלל.",
  },
  {
    key: "ocr",
    tone: "pink",
    icon: <ScanLine aria-hidden="true" />,
    title: "סריקת הוצאות בצילום",
    body: "מצלמים קבלה - והמערכת ממלאת לבד ספק, סכום, מע״מ ותאריך. גם צילומי מסך של ביט או העברה בנקאית.",
  },
  {
    key: "ceiling",
    tone: "teal",
    icon: <Gauge aria-hidden="true" />,
    title: "מעקב תקרת עוסק פטור בזמן אמת",
    body: "רואים בכל רגע כמה נשאר עד התקרה השנתית, כולל התחשבות בחשבוניות זיכוי.",
  },
  {
    key: "reports",
    tone: "indigo",
    icon: <FileBarChart aria-hidden="true" />,
    title: "דו״חות שרואי חשבון אוהבים",
    body: "דוח מע״מ תקופתי, עזר ל-1301, הצהרת הון, גיול חובות ויומן שנתי - הכל מוכן להורדה.",
  },
  {
    key: "migration",
    tone: "sky",
    icon: <ArrowLeftRight aria-hidden="true" />,
    title: "מעבר קל מכל תוכנה",
    body: "ייבוא היסטוריה מ-Excel ומהתוכנות המוכרות, אשפי מעבר ייעודיים - ולא מאבדים אף מסמך.",
  },
  {
    key: "channels",
    tone: "orange",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
      </svg>
    ),
    title: "שליחה בכל ערוץ",
    body: "מייל, וואטסאפ או קישור ציבורי מעוצב - הלקוח מקבל מסמך מקצועי בלי להתקין כלום.",
  },
];

/** Small checkmark used by the trust row and the sample-document feature
 *  list - one glyph, reused, matching the approved mockup. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.3l3.2 3.2L13 4.5" />
    </svg>
  );
}

/** The trailing chevron on "לכל ההשוואות". */
function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3.5L5 8l5 4.5" />
    </svg>
  );
}

/**
 * Self-canonical only, and DELIBERATELY nothing else.
 *
 * A child route that specifies `openGraph` REPLACES the parent's entire
 * openGraph block rather than merging into it, the trap documented in
 * vs-metadata.ts, and how every /vs page once previewed as the homepage. The
 * root layout already sets the correct absolute og:url for `/`, so declaring
 * openGraph here could only make things worse. Title and description are
 * likewise inherited from the root on purpose.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * `/`, the public marketing landing: the "warm friendly" composition
 * approved 2026-08-10 (replacing the "product showcase on obsidian" design
 * from 2026-07-27).
 *
 * Ported faithfully from the approved mockup (cream page, warm stone body
 * copy, orange->rose gradient on primary CTAs, gold-tint accent cards,
 * soft warm shadows, 14-16px radii). Structure top to bottom: a slim sticky
 * header, a centered hero with the compliance-pain headline, the 9-card
 * advantage grid HIGH on the page (right after the hero, each card now
 * individually colored - see the ADVANTAGES comment), a comparison strip
 * linking out to the /vs pages, a "how it looks for your client" section
 * built around the same sample invoice the previous design used (ported
 * zone-for-zone, only re-skinned), the launch pricing band, the existing
 * FAQ (unchanged content, restyled), and a light footer.
 *
 * SCOPING. Everything visual here lives in marketing-light.css under
 * `.ml-theme`, a wrapper rendered INSIDE (marketing)/layout.tsx's shared
 * `.v2-theme` div. That keeps every dark v2-* page (/vs, /blog, /v2/*)
 * completely untouched: this stylesheet is imported ONLY here, and no
 * existing v2-* rule was edited. HeaderLight/FooterLight are homepage-local
 * twins of HeaderV2/FooterV2 (same links, different paint - see the
 * comment on HeaderLight for why a shared `variant` prop was not "clean"
 * here), not shared with any other route either.
 *
 * The sample invoice deliberately does NOT import `DocumentBody` or
 * document-paper.css - the printed sheet is a tax document and is frozen;
 * a marketing page must never be able to reach into it. It also does not
 * import v2.css's `--v2-paper-*` tokens: the whole homepage is warm/cream
 * now, so the sheet uses the SAME `--ml-*` tokens as everything else on
 * this page rather than a separate dark-context sub-palette.
 *
 * Server-rendered so anonymous visitors and crawlers get the full page
 * immediately; `<RedirectIfAuthed />` then bounces an already-signed-in visitor
 * to /dashboard from the client, without ever blocking the anon render.
 */
export default function MarketingLanding() {
  return (
    <>
      <RedirectIfAuthed />
      <JsonLd
        data={graph(
          organization(),
          website(),
          softwareApplication(),
          faqPage(FAQ_ITEMS),
        )}
      />

      <div className="ml-theme">
        <HeaderLight />

        <main id="main-content">
          <section className="ml-hero">
            <div className="ml-wrap ml-hero-in">
              <span className="ml-eyebrow">
                התוכנה הכי ידידותית לעוסק פטור בישראל
              </span>
              <h1 className="ml-hero-h1">
                חשבונית שעומדת בדרישות 2026,{" "}
                <br />
                <span className="ml-grad-text">בלי כאב ראש</span>
              </h1>
              <p className="ml-lede">
                מספר הקצאה מרשות המסים מתקבל אוטומטית, בלחיצה אחת, ישירות
                מתוך המסמך. פחות טפסים, יותר זמן לעסק שלכם.
              </p>
              <div className="ml-hero-actions">
                <Link
                  href="/login?mode=signup"
                  className="ml-btn ml-btn-primary ml-btn-lg"
                >
                  התחילו בחינם
                </Link>
                <span className="ml-hero-note">
                  חינם בתקופת ההשקה, בלי כרטיס אשראי
                </span>
              </div>
              <ul className="ml-trust-row">
                <li>
                  <CheckIcon /> הקמה תוך 5 דקות
                </li>
                <li>
                  <CheckIcon /> תמיכה בעברית
                </li>
                <li>
                  <CheckIcon /> אפשר לבטל בכל רגע
                </li>
              </ul>
            </div>
          </section>

          <section className="ml-advantages">
            <div className="ml-wrap">
              <div className="ml-adv-head">
                <span className="ml-adv-tag">
                  9 יתרונות שמרגישים כמו הקלה
                </span>
                <h2>כל מה שעוסק פטור צריך, במקום אחד ידידותי</h2>
                <p>
                  לא עוד תוכנה שמרגישה כמו טופס של רשות המסים. הכול כאן,
                  פשוט וברור.
                </p>
              </div>

              <div className="ml-adv-grid">
                {ADVANTAGES.map((item) => (
                  <article
                    className={`ml-adv-card${item.flagship ? " is-flagship" : ""}`}
                    key={item.key}
                  >
                    <div
                      className={`ml-adv-icon${item.tone ? ` ml-adv-icon--${item.tone}` : ""}`}
                      aria-hidden="true"
                    >
                      {item.icon}
                    </div>
                    <h3>
                      <LtrText text={item.title} />
                      {item.comingSoon && (
                        <>
                          {" "}
                          <span className="ml-badge-soon">בקרוב</span>
                        </>
                      )}
                    </h3>
                    <p>
                      <LtrText text={item.body} />
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="ml-compare">
            <div className="ml-wrap">
              <div className="ml-compare-in">
                <h3>רוצים השוואה מלאה שורה מול שורה?</h3>
                <p className="sub">
                  בדקנו את עצמנו מול כל התוכנות המובילות בישראל. שורה מול
                  שורה, בלי מסננות.
                </p>
                <div className="ml-chips">
                  {Object.values(COMPETITORS).map((c) => (
                    <Link
                      key={c.slug}
                      href={`/vs/${c.slug}`}
                      className="ml-chip"
                    >
                      <LtrText text={c.name} />
                    </Link>
                  ))}
                </div>
                <Link href="/vs" className="ml-cmp-link">
                  לכל ההשוואות <ArrowIcon />
                </Link>
              </div>
            </div>
          </section>

          <section className="ml-sample">
            <div className="ml-wrap ml-sample-in">
              <div className="ml-sample-copy">
                <span className="ml-eyebrow">המסמך שהלקוח מקבל</span>
                <h2>כך זה נראה אצל הלקוח</h2>
                <p>
                  חשבונית נקייה ומקצועית, עם כל השדות שרשות המסים דורשת,
                  כולל מספר ההקצאה. מוכנה תוך שניות ונשלחת בלחיצה.
                </p>
                <ul className="ml-sample-feats">
                  <li>
                    <CheckIcon /> מספר הקצאה מוטמע אוטומטית
                  </li>
                  <li>
                    <CheckIcon /> עיצוב מקצועי בברירת מחדל
                  </li>
                  <li>
                    <CheckIcon /> נשלח כקישור, מייל או PDF
                  </li>
                </ul>
              </div>

              <figure className="ml-sheet-wrap">
                <article className="ml-sheet">
                  <div className="ml-sh-card ml-sh-head">
                    <div className="ml-sh-biz">
                      <p className="ml-sh-name">סטודיו נועה</p>
                      <p className="ml-sh-bizline">
                        עוסק מורשה <Ltr>003244266</Ltr> · עיצוב גרפי ומיתוג
                        <br />
                        הרצל 12, תל אביב · <Ltr>054-1234567</Ltr> ·{" "}
                        <Ltr>noa@studio-noa.co.il</Ltr>
                      </p>
                    </div>
                    <div className="ml-sh-ident">
                      <div className="ml-sh-orig">מקור</div>
                      <div className="ml-sh-badge">חשבונית מס</div>
                      <div className="ml-sh-num">0042</div>
                      <div className="ml-sh-date">09.07.2026</div>
                    </div>
                  </div>

                  {/* Same DOM order as the real document's `.doc-strip`: the
                      customer first, so RTL puts "לכבוד" at the reading start
                      (right) and the allocation number after it (left), and the
                      customer stays on top when the strip stacks on mobile. */}
                  <div className="ml-sh-strip">
                    <div className="ml-sh-card ml-sh-mini">
                      <div className="ml-sh-glabel">לכבוד</div>
                      <div className="ml-sh-mini-v">סטודיו אורות בע״מ</div>
                      <div className="ml-sh-mini-sub">
                        ח.פ / ת.ז <Ltr>514738293</Ltr>
                      </div>
                    </div>
                    <div className="ml-sh-card ml-sh-mini is-alloc">
                      <div className="ml-sh-glabel">
                        מספר הקצאה · חשבונית ישראל
                      </div>
                      <div className="ml-sh-mini-v is-gold">403581926</div>
                    </div>
                  </div>

                  <div className="ml-sh-card ml-sh-items">
                    <div className="ml-sh-glabel">פירוט</div>
                    <table className="ml-sh-table">
                      <thead>
                        <tr>
                          <th className="c-desc">תיאור</th>
                          <th className="c-qty">כמות</th>
                          <th className="c-num">סכום</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="c-desc">עיצוב לוגו ומיתוג</td>
                          <td className="c-qty">1</td>
                          <td className="c-total">3,200 ₪</td>
                        </tr>
                        <tr>
                          <td className="c-desc">דף נחיתה</td>
                          <td className="c-qty">1</td>
                          <td className="c-total">1,450 ₪</td>
                        </tr>
                        <tr>
                          <td className="c-desc">ייעוץ חזותי</td>
                          <td className="c-qty">1</td>
                          <td className="c-total">600 ₪</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="ml-sh-money">
                    <div className="ml-sh-card ml-sh-breakdown">
                      <div className="ml-sh-brow">
                        <span>סכום ביניים</span>
                        <span>5,250 ₪</span>
                      </div>
                      <div className="ml-sh-brow">
                        <span>
                          מע״מ <Ltr>18%</Ltr>
                        </span>
                        <span>945 ₪</span>
                      </div>
                      <div className="ml-sh-brow is-grand">
                        <span>סה״כ לתשלום</span>
                        <span className="ml-sh-grand">6,195 ₪</span>
                      </div>
                    </div>
                  </div>

                  {/* The separator is an explicit {" · "} expression, not two
                      JSX literals around a bare middot: the transform drops the
                      space that leads a multi-line text child, which silently
                      shipped "מספר הקצאה· נדרש". */}
                  <p className="ml-sh-note">
                    <b>מספר הקצאה</b>
                    {" · "}
                    נדרש בחשבונית מס ללקוח עסקי בסכום של 5,000&nbsp;₪ ומעלה
                    לפני מע״מ. המערכת מבקשת אותו מרשות המסים אוטומטית.
                  </p>

                  <div className="ml-sh-foot">
                    <div className="ml-sh-sig">מסמך זה הופק אלקטרונית</div>
                    <div className="ml-sh-brand">
                      הופק באמצעות <Ltr>MyFriendlyInvoiceApp</Ltr>
                    </div>
                  </div>
                </article>
                <figcaption className="ml-sheet-cap">
                  חשבונית לדוגמה שנוצרה במערכת. שם הלקוח והפרטים להמחשה בלבד.
                </figcaption>
              </figure>
            </div>
          </section>

          <section className="ml-pricing">
            <div className="ml-wrap">
              <h2>בתקופת ההשקה, הכול חינם</h2>
              <p>
                בלי הגבלת מסמכים, בלי כרטיס אשראי, בלי התחייבות. בהמשך,
                המסלולים יתחילו מ־₪15 לחודש · <Ltr>Pro</Ltr> ללא הגבלה
                ב־₪25.
              </p>
              <Link
                href="/login?mode=signup"
                className="ml-btn ml-btn-primary ml-btn-lg"
              >
                התחילו בחינם
              </Link>
              <div className="fine">
                ביטול בכל עת · נעדכן מראש לפני כל שינוי מחיר
              </div>
            </div>
          </section>

          <section className="ml-faq">
            <h2 className="ml-faq-title">שאלות נפוצות</h2>
            {FAQ_ITEMS.map((item) => (
              <div className="ml-faq-item" key={item.q}>
                <p className="ml-faq-q">{item.q}</p>
                <p className="ml-faq-a">{item.a}</p>
              </div>
            ))}
          </section>
        </main>

        <FooterLight />
      </div>
    </>
  );
}
