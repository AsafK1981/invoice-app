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

type Vendor = "invoice4u" | "greeninvoice" | "other" | null;
type EntityType = "clients" | "products" | "documents" | "expenses";

interface ExportStep {
  title: string;
  steps: string[];
  /** Direct link into the competitor's export UI (when known) */
  link?: string;
}

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

const VENDOR_META = {
  invoice4u: { name: "Invoice4U", color: "from-rose-400 to-orange-500" },
  greeninvoice: { name: "חשבונית ירוקה", color: "from-emerald-400 to-teal-500" },
  other: { name: "Excel / אחר", color: "from-amber-400 to-orange-500" },
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(Object.keys(VENDOR_META) as Array<keyof typeof VENDOR_META>).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setVendor(v);
                  setOpenStep(0);
                }}
                className="card-soft p-6 text-right hover:shadow-lg hover:shadow-orange-200/50 transition-all group cursor-pointer"
              >
                <div
                  className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${VENDOR_META[v].color} flex items-center justify-center shadow-md mb-3`}
                >
                  <Upload className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-bold text-stone-900">{VENDOR_META[v].name}</h3>
                <p className="text-xs text-stone-600 mt-1">
                  {v === "invoice4u" || v === "greeninvoice"
                    ? "מדריך ספציפי, תוך 5 דקות"
                    : "ייבוא כללי מ-Excel/CSV"}
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

              {/* Import buttons */}
              <ImportStep
                num={guides.length + 1}
                title="ייבוא הלקוחות לכאן"
                desc="טען את קובץ הלקוחות שייצאת. המערכת תזהה אוטומטית את העמודות."
                icon={Users}
                onClick={() => setImportingEntity("clients")}
              />
              <ImportStep
                num={guides.length + 2}
                title="ייבוא המוצרים / שירותים"
                desc="העלה את קובץ המוצרים."
                icon={Package}
                onClick={() => setImportingEntity("products")}
              />
              <ImportStep
                num={guides.length + 3}
                title="ייבוא היסטוריית מסמכים"
                desc="המסמכים יישמרו במספרים המקוריים — חשוב לרצף לרשות המיסים."
                icon={FileText}
                onClick={() => setImportingEntity("documents")}
              />
              <ImportStep
                num={guides.length + 4}
                title="ייבוא הוצאות (אופציונלי)"
                desc="אם תרצה לשמור גם היסטוריית הוצאות."
                icon={Wallet}
                onClick={() => setImportingEntity("expenses")}
              />

              {/* Settings reminders */}
              <li className="rounded-2xl border border-emerald-100 bg-emerald-50/40 px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-white border border-emerald-200 flex items-center justify-center text-xs font-bold text-emerald-700">
                    {guides.length + 5}
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

function ImportStep({
  num,
  title,
  desc,
  icon: Icon,
  onClick,
}: {
  num: number;
  title: string;
  desc: string;
  icon: typeof Users;
  onClick: () => void;
}) {
  return (
    <li className="rounded-2xl border border-orange-100 bg-white px-4 py-3 hover:bg-orange-50/40">
      <div className="flex items-start gap-3">
        <span className="w-7 h-7 rounded-full bg-white border border-orange-200 flex items-center justify-center text-xs font-bold text-orange-700 flex-shrink-0 mt-0.5">
          {num}
        </span>
        <div className="flex-1">
          <p className="font-semibold text-stone-900 flex items-center gap-2">
            <Icon className="w-4 h-4 text-orange-500" />
            {title}
          </p>
          <p className="text-sm text-stone-700 mt-1">{desc}</p>
          <button
            onClick={onClick}
            className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200"
          >
            <Upload className="w-3.5 h-3.5" />
            העלה קובץ
          </button>
        </div>
      </div>
    </li>
  );
}
