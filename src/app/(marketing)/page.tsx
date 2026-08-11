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
    // Added 2026-08-11: the page never answered the objection that actually
    // stops a switcher - "how painful is the move itself". Every claim here
    // is checked against src/app/(app)/migrate/page.tsx: the vendor list is
    // that wizard's VENDOR_META keys verbatim, and the three exported
    // entities are its three step groups (clients / products / document
    // history). No duration is promised - the wizard does not measure one.
    q: "אני כבר עובד עם תוכנה אחרת. כמה כואב לעבור?",
    a: "יש אשף מעבר ייעודי ל-Invoice4U, Morning (חשבונית ירוקה), iCount, ריווחית וחשבשבת - וגם מסלול Excel לכל תוכנה אחרת. מייצאים קובץ מהתוכנה הישנה, מעלים אותו, והמערכת מייבאת את הלקוחות, המוצרים והשירותים והיסטוריית המסמכים. לא צריך להקליד מסמך אחד מחדש, וההיסטוריה נשארת זמינה לדוחות.",
  },
  {
    q: "מה זה מספר הקצאה ואיך זה עובד כאן?",
    a: "זה מספר שרשות המסים מנפיקה לחשבוניות מעל סכום מסוים (מ-2026: מעל 5,000 ש\"ח לפני מע\"מ ללקוח עסקי), נדרש כדי שהלקוח יוכל לנכות מע\"מ. אחרי חיבור חד-פעמי מול רשות המסים, המערכת מבקשת את המספר ישירות מולה בלחיצה אחת, בלי טפסים ידניים.",
  },
];

