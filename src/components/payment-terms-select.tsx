"use client";

import {
  PAYMENT_TERMS_LABELS,
  PAYMENT_TERMS_ORDER,
  isPaymentTerms,
  type PaymentTerms,
} from "@/lib/payment-terms";

/**
 * The one תנאי תשלום select: the client form, onboarding's first client, the
 * editor's quick-add and the bulk "set terms" dialog all render this, so the
 * options and their order can never drift apart.
 *
 * "" means no agreed terms. With `allowHistory` (the default) it is offered as
 * "לפי היסטוריית התשלומים", which is a real answer: the forecast then
 * estimates from how the client has actually paid. Without it, "" is only a
 * disabled prompt and the caller must require a real choice.
 */
export function PaymentTermsSelect({
  value,
  onChange,
  allowHistory = true,
  id,
  className = "input-warm",
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  required,
  "aria-required": ariaRequired,
}: {
  value: PaymentTerms | "";
  onChange: (value: PaymentTerms | "") => void;
  allowHistory?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  required?: boolean;
  "aria-required"?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(isPaymentTerms(e.target.value) ? e.target.value : "")}
      className={className}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      required={required}
      aria-required={ariaRequired}
    >
      {allowHistory ? (
        <option value="">לפי היסטוריית התשלומים</option>
      ) : (
        <option value="" disabled>
          בחירת תנאי תשלום
        </option>
      )}
      {PAYMENT_TERMS_ORDER.map((t) => (
        <option key={t} value={t}>
          {PAYMENT_TERMS_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

// Forwards id / aria-describedby / required to its one <select>, so FormField
// wires its label and hint to it like a native control.
PaymentTermsSelect.formFieldControl = true;
