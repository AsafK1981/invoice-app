"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Users,
  Package,
  FileText,
  Wallet,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  Upload,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { CsvImportModal } from "@/components/csv-import-modal";
import { Ltr, LtrText } from "@/components/ui/ltr";

const BulkImportZone = dynamic(
  () => import("@/components/bulk-import-zone").then((mod) => mod.BulkImportZone),
  {
    ssr: false,
    loading: () => (
      <div className="card-soft border-2 border-dashed border-orange-200 bg-gradient-to-br from-orange-50/60 to-amber-50/40 p-8 text-center animate-pulse">
        <div className="w-14 h-14 rounded-2xl bg-orange-200/60 mx-auto mb-3" />
        <div className="h-4 w-64 bg-orange-200/50 rounded mx-auto mb-2" />
        <div className="h-3 w-80 bg-orange-100 rounded mx-auto" />
      </div>
    ),
  },
);

type Vendor =
  | "invoice4u"
  | "icount"
  | "rivhit"
  | "morning"
  | "hashavshevet"
  | "ezcount"
  | "sumit"
  | "mybooks"
  | "ypay"
  | "ifreelance"
  | "caspit"
  | "priority"
  | "accountbook"
  | "other"
  | null;
type EntityType = "clients" | "products" | "documents" | "expenses";

interface ExportStep {
  title: string;
  steps: string[];
  /** Direct link into the competitor's export UI (when known) */
  link?: string;
}

// Generic export instructions shared across less-documented Israeli
// vendors. Each gets its own login link but the underlying steps are
// the same: find the Settings/Backup area, export each entity type
// as CSV or Excel.
const GENERIC_STEPS = (loginUrl: string, vendorName: string): ExportStep[] => [
  {
    title: "ייצוא לקוחות",
    steps: [
      `התחבר ל-${vendorName}`,
      'נווט אל "לקוחות" או "אנשי קשר"',
      'מצא תפריט "ייצוא" / "Export" / "גיבוי" (לרוב בכפתור 3 נקודות או באייקון ⬇️)',
      "בחר CSV או Excel ושמור את הקובץ",
    ],
    link: loginUrl,
  },
  {
    title: "ייצוא מוצרים / שירותים",
    steps: [
      'נווט אל "מוצרים" / "שירותים" / "קטלוג"',
      'ייצוא ל-CSV או Excel',
    ],
  },
  {
    title: "ייצוא היסטוריית מסמכים",
    steps: [
      'נווט אל "מסמכים" / "חשבוניות"',
      "הגדר טווח תאריכים: מומלץ השנה הנוכחית + 2 שנים אחורה",
      'אם יש "ייצוא במבנה אחיד" (קובץ ZIP לרשות המסים) - עדיף: כל המסמכים בקובץ אחד, וגוררים אותו כמו שהוא',
      "אחרת: ייצוא ל-CSV או Excel",
      "ודא שמספרים רצים נשמרים, חשוב לרצף לרשות המיסים",
    ],
  },
];

// Nearly every Israeli tool exports its full document history only as the Tax
// Authority's מבנה אחיד ZIP (BKMVDATA.TXT + INI.TXT). The bulk zone reads that
// ZIP directly (src/lib/uniform-structure/parse.ts), so the guides below point
// people at it instead of hunting for an Excel button that covers one report.
const ZIP_STEP = 'יורד קובץ ZIP. אל תפתח אותו - מעלים אותו כמו שהוא בריבוע הייבוא למטה (גרירה או "בחר קבצים מהמחשב"), המערכת קוראת אותו';