/**
 * "כל מה שיש רק אצלנו" - the competitive-advantage grid. Sat right after
 * the hero in the approved warm redesign; since 2026-08-11 (Asaf) the
 * WhatsApp+document showcase leads and this grid follows it.
 * Cards state OUR capabilities only (no competitor names - the comparison
 * strip, now the page's last section, hands off to the /vs pages for the
 * head-to-head).
 *
 * `tone` gives every non-flagship card its own soft-tinted icon tile
 * (Asaf 2026-08-10: the approved mockup shipped with 8 of 9 tiles dull and
 * near-identical; he asked for every card to get real, distinct color).
 * Formula: tile background = Tailwind `*-100`, icon stroke = `*-600`, see
 * `.ml-adv-icon--*` in marketing-light.css. The allocation card keeps no
 * `tone` - it is the one `flagship` card and gets the full brand-gradient
 * tile with a white glyph instead, the strongest treatment on the page.
 *
 * `tone` also lands on the card itself as `ml-adv-card--{tone}` (below),
 * reused by that class's `:hover` rule so the whole card - not just its
 * icon tile - shifts to that hue's `*-50` on hover (2026-08-10 "more
 * interesting" pass, see the hover block under `.ml-adv-icon--orange` in
 * marketing-light.css).
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
 * zone-for-zone, only re-skinned) - since 2026-08-10 sharing one section,
 * side by side, with the WhatsApp phone mock - the launch pricing band, the existing
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
                התוכנה הכי ידידותית לעסקים עצמאיים בישראל
              </span>
              {/* Headline: Hormozi round (2026-08-10) - Asaf picked the
                  dream-outcome flip ("issuing an invoice became the easiest
                  part of your workday") over the compliance-pain framing.
                  The 2026/allocation specificity moved down into the lede
                  so the regulatory hook is still above the fold. */}
              <h1 className="ml-hero-h1">
                להוציא חשבונית הפך{" "}
                <br />
                {/* Explicit {" "} after the span - same transform trap as
                    the allocation note below: a space leading a multi-line
                    text child is silently dropped, which shipped
                    "קלביום" glued together on the first build. */}
                <span className="ml-grad-text">לחלק הכי קל</span>
                {" "}
                ביום העבודה&nbsp;שלכם
              </h1>
              <p className="ml-lede">
                גם עם דרישות 2026: מספר הקצאה מרשות המסים מתקבל אוטומטית,
                בלחיצה אחת, ישירות מתוך המסמך. פחות טפסים, יותר זמן לעסק
                שלכם.
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

          {/* Trust strip (2026-08-11). The page had no credibility layer at
              all - every claim rested on our own say-so. These three are
              deliberately VERIFIABLE facts about the system, not testimonials:
              inventing customer quotes for a product with a handful of live
              users would be fabrication, so real quotes have to come from
              real users before any appear here.

              Each line was checked against reality before being written:
                - allocation numbers: real ones have been issued through the
                  production system against רשות המסים (first: doc #96,
                  2026-07-06), so this is a statement of fact, not intent.
                - isolation/encryption: per-business RLS, plus Tax Authority
                  tokens encrypted at rest via src/lib/crypto.ts. Phrased
                  narrowly - the encryption covers the tax-authority
                  connection, NOT every column, and must not imply otherwise.
                - status page: /status is public and live (verified 200). */}
          <section className="ml-trust">
            <div className="ml-wrap ml-trust-in">
              <div className="ml-trust-card">
                <span className="ml-trust-k">מחוברים בפועל</span>
                <p>
                  המערכת כבר מפיקה מספרי הקצאה אמיתיים מול מערכת חשבונית
                  ישראל של רשות המסים - לא הצהרת כוונות.
                </p>
              </div>
              <div className="ml-trust-card">
                <span className="ml-trust-k">הנתונים שלכם, שלכם</span>
                <p>
                  הפרדה מלאה ברמת בסיס הנתונים - כל עסק ניגש רק למידע שלו,
                  והחיבור לרשות המסים נשמר מוצפן.
                </p>
              </div>
              <div className="ml-trust-card">
                <span className="ml-trust-k">שקיפות על זמינות</span>
                <p>
                  <Link href="/status">עמוד סטטוס פומבי</Link> שמראה בכל
                  רגע אם המערכת פעילה. בלי לנחש.
                </p>
              </div>
            </div>
          </section>

          {/* Combined "client + WhatsApp" showcase. Originally two stacked
              full-width sections (sample invoice, then the WhatsApp phone);
              merged side by side 2026-08-10 at Asaf's request - stacked they
              made the page a full screen too long. Shared centered header,
              then a two-column grid: the phone mock (right, reading start -
              Asaf: "מהוואטסאפ שלכם ישירות אל הלקוח", so the story reads
              WhatsApp first) and the invoice sheet (left), each <figure>
              carrying its own title, visual, fact list and caption. */}
          <section className="ml-show">
            <div className="ml-wrap">
              <div className="ml-show-head">
                <span className="ml-eyebrow">כך זה נראה בפועל</span>
                <h2>מהוואטסאפ שלכם ישירות אל הלקוח</h2>
                <p>
                  בקרוב: כותבים הודעה אחת בצ&apos;אט - והלקוח מקבל מסמך נקי
                  ומקצועי, עם כל השדות שרשות המסים דורשת, כולל מספר
                  ההקצאה.
                </p>
                {/* Honesty line, 2026-08-11. The WhatsApp mock leads the
                    page, so the first thing a visitor absorbs is a channel
                    that is not enabled yet (Meta approval pending). Without
                    this sentence the page reads as if the chat bot is what
                    you get on signup, and the "בקרוב" badge on the column
                    title alone is easy to miss. States plainly what works
                    today - all of it verified live - so nobody signs up for
                    something they cannot use this afternoon. */}
                <p className="ml-show-today">
                  <b>מה שכבר עובד היום:</b> המסמך שמשמאל, מספר ההקצאה
                  שבתוכו, ושליחה ללקוח במייל או בקישור - הכול פעיל עכשיו
                  במערכת. ערוץ הוואטסאפ מצטרף בהמשך.
                </p>
              </div>
            </div>

            <div className="ml-wrap ml-show-grid">
              {/* The phone: a faithful HTML/CSS recreation of the
                  bot-conversation mock Asaf supplied as a screenshot -
                  markup rather than an <img> so it stays sharp on every
                  density, inherits RTL for free, and weighs nothing. Shows
                  the channel's two flows (free-text receipt issuing, photo
                  expense capture); every message body matches the approved
                  mock verbatim. The feature is not live yet (Meta approval
                  pending), so the column title carries the same "בקרוב"
                  badge as the advantage card above and the caption says it
                  is a preview - no false claims. `role="img"` + aria-label:
                  to a screen reader the whole simulated chat is one
                  picture, not a wall of fake conversation turns. */}
              <figure className="ml-wa-phone-wrap">
                <h3 className="ml-show-col-title">
                  ערוץ הוואטסאפ <span className="ml-badge-soon">בקרוב</span>
                </h3>
                <div
                  className="ml-wa-phone"
                  role="img"
                  aria-label="הדמיה של שיחת וואטסאפ עם חשבונית ידידותית: מבקשים קבלה בהודעה חופשית, מאשרים, ומקבלים PDF מוכן; מצלמים קבלה מתחנת דלק וההוצאה נקלטת אוטומטית"
                >
                  <div className="ml-wa-head">
                    <span className="ml-wa-avatar">ח</span>
                    <span className="ml-wa-title">
                      <span className="ml-wa-name">
                        חשבונית ידידותית
                        <svg
                          className="ml-wa-verified"
                          viewBox="0 0 16 16"
                          aria-hidden="true"
                        >
                          <path
                            d="M8 0.8l1.7 1.5 2.2-.4.8 2.1 2.1.8-.4 2.2L16 8l-1.5 1.7.4 2.2-2.1.8-.8 2.1-2.2-.4L8 15.2l-1.7-1.5-2.2.4-.8-2.1-2.1-.8.4-2.2L0 8l1.5-1.7-.4-2.2 2.1-.8.8-2.1 2.2.4z"
                            fill="currentColor"
                          />
                          <path
                            d="M5 8.2l2 2 4-4.2"
                            fill="none"
                            stroke="#0b141a"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className="ml-wa-sub">עסק · מקוון</span>
                    </span>
                  </div>

                  <div className="ml-wa-chat">
                    <span className="ml-wa-day">היום</span>

                    <div className="ml-wa-msg is-out">
                      <p>תוציא קבלה לדני כהן על 1,200 שקל העברה בנקאית</p>
                      <span className="ml-wa-meta">
                        10:42 <b className="ml-wa-ticks">✓✓</b>
                      </span>
                    </div>

                    <div className="ml-wa-msg is-in">
                      <p>רגע לפני שאני מפיק, תאשר שהכול נכון:</p>
                      <dl className="ml-wa-fields">
                        <div>
                          <dt>סוג</dt>
                          <dd>קבלה</dd>
                        </div>
                        <div>
                          <dt>לקוח</dt>
                          <dd>דני כהן</dd>
                        </div>
                        <div>
                          <dt>סכום</dt>
                          <dd>₪1,200.00</dd>
                        </div>
                        <div>
                          <dt>תשלום</dt>
                          <dd>העברה בנקאית</dd>
                        </div>
                        <div>
                          <dt>תאריך</dt>
                          <dd>08.08.2026</dd>
                        </div>
                      </dl>
                      <span className="ml-wa-meta">10:42</span>
                      <div className="ml-wa-actions">
                        <span>✅ אשר והפק</span>
                        <span>✏️ תקן פרט</span>
                        <span>❌ בטל</span>
                      </div>
                    </div>

                    <div className="ml-wa-msg is-out">
                      <p>אשר והפק</p>
                      <span className="ml-wa-meta">
                        10:43 <b className="ml-wa-ticks">✓✓</b>
                      </span>
                    </div>

                    <div className="ml-wa-msg is-in">
                      <div className="ml-wa-doc">
                        <span className="ml-wa-doc-icon">PDF</span>
                        <span className="ml-wa-doc-info">
                          <b>
                            <Ltr>kabala-1043.pdf</Ltr>
                          </b>
                          <span>
                            עמוד אחד · <Ltr>84KB</Ltr>
                          </span>
                        </span>
                      </div>
                      <p>קבלה 1043 הופקה ונשמרה ✅</p>
                      <span className="ml-wa-meta">10:43</span>
                      <div className="ml-wa-actions">
                        <span>👆 שלח את הקבלה לדני</span>
                      </div>
                    </div>

                    <div className="ml-wa-msg is-out is-photo">
                      <span className="ml-wa-photo" aria-hidden="true">
                        🧾
                      </span>
                      <p>קבלה מתחנת דלק</p>
                      <span className="ml-wa-meta">
                        14:10 <b className="ml-wa-ticks">✓✓</b>
                      </span>
                    </div>

                    <div className="ml-wa-msg is-in">
                      <p>קראתי את הקבלה:</p>
                      <dl className="ml-wa-fields">
                        <div>
                          <dt>ספק</dt>
                          <dd>פז</dd>
                        </div>
                        <div>
                          <dt>סכום</dt>
                          <dd>₪312.40</dd>
                        </div>
                        <div>
                          <dt>מע״מ</dt>
                          <dd>₪47.65</dd>
                        </div>
                        <div>
                          <dt>קטגוריה</dt>
                          <dd>דלק ורכב</dd>
                        </div>
                      </dl>
                      <span className="ml-wa-meta">14:10</span>
                      <div className="ml-wa-actions">
                        <span>✅ שמור כהוצאה</span>
                        <span>✏️ תקן פרט</span>
                      </div>
                    </div>
                  </div>
                </div>
                <ul className="ml-sample-feats">
                  <li>
                    <CheckIcon /> מפיקים קבלה בהודעה חופשית, בלי להתחבר
                  </li>
                  <li>
                    <CheckIcon /> מצלמים קבלה - ספק, סכום ומע״מ נקלטים לבד
                  </li>
                  <li>
                    <CheckIcon /> שום מסמך לא נוצר בלי אישור מפורש שלכם
                  </li>
                </ul>
                <figcaption className="ml-sheet-cap">
                  הדמיה של ערוץ הוואטסאפ שנמצא בפיתוח. ההודעות להמחשה בלבד.
                </figcaption>
              </figure>

              <figure className="ml-sheet-wrap">
                <h3 className="ml-show-col-title">המסמך שהלקוח מקבל</h3>
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
                <figcaption className="ml-sheet-cap">
                  חשבונית לדוגמה שנוצרה במערכת. שם הלקוח והפרטים להמחשה בלבד.
                </figcaption>
              </figure>

            </div>
          </section>

          {/* The app itself (2026-08-11). Before this, a visitor never saw
              the screen they would actually work in - the page showed only
              OUTPUTS (the finished invoice, the WhatsApp chat). This is a
              recreation of the real /dashboard composition, built the same
              way as the invoice sheet and the phone above rather than as a
              screenshot: stays sharp at any density, inherits RTL, weighs
              nothing, and can never leak a real customer's figures.

              It mirrors src/app/(app)/dashboard/page.tsx zone for zone -
              greeting + range pills + "מסמך חדש" button, the four stat
              cards in their real order and real tones (הכנסות emerald /
              הוצאות rose / רווח amber / ממוצע למסמך violet), then the
              "הכנסות והוצאות" chart card. Figures are illustrative and the
              caption says so. If that dashboard is ever restructured, this
              block should follow it. */}
          {/* Mid-page CTA (2026-08-11). Measured on the live page, the
              signup buttons sat at y=15 (header), y=424 (hero) and then
              nothing until y=4,353 - the whole middle two thirds, where a
              visitor is actually being convinced, offered no way to act.
              Sits right at the midpoint of that gap - after the
              WhatsApp/document showcase has made the case, before the
              dashboard view and the advantage grid. A slim inline strip,
              not a second pricing band: the real CTA further down should
              stay the loud one. */}
          <section className="ml-midcta">
            <div className="ml-wrap ml-midcta-in">
              <p className="ml-midcta-t">משוכנעים? ההרשמה לוקחת פחות מדקה.</p>
              <Link
                href="/login?mode=signup"
                className="ml-btn ml-btn-primary ml-btn-sm"
              >
                התחילו בחינם
              </Link>
              <span className="ml-midcta-note">
                בלי כרטיס אשראי · אפשר לבטל בכל רגע
              </span>
            </div>
          </section>

          <section className="ml-app">
            <div className="ml-wrap">
              <div className="ml-show-head">
                <span className="ml-eyebrow">המסך שתעבדו בו</span>
                <h2>וכך זה נראה מבפנים</h2>
                <p>
                  לא עוד טבלה אפורה. דשבורד אחד שמראה כמה נכנס, כמה יצא
                  וכמה נשאר - בלי לחפש ובלי להוריד קובץ.
                </p>
              </div>

              <figure className="ml-browser-wrap">
                <div
                  className="ml-browser"
                  role="img"
                  aria-label="הדמיה של מסך הבית במערכת: ברכה אישית, בורר טווח תאריכים, כרטיסי הכנסות, הוצאות, רווח וממוצע למסמך, וגרף הכנסות מול הוצאות לפי חודש"
                >
                  <div className="ml-browser-bar">
                    <span className="ml-browser-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="ml-browser-url">
                      <Ltr>friendlyinvoice.co.il/dashboard</Ltr>
                    </span>
                  </div>

                  <div className="ml-app-body">
                    <div className="ml-app-top">
                      <div className="ml-app-hello">
                        <span className="ml-app-h1">שלום, נועה</span>
                        <span className="ml-app-sub">
                          סקירה מהירה של הפעילות שלך
                        </span>
                      </div>
                      <div className="ml-app-controls">
                        <span className="ml-app-pills">
                          <i className="is-on">החודש</i>
                          <i>השנה</i>
                          <i>הכול</i>
                        </span>
                        <span className="ml-app-newdoc">+ מסמך חדש</span>
                      </div>
                    </div>

                    <div className="ml-app-stats">
                      <div className="ml-app-stat is-emerald">
                        <span className="ml-app-stat-l">הכנסות</span>
                        <span className="ml-app-stat-v">₪24,180</span>
                        <span className="ml-app-stat-s">
                          6 מסמכים שולמו <b className="is-up">▲ 18%</b>
                        </span>
                      </div>
                      <div className="ml-app-stat is-rose">
                        <span className="ml-app-stat-l">הוצאות</span>
                        <span className="ml-app-stat-v">₪5,940</span>
                        <span className="ml-app-stat-s">11 פעולות</span>
                      </div>
                      <div className="ml-app-stat is-amber">
                        <span className="ml-app-stat-l">רווח</span>
                        <span className="ml-app-stat-v">₪18,240</span>
                        <span className="ml-app-stat-s">75% מההכנסות</span>
                      </div>
                      <div className="ml-app-stat is-violet">
                        <span className="ml-app-stat-l">ממוצע למסמך</span>
                        <span className="ml-app-stat-v">₪4,030</span>
                        <span className="ml-app-stat-s">
                          לפי מסמכים שולמו
                        </span>
                      </div>
                    </div>

                    <div className="ml-app-chart">
                      <span className="ml-app-chart-t">הכנסות והוצאות</span>
                      {/* Bar pairs are plain divs with inline heights: a
                          chart library would ship kilobytes of JS to a
                          marketing page for a picture that never changes. */}
                      <div className="ml-app-bars" aria-hidden="true">
                        {[
                          [46, 18],
                          [62, 26],
                          [38, 22],
                          [78, 30],
                          [55, 20],
                          [92, 34],
                        ].map(([inc, exp], i) => (
                          <span className="ml-app-barpair" key={i}>
                            <i
                              className="is-inc"
                              style={{ height: `${inc}%` }}
                            />
                            <i
                              className="is-exp"
                              style={{ height: `${exp}%` }}
                            />
                          </span>
                        ))}
                      </div>
                      <div className="ml-app-legend">
                        <span>
                          <i className="is-inc" /> הכנסות
                        </span>
                        <span>
                          <i className="is-exp" /> הוצאות
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <figcaption className="ml-sheet-cap">
                  מסך הבית של המערכת. הנתונים להמחשה בלבד.
                </figcaption>
              </figure>
            </div>
          </section>

          <section className="ml-advantages">
            <div className="ml-wrap">
              <div className="ml-adv-head">
                <span className="ml-adv-tag">
                  9 יתרונות שמרגישים כמו הקלה
                </span>
                <h2>כל מה שעסק עצמאי צריך, במקום אחד</h2>
                <p>
                  לא עוד תוכנה שמרגישה כמו טופס של רשות המסים. הכול כאן,
                  פשוט וברור.
                </p>
              </div>

              <div className="ml-adv-grid">
                {ADVANTAGES.map((item) => (
                  <article
                    className={`ml-adv-card${item.flagship ? " is-flagship" : ""}${item.tone ? ` ml-adv-card--${item.tone}` : ""}`}
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

          <section className="ml-pricing">
            <div className="ml-wrap">
              <h2>בתקופת ההשקה, הכול חינם</h2>
              {/* Restructured 2026-08-11 (Asaf): the old single paragraph
                  wrapped "Pro" onto its own line and read as one dense run.
                  Now the three "בלי" promises sit on one check-marked line
                  (echoing the hero trust row) and the two future plans get
                  their own labeled chips. Prices/names verified against
                  src/lib/plans.ts (בסיסי ₪15/mo, Pro ₪25/mo unlimited). */}
              <ul className="ml-price-frees">
                <li>
                  <CheckIcon /> בלי הגבלת מסמכים
                </li>
                <li>
                  <CheckIcon /> בלי כרטיס אשראי
                </li>
                <li>
                  <CheckIcon /> בלי התחייבות
                </li>
              </ul>
              <p className="ml-price-later">בהמשך, אלה יהיו המסלולים:</p>
              <div className="ml-price-plans">
                <span className="ml-price-plan">
                  מסלול בסיסי · <b>₪15 לחודש</b>
                </span>
                <span className="ml-price-plan">
                  <Ltr>Pro</Ltr> ללא הגבלה · <b>₪25 לחודש</b>
                </span>
              </div>
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

        </main>

        <FooterLight />
      </div>
    </>
  );
}
