import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  BellRing,
  BookOpen,
  Camera,
  Coins,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Gauge,
  Gift,
  Hash,
  MessageSquareText,
  Receipt,
  TrendingUp,
  UserRound,
  UserSearch,
} from "lucide-react";
import HeaderLight from "../components/HeaderLight";
import FooterLight from "../components/FooterLight";
import JsonLd from "../components/JsonLd";
import SignupLink from "../components/SignupLink";
import { graph, faqPage } from "@/lib/jsonld";
import { LtrText } from "@/components/ui/ltr";
import { pageMetadata } from "@/lib/page-metadata";
import "../marketing-light.css";
import "./accountants.css";

export const metadata = pageMetadata({
  path: "/accountants",
  title: "לרואי חשבון: תוכנת חשבוניות להמליץ עליה ללקוחות עוסק פטור",
  ogTitle: "לרואי חשבון ויועצי מס | חשבונית ידידותית",
  description:
    "תוכנת חשבוניות חינמית לעוסקים פטורים שמוציאה את המסמך הנכון, מספרי הקצאה אוטומטיים, ודוחות מוכנים לרואה החשבון: מע״מ, עזר ל-1301, כרטסת וקובץ מבנה אחיד.",
});

/**
 * /accountants - where an accountant lands from the outreach pilot, and what
 * accountants find when they search for a tool to recommend to small clients.
 *
 * Built on the homepage design system (marketing-light.css). Asaf's calls,
 * 2026-09-27:
 *   - v1 used the /security document layout and read as a long list -> rebuilt.
 *   - No demo / "let's talk" offer anywhere: he does not want calls. The page
 *     sends accountants to sign up and look for themselves instead.
 *   - No personal name or email on this page (FooterLight hides its operator
 *     line on this path only).
 *   - More benefits, starting with "no credit card, check it yourself".
 *
 * Every sentence is a shipped fact. Sources:
 *   benefits            src/app/(marketing)/advantages.tsx (the WhatsApp card
 *                       is deliberately NOT used - the channel is not live)
 *   reports             advantages.tsx "reports" + src/app/(app)/reports/*
 *   1301 / capital      src/lib/csv-export.ts - DRAFTS, keep עזר / טיוטה
 *   uniform structure   src/lib/uniform-structure + /api/uniform-structure/export
 *   locked documents    /security
 * There is NO accountant login into a client's account (/portal is for the
 * business's own customers). Do not claim one until it ships.
 */

type Card = { tone: string; icon: ReactNode; title: string; body: string; flagship?: boolean };

const CLIENT_CARDS: { tone: string; icon: ReactNode; k: string; body: string }[] = [
  {
    tone: "amber",
    icon: <Gift aria-hidden="true" />,
    k: "בלי כרטיס אשראי",
    body: "חינמי בתקופת ההשקה ובלי התחייבות. אפשר להיכנס ולבדוק הכול בעצמכם, עוד לפני שממליצים.",
  },
  {
    tone: "sky",
    icon: <FileCheck aria-hidden="true" />,
    k: "המסמך הנכון, אוטומטית",
    body: "קבלה, חשבונית מס, חשבונית מס-קבלה או חשבון עסקה, לפי הסטטוס של הלקוח ועם מספור רץ.",
  },
  {
    tone: "green",
    icon: <Hash aria-hidden="true" />,
    k: "מספרי הקצאה בלחיצה",
    body: "נמשכים ישירות מרשות המסים כשהחשבונית חייבת בהם, במסגרת חשבונית ישראל.",
  },
  {
    tone: "violet",
    icon: <Gauge aria-hidden="true" />,
    k: "התראת תקרת עוסק פטור",
    body: "הלקוח רואה בכל רגע כמה נשאר לו עד התקרה השנתית, כולל חשבוניות זיכוי.",
  },
];