const EXPORT_GUIDES: Record<Exclude<Vendor, null>, ExportStep[]> = {
  invoice4u: [
    {
      title: "ייצוא לקוחות",
      steps: [
        'התחבר ל-Invoice4U',
        'בתפריט הצדדי לחץ "לקוחות"',
        'לחץ על אייקון ההורדה (⬇️) בראש הטבלה',
        'בחר "ייצוא ל-Excel" או "ייצוא ל-CSV"',
        'שמור את הקובץ למחשב',
      ],
      link: "https://www.invoice4u.co.il/login",
    },
    {
      title: "ייצוא מוצרים / שירותים",
      steps: [
        'בתפריט הצדדי לחץ "מוצרים ושירותים"',
        'אייקון ההורדה (⬇️) → ייצוא ל-Excel/CSV',
      ],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        'בתפריט הצדדי לחץ "מסמכים"',
        'הגדר טווח תאריכים (מומלץ: השנה הנוכחית + 2 שנים אחורה)',
        'אייקון ההורדה → ייצוא ל-Excel/CSV',
        'הקובץ יכלול מספרים רצים, חשוב לשמירה היסטורית',
      ],
    },
  ],
  icount: GENERIC_STEPS("https://app.icount.co.il", "iCount"),
  rivhit: GENERIC_STEPS("https://invoice.rivhit.co.il", "ריווחית"),
  morning: [
    {
      title: "ייצוא לקוחות",
      steps: [
        'התחבר ל-Morning (חשבונית ירוקה)',
        'הגדרות → "גיבוי נתונים" → "ייצוא לקוחות"',
        'הורד את קובץ ה-Excel',
      ],
      link: "https://app.morning.co.il/",
    },
    {
      title: "ייצוא מוצרים",
      steps: [
        'הגדרות → "גיבוי נתונים" → "ייצוא מוצרים"',
        'הורד את הקובץ',
      ],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        'מסמכים → הגדר טווח תאריכים',
        'בתפריט "אפשרויות נוספות" (3 נקודות) → "ייצוא"',
        'בחר את כל סוגי המסמכים → הורד',
      ],
    },
  ],
  hashavshevet: GENERIC_STEPS("https://www.hashavshevet.co.il", "חשבשבת"),
  ezcount: [
    {
      title: "ייצוא לקוחות",
      steps: [
        "התחבר ל-EZcount",
        'בתפריט לחץ "לקוחות"',
        'לחץ "פעולות נוספות" ובחר "ייצוא פרטי קשר"',
        "שמור את קובץ ה-Excel שירד",
      ],
      link: "https://www.ezcount.co.il/front/auth/login",
    },
    {
      title: "ייצוא מוצרים / שירותים",
      steps: [
        'בתפריט לחץ "פריטים"',
        "חפש כפתור ייצוא או הדפסה מעל הרשימה. אם אין, דלג: פריטים אפשר להוסיף גם אחר כך",
      ],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        'בתפריט לחץ "דוחות", ואז "דוחות לרשויות" ואז "מבנה קבצים אחיד לרשות המסים"',
        "הגדר טווח תאריכים (מומלץ: מתחילת הפעילות עד היום)",
        'לחץ "יצא נתונים" ובדוק את הסיכום שמוצג (כמה מסמכים מכל סוג)',
        ZIP_STEP,
      ],
    },
  ],
  sumit: [
    {
      title: "ייצוא לקוחות",
      steps: [
        "התחבר ל-SUMIT",
        'בתפריט לחץ "לקוחות"',
        "חפש כפתור ייצוא ל-Excel מעל הרשימה. אם אין, דלג: הלקוחות נוצרים לבד מהמסמכים בשלב הבא",
      ],
      link: "https://app.sumit.co.il",
    },
    {
      title: "ייצוא מוצרים / שירותים",
      steps: ['בתפריט לחץ "מוצרים" או "קטלוג"', "ייצוא ל-Excel, אם קיים. אחרת דלג"],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        'עבור אל "הנהלת חשבונות" ואז "יצוא במבנה אחיד" (או ישירות: app.sumit.co.il/accounting/openformat)',
        'לחץ "אפשרויות נוספות" ובחר "יצוא במבנה אחיד"',
        'בחר "טווח תאריכים" (מומלץ: מתחילת הפעילות) ולחץ "יצוא"',
        ZIP_STEP,
      ],
    },
  ],
  mybooks: [
    {
      title: "ייצוא לקוחות",
      steps: [
        "התחבר ל-MyBooks",
        "פתח את רשימת הלקוחות",
        "לחץ על סמל הייצוא מעל הטבלה, ואז על הכפתור שמופיע לאישור הייצוא ל-Excel",
        "שמור את הקובץ",
      ],
      link: "https://www.mybooks.co.il/login",
    },
    {
      title: "ייצוא מוצרים / שירותים",
      steps: ["פתח את מסך המוצרים / ניהול מלאי", "סמל הייצוא מעל הטבלה, ואז אישור הייצוא ל-Excel"],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        'לחץ "הגדרות" ואז "ייצוא קבצים במבנה אחיד"',
        "בחר טווח תאריכים (מומלץ: מתחילת הפעילות) ולחץ על סמל ההורדה",
        ZIP_STEP,
        "לחלופין: מסך המסמכים, סינון לפי תאריכים, סמל הייצוא ל-Excel",
      ],
    },
  ],
  ypay: [
    {
      title: "ייצוא לקוחות",
      steps: [
        "התחבר ל-YPAY",
        'בתפריט הצד לחץ "פעולות נוספות" ובחר "יצוא לקוחות/ספקים"',
        'לחץ "לחץ ליצוא" ושמור את קובץ ה-Excel',
      ],
      link: "https://ypay.co.il/front/login",
    },
    {
      title: "ייצוא מוצרים / שירותים",
      steps: ['פתח את "הגדרת פריטים"', "אם יש כפתור ייצוא, שמור את הקובץ. אחרת דלג: פריטים אפשר להוסיף אחר כך"],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        'בתפריט הצד לחץ "פעולות נוספות" ובחר "קבצים אחידים"',
        "הזן טווח תאריכים (מומלץ: מתחילת הפעילות)",
        'לחץ "להורדת הקבצים"',
        ZIP_STEP,
      ],
    },
  ],
  ifreelance: GENERIC_STEPS("https://www.ifreelance.co.il/?action=login", "iFreelance"),
  caspit: [
    {
      title: "ייצוא לקוחות",
      steps: [
        "התחבר לכספית",
        'בתפריט לחץ "תחזוקה" ואז "יצוא ויבוא"',
        'בחר "יצוא לקוחות וספקים" ושמור את קובץ ה-Excel',
      ],
      link: "https://app.caspit.biz/Home/Login",
    },
    {
      title: "ייצוא מוצרים / שירותים",
      steps: [
        'באותו מסך "יצוא ויבוא" בחר את ייצוא הפריטים',
        "פתח את הקובץ ב-Excel ושמור אותו מחדש כ-xlsx",
      ],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        "פתח את רשימת המסמכים וסנן לפי טווח תאריכים (מומלץ: מתחילת הפעילות)",
        'לחץ "הדפס רשימה", ובתצוגה המקדימה בחר ייצוא ל-Excel. כך יוצאת כל הרשימה',
        "(צלמית ה-Excel מעל הרשימה מייצאת רק את העמוד הנוכחי, עד 200 שורות)",
      ],
    },
  ],
  priority: [
    {
      title: "ייצוא לקוחות",
      steps: [
        "היכנס ל-Priority Zoom עם הקישור האישי שקיבלת במייל (אין כתובת כניסה אחת לכולם)",
        'פתח "שיווק ומכירות", ואז "לקוחות", ואז "לקוחות"',
        "לחץ על אייקון ה-Excel בפינה השמאלית העליונה של המסך",
        'אם האייקון אפור: מנהל המערכת צריך לסמן למשתמש "פריקת נתונים ממסך" בהרשאות, ולהתחבר מחדש',
      ],
    },
    {
      title: "ייצוא מוצרים / שירותים",
      steps: ['פתח "ניהול מלאי", ואז "פריטים"', "הצג את כל הפריטים ולחץ על אייקון ה-Excel"],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        'פתח את דוחות המסמכים (למשל "כספים" ואז "דוחות מסמכים")',
        'הגדר "מ-תאריך" ו"עד-תאריך" והרץ את הדוח',
        "לחץ על אייקון ה-Excel לייצוא כל השורות",
        'לחלופין: הדוח "העברת קובץ להנהלת חשבונות" מייצא את כל התנועות לפי טווח תאריכים',
      ],
    },
  ],
  accountbook: [
    {
      title: "ייצוא לקוחות",
      steps: [
        "התחבר ל-AccountBook (cloud.tamal.co.il)",
        'פתח את מסך "לקוחות", ובו "דוחות" ואז דוח לקוחות',
        'לחץ "הדפסה ויצוא הדו"ח לאקסל"',
      ],
      link: "https://cloud.tamal.co.il/login.aspx",
    },
    {
      title: "ייצוא מוצרים / שירותים",
      steps: ['פתח "ניהול פריטים" ואז את הטאב "דוחות"', 'לחץ "הדפסה ויצוא הדו"ח לאקסל ו-PDF"'],
    },
    {
      title: "ייצוא היסטוריית מסמכים",
      steps: [
        'פתח "דוחות" ובחר "דוח הכנסות" (כל המסמכים שמתעדים הכנסה)',
        "הגדר תקופה (מומלץ: מתחילת הפעילות), ואפשר גם לקוח וסוג מסמך",
        'לחץ "הדפסה ויצוא הדו"ח לאקסל"',
      ],
    },
  ],
  other: [
    {
      title: "פתח את הקובץ במקור שלך",
      steps: [
        "פתח Excel / Google Sheets / כל כלי דומה",
        "ודא שבכל גיליון יש שורת כותרת (שם עמודה) בשורה הראשונה",
        "שמור כל גיליון כקובץ CSV נפרד: לקוחות.csv, מוצרים.csv, מסמכים.csv",
      ],
    },
  ],
};

