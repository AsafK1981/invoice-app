"use client";

import { businessNumberHint } from "@/lib/business-number-hint";

const TONE_CLASS = {
  ok: "text-emerald-700",
  info: "text-sky-800",
  warn: "text-amber-800",
} as const;

/** Live hint under a business-number input. Informational only, never blocks. */
export function BusinessNumberHintText({ value, digitsOnlyField = false }: { value: string; digitsOnlyField?: boolean }) {
  const hint = businessNumberHint(value, { digitsOnlyField });
  if (!hint) return null;
  return (
    <p aria-live="polite" className={`text-xs mt-1 leading-relaxed ${TONE_CLASS[hint.tone]}`}>
      {hint.text}
    </p>
  );
}