const REPORTS: Card[] = [
  {
    tone: "indigo",
    icon: <FileSpreadsheet aria-hidden="true" />,
    title: "קובץ מבנה אחיד",
    body: "מייבאים ישירות למערכת שלכם, בלי להקליד מחדש.",
    flagship: true,
  },
  {
    tone: "amber",
    icon: <Receipt aria-hidden="true" />,
    title: "דוח מע״מ תקופתי",
    body: "יחד עם רשימת המסמכים לתקופה.",
  },
  {
    tone: "rose",
    icon: <FileText aria-hidden="true" />,
    title: "עזר להכנת 1301",
    body: "טיוטה כנקודת פתיחה לעבודה שלכם, לא טופס מוגש. וגם טיוטת הצהרת הון.",
  },
  {
    tone: "green",
    icon: <BookOpen aria-hidden="true" />,
    title: "רווח והפסד, כרטסת ויומן",
    body: "כולל כרטסת לקוח, יומן שנתי וגיול חובות.",
  },
  {
    tone: "sky",
    icon: <TrendingUp aria-hidden="true" />,
    title: "תחזית מס לסוף השנה",
    body: "כדי לדבר עם הלקוח על מקדמות לפני שזה מאוחר.",
  },
  {
    tone: "orange",
    icon: <Download aria-hidden="true" />,
    title: "ייצוא כל הנתונים",
    body: "לקובצי Excel ו-CSV, בפורמט שאפשר למיין ולסכום.",
  },
];

const MORE_BENEFITS: Card[] = [
  {
    tone: "indigo",
    icon: <MessageSquareText aria-hidden="true" />,
    title: "עוזר AI בעברית",
    body: "הלקוח שואל בשפה חופשית, מוצא מסמכים ומקבל טיוטות מוכנות לאישור. לא בטוח איך עושים משהו? העוזר מסביר צעד אחר צעד.",
  },
  {
    tone: "amber",
    icon: <Camera aria-hidden="true" />,
    title: "סריקת הוצאות בצילום",
    body: "מצלמים קבלה והמערכת ממלאת ספק, סכום, מע״מ ותאריך. גם צילום מסך של ביט או העברה בנקאית.",
  },
  {
    tone: "rose",
    icon: <BellRing aria-hidden="true" />,
    title: "תזכורות אוטומטיות",
    body: "תזכורת חודשית להוציא מסמכים, ותזכורות תשלום ללקוחות שמאחרים, במייל ובאפליקציה.",
  },
  {
    tone: "green",
    icon: <ArrowLeftRight aria-hidden="true" />,
    title: "מעבר קל מכל תוכנה",
    body: "ייבוא היסטוריה מ-Excel ומהתוכנות המוכרות, עם אשפי מעבר, בלי לאבד אף מסמך.",
  },
  {
    tone: "sky",
    icon: <UserRound aria-hidden="true" />,
    title: "אזור אישי ללקוחות שלו",
    body: "הלקוחות של העסק רואים את כל המסמכים שלהם במקום אחד, כולל מה שולם ומה ממתין.",
  },
  {
    tone: "orange",
    icon: <Coins aria-hidden="true" />,
    title: "חשבוניות בדולר ובאירו",
    body: "השער היציג של בנק ישראל נמשך לבד, והסכום בשקלים נשמר בשביל הדוחות והמע״מ.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "אפשר לבדוק את המערכת בעצמנו?",
    a: "כן. נרשמים בחינם, בלי כרטיס אשראי, ורואים בדיוק את מה שהלקוח רואה: הוצאת מסמכים, מספרי הקצאה והדוחות.",
  },
  {
    q: "מה אני מרוויח מלהמליץ?",
    a: "הופעה ברשימת רואי החשבון שבתוך האפליקציה, שמשתמשים רואים כשהם מחפשים רואה חשבון. ובנוסף, לקוחות שמגיעים אליכם עם מסמכים תקינים ודוחות מוכנים.",
  },
  {
    q: "אני יכול להיכנס לחשבון של הלקוח?",
    a: "כרגע לא. הלקוח מפיק את הדוחות ואת קובץ המבנה האחיד ושולח לכם אותם.",
  },
  {
    q: "מה הקאץ׳?",
    a: "אין. זו תקופת השקה והכלי פתוח בחינם לכולם. בהמשך יהיה גם מסלול בתשלום, במחיר נמוך.",
  },
  {
    q: "הלקוח כבר עובד עם תוכנה אחרת.",
    a: "אין סיבה להחליף מה שעובד. הכלי מתאים במיוחד לעוסקים קטנים שמרגישים שהתוכנה הנוכחית יקרה או מסובכת בשבילם, ויש אשפי מעבר שמייבאים את ההיסטוריה.",
  },
  {
    q: "מה קורה עם מסמך שכבר נשלח?",
    a: "הוא ננעל. מסד הנתונים עצמו מסרב לשנות או למחוק חשבונית שנשלחה, ותיקון נעשה בחשבונית זיכוי, כמו שצריך.",
  },
  {
    q: "איפה נשמר המידע?",
    a: "במסד נתונים מאובטח עם הפרדה בין עסק לעסק וגיבוי לילי מוצפן. אנחנו רשומים כבית תוכנה ברשות המסים. הפירוט המלא בעמוד אבטחת המידע.",
  },
];

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
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