const VENDOR_META: Record<Exclude<Vendor, null>, { name: string; color: string; tagline: string }> = {
  // Card order in the picker: the tools people switch from most often first.
  // The list is mirrored word-for-word in the marketing FAQ (src/app/(marketing)/page.tsx).
  invoice4u: { name: "Invoice4U", color: "from-rose-400 to-orange-500", tagline: "מדריך ספציפי, 5 דקות" },
  morning: { name: "Morning (חשבונית ירוקה)", color: "from-emerald-400 to-teal-500", tagline: "מדריך ספציפי, 5 דקות" },
  icount: { name: "iCount", color: "from-blue-400 to-indigo-500", tagline: "מדריך כללי, 5-10 דקות" },
  ezcount: { name: "EZcount", color: "from-orange-400 to-red-500", tagline: "מדריך ספציפי, 5 דקות" },
  sumit: { name: "SUMIT", color: "from-sky-400 to-blue-600", tagline: "מדריך ספציפי, 5 דקות" },
  rivhit: { name: "ריווחית", color: "from-violet-400 to-purple-500", tagline: "מדריך כללי, 5-10 דקות" },
  hashavshevet: { name: "חשבשבת", color: "from-stone-500 to-stone-700", tagline: "מדריך כללי, 5-10 דקות" },
  mybooks: { name: "MyBooks", color: "from-teal-400 to-cyan-600", tagline: "מדריך ספציפי, 5 דקות" },
  ypay: { name: "YPAY", color: "from-lime-500 to-green-600", tagline: "מדריך ספציפי, 5 דקות" },
  ifreelance: { name: "iFreelance", color: "from-fuchsia-400 to-pink-600", tagline: "מדריך כללי, 5-10 דקות" },
  caspit: { name: "כספית", color: "from-yellow-400 to-amber-600", tagline: "מדריך ספציפי, 5 דקות" },
  priority: { name: "Priority Zoom", color: "from-indigo-500 to-blue-800", tagline: "מדריך כללי, 10 דקות" },
  accountbook: { name: 'AccountBook (תמ"ל)', color: "from-slate-400 to-slate-600", tagline: "מדריך כללי, 5-10 דקות" },
  other: { name: "Excel / אחר", color: "from-amber-400 to-orange-500", tagline: "ייבוא כללי מ-CSV / Excel" },
};

