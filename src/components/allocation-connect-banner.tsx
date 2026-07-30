"use client";

import { useEffect, useState } from "react";
import { Landmark, ShieldCheck, Loader2, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  requiresAllocationNumber,
  allocationRequiredThreshold,
  allocationThresholdSentence,
  formatThreshold,
  normalizeCustomerVatNumber,
} from "@/lib/tax-authority";
import { AllocationSteps } from "@/components/allocation-steps";
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
 *
 * PALETTE. Gold, like the rest of the app - NOT a חשבונית ישראל blue. The card
 * and the medallion use the coral utilities app-skin.css re-tints to the gold
 * ramp, and the connect button carries `.pgbtn-primary`, the app's ONE filled
 * button treatment (the same class מסמך חדש wears on /documents), so the two
 * are byte-identical gradients rather than two copies of one gradient string.
 * The only non-gold colour left is the emerald "מחובר" line, which is success.
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
            ללקוח אין מספר עוסק/ח.פ, לכן <span className="font-semibold">אין צורך במספר הקצאה</span>{" "}
            מרשות המסים. אם זהו לקוח עסקי, הוסף את מספר העוסק/ח.פ שלו והמסמך יעבור למסלול ההקצאה.
          </p>
        </div>
      );
    }
    const threshold = allocationRequiredThreshold(date ? new Date(date) : new Date());
    return (
      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3 flex items-start gap-3">
        <Info className="w-5 h-5 text-stone-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-stone-700 leading-relaxed">
          הסכום נמוך מ-{formatThreshold(threshold)} לפני מע״מ, לכן{" "}
          <span className="font-semibold">אין צורך במספר הקצאה</span> מרשות המסים למסמך הזה. אפשר
          לשמור ולשלוח ללקוח כרגיל.
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
  // The number is NOT fetched on save; the user asks for it with one click on
  // the document page right after saving, or types one they already received.
  const hasNumber = allocationNumber.trim().length > 0;
  const allocField = (
    <div className="mt-3 pt-3 border-t border-stone-200/70">
      <label className="text-xs font-semibold text-stone-700 mb-1 block">
        מספר הקצאה (לא חובה למלא עכשיו)
      </label>
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={allocationNumber}
        onChange={(e) => onAllocationNumberChange?.(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="טרם התקבל"
        className="input-warm text-left"
      />
      <p className="text-xs text-stone-600 mt-1 leading-relaxed">
        {hasNumber
          ? "המספר שהקלדת יודפס על המסמך."
          : connected
            ? "אפשר להשאיר ריק ולבקש את המספר מיד אחרי השמירה. אם כבר קיבלת מספר מרשות המסים, הקלד אותו כאן."
            : "אם כבר קיבלת מספר מרשות המסים, הקלד אותו כאן. אחרת חבר את העסק, ותוכל לבקש אותו מיד אחרי השמירה."}
      </p>
    </div>
  );

  const thresholdLine = (
    <p className="text-xs text-stone-600 mt-1 leading-relaxed">
      {allocationThresholdSentence(date ? new Date(date) : new Date())}
    </p>
  );

  if (connected) {
    return (
      <div className="rounded-2xl border border-orange-200 bg-gradient-to-l from-orange-50/80 to-amber-50/50 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Landmark className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-stone-900">
              למסמך הזה צריך מספר הקצאה מרשות המסים
            </p>
            {thresholdLine}
            <p className="text-xs text-stone-700 mt-1.5 leading-relaxed">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                <ShieldCheck className="w-3.5 h-3.5" />
                העסק שלך מחובר לחשבונית ישראל.
              </span>{" "}
              המספר לא מגיע מעצמו: קודם שומרים את המסמך, ואז מבקשים אותו בלחיצה אחת. רק אחרי
              שהמספר מתקבל מותר לשלוח את המסמך ללקוח.
            </p>
          </div>
        </div>
        <AllocationSteps current={1} className="mt-3" />
        {allocField}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-orange-200 bg-gradient-to-l from-orange-50/80 to-amber-50/50 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Landmark className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-stone-900">
            למסמך הזה צריך מספר הקצאה מרשות המסים
          </p>
          {thresholdLine}
          <p className="text-xs text-stone-700 mt-1.5 leading-relaxed">
            מחברים את העסק לחשבונית ישראל פעם אחת. אחר כך, על כל מסמך כזה, שומרים ומבקשים את
            המספר בלחיצה אחת, בלי להיכנס לאתר של רשות המסים.
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="pgbtn-primary mt-2.5 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {connecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Landmark className="w-4 h-4" />
            )}
            חבר את העסק לחשבונית ישראל
          </button>
        </div>
      </div>
      <AllocationSteps current={1} className="mt-3" />
      {allocField}
    </div>
  );
}
