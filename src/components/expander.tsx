"use client";

import { ChevronDown } from "lucide-react";

/** A quiet disclosure for advanced/rarely-used controls. Shared by
 *  receipt-editor.tsx ("הגדרות מתקדמות") and AllocationNextStepCard
 *  ("כבר קיבלתי מספר הקצאה") so both reuse the exact same disclosure
 *  styling instead of forking it. Lives in its own module (not exported
 *  from receipt-editor.tsx) to avoid a circular import between the two. */
export function Expander({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 min-h-[44px] text-[13px] font-semibold text-stone-700 hover:text-orange-700"
      >
        <ChevronDown
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {label}
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t border-dashed border-orange-200">{children}</div>
      )}
    </div>
  );
}
