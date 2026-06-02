"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LogOut,
  FileText,
  ExternalLink,
  CheckCircle2,
  Clock,
  Briefcase,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";

interface PortalDoc {
  id: string;
  type: string;
  number: number;
  date: string;
  status: string;
  total: number;
  business_id: string;
  paid_at?: string | null;
}

interface PortalBusiness {
  id: string;
  name: string;
  business_type: string;
  tax_id: string;
  email?: string | null;
  phone?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  receipt: "קבלה",
  quote: "חשבון עסקה",
  tax_invoice: "חשבונית מס",
  tax_invoice_receipt: "חשבונית מס/קבלה",
  credit_note: "חשבונית זיכוי",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  sent: { label: "ממתין", color: "bg-amber-50 text-amber-800 border-amber-200" },
  paid: { label: "שולם", color: "bg-emerald-50 text-emerald-800 border-emerald-200" },
};

export default function PortalDocumentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [docs, setDocs] = useState<PortalDoc[]>([]);
  const [businesses, setBusinesses] = useState<PortalBusiness[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/portal/documents", { cache: "no-store" });
        if (res.status === 401) {
          window.location.href = "/portal?error=expired";
          return;
        }
        const data = await res.json();
        if (!data.ok) {
          setError(data.error || "שגיאה בטעינת המסמכים");
          return;
        }
        setEmail(data.email || "");
        setDocs(data.documents || []);
        setBusinesses(data.businesses || []);
      } catch {
        setError("שגיאת רשת");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    window.location.href = "/portal";
  }

  const docsByBusiness = new Map<string, PortalDoc[]>();
  for (const d of docs) {
    const list = docsByBusiness.get(d.business_id) || [];
    list.push(d);
    docsByBusiness.set(d.business_id, list);
  }

  const totalPaid = docs
    .filter((d) => d.status === "paid")
    .reduce((s, d) => s + (d.type === "credit_note" ? -d.total : d.total), 0);
  const totalOpen = docs
    .filter((d) => d.status === "sent" && (d.type === "quote" || d.type === "tax_invoice"))
    .reduce((s, d) => s + d.total, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50">
        <p className="text-stone-600 font-medium">טוען...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="bg-white rounded-2xl shadow-sm border border-orange-100 p-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-stone-900">החשבוניות שלי</h1>
            <p className="text-sm text-stone-600">{email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-2 text-sm text-stone-700 hover:text-stone-900 border border-stone-200 px-3 py-1.5 rounded-xl hover:bg-stone-50"
          >
            <LogOut className="w-4 h-4" />
            התנתקות
          </button>
        </header>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-800">
            {error}
          </div>
        )}

        {docs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-10 text-center">
            <FileText className="w-12 h-12 mx-auto text-stone-400 mb-3" />
            <p className="text-stone-700 font-medium">אין עדיין מסמכים זמינים</p>
            <p className="text-sm text-stone-500 mt-1">
              כשעסק ישלח לכם חשבונית — היא תופיע כאן.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-4">
                <div className="flex items-center gap-2 text-xs text-stone-600 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  שולמו
                </div>
                <p className="text-lg font-bold text-stone-900" dir="ltr">
                  {formatCurrency(totalPaid)}
                </p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-4">
                <div className="flex items-center gap-2 text-xs text-stone-600 mb-1">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  ממתין לתשלום
                </div>
                <p className="text-lg font-bold text-stone-900" dir="ltr">
                  {formatCurrency(totalOpen)}
                </p>
              </div>
            </div>

            {businesses.map((biz) => {
              const list = docsByBusiness.get(biz.id) || [];
              if (list.length === 0) return null;
              return (
                <section key={biz.id} className="bg-white rounded-2xl shadow-sm border border-orange-100 overflow-hidden">
                  <header className="px-5 py-4 border-b border-orange-100 bg-gradient-to-l from-orange-50/70 to-amber-50/70">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-orange-600" />
                      <h2 className="font-bold text-stone-900">{biz.name}</h2>
                    </div>
                    <p className="text-xs text-stone-600 mt-0.5">{list.length} מסמכים</p>
                  </header>
                  <ul className="divide-y divide-stone-100">
                    {list.map((d) => {
                      const status = STATUS_LABELS[d.status] || {
                        label: d.status,
                        color: "bg-stone-50 text-stone-700 border-stone-200",
                      };
                      return (
                        <li key={d.id}>
                          <Link
                            href={`/view/${d.id}`}
                            className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-orange-50/40 transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-stone-900 text-sm">
                                  {TYPE_LABELS[d.type] || d.type} #{d.number}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-lg border ${status.color}`}>
                                  {status.label}
                                </span>
                              </div>
                              <p className="text-xs text-stone-500 mt-0.5">
                                {formatDate(d.date)}
                                {d.paid_at && d.status === "paid" && (
                                  <> · שולם ב-{formatDate(d.paid_at.slice(0, 10))}</>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-stone-900 text-sm" dir="ltr">
                                {formatCurrency(d.total)}
                              </span>
                              <ExternalLink className="w-3.5 h-3.5 text-stone-400" />
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
