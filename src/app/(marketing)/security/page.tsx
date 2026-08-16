import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/security",
  title: "אבטחת מידע וגיבויים",
  ogTitle: "אבטחת מידע וגיבויים | חשבונית ידידותית",
  description:
    "איפה המידע שלך נשמר, איך הוא מוגן, מה קורה אם משהו נמחק, ואיך אתה יכול לקחת אותו איתך בכל רגע. עובדות בלבד, בלי הבטחות שיווקיות.",
});

/**
 * /security - the plain-language answer to "is my data safe here?".
 *
 * Every sentence on this page is a fact that can be checked in the repo or
 * against the live project. Nothing here is aspirational: if a control is
 * removed, remove its line. Sources per section:
 *   storage/location  Supabase project ddrlnwwuzehatjfachgu, region eu-west-2
 *   isolation         RLS on every public table (scripts/migrations/20260816-assert-rls-all-public-tables.sql)
 *   immutability      scripts/migrations/20260807-… (documents) + 20260816-document-items-immutability.sql
 *   backups           .github/workflows/db-backup.yml + docs/restore-runbook.md
 *   export/delete     /api/export-data, src/lib/backup-zip.ts, /api/uniform-structure/export, /api/delete-account
 *   2FA               src/components/two-factor-section.tsx
 *   headers/HSTS      next.config.ts
 *   weekly check      AGENTS.md "Security floor" (weekly remote AEGIS re-run)
 *   security.txt      src/app/api/security-txt/route.ts
 *   Tax Authority     docs/security-procedures.md (software-house file 4257104)
 * No certifications are claimed for the app itself. Supabase's SOC 2 is
 * theirs, and is stated as theirs.
 */
