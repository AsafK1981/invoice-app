"use client";

import { useState } from "react";
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
import { CsvImportModal } from "@/components/csv-import-modal";
import { BulkImportZone } from "@/components/bulk-import-zone";

type Vendor =
  | "invoice4u"
  | "greeninvoice"
  | "icount"
  | "rivhit"
  | "morning"
  | "hashavshevet"
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
// the same — find the Settings/Backup area, export each entity type
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
      "הגדר טווח תאריכים — מומלץ השנה הנוכחית + 2 שנים אחורה",
      "ייצוא ל-CSV או Excel",
      "ודא שמספרים רצים נשמרים — חשוב לרצף לרשות המיסים",
    ],
  },
];

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
        'הקובץ יכלול מספרים רצים — חשוב לשמירה היסטורית',
      ],
    },
  ],
  greeninvoice: [
    {
      title: "ייצוא לקוחות",
      steps: [
        'התחבר ל-Greeninvoice',
        'הגדרות → "גיבוי נתונים" → "ייצוא לקוחות"',
        'הורד את קובץ ה-Excel',
      ],
      link: "https://app.greeninvoice.co.il/",
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
  icount: GENERIC_STEPS("https://app.icount.co.il", "iCount"),
  rivhit: GENERIC_STEPS("https://invoice.rivhit.co.il", "ריווחית"),
  morning: GENERIC_STEPS("https://app.morning.co.il", "Morning"),
  hashavshevet: GENERIC_STEPS("https://www.hashavshevet.co.il", "חשבשבת"),
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
  invoice4u: {
    name: "Invoice4U",
    color: "from-rose-400 to-orange-500",
    tagline: "מדריך ספציפי, 5 דקות",
  },
  greeninvoice: {
    name: "חשבונית ירוקה",
    color: "from-emerald-400 to-teal-500",
    tagline: "מדריך ספציפי, 5 דקות",
  },
  icount: {
    name: "iCount",
    color: "from-blue-400 to-indigo-500",
    tagline: "מדריך כללי, 5–10 דקות",
  },
  rivhit: {
    name: "ריווחית",
    color: "from-violet-400 to-purple-500",
    tagline: "מדריך כללי, 5–10 דקות",
  },
  morning: {
    name: "Morning",
    color: "from-amber-400 to-yellow-500",
    tagline: "מדריך כללי, 5–10 דקות",
  },
  hashavshevet: {
    name: "חשבשבת",
    color: "from-stone-500 to-stone-700",
    tagline: "מדריך כללי, 5–10 דקות",
  },
  other: {
    name: "Excel / אחר",
    color: "from-amber-400 to-orange-500",
    tagline: "ייבוא כללי מ-CSV / Excel",
  },
};

export default function MigratePage() {
  const [vendor, setVendor] = useState<Vendor>(null);
  const [openStep, setOpenStep] = useState<number | null>(0);
  const [importingEntity, setImportingEntity] = useState<EntityType | null>(null);

  const guides = vendor ? EXPORT_GUIDES[vendor] : [];

  function whatsappConciergeLink(): string {
    const PHONE = "972549000684";
    const text = `היי אסף, רציתי לעבור מ-${vendor ? VENDOR_META[vendor].name : "תוכנה אחרת"} ל-MySuperFriendlyInvoiceApp. אני שולח את הקבצים שיצאתי, ואשמח אם תעזור לי לייבא אותם.`;
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
          מעבירים אותך ביד מ-Invoice4U / חשבונית ירוקה / Excel. כל הלקוחות והמוצרים והמסמכים שלך — בכמה דקות.
        </p>
      </div>

      {/* Vendor picker */}
      {!vendor && (
        <>
          <h2 className="text-lg font-semibold text-stone-900">מאיזה כלי אתה מגיע?</h2>
          <p className="text-sm text-stone-600 -mt-3">
            לא רואה את הכלי שלך כאן? לחץ <strong>"Excel / אחר"</strong> — או דלג לקטע ה-WhatsApp למטה.
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
                <h3 className="font-bold text-stone-900 text-sm">{VENDOR_META[v].name}</h3>
                <p className="text-xs text-stone-600 mt-1 leading-snug">
                  {VENDOR_META[v].tagline}
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
                  שלח לי ב-WhatsApp את קבצי הייצוא מהכלי הישן ואני אייבא לך את הכל ידנית — בחינם, כי אתה
                  מתוך ה-20 הראשונים שמשתמשים באפליקציה.
                </p>
                <a
                  href={whatsappConciergeLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <MessageCircle className="w-4 h-4" />
                  שלח לי ב-WhatsApp
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
                <h2 className="font-bold text-stone-900">מעבר מ-{VENDOR_META[vendor].name}</h2>
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
                          <li key={i}>{s}</li>
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
                          פתח את {VENDOR_META[vendor].name}
                        </a>
                      )}
                    </div>
                  )}
                </li>
              ))}

              {/* One-click bulk import — preferred path */}
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
                      גרור את כל הקבצים שייצאת (לקוחות / מוצרים / הוצאות / מסמכים) — או קובץ Excel
                      אחד עם כל הגיליונות — המערכת תזהה אוטומטית מה כל קובץ ותייבא הכל יחד.
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
                      <ChevronUp className="w-4 h-4 inline hidden group-open:inline" /> או — ייבוא
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
                      → "פרטי עסק" — עדכן שם, ח.פ./ת.ז., כתובת, פרטי בנק. העלה את הלוגו שלך כדי שיופיע על
                      כל מסמך.
                    </p>
                  </div>
                </div>
              </li>

              <li className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-sm">
                    <p className="font-bold text-stone-900">סיימת — אתה מוכן לעבודה ✨</p>
                    <p className="text-stone-700 mt-1 leading-relaxed">
                      ההיסטוריה שלך נשמרה, המספרים הרצים ממשיכים מהמקום שעצרת.
                    </p>
                    <Link
                      href="/dashboard"
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200"
                    >
                      <Sparkles className="w-4 h-4" />
                      קח אותי לדשבורד
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
                  שלח לי ב-WhatsApp את הקבצים, ואני אטפל ידנית. חינם בתקופת הבטא.
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

      {/* Existing CSV import modal — reused per entity */}
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

