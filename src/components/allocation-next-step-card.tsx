"use client";

import { useState } from "react";
import { Landmark } from "lucide-react";
import { AllocationSteps } from "@/components/allocation-steps";
import { Expander } from "@/components/expander";

interface Props {
  /** Manually-entered allocation number, controlled by the editor. */
  allocationNumber: string;
  onAllocationNumberChange: (value: string) => void;
  /** Same shared status the top banner reads (useTaxAuthorityStatus()), so
   *  the manual-entry helper text never disagrees with it. */
  connected: boolean;
}

/**
 * "What happens next", mounted at the END of the form (right after the
 * "שליחה ללקוח" card), not the top. This is the exact spot Asaf asked for:
 * "צריך שברגע שסיימת את המסמך יהיה כתוב: לחץ כאן כדי לקבל מספר הקצאה" - the
 * next action belongs where the work ends, not back up at a banner above the
 * whole form.
 *
 * Visual language copied from the gold "השלב הבא" card in
 * allocation-number-section.tsx (the document-page equivalent of this same
 * step), so next-step cards read as one family across the editor and the
 * document page rather than two different visual stories for the same idea.
 *
 * The request stays manual, always: no number is fetched from here. Saving
 * takes the user straight to the document page where ONE click asks רשות
 * המסים for it; the disclosure below is only for a number already obtained
 * elsewhere (typed in by hand), tucked away so it doesn't compete with the
 * primary "just save" action.
 */
export function AllocationNextStepCard({
  allocationNumber,
  onAllocationNumberChange,
  connected,
}: Props) {
  const [manualOpen, setManualOpen] = useState(false);
  const hasNumber = allocationNumber.trim().length > 0;

  return (
    <div className="rounded-2xl border border-orange-200 bg-gradient-to-l from-orange-50/80 to-amber-50/50 px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Landmark className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold tracking-wide text-amber-700">השלב הבא</p>
          <p className="text-[15px] font-extrabold text-stone-900 leading-tight mt-0.5">
            אחרי השמירה מבקשים מספר הקצאה
          </p>
          <p className="text-xs text-stone-700 mt-1.5 leading-relaxed">
            לוחצים על כפתור השמירה למטה, ובעמוד המסמך מבקשים את מספר ההקצאה מרשות המסים בלחיצה
            אחת. עד שהמספר מתקבל אי אפשר לשלוח את המסמך ללקוח.
          </p>
        </div>
      </div>

      <AllocationSteps current={1} className="mt-3.5" />

      <Expander
        label="כבר קיבלתי מספר הקצאה, אקליד אותו בעצמי"
        open={manualOpen}
        onToggle={() => setManualOpen((s) => !s)}
      >
        <label className="text-xs font-semibold text-stone-700 mb-1 block">מספר הקצאה</label>
        <input
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={allocationNumber}
          onChange={(e) => onAllocationNumberChange(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="טרם התקבל"
          className="input-warm text-left"
        />
        <p className="text-xs text-stone-600 mt-1 leading-relaxed">
          {hasNumber
            ? "המספר שהקלדת יודפס על המסמך."
            : connected
              ? "אפשר להשאיר ריק ולבקש את המספר מיד אחרי השמירה. אם כבר קיבלת מספר מרשות המסים, הקלד אותו כאן."
              : "אם כבר קיבלת מספר מרשות המסים, הקלד אותו כאן. אחרת חבר את העסק למעלה, ותוכל לבקש אותו מיד אחרי השמירה."}
        </p>
      </Expander>
    </div>
  );
}