export default function SecurityPage() {
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
              <span>שקיפות</span>
            </div>
            <h1 className="v2-doc-title">אבטחת מידע וגיבויים</h1>
            <p className="v2-doc-updated">עודכן לאחרונה: אוגוסט 2026</p>
          </div>

          <article className="v2-prose">
            <section>
              <h2>בקצרה</h2>
              <ul>
                <li>
                  <strong>המידע שלך יושב במסד נתונים Postgres בלונדון</strong>, אצל
                  Supabase, עם הפרדה קשיחה בין עסק לעסק ברמת מסד הנתונים.
                </li>
                <li>
                  <strong>כל לילה נוצר גיבוי מוצפן</strong> של כל המסד וכל הקבצים,
                  נשמר במקום נפרד לגמרי מ-Supabase, ונבדק בשחזור אמיתי לפני
                  שהוא נחשב תקין.
                </li>
                <li>
                  <strong>מסמך שהונפק ננעל.</strong> מסד הנתונים עצמו מסרב לשנות
                  או למחוק חשבונית שנשלחה ללקוח, גם אם הקוד שלנו יבקש.
                </li>
                <li>
                  <strong>המידע שלך הוא שלך.</strong> ייצוא מלא (JSON, CSV, מבנה
                  אחיד לרשות המסים) ומחיקת חשבון זמינים בלחיצה, בלי לבקש רשות
                  ובלי לחכות.
                </li>
              </ul>
            </section>

            <section>
              <h2>1. איפה המידע נשמר</h2>
              <p>
                העסקים, הלקוחות, המסמכים, השורות וההוצאות שלך נשמרים במסד
                נתונים Postgres המנוהל על ידי Supabase, בשרתים באזור לונדון
                (בריטניה). קבצים שאתה מעלה (לוגו, קבלות סרוקות, קבצים מצורפים)
                נשמרים באחסון קבצים של אותו ספק, באותו אזור. Supabase מוסמכת
                SOC 2 והדיסקים שלה מוצפנים במנוחה. האתר עצמו מוגש דרך Vercel,
                שלא מחזיק עותק של הנתונים העסקיים שלך.
              </p>
              <p>
                מספרי הקצאה מרשות המסים מתקבלים דרך חיבור מאובטח (OAuth), ואסימוני
                הגישה לרשות נשמרים בעמודה מוצפנת (AES-256-GCM) עם מפתח נפרד
                שאינו נמצא במסד הנתונים.
              </p>
            </section>

            <section>
              <h2>2. הפרדה בין עסקים</h2>
              <p>
                כל טבלה במסד הנתונים מוגנת ב-Row Level Security: כל שורה משויכת
                לעסק, ומסד הנתונים עצמו לא מחזיר שורה של עסק אחר, גם אם מישהו
                ינסה לפנות אליו ישירות ולא דרך האפליקציה. הרשאות הכתיבה על
                הקבצים מוגבלות באותו אופן לעסק שהעלה אותם. בדיקה אוטומטית שבועית
                מריצה מחדש את ניסיון הגישה החוצה בין עסקים ומתריעה אם משהו נפתח.
              </p>
            </section>

            <section>
              <h2>3. מסמך שהונפק לא משתנה</h2>
              <p>
                חשבונית, קבלה או חשבונית זיכוי שיצאו ממצב טיוטה ננעלות ברמת מסד
                הנתונים: הסכומים, המספר, התאריך, שם הלקוח והשורות אינם ניתנים
                לשינוי, ומסמך שנשלח ללקוח אינו ניתן למחיקה. תיקון נעשה כמו
                שהחוק דורש, במסמך חדש (חשבונית זיכוי), לא בעריכה שקטה של
                הישן. הנעילה היא טריגר בתוך מסד הנתונים, כלומר היא חלה גם על
                הקוד שלנו ולא רק על המשתמש.
              </p>
            </section>

            <section>
              <h2>4. גיבויים</h2>
              <p>
                בכל לילה נוצר גיבוי מלא של מסד הנתונים ושל כל הקבצים. הגיבוי
                מוצפן (AES-256) עם מפתח שנמצא רק בידינו, ונשמר בשני מקומות
                נפרדים ובלתי תלויים ב-Supabase. לפני שגיבוי נחשב תקין הוא משוחזר
                אוטומטית לתוך מסד נתונים נפרד ומספר הרשומות מושווה לרשומה
                המקורית; גיבוי שלא עבר את השחזור מסומן ככושל ומתריע מיד. נשמרים
                35 גיבויים יומיים וגיבוי חודשי לצמיתות. במקרה הגרוע ביותר, אובדן
                המידע מוגבל ליממה אחת.
              </p>
            </section>

            <section>
              <h2>5. המידע שלך יוצא איתך</h2>
              <p>
                מהגדרות החשבון אפשר להוריד בכל רגע את כל המידע: קובץ JSON מלא
                וחבילת CSV שנפתחת באקסל; מעמוד הדוחות מפיקים קובץ "מבנה אחיד"
                בפורמט הרשמי של רשות המסים לצורכי ביקורת. גם מחיקת החשבון כולו
                זמינה מההגדרות,
                מוחקת את הכל ולא ניתנת לביטול. אין נעילה, אין תקופת המתנה ואין
                צורך לפנות אלינו.
              </p>
            </section>

            <section>
              <h2>6. התחברות והגנה על החשבון</h2>
              <p>
                אפשר להתחבר עם Google או עם אימייל וסיסמה. סיסמאות נשמרות
                כ-hash בלבד (bcrypt) ואינן ניתנות לשחזור גם על ידינו. אימות
                דו-שלבי (אפליקציית אימות) זמין בהגדרות ומומלץ לכל משתמש. כל
                החיבורים לאתר ולשרת מוצפנים ב-TLS עם HSTS, ודפי האפליקציה
                נושאים כותרות אבטחה שמונעות הטמעה באתרים אחרים ושליחת מידע
                לצדדים שלישיים.
              </p>
            </section>

            <section>
              <h2>7. מה אנחנו לא עושים</h2>
              <p>
                לא מוכרים, לא משכירים ולא מעבירים מידע לצדדים שלישיים למטרות
                שיווק. אין עוגיות מעקב ואין פרסום. הגישה שלנו למידע של עסק
                מסוים נעשית רק לצורך תמיכה שהעסק עצמו ביקש. הפירוט המלא נמצא
                ב<Link href="/privacy">מדיניות הפרטיות</Link>.
              </p>
            </section>

            <section>
              <h2>8. דיווח על בעיית אבטחה</h2>
              <p>
                מצאת משהו? נשמח לדעת לפני כולם. פרטי הקשר מפורסמים בקובץ{" "}
                <a href="/.well-known/security.txt">security.txt</a> התקני, או
                ישירות ל-
                <a href="mailto:asafkotlar@gmail.com">asafkotlar@gmail.com</a>.
                אנחנו רשומים כבית תוכנה ברשות המסים ופועלים לפי נספח אבטחת
                המידע שלה, כולל נוהל דיווח על אירועי אבטחה.
              </p>
            </section>
          </article>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
