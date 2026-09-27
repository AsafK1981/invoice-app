import type { Metadata } from "next";
import Link from "next/link";
import HeaderLight from "../components/HeaderLight";
import FooterLight from "../components/FooterLight";
import RedirectIfAuthed from "../components/RedirectIfAuthed";
import SignupLink from "../components/SignupLink";
import { pageMetadata } from "@/lib/page-metadata";
import "../marketing-light.css";
import "./from-accountant.css";

/**
 * /from-accountant - where a client lands from the link their accountant
 * forwarded (the "שלחו ללקוחות שלכם" card on /accountants). Asaf,
 * 2026-09-27: the client arrives warm, so skip the full homepage pitch -
 * one screen, three benefits, one signup button.
 *
 * noindex: a referral funnel page, it must not compete with the homepage in
 * search. Kept out of the sitemap for the same reason.
 * No personal name/email here (FooterLight hides its operator line on this
 * path), no WhatsApp claim, every line is a shipped fact.
 */
export const metadata: Metadata = {
  ...pageMetadata({
    path: "/from-accountant",
    title: "רואה החשבון שלך המליץ עלינו",
    ogTitle: "רואה החשבון שלך המליץ עלינו | חשבונית ידידותית",
    description:
      "תוכנת חשבוניות חינמית לעוסקים פטורים: המסמך הנכון אוטומטית, מספר הקצאה בלחיצה, והכול מסודר לרואה החשבון בסוף השנה.",
  }),
  robots: { index: false, follow: true },
};

const POINTS: { k: string; body: string }[] = [
  {
    k: "המסמך הנכון, אוטומטית",
    body: "קבלה, חשבונית מס או חשבון עסקה, לפי הסטטוס שלך ועם מספור רץ.",
  },
  {
    k: "מספר הקצאה בלחיצה",
    body: "נמשך ישירות מרשות המסים כשהחשבונית חייבת בו.",
  },
  {
    k: "הכול מסודר לרואה החשבון",
    body: "דוחות מוכנים וקובץ מבנה אחיד שאפשר לשלוח לו בלחיצה, בלי ערימת קבלות בסוף השנה.",
  },
];

function CheckIcon() {
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
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export default function FromAccountantPage() {
  return (
    <>
      <RedirectIfAuthed />
      <div className="ml-theme">
        <HeaderLight />

        <main id="main-content">
          <section className="ml-hero fa-hero">
            <div className="ml-wrap ml-hero-in">
              <span className="ml-eyebrow">רואה החשבון שלך המליץ עלינו</span>
              <h1 className="ml-hero-h1">
                להוציא קבלות וחשבוניות,{" "}
                <br />
                <span className="ml-grad-text">פשוט וחינם</span>
              </h1>
              <p className="ml-lede">
                תוכנת חשבוניות לעוסקים פטורים, שעושה בשבילך את החלק המסובך.
              </p>

              <ul className="fa-points">
                {POINTS.map((p) => (
                  <li key={p.k}>
                    <span className="fa-tick">
                      <CheckIcon />
                    </span>
                    <span>
                      <strong>{p.k}</strong>
                      <span className="fa-point-body">{p.body}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="ml-hero-actions">
                <SignupLink className="ml-btn ml-btn-primary ml-btn-lg">
                  התחילו בחינם
                </SignupLink>
                <span className="ml-hero-note">
                  בלי כרטיס אשראי · ההרשמה לוקחת דקה
                </span>
              </div>

              <p className="fa-more">
                רוצים להכיר לעומק? <Link href="/">לכל היתרונות</Link>
              </p>
            </div>
          </section>
        </main>

        <FooterLight />
      </div>
    </>
  );
}
