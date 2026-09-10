"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, CheckCircle2, FileText } from "lucide-react";
import { useBusiness, saveTaxOfficerNoticeSentAt } from "@/lib/business-store";
import { logAudit } from "@/lib/audit-log";
import { formatDate } from "@/lib/format";

/**
 * הוראות ניהול ספרים 18ב(ב): "נישום המבקש לשלוח מסמכים ממוחשבים, יודיע על
 * כך לפקיד השומה בדואר רשום, לפני משלוח המסמך הממוחשב הראשון".
 *
 * The app cannot post a letter. What it can do: explain the duty once, hand
 * the owner a ready letter, and record when they confirmed it was sent. The
 * dashboard banner (tax-officer-notice-banner.tsx) keeps nagging until then.
 */
export function TaxOfficerNoticeSection() {
  const { business, ready } = useBusiness();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready || !business.id) return null;
  const sentAt = business.taxOfficerNoticeSentAt;

  async function setSent(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const iso = next ? new Date().toISOString() : null;
      await saveTaxOfficerNoticeSentAt(business.id, iso);
      logAudit({
        action: "business.tax_officer_notice",
        targetType: "business",
        targetId: business.id,
        targetLabel: business.name,
        payload: { sent_at: iso },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-soft p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-2xl bg-stone-100 flex items-center justify-center shrink-0">
          <Mail className="w-4 h-4 text-stone-500" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-stone-900">הודעה לפקיד השומה על מסמכים ממוחשבים</h2>
          <p className="text-sm text-stone-700 mt-1 leading-relaxed">
            לפי הוראות ניהול ספרים (סעיף 18ב(ב)), עסק ששולח ללקוחותיו חשבוניות וקבלות
            כקבצים במקום בנייר חייב להודיע על כך לפקיד השומה בדואר רשום, פעם אחת, לפני
            המסמך הממוחשב הראשון. המכתב מוכן, צריך רק להדפיס, לחתום ולשלוח.
          </p>

          {sentAt ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                סימנת שההודעה נשלחה בדואר רשום ב-{formatDate(sentAt.slice(0, 10))}.
              </span>
              <button
                type="button"
                onClick={() => void setSent(false)}
                disabled={busy}
                className="mr-auto text-xs text-stone-500 underline hover:text-stone-700 disabled:opacity-50"
              >
                בטל סימון
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <Link
                href="/notices/tax-officer"
                className="inline-flex items-center justify-center gap-2 bg-white border border-stone-300 text-stone-800 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-stone-50"
              >
                <FileText className="w-4 h-4" />
                פתח את המכתב המוכן להדפסה
              </Link>
              <button
                type="button"
                onClick={() => void setSent(true)}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:shadow-md disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {busy ? "שומר..." : "שלחתי בדואר רשום"}
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
        </div>
      </div>
    </section>
  );
}
