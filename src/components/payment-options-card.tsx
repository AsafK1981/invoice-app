"use client";

import { useState } from "react";
import { Copy, Check, Wallet } from "lucide-react";
import type { Business, InvoiceDocument } from "@/lib/types";
import { docDir, toDocLang } from "@/lib/document-strings";
import { formatMoney } from "@/lib/currencies";

interface Props {
  business: Business;
  document: InvoiceDocument;
}

const PAYMENT_STRINGS = {
  he: { title: "איך לשלם", amountDue: "סכום לתשלום:", amount: "סכום", copy: "העתק", bankTransfer: "העברה בנקאית", bank: "בנק", branch: "סניף", account: "חשבון", instructions: "הוראות תשלום" },
  en: { title: "How to pay", amountDue: "Amount due:", amount: "amount", copy: "Copy", bankTransfer: "Bank transfer", bank: "Bank", branch: "Branch", account: "Account", instructions: "Payment instructions" },
};

function CopyValue({
  value,
  label,
  copyLabel,
  monospace = false,
  big = false,
}: {
  value: string;
  label: string;
  copyLabel: string;
  monospace?: boolean;
  big?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard API can fail in insecure contexts; just no-op.
        }
      }}
      aria-label={`${copyLabel} ${label}`}
      className={`group inline-flex items-center gap-2 min-h-9 max-w-full rounded-xl border border-stone-200 bg-stone-50 hover:bg-orange-50 hover:border-orange-200 transition-colors px-3 ${
        big ? "py-2.5" : "py-1.5"
      } text-stone-900`}
    >
      <span
        className={`break-all ${monospace ? "font-mono tracking-tight" : ""} ${
          big ? "text-lg font-bold" : "text-sm font-semibold"
        }`}
        dir="auto"
      >
        {value}
      </span>
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-600" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-stone-400 group-hover:text-orange-600" />
      )}
    </button>
  );
}

export function PaymentOptionsCard({ business, document: doc }: Props) {
  const showCard =
    (doc.type === "quote" || doc.type === "proforma" || doc.type === "tax_invoice") &&
    doc.status !== "paid" &&
    doc.status !== "cancelled";

  if (!showCard) return null;

  const hasBank = Boolean(business.bankAccount && business.bankName);
  const hasNotes = Boolean(business.paymentNotes?.trim());
  const language = toDocLang(doc.language);
  const t = PAYMENT_STRINGS[language];

  if (!hasBank && !hasNotes) return null;

  // The document's own currency: a $3,600 quote must not read "₪3,600" here.
  const totalFmt = formatMoney(doc.total, doc.currency || "ILS");

  return (
    <div className="no-print max-w-[210mm] mx-auto mt-6" dir={docDir(language)} lang={language}>
      <div className="bg-white rounded-2xl shadow-sm border-2 border-orange-200 overflow-hidden">
        <div className="bg-gradient-to-l from-orange-50 to-amber-50 px-5 py-4 border-b border-orange-100">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="font-bold text-stone-900 text-base">{t.title}</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-stone-600">{t.amountDue}</span>
              <CopyValue value={totalFmt} label={t.amount} copyLabel={t.copy} big />
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {hasBank && (
            <div className="rounded-xl border border-stone-200 p-4 bg-stone-50/40">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-orange-600" />
                <h4 className="text-sm font-bold text-stone-900">{t.bankTransfer}</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-stone-500 mb-1">{t.bank}</div>
                  <CopyValue value={business.bankName!} label={t.bank} copyLabel={t.copy} />
                </div>
                {business.bankBranch && (
                  <div>
                    <div className="text-xs text-stone-500 mb-1">{t.branch}</div>
                    <CopyValue value={business.bankBranch} label={t.branch} copyLabel={t.copy} monospace />
                  </div>
                )}
                <div>
                  <div className="text-xs text-stone-500 mb-1">{t.account}</div>
                  <CopyValue value={business.bankAccount!} label={t.account} copyLabel={t.copy} monospace />
                </div>
              </div>
            </div>
          )}

          {hasNotes && (
            <div className="rounded-xl border border-stone-200 p-4">
              <h4 className="text-sm font-bold text-stone-900">{t.instructions}</h4>
              <p className="text-xs text-stone-600 mt-2 whitespace-pre-line break-words" dir="auto">{business.paymentNotes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
