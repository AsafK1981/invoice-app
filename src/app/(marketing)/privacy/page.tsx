import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/privacy",
  title: "מדיניות פרטיות",
  ogTitle: "מדיניות פרטיות | חשבונית ידידותית",
  description:
    "מדיניות הפרטיות של חשבונית ידידותית: אילו נתונים אנחנו אוספים, איך הם מאובטחים ב-Supabase, ואילו זכויות יש לך - כולל ייצוא ומחיקת חשבון.",
});

/**
 * /v2/privacy, the same privacy-policy copy as /privacy, re-themed in
 * the gold/obsidian v2 design. Legal wording is reused verbatim.
 */
export default function V2PrivacyPage() {
  return (
    <>
      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      <main id="main-content" className="v2-main">
        <div className="v2-doc">
          <Link href="/" className="v2-back">
            <ArrowRight />
            חזרה לעמוד הבית
          </Link>

          <div className="v2-doc-head">
            <div className="v2-eyebrow-row">
              <i className="ln" />
              <span>מסמך משפטי</span>
            </div>
            <h1 className="v2-doc-title v2-gold">מדיניות פרטיות</h1>
            <p className="v2-doc-updated">עודכן לאחרונה: אפריל 2026</p>
          </div>

          <article className="v2-prose">
            <section>
              <h2>1. איזה מידע אנחנו אוספים</h2>
              <p>
                כשאתה משתמש ב-MyFriendlyInvoiceApp אנחנו אוספים: כתובת
                אימייל וסיסמה (להתחברות), פרטי העסק שלך, פרטי הלקוחות שאתה מוסיף,
                מסמכים שאתה מפיק, והוצאות שאתה מתעד.
              </p>
            </section>

            <section>
              <h2>2. כיצד אנחנו משתמשים במידע</h2>
              <p>
                המידע שלך משמש אך ורק להפעלת השירות שלך - אחסון מסמכים, שליחת
                אימיילים, חישוב דו״חות. אנחנו לא מוכרים, משכירים, או חולקים את
                המידע שלך עם צד שלישי.
              </p>
            </section>

            <section>
              <h2>3. אבטחה</h2>
              <p>
                הנתונים שלך מאוחסנים ב-Supabase (תשתית ענן מאובטחת) עם הצפנה
                ב-transit וב-rest. כל משתמש רואה רק את הנתונים שלו (Row Level
                Security). הסיסמה שלך מוצפנת ולא ניתן לראותה גם על ידינו.
              </p>
            </section>

            <section>
              <h2>4. שירותים חיצוניים</h2>
              <p>
                אנחנו משתמשים בשירותי צד שלישי כדי לתפעל את האפליקציה: Supabase
                (מסד נתונים ואותנטיקציה), Vercel (אירוח), Resend (שליחת
                אימיילים), Google (התחברות OAuth). כל אחד מהם מקבל רק את המידע
                ההכרחי לשירותו.
              </p>
            </section>

            <section>
              <h2>5. הזכויות שלך</h2>
              <p>
                אתה יכול בכל עת: לצפות בנתונים שלך, לערוך אותם, לייצא אותם (CSV),
                או למחוק את החשבון שלך לחלוטין מההגדרות. מחיקת חשבון מסירה את כל
                הנתונים שלך מהשרתים שלנו לצמיתות.
              </p>
            </section>

            <section>
              <h2>6. עוגיות</h2>
              <p>
                האפליקציה משתמשת באחסון מקומי (localStorage) של הדפדפן לזכור את
                ההתחברות שלך. אנחנו לא משתמשים בעוגיות מעקב או שיווק.
              </p>
            </section>

            <section>
              <h2>7. יצירת קשר</h2>
              <p>
                שאלות בנוגע למדיניות הפרטיות? פנה אלינו ב-
                <a href="mailto:asafkotlar@gmail.com">asafkotlar@gmail.com</a>
              </p>
            </section>
          </article>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
