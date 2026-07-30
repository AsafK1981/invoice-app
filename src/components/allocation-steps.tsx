"use client";

import { Check } from "lucide-react";

/**
 * ONE story for מספר הקצאה, told the same way everywhere.
 *
 * The number is NOT obtained automatically on save: the user saves, then asks
 * for the number with one click on the document page, and only then may send
 * the document to the customer. Both the in-editor banner (step 1) and the
 * document page card (step 2) render this same list, so the wording, the order
 * and the button names never drift apart.
 *
 * Written for someone who is not technical: short sentences, no jargon, says
 * which button to press and what happens after.
 */
export const ALLOCATION_STEPS: { title: string; body: string }[] = [
  {
    title: "שומרים את המסמך",
    body: "ממלאים את הפרטים ולוחצים על כפתור השמירה הגדול.",
  },
  {
    title: "מבקשים מספר הקצאה",
    body: "בעמוד המסמך לוחצים על כפתור אחד, ורשות המסים שולחת את המספר תוך שניות.",
  },
  {
    title: "שולחים ללקוח",
    body: "אחרי שהמספר מופיע על המסמך, אפשר לשלוח אותו ללקוח.",
  },
];

interface Props {
  /** 1-based index of the step the user is standing on right now. */
  current: 1 | 2 | 3;
  className?: string;
}

/**
 * The 3-step progression, with the current step called out. Steps already
 * behind the user get a check and go quiet; steps ahead stay muted so the eye
 * lands on the one that matters now.
 *
 * PALETTE. The app is one warm black-and-gold system, so this is written in the
 * coral utility vocabulary (`orange`/`amber`/`rose`) that app-skin.css re-tints
 * to the gold ramp - the active badge's `from-orange-500 to-rose-500` resolves
 * to --gold-grad-cta with --gold-ink on the numeral, exactly like the app's
 * other filled controls. The ONLY colour that is not gold here is the emerald
 * check on a finished step, which means "done" and is kept for that reason.
 */
export function AllocationSteps({ current, className = "" }: Props) {
  return (
    <ol className={`grid gap-2 sm:grid-cols-3 ${className}`}>
      {ALLOCATION_STEPS.map((step, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li
            key={step.title}
            aria-current={active ? "step" : undefined}
            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
              active
                ? "border-orange-200 bg-white shadow-sm shadow-orange-100/70"
                : "border-transparent bg-white/45"
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                done
                  ? "bg-emerald-100 text-emerald-700"
                  : active
                    ? "bg-gradient-to-br from-orange-500 to-rose-500"
                    : "bg-stone-100 text-stone-500"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
            </span>
            <span className="min-w-0">
              <span
                className={`block text-[13px] font-bold leading-snug ${
                  active ? "text-stone-900" : "text-stone-600"
                }`}
              >
                {step.title}
                {active && (
                  <span className="ms-2 inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[10px] font-bold text-amber-800">
                    אתה כאן
                  </span>
                )}
              </span>
              <span
                className={`mt-0.5 block text-xs leading-relaxed ${
                  active ? "text-stone-700" : "text-stone-500"
                }`}
              >
                {step.body}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
