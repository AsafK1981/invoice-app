"use client";

import { useState } from "react";
import { Landmark, ShieldCheck, Loader2, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  requiresAllocationNumber,
  allocationRequiredThreshold,
  allocationThresholdSentence,
  formatThreshold,
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
  /** Shared status from useTaxAuthorityStatus(), fetched ONCE by the editor
   *  and passed down here (and to the end-of-form next-step card), so the
   *  two can never double-fetch or disagree for a beat. */
  businessType: string | null;
  connected: boolean;
  loaded: boolean;
}

/**
 * The ONE-TIME PREREQUISITE, kept at the top of the editor: connecting to
 * חשבונית ישראל is an OAuth redirect off the page, so it must happen before
 * (or independent of) filling the rest of the form. Everything else about the
 * allocation-number flow - the 3-step walkthrough and the manual number field
 * - moved to <AllocationNextStepCard>, right where the form ends, because
 * that's the moment the user actually needs it.
 *
 * Three states:
 *   - Not connected + doc needs a number → the gold CTA card (connect button).
 *   - Connected + doc needs a number → ONE slim status line, no card: the
 *     prerequisite is already satisfied, so there's nothing to act on here.
 *   - Doc does not need a number → a quiet reassurance note (unchanged).
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
  businessType,
  connected,
  loaded,
}: Props) {
  const [connecting, setConnecting] = useState(false);

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

  const thresholdLine = (
    <p className="text-xs text-stone-600 mt-1 leading-relaxed">
      {allocationThresholdSentence(date ? new Date(date) : new Date())}
    </p>
  );

  // Prerequisite already satisfied: no card, just a slim one-line status so
  // the eye moves straight to the form instead of stopping on a CTA that has
  // nothing left to ask. The actual next step (asking for the number) is
  // <AllocationNextStepCard>, at the end of the form.
  if (connected) {
    return (
      <p className="text-xs text-stone-700 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" />
        <span>
          <span className="font-semibold text-emerald-800">מחובר לחשבונית ישראל.</span> מספר
          ההקצאה יתבקש בלחיצה אחת אחרי השמירה.
        </span>
      </p>
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
    </div>
  );
}
