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
    "מדיניות הפרטיות של חשבונית ידידותית: איזה מידע נאסף ולמה, אילו ספקים מעבדים אותו (כולל AI), איך הוא מאובטח, ואילו זכויות יש לך לפי חוק הגנת הפרטיות.",
});

/**
 * Privacy policy. Every substantive clause here passed the
 * legal-devils-advocate gate (2026-08-16, jurisdiction: Israel,
 * tested against חוק הגנת הפרטיות incl. Amendment 13 and the 2017
 * Data Security Regulations). The Anthropic no-training claim was
 * verified against Anthropic's live commercial terms - keep the
 * "commercial terms" qualifier if editing. Groq (voice-note
 * transcription) added 2026-08-17 and gated the same way: the
 * no-training statement cites the Groq Services Agreement §4.2 with
 * its conditionality, verdict LEGAL after rewording. Do not edit
 * clause substance without re-running the gate.
 *
 * 2026-09-10, gated again. §4 gained Sentry and Axiom (both were receiving
 * user id, business id and - for Axiom - IP and the עוסק number on a rejected
 * allocation, while named nowhere), and §4א was added for the two permissions
 * a reader would not otherwise guess at. Gate returned three constraints,
 * all applied here:
 *   - Cross-border: do not publish one blanket "בכפוף להסכמי עיבוד מידע"
 *     across EU-hosted and US-hosted providers, since it implies a uniform
 *     legal basis that does not exist per provider. Now says where each one
 *     sits and what the agreement covers, without asserting which gateway of
 *     תקנות העברת מידע לחו"ל it satisfies. Confirming each provider's DPA
 *     actually matches תקנה 2(4) is open work, and is lawyer work.
 *   - Gmail: describe the mechanism, not the goal. The first draft said we
 *     read messages "כדי לאתר" documents, which a reader would take as
 *     header matching. Reality is narrower in one way and broader in
 *     another: Google runs the search server-side so non-matching mail never
 *     reaches us (buildGmailQuery), but a matching message is fetched
 *     format=full and its attachment is downloaded and sent to the scanner.
 *     Both halves are now stated.
 *   - The absolute "הקלטת מסך מושבתת לחלוטין" may not rest on a runtime
 *     config someone can flip. tests/sentry-replay-disabled.test.ts fails the
 *     suite if either replay rate leaves 0 or a replayIntegration appears, and
 *     it also asserts this sentence still exists so the two cannot drift apart.
 *
 * Gate also confirmed: no ממונה על הגנת הפרטיות and no מאגר registration duty
 * at this scale, and said explicitly NOT to add a line claiming either - there
 * is no duty to publish a negative. Re-ask if the user count passes low
 * hundreds.
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
            <h1 className="v2-doc-title">מדיניות פרטיות</h1>
            <p className="v2-doc-updated">עודכן לאחרונה: ספטמבר 2026</p>
          </div>

          <article className="v2-prose">
            <section>
              <h2>1. כללי</h2>
              <p>
                מדיניות זו מסבירה איזה מידע נאסף כשאתה משתמש ב"חשבונית
                ידידותית", למה הוא משמש, ואילו זכויות יש לך. בעל השליטה במאגר
                המידע: אסף קוטלר ("חשבונית ידידותית"). דרכי התקשרות:{" "}
                <a href="mailto:asafkotlar@gmail.com">asafkotlar@gmail.com</a>.
              </p>
            </section>

            <section>
              <h2>2. איזה מידע נאסף ולאיזו מטרה</h2>
              <p>
                פרטי התחברות (אימייל וסיסמה, או חשבון Google) - לזיהוי ואבטחת
                החשבון. פרטי העסק שלך - להפקת מסמכים תקינים על שמך. פרטי הלקוחות
                שאתה מוסיף - להפקת מסמכים ושליחתם. המסמכים וההוצאות שאתה מתעד,
                כולל קבלות סרוקות - לניהול העסק שלך ולחישוב דוחות. הודעות שאתה
                שולח לעוזר החכם - למתן מענה. ואם חיברת את ערוץ הוואטסאפ - מספר
                הטלפון וההודעות בו, להפעלת הערוץ. מסירת המידע אינה חובה על פי
                חוק, אך בלעדיה לא נוכל לספק את השירות.
              </p>
            </section>

            <section>
              <h2>3. מה אנחנו לא עושים במידע</h2>
              <p>
                המידע משמש אך ורק להפעלת השירות עבורך. אנחנו לא מוכרים ולא
                משכירים את המידע שלך, ולא מעבירים אותו לצדדים שלישיים למטרות
                שיווק. אין באתר עוגיות מעקב או פרסום. בנוסף נאספות סטטיסטיקות
                שימוש אנונימיות ומצרפיות (ללא עוגיות וללא זיהוי אישי, באמצעות
                Vercel Analytics) לשיפור השירות.
              </p>
            </section>

            <section>
              <h2>4. ספקי משנה והעברת מידע לחו"ל</h2>
              <p>
                כדי להפעיל את השירות אנחנו נעזרים בספקים חיצוניים, שכל אחד מהם
                מקבל רק את המידע הדרוש לתפקידו: Supabase (מסד נתונים ואימות,
                שרתים באיחוד האירופי/בריטניה), Vercel (אירוח), Google (התחברות
                OAuth; ואם חיברת את תיבת הדואר שלך לאיתור הוצאות - גם הרשאת
                קריאה לתיבת ה-Gmail שלך, ראה סעיף 4א), Resend ו-Gmail (שליחת
                אימיילים), Anthropic (עיבוד סריקות הוצאות, הודעות העוזר החכם,
                וקובץ ספר מותג שהעלית לעיצוב המסמכים), Groq (תמלול הודעות קוליות
                שנשלחות לבוט הוואטסאפ, אם בחרת להשתמש בו), Meta (ערוץ הוואטסאפ,
                אם בחרת להשתמש בו), Polar (סליקת תשלומים - פרטי האשראי נמסרים
                ישירות לספק הסליקה ולא נשמרים אצלנו), Sentry (דיווח תקלות) ו-Axiom
                (יומני אבטחה, שרתים באיחוד האירופי). חלק מהספקים מעבדים מידע
                בשרתים מחוץ לישראל: Supabase ו-Axiom באיחוד האירופי, והיתר
                בעיקר בארה"ב. מול כל ספק כזה קיים הסכם עיבוד מידע שמגדיר למה
                מותר לו להשתמש במידע וכיצד עליו לאבטח אותו.
              </p>
            </section>

            <section>
              <h2>4א. שתי הרשאות שחשוב שתכיר</h2>
              <p>
                <strong>חיבור תיבת הדואר.</strong> אם הפעלת את איתור ההוצאות
                מהמייל, אנחנו מבקשים מ-Google הרשאת קריאה לתיבת ה-Gmail שלך
                (ההרשאה נקראת <span dir="ltr">gmail.readonly</span>). זו הרשאה
                רחבה יותר מהתחברות רגילה, ולכן חשוב שתדע בדיוק מה נעשה בה.
              </p>
              <p>
                איננו סורקים את התיבה כולה. Google מריץ עבורנו חיפוש בצד שלו,
                ואנחנו מקבלים רק הודעות שעונות עליו: הודעות שיש בהן קובץ מצורף
                ושמוזכרת בהן חשבונית או קבלה (בעברית או באנגלית), למעט צ׳אטים
                והודעות ששלחת בעצמך. בהודעות שכן תואמות אנחנו קוראים את התוכן
                המלא ומורידים את הקובץ המצורף, והקובץ נשלח לסריקה אוטומטית אצל
                Anthropic כדי לחלץ ממנו את פרטי ההוצאה. הודעות שלא תואמות לחיפוש
                לא מגיעות אלינו כלל.
              </p>
              <p>
                אף אדם אצלנו לא קורא את תוכן ההודעות שלך, אלא אם פנית לתמיכה
                וביקשת מפורשות שנבדוק מקרה מסוים. איננו שולחים הודעות, איננו
                מוחקים הודעות, ואיננו משתמשים בתוכן לשום מטרה אחרת: לא לשיווק,
                לא לפרסום ולא לאימון מודלים. אפשר לנתק את החיבור בכל רגע מתוך
                עמוד ההגדרות, וגם ישירות מחשבון Google שלך.
              </p>
              <p>
                <strong>דיווח תקלות ויומני אבטחה.</strong> כשמתרחשת שגיאה
                באפליקציה נשלח דיווח ל-Sentry הכולל את פרטי השגיאה ואת מזהי
                המשתמש והעסק. איננו מקליטים את המסך שלך: הקלטת מסך מושבתת
                לחלוטין. במקביל, אירועי אבטחה (למשל ניסיון התחברות כושל) נרשמים
                ב-Axiom וכוללים את כתובת ה-IP ואת מזהי המשתמש והעסק. שני אלה
                משמשים אותנו לאיתור תקלות ולהגנה על החשבון בלבד, ולא לשיווק ולא
                לפרסום.
              </p>
            </section>

            <section>
              <h2>5. בינה מלאכותית ונתונים</h2>
              <p>
                תמונות קבלות שאתה סורק והודעות שאתה שולח לעוזר החכם נשלחות
                לעיבוד אצל Anthropic. על פי תנאי השירות המסחריים של Anthropic,
                מידע שנשלח דרך ה-API אינו משמש לאימון מודלים. הודעות קוליות
                שנשלחות לבוט הוואטסאפ מתומללות לטקסט אצל Groq. על פי הסכם
                השירות בינינו לבין Groq (Groq Services Agreement, סעיף 4.2),
                Groq אינה רשאית להשתמש בקלט או בפלט, לרבות תמלולי הודעות
                קוליות, לאימון או כוונון מודלים, אלא אם ניתנה לכך הרשאה
                מפורשת מאיתנו; לא נתנו הרשאה כזו.
              </p>
            </section>

            <section>
              <h2>6. המידע על הלקוחות שלך</h2>
              <p>
                פרטי הלקוחות שאתה מזין (שם, אימייל, טלפון) נשמרים אצלנו עבורך
                בלבד: אתה בעל השליטה במידע הזה, ואנחנו מחזיקים בו רק כדי לספק לך
                את השירות. באחריותך לוודא שיש לך בסיס חוקי להחזיק בפרטי הלקוחות
                שלך. אם לקוח שלך יפנה אלינו ישירות בבקשה לגבי המידע שלו, נפנה את
                הבקשה אליך.
              </p>
            </section>

            <section>
              <h2>7. אבטחה וגישה לנתונים</h2>
              <p>
                הנתונים מאוחסנים ב-Supabase עם הצפנה במעבר ובמנוחה. ברמת
                האפליקציה, כל משתמש רואה רק את הנתונים שלו (Row Level
                Security). סיסמאות מאוחסנות בגיבוב ואיננו יכולים לראותן.
              </p>
              <p>
                בעל השליטה במאגר (כיום אדם אחד) מחזיק, מעבר להרשאות
                המשתמשים, גם בגישה טכנית ברמת התשתית לנתונים, הנדרשת לתפעול
                השירות, לתמיכה שביקשת, לתיקון תקלות, לאבטחת מידע ולקיום חובות
                על פי דין - ורק לצרכים אלה. פעילות במערכות התשתית נרשמת
                ביומני מערכת הנשמרים לצורכי אבטחה ותחקור אירועים. איננו
                מעיינים במסמכים שלך או בפרטי לקוחותיך שלא לצורך אחד מהצרכים
                שלעיל.
              </p>
              <p>
                אם יתרחש אירוע אבטחה חמור שנוגע למידע שלך, נודיע לך בהתאם
                להוראות הדין.
              </p>
            </section>

            <section>
              <h2>8. שמירה ומחיקה</h2>
              <p>
                הנתונים נשמרים כל עוד החשבון פעיל. מחיקת חשבון מעמוד ההגדרות
                מוחקת את כל הנתונים שלך מהמערכת הפעילה שלנו באופן מיידי; עותקים
                שנוצרו בגיבויי תשתית שגרתיים אינם משמשים לשום מטרה אחרת ונמחקים
                אוטומטית עם התחלפות מחזור הגיבויים. שים לב: על פי הוראות ניהול
                ספרים, החובה לשמור מסמכי מס למשך 7 שנים לפחות חלה עליך - לפני
                מחיקת החשבון ייצא עותק של המסמכים שלך.
              </p>
            </section>

            <section>
              <h2>9. הזכויות שלך</h2>
              <p>
                על פי חוק הגנת הפרטיות, אתה זכאי לעיין במידע שנאסף עליך, לבקש את
                תיקונו, ולבקש את מחיקתו - למעט מידע שאנו או אתה מחויבים לשמור על
                פי דין, כגון מסמכי מס הכפופים לחובת שמירה של 7 שנים לפחות. במקרים
                אלה נסביר איזה חלק מהבקשה ניתן למימוש. את רוב הפעולות אפשר לבצע
                ישירות מהאפליקציה, כולל ייצוא הנתונים שלך (CSV) ומחיקת החשבון,
                והשאר בפנייה אלינו במייל.
              </p>
            </section>

            <section>
              <h2>10. עוגיות ואחסון מקומי</h2>
              <p>
                האפליקציה משתמשת באחסון מקומי (localStorage) ובעוגיות הדרושות
                להתחברות בלבד. איננו משתמשים בעוגיות מעקב או פרסום.
              </p>
            </section>

            <section>
              <h2>11. עדכונים למדיניות</h2>
              <p>
                אנחנו עשויים לעדכן מדיניות זו מעת לעת. על שינוי מהותי נודיע
                באפליקציה או במייל לפני כניסתו לתוקף. תאריך העדכון האחרון מופיע
                בראש העמוד.
              </p>
            </section>

            <section>
              <h2>12. יצירת קשר</h2>
              <p>
                לשאלות בנושא פרטיות - פנה אלינו ב-
                <a href="mailto:asafkotlar@gmail.com">asafkotlar@gmail.com</a>.
                אם תרצה להתלונן, באפשרותך לפנות גם לרשות להגנת הפרטיות.
              </p>
            </section>
          </article>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
