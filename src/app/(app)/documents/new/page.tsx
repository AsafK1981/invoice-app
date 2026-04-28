"use client";

import Link from "next/link";
import { ArrowRight, ReceiptText, FileText, FileCheck, FileMinus, FileSpreadsheet, Lock } from "lucide-react";
import { useBusiness } from "@/lib/business-store";
import { canIssueTaxInvoices } from "@/lib/vat";

export default function NewDocumentPage() {
  const { business } = useBusiness();
  const canTaxInvoice = canIssueTaxInvoices(business);

  const cards = [
    {
      title: "קבלה",
      desc: "מסמך רשמי שמונפק ללקוח אחרי תשלום",
      icon: ReceiptText,
      href: "/documents/new/receipt",
      gradient: "from-emerald-400 to-teal-500",
      bgGradient: "from-emerald-50 to-teal-50",
    },
    {
      title: "חשבון עסקה",
      desc: "מסמך שנשלח ללקוח לפני התשלום",
      icon: FileText,
      href: "/documents/new/quote",
      gradient: "from-amber-400 to-orange-500",
      bgGradient: "from-amber-50 to-orange-50",
    },
    {
      title: "חשבונית מס",
      desc: canTaxInvoice
        ? "חשבונית מס - כולל מע״מ"
        : "זמין רק לעוסק מורשה",
      icon: FileCheck,
      href: canTaxInvoice ? "/documents/new/tax-invoice" : undefined,
      gradient: "from-sky-400 to-blue-500",
      bgGradient: "from-sky-50 to-blue-50",
      disabledReason: canTaxInvoice ? undefined : "שנה את סוג העוסק להגדרות לעוסק מורשה",
    },
    {
      title: "חשבונית מס/קבלה",
      desc: canTaxInvoice
        ? "חשבונית מס + קבלה במסמך אחד"
        : "זמין רק לעוסק מורשה",
      icon: FileSpreadsheet,
      href: canTaxInvoice ? "/documents/new/tax-invoice-receipt" : undefined,
      gradient: "from-violet-400 to-purple-500",
      bgGradient: "from-violet-50 to-purple-50",
      disabledReason: canTaxInvoice ? undefined : "שנה את סוג העוסק להגדרות לעוסק מורשה",
    },
    {
      title: "חשבונית זיכוי",
      desc: canTaxInvoice
        ? "ביטול/החזר על חשבונית מס שהונפקה"
        : "זמין רק לעוסק מורשה",
      icon: FileMinus,
      href: canTaxInvoice ? "/documents/new/credit-note" : undefined,
      gradient: "from-rose-400 to-pink-500",
      bgGradient: "from-rose-50 to-pink-50",
      disabledReason: canTaxInvoice ? undefined : "שנה את סוג העוסק להגדרות לעוסק מורשה",
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link
          href="/documents"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה למסמכים
        </Link>
        <h1 className="text-3xl font-bold text-stone-900 mt-3">מסמך חדש ✨</h1>
        <p className="text-sm text-stone-500 mt-1">בחר את סוג המסמך שברצונך להפיק</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const disabled = !card.href;
          const inner = (
            <div
              className={`card-soft p-6 h-full transition-all relative overflow-hidden ${
                disabled
                  ? "opacity-70 cursor-not-allowed grayscale"
                  : "cursor-pointer hover:shadow-xl hover:-translate-y-1"
              } bg-gradient-to-br ${card.bgGradient}`}
            >
              <div className="flex items-start justify-between">
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-md`}
                >
                  <Icon className="w-7 h-7 text-white" />
                </div>
                {disabled && <Lock className="w-4 h-4 text-stone-400" />}
              </div>
              <h3 className="font-bold text-lg text-stone-900 mt-4">{card.title}</h3>
              <p className="text-sm text-stone-600 mt-1">{card.desc}</p>
              {card.disabledReason && (
                <p className="text-xs text-stone-500 mt-3 italic">{card.disabledReason}</p>
              )}
            </div>
          );
          if (disabled) return <div key={card.title}>{inner}</div>;
          return (
            <Link key={card.title} href={card.href!}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