function CardGrid({ items }: { items: Card[] }) {
  return (
    <div className="ml-adv-grid">
      {items.map((r, index) => (
        <article
          className={`ml-adv-card${r.flagship ? " is-flagship" : ""} ml-adv-card--${r.tone}`}
          key={r.title}
          style={{ "--i": index } as CSSProperties}
        >
          <div className={`ml-adv-icon ml-adv-icon--${r.tone}`} aria-hidden="true">
            {r.icon}
          </div>
          <h3>
            <LtrText text={r.title} />
          </h3>
          <p>
            <LtrText text={r.body} />
          </p>
        </article>
      ))}
    </div>
  );
}

export default function AccountantsPage() {
  return (
    <>
      <JsonLd data={graph(faqPage(FAQ))} />

      <div className="ml-theme">
        <HeaderLight />

        <main id="main-content" className="acc-main">
          <section className="ml-hero">
            <div className="ml-wrap ml-hero-in">
              <span className="ml-eyebrow">לרואי חשבון ויועצי מס</span>
              <h1 className="ml-hero-h1">
                המלצה אחת ללקוח,{" "}
                <br />
                <span className="ml-grad-text">תיק מסודר</span>
                {" "}
                בסוף השנה
              </h1>
              <p className="ml-lede">
                תוכנת חשבוניות חינמית לעוסקים הפטורים שלכם: הם מוציאים את המסמך
                הנכון עם מספר הקצאה, ואתם מקבלים דוחות מוכנים וקובץ מבנה אחיד.
              </p>
              <div className="ml-hero-actions">
                <SignupLink className="ml-btn ml-btn-primary ml-btn-lg">
                  היכנסו ובדקו בעצמכם
                </SignupLink>
                <span className="ml-hero-note">
                  חינם בתקופת ההשקה, בלי כרטיס אשראי
                </span>
              </div>
              <ul className="ml-trust-row">
                <li>
                  <CheckIcon /> בלי כרטיס אשראי
                </li>
                <li>
                  <CheckIcon /> מספרי הקצאה אוטומטיים
                </li>
                <li>
                  <CheckIcon /> מבנה אחיד מוכן
                </li>
              </ul>
            </div>
          </section>

          <section className="ml-trust" aria-label="מה הלקוח שלכם מקבל">
            <div className="ml-wrap ml-trust-in">
              {CLIENT_CARDS.map((c) => (
                <div className={`ml-trust-card ml-trust-card--${c.tone}`} key={c.k}>
                  <span className="ml-trust-icon">{c.icon}</span>
                  <span className="ml-trust-k">{c.k}</span>
                  <p>
                    <LtrText text={c.body} />
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="acc-steps" aria-labelledby="acc-steps-title">
            <div className="ml-wrap">
              <div className="acc-steps-head">
                <h2 id="acc-steps-title">איך זה עובד</h2>
                <p>שלושה צעדים, ואף אחד מהם לא דורש מכם זמן.</p>
              </div>
              <ol className="acc-steps-list">
                <li className="acc-step">
                  <h3>שולחים ללקוח קישור</h3>
                  <p>ההרשמה לוקחת דקה, בלי כרטיס אשראי.</p>
                </li>
                <li className="acc-step">
                  <h3>הלקוח מוציא מסמכים</h3>
                  <p>המערכת בוחרת את סוג המסמך הנכון ומושכת מספר הקצאה כשצריך.</p>
                </li>
                <li className="acc-step">
                  <h3>אתם מקבלים קבצים נקיים</h3>
                  <p>דוחות מוכנים וקובץ מבנה אחיד, בלי לרדוף אחרי קבלות בסוף השנה.</p>
                </li>
              </ol>
            </div>
          </section>

          {/* The accountant's side of the deal: recommending the app gets them
              into the in-app directory (/find-accountant,
              src/lib/partner-accountants.ts). Reuses the homepage spotlight
              card; the band itself lives in accountants.css. */}
          <section className="acc-partner" aria-labelledby="acc-partner-title">
            <div className="ml-wrap">
              <div className="ml-spot-list">
                <article className="ml-spot-card is-flagship">
                  <div className="ml-spot-icon" aria-hidden="true">
                    <UserSearch />
                  </div>
                  <div className="ml-spot-copy">
                    <h3 id="acc-partner-title">ממליצים עלינו? אנחנו ממליצים עליכם</h3>
                    <p>
                      רואי חשבון שממליצים על חשבונית ידידותית מופיעים בתוך האפליקציה,
                      ברשימה שהמשתמשים רואים כשהם מחפשים רואה חשבון. כך הלקוחות הבאים
                      שלכם יכולים להגיע אליכם מאיתנו.
                    </p>
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section className="ml-advantages" id="reports">
            <div className="ml-wrap">
              <div className="ml-adv-head">
                <span className="ml-adv-tag">מה מגיע אליכם</span>
                <h2>הדוחות שאתם צריכים, מוכנים</h2>
                <p>הלקוח מפיק ושולח אותם בלחיצה, במקום ערימת קבלות.</p>
              </div>
              <CardGrid items={REPORTS} />
            </div>
          </section>

          <section className="ml-advantages acc-more" id="benefits">
            <div className="ml-wrap">
              <div className="ml-adv-head">
                <span className="ml-adv-tag">ומה עוד הלקוח מקבל</span>
                <h2>כלי שהלקוח באמת ירצה להשתמש בו</h2>
                <p>לקוח שנהנה מהכלי מוציא מסמכים בזמן, וזה מה שמגיע אליכם בסוף.</p>
              </div>
              <CardGrid items={MORE_BENEFITS} />
            </div>
          </section>

          <section className="ml-faq" id="faq">
            <h2 className="ml-faq-title">שאלות שרואי חשבון שואלים</h2>
            {FAQ.map((item, index) => (
              <details
                className="ml-faq-item"
                key={item.q}
                name="acc-faq"
                open={index === 0 ? true : undefined}
              >
                <summary className="ml-faq-q">
                  {item.q}
                  <svg className="ml-faq-chev" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M3.5 6l4.5 4.5L12.5 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </summary>
                <p className="ml-faq-a">
                  {item.a}
                  {item.q === "איפה נשמר המידע?" ? (
                    <>
                      {" "}
                      <Link href="/security">לעמוד אבטחת המידע</Link>
                    </>
                  ) : null}
                </p>
              </details>
            ))}
          </section>

          <section className="ml-midcta">
            <div className="ml-wrap ml-midcta-in">
              <p className="ml-midcta-slogan">הכי פשוט: לראות בעיניים.</p>
              <p className="ml-midcta-t">
                נרשמים בחינם ובודקים בדיוק את מה שהלקוח יקבל.
              </p>
              <SignupLink className="ml-btn ml-btn-primary ml-btn-sm">
                היכנסו ובדקו בעצמכם
              </SignupLink>
              <span className="ml-midcta-note">
                בלי כרטיס אשראי · בלי התחייבות
              </span>
            </div>
          </section>
        </main>

        <FooterLight />
      </div>
    </>
  );
}
