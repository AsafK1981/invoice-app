import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/terms",
  title: "תנאי שימוש",
  ogTitle: "תנאי שימוש | חשבונית ידידותית",
  description:
    "תנאי השימוש בחשבונית ידידותית: אחריות המשתמש למידע ולעמידה בדיני המס, הגבלת האחריות של השירות, וכללי סיום החשבון - בשפה פשוטה.",
});

/**
 * /v2/terms, the same terms-of-use copy as /terms, re-themed in the
 * gold/obsidian v2 design. Legal wording is reused verbatim.
 */
export default function V2TermsPage() {
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
            <h1 className="v2-doc-title">תנאי שימוש</h1>
            <p className="v2-doc-updated">עודכן לאחרונה: אפריל 2026</p>
          </div>

          <article className="v2-prose">
            <section>
              <h2>1. השירות</h2>
              <p>
                MyFriendlyInvoiceApp הוא כלי לניהול חשבוניות וקבלות
                לעצמאיים. השירות ניתן באופן "כפי שהוא" (AS-IS).
              </p>
            </section>

            <section>
              <h2>2. אחריות המשתמש</h2>
              <p>
                אתה אחראי לדיוק המידע שאתה מזין, לעמידה בחוקי המס בישראל, ולכל
                מסמך שאתה מפיק. אנחנו לא מהווים תחליף לרואה חשבון או יועץ מס.
              </p>
            </section>

            <section>
              <h2>3. הגבלת אחריות</h2>
              <p>
                השירות מסופק ללא אחריות מכל סוג שהוא. אנחנו לא נושאים באחריות לכל
                נזק עקיף, מקרי או תוצאתי הנובע מהשימוש בשירות. למרות מאמצינו
                לאבטחת הנתונים, אנחנו ממליצים על גיבוי שגרתי של הנתונים החשובים לך
                (ייצוא ל-CSV).
              </p>
            </section>

            <section>
              <h2>4. עמידה בדיני המס</h2>
              <p>
                באחריותך לוודא שהמסמכים שאתה מפיק עומדים בדרישות רשות המסים
                בישראל. עוסק מורשה החייב בהקצאת מספרי חשבונית מ-API "חשבונית
                ישראל" אחראי לחיבור וההפעלה של ה-API לפי הוראות החוק.
              </p>
            </section>

            <section>
              <h2>5. סיום השירות</h2>
              <p>
                אתה יכול לסגור את החשבון שלך בכל עת מתוך עמוד ההגדרות. אנחנו
                שומרים לעצמנו את הזכות לסיים שירות למשתמש שמפר את התנאים הללו.
              </p>
            </section>

            <section>
              <h2>6. שינויים בתנאים</h2>
              <p>
                אנחנו עשויים לעדכן את התנאים מעת לעת. שינויים מהותיים יבואו לידיעתך
                באמצעות הודעה באפליקציה.
              </p>
            </section>

            <section>
              <h2>7. יצירת קשר</h2>
              <p>
                שאלות? פנה אלינו ב-
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
