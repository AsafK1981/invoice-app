import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/accessibility",
  title: "הצהרת נגישות",
  ogTitle: "הצהרת נגישות | חשבונית ידידותית",
  description:
    "הצהרת הנגישות של חשבונית ידידותית: אילו אמצעי נגישות קיימים באפליקציה בפועל, מה עדיין לא נבדק, ואיך לדווח על בעיית נגישות.",
});

/**
 * Accessibility statement. Every claim here must be verifiable against the
 * actual code (focus-visible ring in globals.css, the measured contrast
 * fixes in globals.css/app-skin.css, the dialog focus-trap in modal.tsx, the
 * inert mobile drawer in sidebar.tsx, the skip links + landmarks in the two
 * root layouts, the label association in form-field.tsx, lang="he" dir="rtl"
 * in layout.tsx). This is a solo-owner SaaS with NO independent accessibility
 * audit, so the page must not claim WCAG or ת"י 5568 conformance - only that
 * these principles were the target and that specific, real work was done
 * toward them. See AGENTS.md "Security floor" section for the project's
 * general stance on not overclaiming in public-facing statements.
 */
export default function AccessibilityPage() {
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
            <h1 className="v2-doc-title v2-gold">הצהרת נגישות</h1>
            <p className="v2-doc-updated">עודכן לאחרונה: 4 באוגוסט 2026</p>
          </div>

          <article className="v2-prose">
            <section>
              <h2>1. המחויבות שלנו לנגישות</h2>
              <p>
                MyFriendlyInvoiceApp (חשבונית ידידותית) הוא מיזם של איש אחד,
                אסף קוטלר. אנחנו רוצים שהאפליקציה תהיה שמישה לכמה שיותר אנשים,
                כולל אנשים עם מוגבלויות, ופועלים לשפר את הנגישות שלה באופן
                שוטף. המסמך הזה מתאר בכנות מה כבר נעשה בפועל, ומה עדיין לא -
                כדי שתדע בדיוק למה לצפות.
              </p>
            </section>

            <section>
              <h2>2. מה כבר נעשה</h2>
              <p>הצעדים הבאים קיימים היום, בפועל, בקוד של האפליקציה:</p>
              <ul>
                <li>
                  <strong>ניווט מקלדת וטבעת פוקוס גלויה:</strong> כל אלמנט
                  שאפשר ללחוץ עליו (קישורים, כפתורים, שדות טופס) מקבל טבעת
                  פוקוס כתומה ברורה כשמנווטים אליו במקלדת, כדי שתמיד תדע איפה
                  אתה נמצא בעמוד.
                </li>
                <li>
                  <strong>קישור &quot;דלג לתוכן&quot;:</strong> בראש כל עמוד
                  (גם באפליקציה וגם באתר השיווקי) קיים קישור סמוי שמופיע ברגע
                  שמתחילים לנווט במקלדת, ומאפשר לדלג ישירות לתוכן הראשי בלי
                  לעבור על כל התפריט מחדש בכל עמוד.
                </li>
                <li>
                  <strong>ניגודיות צבעים:</strong> ביצענו סריקה של עמודי הליבה
                  באפליקציה ומדדנו את יחסי הניגודיות בפועל. כמה צבעים (כמו
                  ירוק, אדום, כחול וטורקיז על טקסט) לא עמדו ברף AA של WCAG
                  (4.5:1 לטקסט רגיל) ותוקנו לגוון כהה יותר שנמדד ועובר את הרף.
                  אותו דבר נעשה לצבעי המותג (זהב) על גבי כרטיסים לבנים.
                </li>
                <li>
                  <strong>תיוג טפסים לקורא מסך:</strong> שדות הטופס
                  באפליקציה מקושרים תכנותית לתווית (label) שלהם, כך שקורא מסך
                  מכריז את שם השדה יחד עם הערך שלו, ולא רק &quot;תיבת טקסט&quot;
                  ריקה.
                </li>
                <li>
                  <strong>חלונות קופצים (דיאלוגים) נגישים:</strong> חלונות
                  קופצים באפליקציה (כמו הגדרות חשבון) מסומנים כ-dialog לקורא
                  מסך, שומרים את מוקד המקלדת בתוכם כל עוד הם פתוחים (כדי שלא
                  תיתקע מאחוריהם בטעות), נסגרים במקש Escape, ומחזירים את
                  הפוקוס בדיוק לאלמנט שהיה ממוקד לפני הפתיחה.
                </li>
                <li>
                  <strong>תפריט מובייל נגיש:</strong> כשתפריט הניווט הנייד
                  סגור, התוכן שלו מוסתר לגמרי גם מקורא מסך וגם מניווט מקלדת
                  (ולא רק ויזואלית), כדי שלא תיתקל בפריטי תפריט &quot;נסתרים&quot;
                  שהם בעצם עדיין שם. גם כאן, מקש Escape סוגר את התפריט.
                </li>
                <li>
                  <strong>עברית ו-RTL כברירת מחדל:</strong> כל עמוד באפליקציה
                  מוצהר כ-<span dir="ltr">lang=&quot;he&quot;</span> ו-
                  <span dir="ltr">dir=&quot;rtl&quot;</span>, כך שקוראי מסך
                  והדפדפן עצמו יודעים לטפל נכון בכיוון הטקסט והניקוד.
                </li>
              </ul>
            </section>

            <section>
              <h2>3. רמת הנגישות</h2>
              <p>
                האפליקציה נבנתה מתוך כוונה לעמוד בעקרונות תקן WCAG 2.1 ברמה
                AA, שהוא גם הבסיס של תקן ישראלי 5568. בוצעו שיפורים ממוקדים
                ונמדדים (ראה סעיף 2), אבל <strong>האפליקציה לא עברה בדיקת
                נגישות עצמאית</strong> על ידי גורם חיצוני, ואיננו יכולים
                להצהיר שהיא עומדת באופן מלא בדרישות התקן. אנחנו גם לא ביצענו
                עדיין בדיקה שיטתית עם תוכנות קריאת מסך נפוצות כמו NVDA, JAWS
                או VoiceOver. אם תיתקל בבעיה, נשמח שתדווח לנו (סעיף 5).
              </p>
            </section>

            <section>
              <h2>4. תחומים שעדיין בתהליך</h2>
              <p>
                האפליקציה היא מיזם של איש אחד, והנגישות שלה היא עבודה מתמשכת
                ולא פרויקט שנסגר. בין השאר אנחנו ממשיכים לעבוד על התאמת מבנה
                העיצוב לערכים לוגיים מלאים, על גדלי אזורי המגע במובייל, ועל
                נגישות מסמכי ה-PDF שהאפליקציה מפיקה. אם נתקלת בקושי כלשהו,
                נשמח שתדווח לנו (סעיף 5) - דיווח כזה הוא הדרך המהירה ביותר
                שלנו לדעת מה לתקן קודם.
              </p>
            </section>

            <section>
              <h2>5. דיווח על בעיית נגישות</h2>
              <p>
                אם נתקלת בבעיית נגישות באפליקציה, נשמח לשמוע ולתקן. כתוב לנו
                ל-<a href="mailto:asafkotlar@gmail.com">asafkotlar@gmail.com</a>,
                ואם אפשר תאר את הבעיה, באיזה עמוד היא נמצאה, ובאיזה אמצעי
                השתמשת (מקלדת, קורא מסך, הגדלת טקסט וכו׳). כמיזם של איש אחד,
                נשתדל להשיב בהקדם האפשרי - בדרך כלל תוך ימים ספורים.
              </p>
            </section>
          </article>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
