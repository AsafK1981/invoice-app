"use client";

import Link from "next/link";
import { ArrowRight, Printer } from "lucide-react";
import { useBusiness } from "@/lib/business-store";
import { formatDate } from "@/lib/format";
import { todayInIsrael } from "@/lib/date";

/**
 * The registered-mail letter required by הוראות ניהול ספרים 18ב(ב), pre-filled
 * from the business record. Print it, sign it, send it by registered mail to
 * the assessing office that holds the business's file, keep the postal
 * receipt, then tick "שלחתי בדואר רשום" in settings.
 */
export default function TaxOfficerNoticePage() {
  const { business, ready } = useBusiness();
  if (!ready) return <div className="text-center py-16 text-stone-500">טוען...</div>;

  const today = todayInIsrael();
  const typeLabel =
    business.businessType === "company"
      ? "חברה"
      : business.businessType === "authorized"
        ? "עוסק מורשה"
        : "עוסק פטור";

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <Link
          href="/settings#tax-officer-notice"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה להגדרות
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:shadow-md"
        >
          <Printer className="w-4 h-4" />
          הדפס
        </button>
      </div>

      <div className="no-print card-soft p-4 text-sm text-stone-700 max-w-[210mm] mx-auto">
        <p className="font-semibold text-stone-900 mb-1">מה עושים עם המכתב</p>
        <ol className="list-decimal pr-5 space-y-1">
          <li>מדפיסים וחותמים בעט.</li>
          <li>ממלאים את שם משרד השומה שבו מתנהל תיק העסק (מופיע במכתבים מרשות המסים).</li>
          <li>שולחים בדואר רשום ושומרים את אישור המשלוח יחד עם הספרים.</li>
          <li>חוזרים להגדרות ומסמנים "שלחתי בדואר רשום".</li>
        </ol>
      </div>

      <div
        dir="rtl"
        className="bg-white max-w-[210mm] mx-auto p-[20mm] shadow-sm border border-stone-200 print:shadow-none print:border-0 text-stone-900 leading-relaxed"
        style={{ minHeight: "297mm" }}
      >
        <p className="text-sm">{formatDate(today)}</p>

        <p className="mt-8">לכבוד</p>
        <p>פקיד השומה</p>
        <p>משרד שומה: ____________________</p>

        <p className="mt-8 font-bold underline">
          הנדון: הודעה על משלוח מסמכים ממוחשבים לפי סעיף 18ב(ב) להוראות מס הכנסה (ניהול פנקסי חשבונות), התשל"ג-1973
        </p>

        <p className="mt-6">
          אני הח"מ, {business.name || "____________________"}, {typeLabel}, מספר{" "}
          {business.businessType === "company" ? "ח.פ." : "עוסק / ת.ז."}{" "}
          <span dir="ltr">{business.taxId || "____________"}</span>, מכתובת{" "}
          {business.address || "____________________"}, מודיע/ה בזאת כי בכוונתי לשלוח
          ללקוחותיי מסמכים ממוחשבים (חשבוניות, קבלות, חשבוניות מס/קבלה, הצעות מחיר
          והודעות זיכוי), החתומים בחתימה אלקטרונית מאובטחת ומסומנים במילים "מסמך
          ממוחשב", בהתאם לסעיף 18ב להוראות.
        </p>

        <p className="mt-4">
          המסמכים מופקים באמצעות תוכנת "חשבונית ידידותית" (friendlyinvoice.co.il),
          נשלחים רק ללקוחות שהביעו את הסכמתם לקבל מסמכים ממוחשבים, ונשמרים באמצעים
          ממוחשבים למשך התקופה הקבועה בהוראות.
        </p>

        <p className="mt-4">הודעה זו נשלחת לפני משלוח המסמך הממוחשב הראשון.</p>

        <p className="mt-10">בכבוד רב,</p>
        <p className="mt-8">שם: {business.name || "____________________"}</p>
        <p className="mt-4">חתימה: ____________________</p>
        <p className="mt-4">טלפון: {business.phone || "____________"}
          {business.email ? <>{" "}| דוא"ל: <span dir="ltr">{business.email}</span></> : null}
        </p>
      </div>
    </div>
  );
}
