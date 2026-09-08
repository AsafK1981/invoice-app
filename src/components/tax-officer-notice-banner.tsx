"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { useBusiness } from "@/lib/business-store";
import { useDocuments } from "@/lib/document-store";

/**
 * Dashboard reminder for הוראות ניהול ספרים 18ב(ב): the registered-mail notice
 * to פקיד השומה is due before the first computerized document. Shown while the
 * business has issued at least one document and has not confirmed the notice.
 * Not dismissible on purpose: it is a legal precondition, not a tip.
 */
export function TaxOfficerNoticeBanner() {
  const { business, ready } = useBusiness();
  const { documents, ready: docsReady } = useDocuments();
  if (!ready || !docsReady) return null;
  if (business.taxOfficerNoticeSentAt) return null;
  const issued = documents.some((d) => d.status !== "draft");
  if (!issued) return null;

  return (
    <div className="no-print card-soft p-4 bg-amber-50 border-orange-200 flex items-start gap-3">
      <div className="w-9 h-9 rounded-2xl bg-white flex items-center justify-center shrink-0">
        <Mail className="w-4 h-4 text-orange-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-stone-900">
          הודעה לפקיד השומה עוד לא סומנה כנשלחה
        </p>
        <p className="text-xs text-stone-700 mt-0.5">
          כדי שהמסמכים שאתה שולח כקבצים ייחשבו מסמכים ממוחשבים לפי הוראות ניהול ספרים,
          צריך להודיע לפקיד השומה בדואר רשום פעם אחת. המכתב מוכן.
        </p>
      </div>
      <Link
        href="/settings#tax-officer-notice"
        className="shrink-0 inline-flex items-center gap-2 bg-white border border-orange-200 text-stone-800 px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-orange-100"
      >
        לטיפול
      </Link>
    </div>
  );
}
