"use client";

import { useEffect, useState } from "react";
import { Landmark, ShieldCheck, Loader2, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  requiresAllocationNumber,
  allocationRequiredThreshold,
  normalizeCustomerVatNumber,
} from "@/lib/tax-authority";
import type { DocumentType, InvoiceDocument } from "@/lib/types";

interface Props {
  documentType: DocumentType;
  /** Pre-VAT subtotal in ₪ (foreign docs: subtotal × exchange rate). The
   *  allocation threshold is measured on the PRE-VAT amount, not the total. */
  subtotalIls: number;
  /** Document date (YYYY-MM-DD); the threshold is date-aware. */
  date: string;
  /** Buyer's business/VAT number. Absent/empty ⇒ private customer (B2C),
   *  which never needs an allocation number. */
  customerTaxId?: string;
  /** Manually-entered allocation number (controlled by the editor). */
  allocationNumber?: string;
  onAllocationNumberChange?: (value: string) => void;
}

/**
 * Prominent, in-editor call-to-action shown WHILE writing a tax invoice that
 * will need a חשבונית ישראל allocation number. Surfaces the connect / status
 * right where the user is, instead of buried in settings; the allocation flow
 * was hard to find. Self-hides for עוסק פטור and for documents under the
 * threshold (where no allocation number is required).
 */
export function AllocationConnectBanner({
  documentType,
  subtotalIls,
  date,
  customerTaxId,
  allocationNumber = "",
  onAllocationNumberChange,
}: Props) {
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/tax-authority/status", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const d = await res.json();
        if (!cancelled && d.ok) {
          setBusinessType(d.businessType);
          setConnected(Boolean(d.connected));
        }
      } catch {
        /* status is best-effort; the banner simply stays hidden on failure */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Allocation numbers apply only to VAT-charging businesses (עוסק מורשה / חברה).
  if (!loaded || businessType === "exempt" || businessType === null) return null;
  // Only when THIS document actually needs a number (right type + over the
  // date-aware threshold + a BUSINESS customer). requiresAllocationNumber
  // gates on the PRE-VAT amount (subtotalIls ?? subtotal), so feed the ₪
  // subtotal under BOTH keys. A private customer (no tax id) is never gated.
  const needs = requiresAllocationNumber(
    {
      type: documentType,
      date,
      subtotal: subtotalIls,
      subtotalIls,
    } as Pick<InvoiceDocument, "type" | "date" | "subtotal" | "subtotalIls"> as InvoiceDocument,
    customerTaxId,
  );

  const isAllocatableType =
    documentType === "tax_invoice" ||
    documentType === "tax_invoice_receipt" ||
    documentType === "credit_note";

  const isPrivateCustomer = !normalizeCustomerVatNumber(customerTaxId);

  // A tax invoice that doesn't need an allocation number; reassure the user
  // with a short note instead of showing nothing. Two reasons it may not need
  // one: under the threshold, or a private (B2C) customer.
  if (!needs) {
    if (!isAllocatableType) return null;
    if (isPrivateCustomer) {
      return (
        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3 flex items-start gap-3">
          <Info className="w-5 h-5 text-stone-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-stone-700 leading-relaxed">
            לקוח ללא מספר עוסק/ח.פ, לכן <span className="font-semibold">אין חובת מספר הקצאה</span>. אם זהו לקוח עסקי, הוסף את מספר העוסק/ח.פ שלו כדי לקבל מספר הקצאה.
          </p>
        </div>
      );
    }
    const threshold = allocationRequiredThreshold(date ? new Date(date) : new Date());
    return (
      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3 flex items-start gap-3">
        <Info className="w-5 h-5 text-stone-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-stone-700 leading-relaxed">
          הסכום מתחת ל-₪{threshold.toLocaleString()}, <span className="font-semibold">אין צורך במספר הקצאה</span> מרשות המסים למסמך זה.
        </p>
      </div>
    );
  }

  async function connect() {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/tax-authority/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const d = await res.json();
      if (d.ok && d.url) {
        window.location.href = d.url;
        return;
      }
    } catch {
      /* fall through to re-enable the button */
    }
    setConnecting(false);
  }

  // The "מספר הקצאה" slot, always rendered when this document needs a number,
  // so the user has a fixed place for it and a reminder that it's still missing.
  // Editable: the number normally arrives automatically from the Tax Authority
  // after saving, but the user can also type/paste one they obtained elsewhere.
  const hasNumber = allocationNumber.trim().length > 0;
  const allocField = (
    <div className="mt-3 pt-3 border-t border-stone-200/70">
      <label className="text-xs font-semibold text-stone-700 mb-1 block">מספר הקצאה</label>
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={allocationNumber}
        onChange={(e) => onAllocationNumberChange?.(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="טרם הוקצה"
        className="input-warm text-left"
      />
      <p className="text-xs text-stone-600 mt-1">
        {hasNumber
          ? "מספר הקצאה הוזן ידנית, יודפס על המסמך."
          : connected
          ? "השאר ריק, יתקבל אוטומטית מרשות המסים לאחר שמירה. או הזן ידנית."
          : "השאר ריק והפק לאחר חיבור, או הזן ידנית מספר שקיבלת."}
      </p>
    </div>
  );

  if (connected) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-700 flex-shrink-0" />
          <p className="text-sm text-emerald-900">
            <span className="font-bold">מחובר לחשבונית ישראל.</span> מספר ההקצאה יתקבל אוטומטית
            לאחר שמירת המסמך.
          </p>
        </div>
        {allocField}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-l from-indigo-50 to-blue-50/50 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Landmark className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-stone-900">
            מסמך זה דורש מספר הקצאה (חשבונית ישראל)
          </p>
          <p className="text-xs text-stone-700 mt-0.5 leading-relaxed">
            חבר את העסק פעם אחת, וכל חשבונית מס מעל הסף תקבל מספר הקצאה מרשות המסים אוטומטית,
            בלי פורטל חיצוני.
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="mt-2.5 inline-flex items-center gap-2 bg-gradient-to-l from-indigo-500 to-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-indigo-200/60 disabled:opacity-50"
          >
            {connecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Landmark className="w-4 h-4" />
            )}
            חבר לחשבונית ישראל
          </button>
        </div>
      </div>
      {allocField}
    </div>
  );
}
