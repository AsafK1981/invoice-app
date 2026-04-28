import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

export const metadata = {
  title: "תנאי שימוש",
};

export default function TermsPage() {
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
            <h1 className="text-3xl font-bold text-stone-900">תנאי שימוש</h1>
          </div>

          <p className="text-sm text-stone-600">עודכן לאחרונה: אפריל 2026</p>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">1. השירות</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              MySuperFriendlyInvoiceApp הוא כלי לניהול חשבוניות וקבלות לעצמאיים. השימוש בשירות הוא חינם וניתן באופן "כפי שהוא" (AS-IS).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">2. אחריות המשתמש</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              אתה אחראי לדיוק המידע שאתה מזין, לעמידה בחוקי המס בישראל, ולכל מסמך שאתה מפיק. אנחנו לא מהווים תחליף לרואה חשבון או יועץ מס.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">3. הגבלת אחריות</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              השירות מסופק ללא אחריות מכל סוג שהוא. אנחנו לא נושאים באחריות לכל נזק עקיף, מקרי או תוצאתי הנובע מהשימוש בשירות. למרות מאמצינו לאבטחת הנתונים, אנחנו ממליצים על גיבוי שגרתי של הנתונים החשובים לך (ייצוא ל-CSV).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">4. עמידה בדיני המס</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              באחריותך לוודא שהמסמכים שאתה מפיק עומדים בדרישות רשות המיסים בישראל. עוסק מורשה החייב בהקצאת מספרי חשבונית מ-API "חשבונית ישראל" אחראי לחיבור וההפעלה של ה-API לפי הוראות החוק.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">5. סיום השירות</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              אתה יכול לסגור את החשבון שלך בכל עת מתוך עמוד ההגדרות. אנחנו שומרים לעצמנו את הזכות לסיים שירות למשתמש שמפר את התנאים הללו.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">6. שינויים בתנאים</h2>
            <p className="text-sm text-stone-700 leading-relaxed">
              אנחנו עשויים לעדכן את התנאים מעת לעת. שינויים מהותיים יבואו לידיעתך באמצעות הודעה באפליקציה.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900 mb-2">7. יצירת קשר</h2>
            <p className="text-sm text-stone-700 leading-relaxed">שאלות? פנה אלינו ב-asafkotlar@gmail.com</p>
          </section>
        </div>
      </div>
    </div>
  );
}
