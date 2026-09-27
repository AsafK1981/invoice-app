import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/accountants",
  title: "לרואי חשבון: תוכנת חשבוניות להמליץ עליה ללקוחות עוסק פטור",
  ogTitle: "לרואי חשבון ויועצי מס | חשבונית ידידותית",
  description:
    "תוכנת חשבוניות חינמית לעוסקים פטורים שמוציאה את המסמך הנכון, מספרי הקצאה אוטומטיים, ודוחות מוכנים לרואה החשבון: מע״מ, עזר ל-1301, כרטסת וקובץ מבנה אחיד.",
});

/**
 * /accountants - the page an accountant lands on when a client (or Asaf)
 * sends them here, and the page accountants find when they search for a tool
 * to recommend to small clients.
 *
 * Same rule as /security: every sentence is a shipped fact. Sources:
 *   document types      src/lib/document-store.ts
 *   allocation numbers  src/lib/ita/*
 *   ceiling alert       advantages.tsx "tikra" card
 *   reports list        advantages.tsx "reports" card + src/app/(app)/reports/*
 *   1301 / capital      src/lib/csv-export.ts - these are DRAFTS for the
 *                       accountant, not filled forms. Keep the word עזר/טיוטה.
 *   uniform structure   src/lib/uniform-structure + /api/uniform-structure/export
 *   immutability        /security section on locked documents
 * There is NO accountant login into a client's account (the /portal is for the
 * business's own customers). Do not claim one until it ships.
 */
export default function AccountantsPage() {
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
              <span>לרואי חשבון ויועצי מס</span>
            </div>
            <h1 className="v2-doc-title">
              כלי חשבוניות שאפשר להמליץ עליו ללקוחות העוסקים הפטורים
            </h1>
            <p className="v2-doc-updated">עודכן לאחרונה: ספטמבר 2026</p>
          </div>

          <article className="v2-prose">
            <section>
              <h2>בקצרה</h2>
              <ul>
                <li>
                  <strong>חינמי לגמרי בתקופת ההשקה.</strong> בלי כרטיס אשראי
                  ובלי התחייבות, כך שאין ללקוח שום חסם להתחיל.
                </li>
                <li>
                  <strong>הלקוח מוציא את המסמך הנכון.</strong> קבלה, חשבונית
                  מס, חשבונית מס-קבלה או חשבון עסקה, לפי הסטטוס שלו.
                </li>
                <li>
                  <strong>מספרי הקצאה נמשכים אוטומטית</strong> מרשות המסים,
                  במסגרת חשבונית ישראל.
                </li>
                <li>
                  <strong>אתם מקבלים נתונים מסודרים.</strong> דוחות מוכנים וקובץ
                  מבנה אחיד לייבוא ישיר.
                </li>
              </ul>
            </section>

            <section>
              <h2>מה הלקוח שלכם מקבל</h2>
              <ul>
                <li>בחירת סוג המסמך הנכון, עם מספור רץ אוטומטי.</li>
                <li>מספר הקצאה בלחיצה כשהחשבונית חייבת בו.</li>
                <li>
                  התראה בזמן אמת כשהוא מתקרב לתקרת עוסק פטור, לפני שהוא חוצה
                  אותה בטעות.
                </li>
                <li>סריקת קבלות והוצאות בצילום.</li>
                <li>תזכורות תשלום ללקוחות שמאחרים, במייל ובאפליקציה.</li>
              </ul>
            </section>

            <section>
              <h2>מה אתם מקבלים ממנו</h2>
              <p>
                במקום לרדוף אחרי הלקוח בסוף השנה, הוא מפיק ושולח לכם את הקבצים
                בלחיצה:
              </p>
              <ul>
                <li>
                  <strong>קובץ מבנה אחיד</strong> שמייבאים ישירות למערכת שלכם.
                </li>
                <li>דוח מע״מ תקופתי ורשימת מסמכים לתקופה.</li>
                <li>
                  <strong>עזר להכנת 1301</strong> וטיוטת הצהרת הון, כנקודת
                  פתיחה לעבודה שלכם, לא כטופס מוגש.
                </li>
                <li>רווח והפסד, כרטסת לקוח, יומן שנתי וגיול חובות.</li>
                <li>תחזית מס לסוף השנה.</li>
                <li>ייצוא ל-Excel ול-CSV של כל הנתונים.</li>
              </ul>
            </section>

            <section>
              <h2>תקינות</h2>
              <ul>
                <li>
                  מסמך שהונפק <strong>ננעל</strong>: מסד הנתונים עצמו מסרב לשנות
                  או למחוק חשבונית שנשלחה. תיקון נעשה בחשבונית זיכוי, כמו
                  שצריך.
                </li>
                <li>אנחנו רשומים כבית תוכנה ברשות המסים.</li>
                <li>
                  פירוט מלא על שמירת המידע והגיבויים בעמוד{" "}
                  <Link href="/security">אבטחת מידע</Link>.
                </li>
              </ul>
            </section>

            <section>
              <h2>שאלות שרואי חשבון שואלים</h2>
              <p>
                <strong>אני יכול להיכנס לחשבון של הלקוח?</strong>
                <br />
                כרגע לא. הלקוח מפיק את הדוחות וקובץ המבנה האחיד ושולח לכם
                אותם. אם גישה ישירה חשובה לכם, ספרו לנו, זה בדיוק סוג המשוב
                שקובע מה נבנה הלאה.
              </p>
              <p>
                <strong>מה הקאץ׳?</strong>
                <br />
                אין. זו תקופת השקה והכלי פתוח בחינם לכולם. בהמשך יהיה גם מסלול
                בתשלום, במחיר נמוך.
              </p>
              <p>
                <strong>הלקוח כבר עובד עם תוכנה אחרת.</strong>
                <br />
                אין סיבה להחליף מה שעובד. הכלי מתאים במיוחד לעוסקים קטנים
                שמרגישים שהתוכנה הנוכחית יקרה או מסובכת בשבילם.
              </p>
            </section>

            <section>
              <h2>איך ממליצים</h2>
              <p>
                פשוט שולחים ללקוח את הקישור. ההרשמה לוקחת דקה:{" "}
                <Link href="/login?mode=signup">friendlyinvoice.co.il</Link>
              </p>
              <p>
                רוצים לראות את המערכת לפני שממליצים, או לשאול משהו? כתבו לי
                ישירות ל-
                <a href="mailto:asafkotlar@gmail.com">asafkotlar@gmail.com</a>{" "}
                ואשמח להראות לכם אותה.
              </p>
            </section>
          </article>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
