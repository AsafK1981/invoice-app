"use client";

import { useState } from "react";
import { Copy, Check, Phone, Wallet, Smartphone } from "lucide-react";
import type { Business, InvoiceDocument } from "@/lib/types";

interface Props {
  business: Business;
  document: InvoiceDocument;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) return "+" + digits.replace(/^972/, "972-");
  if (digits.startsWith("0")) {
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  return raw;
}

function CopyValue({
  value,
  label,
  monospace = false,
  big = false,
}: {
  value: string;
  label: string;
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
      aria-label={`העתק ${label}`}
      className={`group inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 hover:bg-orange-50 hover:border-orange-200 transition-colors px-3 ${
        big ? "py-2.5" : "py-1.5"
      } text-stone-900`}
    >
      <span
        className={`${monospace ? "font-mono tracking-tight" : ""} ${
          big ? "text-lg font-bold" : "text-sm font-semibold"
        }`}
        dir="ltr"
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
    (doc.type === "quote" || doc.type === "tax_invoice") &&
    doc.status !== "paid" &&
    doc.status !== "cancelled";

  if (!showCard) return null;

  const hasBank = Boolean(business.bankAccount && business.bankName);
  const hasMobilePayment = Boolean(business.phone);

  if (!hasBank && !hasMobilePayment) return null;

  const totalFmt = `₪${doc.total.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const phoneFormatted = business.phone ? formatPhone(business.phone) : null;

  return (
    <div className="no-print max-w-[210mm] mx-auto mt-6">
      <div className="bg-white rounded-2xl shadow-sm border-2 border-orange-200 overflow-hidden">
        <div className="bg-gradient-to-l from-orange-50 to-amber-50 px-5 py-4 border-b border-orange-100">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="font-bold text-stone-900 text-base">איך לשלם</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-stone-600">סכום לתשלום:</span>
              <CopyValue value={totalFmt} label="סכום" big />
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {hasMobilePayment && phoneFormatted && (
            <div className="rounded-xl border border-stone-200 p-4 bg-stone-50/40">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="w-4 h-4 text-orange-600" />
                <h4 className="text-sm font-bold text-stone-900">Bit / PayBox</h4>
              </div>
              <p className="text-xs text-stone-600 mb-3">
                פתחו את האפליקציה ושלחו תשלום למספר:
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <CopyValue value={business.phone!} label="טלפון" monospace />
                <a
                  href={`tel:${business.phone}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white hover:bg-orange-50 hover:border-orange-200 transition-colors px-3 py-1.5 text-sm font-medium text-stone-700"
                >
                  <Phone className="w-3.5 h-3.5" />
                  חייגו
                </a>
              </div>
            </div>
          )}

          {hasBank && (
            <div className="rounded-xl border border-stone-200 p-4 bg-stone-50/40">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-orange-600" />
                <h4 className="text-sm font-bold text-stone-900">העברה בנקאית</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-stone-500 mb-1">בנק</div>
                  <CopyValue value={business.bankName!} label="בנק" />
                </div>
                {business.bankBranch && (
                  <div>
                    <div className="text-xs text-stone-500 mb-1">סניף</div>
                    <CopyValue value={business.bankBranch} label="סניף" monospace />
                  </div>
                )}
                <div>
                  <div className="text-xs text-stone-500 mb-1">חשבון</div>
                  <CopyValue value={business.bankAccount!} label="חשבון" monospace />
                </div>
              </div>
              {business.paymentNotes && (
                <p className="text-xs text-stone-600 mt-3 pt-3 border-t border-stone-200 whitespace-pre-line">
                  {business.paymentNotes}
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-stone-500 text-center pt-1">
            לאחר התשלום, {business.name} ישלח לכם אישור.
          </p>
        </div>
      </div>
    </div>
  );
}
