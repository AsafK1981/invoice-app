"use client";

import { useState } from "react";
import { AlertCircle, ArrowLeft, Landmark } from "lucide-react";
import { AllocationSteps } from "@/components/allocation-steps";
import { Expander } from "@/components/expander";

interface Props {
  /** Manually-entered allocation number, controlled by the editor. */
  allocationNumber: string;
  onAllocationNumberChange: (value: string) => void;
  /** Same shared status the top banner reads (useTaxAuthorityStatus()), so
   *  the manual-entry helper text never disagrees with it. */
  connected: boolean;
  /** The editor's ONE primary save action (the same handler the aside and
   *  the mobile bar call), rendered here as well so the "next step" card
   *  contains the button it talks about instead of pointing at one that
   *  lives in another column. */
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  /** True while the save is in flight / the exchange rate is loading, so the
   *  icon is dropped the same way the other two save buttons do it. */
  saveBusy: boolean;
  /** Why the button is disabled, in one sentence (null when it is enabled). */
  blockReason: string | null;
}

/**
 * "What happens next", mounted at the END of the form (right after the
 * "שליחה ללקוח" card), not the top. This is the exact spot Asaf asked for:
 * "צריך שברגע שסיימת את המסמך יהיה כתוב: לחץ כאן כדי לקבל מספר הקצאה" - the
 * next action belongs where the work ends, not back up at a banner above the
 * whole form.
 *
 * 2026-08-17: the card used to SAY "press the save button below" while the
 * button actually sat in the left-hand aside (desktop) - the user had to
 * leave the card, look sideways, and find it. Asaf: "צריך שבאותו מסגרת מתחת
 * ל-1-2-3 יהיה את הכפתור הזה הגדול". So the same primary save action is now
 * rendered INSIDE the card, directly under the 3 steps: what the card
 * describes and what the user presses are the same thing in the same box.
 * The aside / mobile-bar buttons stay (they hold the total + toast); this is
 * a third affordance for the same handler, not a different flow.
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
  onSave,
  saveLabel,
  saveDisabled,
  saveBusy,
  blockReason,
}: Props) {
  const [manualOpen, setManualOpen] = useState(false);
  const hasNumber = allocationNumber.trim().length > 0;

  return (
    <div className="rounded-2xl border border-orange-200 bg-gradient-to-l from-orange-50/80 to-amber-50/50 px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Landmark className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold tracking-wide text-amber-700">השלב הבא</p>
          <p className="text-[15px] font-extrabold text-stone-900 leading-tight mt-0.5">
            אחרי השמירה מבקשים מספר הקצאה
          </p>
          <p className="text-xs text-stone-700 mt-1.5 leading-relaxed">
            סיימת למלא? לוחצים על הכפתור הגדול שכאן למטה. המסמך נשמר, ובעמוד המסמך מבקשים את
            מספר ההקצאה מרשות המסים בלחיצה אחת. עד שהמספר מתקבל אי אפשר לשלוח את המסמך ללקוח.
          </p>
        </div>
      </div>

      <AllocationSteps current={1} className="mt-3.5" />

      {/* The button the card talks about, in the card. Same handler, same
          gating and same label as the aside / mobile-bar buttons, so the
          three never disagree about whether saving is possible right now.

          The "1" medallion ties this button to step 1 of the strip right
          above it: the strip numbers the steps, and the button that DOES a
          step carries that step's number (the request button on the document
          page carries "2" the same way). The circle keeps a bg-* class so the
          app-skin descendant ink rule leaves the numeral on the button's own
          ink. */}
      <div className="mt-3.5">
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          className="w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-4 bg-gradient-to-l from-orange-500 to-orange-700 text-white rounded-2xl text-[15px] font-bold text-center leading-tight shadow-md shadow-orange-200/70 hover:shadow-lg hover:shadow-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:from-stone-300 disabled:to-stone-300 disabled:cursor-not-allowed disabled:shadow-none transition-all"
        >
          <span
            aria-hidden
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/25 text-[13px] font-bold"
          >
            1
          </span>
          <span>{saveLabel}</span>
          {!saveBusy && <ArrowLeft className="w-4 h-4 flex-shrink-0" aria-hidden />}
        </button>
        {blockReason ? (
          <p className="mt-2 flex items-start justify-center gap-1.5 text-[11px] leading-snug text-amber-800">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{blockReason}</span>
          </p>
        ) : (
          <p className="mt-2 text-center text-[11px] leading-snug text-stone-600">
            {hasNumber
              ? "המספר שהקלדת יודפס על המסמך."
              : "אחרי השמירה תגיע לעמוד המסמך, ושם תבקש את מספר ההקצאה בלחיצה אחת."}
          </p>
        )}
      </div>

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
