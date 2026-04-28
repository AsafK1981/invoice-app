import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

export const metadata = {
  title: "מדיניות פרטיות",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium mb-6"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לעמוד הבית
        </Link>

        <div className="card-soft p-8 sm:p-12 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-md">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-stone-900">מדיניות פרטיות</h1>
          </div>

          <p className="text-sm text-stone-600">עודכן לאחרונה: אפריל 2026</p>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">1. איזה מידע אנחנו אוספים</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              כשאתה משתמש ב-MySuperFriendlyInvoiceApp אנחנו אוספים: כתובת אימייל וסיסמה (להתחברות), פרטי העסק שלך, פרטי הלקוחות שאתה מוסיף, מסמכים שאתה מפיק, והוצאות שאתה מתעד.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">2. כיצד אנחנו משתמשים במידע</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              המידע שלך משמש אך ורק להפעלת השירות שלך - אחסון מסמכים, שליחת אימיילים, חישוב דו״חות. אנחנו לא מוכרים, משכירים, או חולקים את המידע שלך עם צד שלישי.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">3. אבטחה</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              הנתונים שלך מאוחסנים ב-Supabase (תשתית ענן מאובטחת) עם הצפנה ב-transit וב-rest. כל משתמש רואה רק את הנתונים שלו (Row Level Security). הסיסמה שלך מוצפנת ולא ניתן לראותה גם על ידינו.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">4. שירותים חיצוניים</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              אנחנו משתמשים בשירותי צד שלישי כדי לתפעל את האפליקציה: Supabase (מסד נתונים ואותנטיקציה), Vercel (אירוח), Resend (שליחת אימיילים), Google (התחברות OAuth). כל אחד מהם מקבל רק את המידע ההכרחי לשירותו.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">5. הזכויות שלך</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              אתה יכול בכל עת: לצפות בנתונים שלך, לערוך אותם, לייצא אותם (CSV), או למחוק את החשבון שלך לחלוטין מההגדרות. מחיקת חשבון מסירה את כל הנתונים שלך מהשרתים שלנו לצמיתות.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">6. עוגיות</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              האפליקציה משתמשת באחסון מקומי (localStorage) של הדפדפן לזכור את ההתחברות שלך. אנחנו לא משתמשים בעוגיות מעקב או שיווק.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">7. יצירת קשר</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              שאלות בנוגע למדיניות הפרטיות? פנה אלינו ב-asafkotlar@gmail.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
