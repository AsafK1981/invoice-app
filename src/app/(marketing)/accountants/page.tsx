import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import {
  BookOpen,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Gauge,
  Gift,
  Hash,
  Receipt,
  TrendingUp,
} from "lucide-react";
import HeaderLight from "../components/HeaderLight";
import FooterLight from "../components/FooterLight";
import JsonLd from "../components/JsonLd";
import SignupLink from "../components/SignupLink";
import { graph, faqPage } from "@/lib/jsonld";
import { Ltr, LtrText } from "@/components/ui/ltr";
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
 * Built on the homepage design system (marketing-light.css) on purpose: the
 * first version used the /security legal-document layout and read as a long
 * bulleted list (Asaf, 2026-09-27: "not laid out nicely, make it friendlier,
 * more attractive, more comfortable").
 *
 * Same rule as /security: every sentence is a shipped fact. Sources:
 *   document types      src/lib/document-store.ts
 *   allocation numbers  src/lib/ita/*
 *   ceiling alert       advantages.tsx
 *   reports             advantages.tsx "reports" card + src/app/(app)/reports/*
 *   1301 / capital      src/lib/csv-export.ts - DRAFTS for the accountant,
 *                       not filled forms. Keep the words עזר / טיוטה.
 *   uniform structure   src/lib/uniform-structure + /api/uniform-structure/export
 *   locked documents    /security
 * There is NO accountant login into a client's account (/portal is for the
 * business's own customers). Do not claim one until it ships.
 */

const DEMO_MAIL = `mailto:asafkotlar@gmail.com?subject=${encodeURIComponent(
  "הדגמה של חשבונית ידידותית לרואי חשבון",
)}`;

const CLIENT_CARDS: { tone: string; icon: ReactNode; k: string; body: string }[] = [
  {
    tone: "amber",
    icon: <Gift aria-hidden="true" />,
    k: "חינמי בתקופת ההשקה",
    body: "בלי כרטיס אשראי ובלי התחייבות, כך שאין ללקוח שום חסם להתחיל.",
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
    body: "הלקוח רואה בזמן אמת כמה נשאר לו עד התקרה, ומקבל התראה לפני שהוא חוצה אותה.",
  },
];

const REPORTS: { tone: string; icon: ReactNode; title: string; body: string; flagship?: boolean }[] = [
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

const FAQ: { q: string; a: string }[] = [
  {
    q: "אני יכול להיכנס לחשבון של הלקוח?",
    a: "כרגע לא. הלקוח מפיק את הדוחות ואת קובץ המבנה האחיד ושולח לכם אותם. אם גישה ישירה חשובה לכם, ספרו לנו - זה בדיוק סוג המשוב שקובע מה נבנה הלאה.",
  },
  {
    q: "מה הקאץ׳?",
    a: "אין. זו תקופת השקה והכלי פתוח בחינם לכולם. בהמשך יהיה גם מסלול בתשלום, במחיר נמוך.",
  },
  {
    q: "הלקוח כבר עובד עם תוכנה אחרת.",
    a: "אין סיבה להחליף מה שעובד. הכלי מתאים במיוחד לעוסקים קטנים שמרגישים שהתוכנה הנוכחית יקרה או מסובכת בשבילם.",
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
                  נסו את המערכת בחינם
                </SignupLink>
                <a className="acc-hero-alt" href={DEMO_MAIL}>
                  או תאמו הדגמה של 10 דקות
                </a>
              </div>
              <ul className="ml-trust-row">
                <li>
                  <CheckIcon /> חינם בתקופת ההשקה
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

          <section className="ml-advantages" id="reports">
            <div className="ml-wrap">
              <div className="ml-adv-head">
                <span className="ml-adv-tag">מה מגיע אליכם</span>
                <h2>הדוחות שאתם צריכים, מוכנים</h2>
                <p>הלקוח מפיק ושולח אותם בלחיצה, במקום ערימת קבלות.</p>
              </div>

              <div className="ml-adv-grid">
                {REPORTS.map((r, index) => (
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
              <p className="ml-midcta-slogan">רוצים לראות לפני שממליצים?</p>
              <p className="ml-midcta-t">
                כתבו לי ואראה לכם את המערכת בעשר דקות, או פשוט נסו אותה בעצמכם.
              </p>
              <a className="ml-btn ml-btn-primary ml-btn-sm" href={DEMO_MAIL}>
                תאמו הדגמה
              </a>
              <span className="ml-midcta-note">
                אסף קוטלר · <Ltr>asafkotlar@gmail.com</Ltr>
              </span>
            </div>
          </section>
        </main>

        <FooterLight />
      </div>
    </>
  );
}