export default function MigratePage() {
  const [vendor, setVendor] = useState<Vendor>(null);
  const [openStep, setOpenStep] = useState<number | null>(0);
  // Deep link: /migrate?vendor=ezcount lands straight on that vendor's guide,
  // so a /vs/<vendor> page (or a support reply) can skip the picker. Read
  // from window on mount rather than useSearchParams, which would force a
  // Suspense boundary around this statically rendered page for one param.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("vendor");
    if (wanted && wanted in VENDOR_META) setVendor(wanted as Vendor);
  }, []);
  const [importingEntity, setImportingEntity] = useState<EntityType | null>(null);

  const guides = vendor ? EXPORT_GUIDES[vendor] : [];

  function whatsappConciergeLink(): string {
    const PHONE = "972549000684";
    const text = `היי אסף, רציתי לעבור מ-${vendor ? VENDOR_META[vendor].name : "תוכנה אחרת"} ל-MyFriendlyInvoiceApp. אני שולח את הקבצים שיצאתי, ואשמח אם תעזור לי לייבא אותם.`;
    return `https://wa.me/${PHONE}?text=${encodeURIComponent(text)}`;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </span>
          מעבר מתוכנה אחרת
        </h1>
        <p className="text-sm text-stone-700 mt-2 mr-14 leading-relaxed">
          כל הלקוחות, המוצרים, ההוצאות והמסמכים שלך עוברים לכאן בכמה דקות. שום דבר לא
          מוקלד מחדש, ומספרי המסמכים ממשיכים מהמקום שעצרת.
        </p>
      </div>

      {/* How it works, in three sentences. Shown before the vendor picker so a
          first-time user understands the whole journey before choosing a tool;
          the numbered per-vendor guide below repeats the same three beats in
          detail. Hidden once a vendor is picked so the guide is the only list
          on screen. */}
      {!vendor && (
        <ol className="grid sm:grid-cols-3 gap-3">
          {[
            {
              icon: ExternalLink,
              title: "מייצאים מהכלי הישן",
              body: "בכל תוכנה יש כפתור ייצוא ל-Excel או CSV. נראה לך בדיוק איפה הוא.",
            },
            {
              icon: Upload,
              title: "מעלים את הקבצים בריבוע שלמטה",
              body: 'גוררים אותם פנימה, או לוחצים "בחר קבצים מהמחשב". המערכת מזהה לבד מה זה לקוחות, מה מוצרים ומה מסמכים.',
            },
            {
              icon: CheckCircle2,
              title: "ממשיכים לעבוד",
              body: "ההיסטוריה שלך כאן, המספור ממשיך ברצף, והמסמך הבא כבר יוצא מכאן.",
            },
          ].map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="card-soft p-4 flex items-start gap-3">
                <span className="w-9 h-9 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-400 text-white flex items-center justify-center shadow-sm flex-shrink-0 text-sm font-bold">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                    <Icon className="w-4 h-4 text-orange-500" aria-hidden="true" />
                    {step.title}
                  </p>
                  <p className="text-xs text-stone-700 mt-1 leading-relaxed">
                    <LtrText text={step.body} />
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* The upload square lives on the FIRST screen, right under step 2, so
          "מעלים את הקבצים בריבוע שלמטה" points at something real. Before
          2026-08-25 it only appeared after picking a vendor, and the step
          said "drag here" with nothing to drag into. The per-vendor guide
          below still embeds its own copy as its step 4. */}
      {!vendor && (
        <section className="card-soft p-5 sm:p-6 border-2 border-orange-200 bg-white">
          <div className="flex items-start gap-3 mb-4">
            <span className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-sm flex-shrink-0">
              <Upload className="w-5 h-5 text-white" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-stone-900">כבר ייצאת את הקבצים? העלה אותם כאן</h2>
              <p className="text-sm text-stone-700 mt-0.5">
                עוד לא? בחר למטה מאיזו תוכנה אתה מגיע, ונראה לך בדיוק איפה כפתור הייצוא.
              </p>
            </div>
          </div>
          <BulkImportZone />
        </section>
      )}

      {/* Vendor picker */}
      {!vendor && (
        <>
          <h2 className="text-lg font-semibold text-stone-900">מאיזו תוכנה אתה מגיע? נראה לך איך מייצאים</h2>
          <p className="text-sm text-stone-600 -mt-3">
            לא רואה את הכלי שלך כאן? לחץ{" "}
            <strong>
              "<Ltr>Excel</Ltr> / אחר"
            </strong>{" "}
            או דלג לקטע ה-<Ltr>WhatsApp</Ltr> למטה.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {(Object.keys(VENDOR_META) as Array<keyof typeof VENDOR_META>).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setVendor(v);
                  setOpenStep(0);
                }}
                className="card-soft p-4 text-right hover:shadow-lg hover:shadow-orange-200/50 transition-all group cursor-pointer"
              >
                <div
                  className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${VENDOR_META[v].color} flex items-center justify-center shadow-md mb-2`}
                >
                  <Upload className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-stone-900 text-sm">
                  <LtrText text={VENDOR_META[v].name} />
                </h3>
                <p className="text-xs text-stone-600 mt-1 leading-snug">
                  <LtrText text={VENDOR_META[v].tagline} />
                </p>
              </button>
            ))}
          </div>

          <div className="card-soft p-5 bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md flex-shrink-0">
                <MessageCircle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-stone-900">לא בא לך להתעסק? אני עושה לך את זה.</h3>
                <p className="text-sm text-stone-700 mt-1 leading-relaxed">
                  שלח לי ב-<Ltr>WhatsApp</Ltr> את קבצי הייצוא מהכלי הישן ואני אייבא לך את הכל ידנית
                  בחינם, כי אתה מתוך ה-20 הראשונים שמשתמשים באפליקציה.
                </p>
                <a
                  href={whatsappConciergeLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <MessageCircle className="w-4 h-4" />
                  שלח לי ב-<Ltr>WhatsApp</Ltr>
                </a>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Step-by-step guide */}
      {vendor && (
        <>
          <button
            onClick={() => setVendor(null)}
            className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-orange-700"
          >
            <ArrowLeft className="w-4 h-4 rotate-180" />
            חזרה לבחירת כלי
          </button>

          <div className="card-soft p-5">
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${VENDOR_META[vendor].color} flex items-center justify-center shadow-md`}
              >
                <Upload className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-stone-900">
                  מעבר מ-
                  <LtrText text={VENDOR_META[vendor].name} />
                </h2>
                <p className="text-xs text-stone-600">בצע את השלבים בסדר</p>
              </div>
            </div>

            <ol className="space-y-2">
              {/* Step: export from old tool */}
              {guides.map((g, idx) => (
                <li
                  key={idx}
                  className="rounded-2xl border border-orange-100 bg-orange-50/30 overflow-hidden"
                >
                  <button
                    onClick={() => setOpenStep(openStep === idx ? null : idx)}
                    className="w-full flex items-center justify-between px-4 py-3 text-right hover:bg-orange-50/60"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-white border border-orange-200 flex items-center justify-center text-xs font-bold text-orange-700">
                        {idx + 1}
                      </span>
                      <span className="font-semibold text-stone-900">{g.title}</span>
                    </div>
                    {openStep === idx ? (
                      <ChevronUp className="w-4 h-4 text-stone-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-stone-500" />
                    )}
                  </button>
                  {openStep === idx && (
                    <div className="px-4 py-3 border-t border-orange-100 bg-white">
                      <ol className="space-y-2 text-sm text-stone-800 list-decimal pr-5">
                        {g.steps.map((s, i) => (
                          <li key={i}>
                            <LtrText text={s} />
                          </li>
                        ))}
                      </ol>
                      {g.link && (
                        <a
                          href={g.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700"
                        >
                          <ExternalLink className="w-3 h-3" />
                          פתח את <LtrText text={VENDOR_META[vendor].name} />
                        </a>
                      )}
                    </div>
                  )}
                </li>
              ))}

              {/* One-click bulk import: preferred path */}
              <li className="rounded-2xl border-2 border-orange-200 bg-gradient-to-br from-orange-50/80 to-amber-50/60 px-4 py-4">
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm">
                    {guides.length + 1}
                  </span>
                  <div className="flex-1">
                    <p className="font-bold text-stone-900 flex items-center gap-2">
                      <Upload className="w-4 h-4 text-orange-500" />
                      ייבוא הכל בלחיצה אחת
                    </p>
                    <p className="text-sm text-stone-700 mt-0.5">
                      גרור את כל הקבצים שייצאת (לקוחות / מוצרים / הוצאות / מסמכים), קובץ{" "}
                      <Ltr>Excel</Ltr> אחד עם כל הגיליונות, או את ה-<Ltr>ZIP</Ltr> של "מבנה אחיד" כמו
                      שהוא. המערכת מזהה אוטומטית מה כל קובץ ומייבאת הכל יחד.
                    </p>
                  </div>
                </div>
                <BulkImportZone />
              </li>

              {/* Fallback: per-entity manual imports (collapsed by default) */}
              <li className="rounded-2xl border border-stone-200 bg-white">
                <details className="group">
                  <summary className="cursor-pointer px-4 py-3 text-sm text-stone-700 hover:bg-stone-50 rounded-2xl flex items-center justify-between">
                    <span>
                      <ChevronDown className="w-4 h-4 inline group-open:hidden" />
                      <ChevronUp className="w-4 h-4 inline hidden group-open:inline" /> או ייבוא
                      נפרד לכל סוג נתונים
                    </span>
                  </summary>
                  <div className="border-t border-stone-100 p-3 space-y-2">
                    <button
                      onClick={() => setImportingEntity("clients")}
                      className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-stone-50 hover:bg-stone-100 text-stone-800"
                    >
                      <Users className="w-4 h-4 text-orange-500" /> ייבוא לקוחות
                    </button>
                    <button
                      onClick={() => setImportingEntity("products")}
                      className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-stone-50 hover:bg-stone-100 text-stone-800"
                    >
                      <Package className="w-4 h-4 text-orange-500" /> ייבוא מוצרים
                    </button>
                    <button
                      onClick={() => setImportingEntity("documents")}
                      className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-stone-50 hover:bg-stone-100 text-stone-800"
                    >
                      <FileText className="w-4 h-4 text-orange-500" /> ייבוא מסמכים
                    </button>
                    <button
                      onClick={() => setImportingEntity("expenses")}
                      className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-stone-50 hover:bg-stone-100 text-stone-800"
                    >
                      <Wallet className="w-4 h-4 text-orange-500" /> ייבוא הוצאות
                    </button>
                  </div>
                </details>
              </li>

              {/* Settings reminders */}
              <li className="rounded-2xl border border-emerald-100 bg-emerald-50/40 px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-white border border-emerald-200 flex items-center justify-center text-xs font-bold text-emerald-700">
                    {guides.length + 2}
                  </span>
                  <div className="flex-1 text-sm">
                    <p className="font-semibold text-stone-900 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-emerald-600" />
                      פרטי עסק + לוגו
                    </p>
                    <p className="text-stone-700 mt-1 leading-relaxed">
                      לך ל-
                      <Link href="/settings" className="text-orange-600 underline">
                        הגדרות
                      </Link>{" "}
                      → "פרטי עסק": עדכן שם, ח.פ./ת.ז., כתובת, פרטי בנק. העלה את הלוגו שלך כדי שיופיע על
                      כל מסמך.
                    </p>
                  </div>
                </div>
              </li>

              <li className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-sm">
                    <p className="font-bold text-stone-900">סיימת! אתה מוכן לעבודה ✨</p>
                    <p className="text-stone-700 mt-1 leading-relaxed">
                      ההיסטוריה שלך נשמרה, המספרים הרצים ממשיכים מהמקום שעצרת.
                    </p>
                    <Link
                      href="/dashboard"
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200"
                    >
                      <Sparkles className="w-4 h-4" />
                      קח אותי למסך הראשי
                    </Link>
                  </div>
                </div>
              </li>
            </ol>
          </div>

          <div className="card-soft p-4 bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-100">
            <div className="flex items-center gap-3">
              <MessageCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div className="flex-1 text-sm">
                <span className="font-semibold text-stone-900">תקוע באיזה שלב?</span>{" "}
                <span className="text-stone-700">
                  שלח לי ב-<Ltr>WhatsApp</Ltr> את הקבצים, ואני אטפל ידנית. חינם בתקופת הבטא.
                </span>
              </div>
              <a
                href={whatsappConciergeLink()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 flex-shrink-0"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                שלח
              </a>
            </div>
          </div>
        </>
      )}

      {/* Existing CSV import modal: reused per entity */}
      {importingEntity && (
        <CsvImportModal
          open={true}
          onClose={() => setImportingEntity(null)}
          entityType={importingEntity}
        />
      )}
    </div>
  );
}

