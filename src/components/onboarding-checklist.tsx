"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X, Sparkles, ArrowLeft } from "lucide-react";
import type { Business, Client, Product, InvoiceDocument } from "@/lib/types";
import { Ltr, LtrText } from "@/components/ui/ltr";

interface Props {
  business: Business;
  clients: Client[];
  products: Product[];
  documents: InvoiceDocument[];
}

interface Step {
  id: string;
  done: boolean;
  label: string;
  desc: string;
  cta: string;
  href: string;
}

const DISMISS_KEY = "invoice-app:onboarding-checklist-dismissed";

export function OnboardingChecklist({ business, clients, products, documents }: Props) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  const steps: Step[] = [
    {
      id: "business",
      done: Boolean(business.name && business.taxId && business.address),
      label: "פרטי העסק",
      desc: "שם, ח.פ וכתובת, כך שיופיעו על כל מסמך",
      cta: "לעמוד הגדרות",
      href: "/settings",
    },
    {
      id: "payment",
      done: Boolean(business.bankName || business.bankAccount || business.paymentNotes),
      label: "פרטי תשלום",
      desc: "בנק / סניף / חשבון או Bit, כדי שלקוחות יידעו איך לשלם",
      cta: "הוסף פרטי בנק",
      href: "/settings#payment-details",
    },
    {
      id: "client",
      done: clients.length > 0,
      label: "לקוח ראשון",
      desc: "הוסף לקוח כדי להפיק עבורו מסמכים מהר",
      cta: "הוסף לקוח",
      href: "/clients",
    },
    {
      id: "product",
      done: products.length > 0,
      label: "מוצר או שירות",
      desc: "אופציונלי, אך משלים אוטומטית בעורך המסמכים",
      cta: "הוסף לקטלוג",
      href: "/products",
    },
    {
      id: "document",
      done: documents.length > 0,
      label: "מסמך ראשון",
      desc: "הפק קבלה, חשבון עסקה או חשבונית",
      cta: "מסמך חדש",
      href: "/documents/new",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  if (allDone || dismissed) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="card-soft p-5 bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 border-orange-200 relative">
      <button
        onClick={dismiss}
        className="absolute top-3 left-3 text-stone-400 hover:text-stone-700 p-1 rounded-lg hover:bg-white/60 transition-colors"
        aria-label="הסתר"
        title="הסתר את הצ'ק-ליסט"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-md shadow-orange-200/50 flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="font-bold text-stone-900">
            {completedCount === 0 ? "ברוך הבא! בוא נתחיל" : `כמעט שם: ${completedCount} מתוך ${steps.length}`}
          </h2>
          <p className="text-sm text-stone-700 mt-0.5">
            {completedCount === 0
              ? "5 שלבים קצרים כדי להפיק את המסמך הראשון שלך"
              : nextStep
              ? `הצעד הבא: ${nextStep.label}`
              : ""}
          </p>
        </div>
      </div>

      {/* "Migrating from another tool?" hint: shows only while the user
          hasn't ticked off any steps yet (i.e. fresh signup). */}
      {completedCount === 0 && (
        <Link
          href="/migrate"
          className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 mb-2 transition-colors group"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-sm flex-shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-stone-900">
              מגיע מתוכנת חשבוניות אחרת?
            </p>
            <p className="text-xs text-stone-700 mt-0.5">
              <Ltr>Invoice4U</Ltr> · <Ltr>Morning</Ltr> · <Ltr>iCount</Ltr> · <Ltr>EZcount</Ltr> ·{" "}
              <Ltr>SUMIT</Ltr> · ריווחית · חשבשבת ועוד: מדריך מעבר ל-13 תוכנות
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            התחל
            <ArrowLeft className="w-3 h-3" />
          </span>
        </Link>
      )}

      <div className="space-y-2">
        {steps.map((step) => (
          <Link
            key={step.id}
            href={step.href}
            className={`ob-step flex items-center gap-3 p-3 rounded-xl transition-colors ${
              step.done
                ? "ob-step-done bg-white/40"
                : "ob-step-open bg-white/70 hover:bg-white shadow-sm hover:shadow"
            }`}
          >
            {step.done ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            ) : (
              <Circle className="w-5 h-5 text-stone-300 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p
                className={`ob-step-label text-sm font-semibold ${
                  step.done ? "text-stone-500 line-through" : "text-stone-900"
                }`}
              >
                {step.label}
              </p>
              {!step.done && (
                <p className="text-xs text-stone-600 mt-0.5">
                  <LtrText text={step.desc} />
                </p>
              )}
            </div>
            {!step.done && (
              <span className="ob-step-cta inline-flex items-center gap-1 text-xs font-medium text-orange-700">
                {step.cta}
                <ArrowLeft className="w-3 h-3" />
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
