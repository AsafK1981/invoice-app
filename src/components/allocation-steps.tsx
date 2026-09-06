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
  /** "lg" is the document-page card, which spans the whole content column
   *  (Asaf, 2026-08-31: the A4-width card left dead space on both sides and
   *  read too small); the in-editor banner keeps the default "md". */
  size?: "md" | "lg";
}

/**
 * The 3-step progression, with the current step called out. Steps already
 * behind the user get a check and go quiet; steps ahead stay muted so the eye
 * lands on the one that matters now.
 *
 * PALETTE. The app is one warm black-and-gold system, so this is written in the
 * coral utility vocabulary (`orange`/`amber`/`rose`) that app-skin.css re-tints
 * to the gold ramp - the active badge's `from-orange-500 to-orange-700` resolves
 * to --gold-grad-cta with --gold-ink on the numeral, exactly like the app's
 * other filled controls. The ONLY colour that is not gold here is the emerald
 * check on a finished step, which means "done" and is kept for that reason.
 */
export function AllocationSteps({ current, className = "", size = "md" }: Props) {
  const lg = size === "lg";
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
            className={`flex items-start rounded-xl border ${lg ? "gap-3 px-4 py-3.5" : "gap-2.5 px-3 py-2.5"} ${
              active
                ? "border-orange-200 bg-white shadow-sm shadow-orange-100/70"
                : "border-transparent bg-white/45"
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 flex flex-shrink-0 items-center justify-center rounded-full font-bold ${lg ? "h-7 w-7 text-xs" : "h-6 w-6 text-[11px]"} ${
                done
                  ? "bg-emerald-100 text-emerald-700"
                  : active
                    ? "bg-gradient-to-br from-orange-500 to-orange-700"
                    : "bg-stone-100 text-stone-500"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
            </span>
            <span className="min-w-0">
              {/* Every card reserves the same three bands - badge, title, body -
                  whether or not it is the active one, so the explanations all
                  sit on one baseline. Two things used to break that: the three
                  titles are different lengths, so side by side one fitted on a
                  single line while the others wrapped, and the "אתה כאן" pill
                  rode inside the active title and pushed it onto an extra line.
                  Measured bodies started at 56 / 54 / 34px from the card top.
                  The pill now has its own fixed-height row instead of competing
                  with the title text for it, and the title reserves two lines
                  in the multi-column layout (mobile stacks one per row, where
                  each title fits on a single line anyway). */}
              <span className="mb-0.5 block h-4 text-[10px] leading-4">
                {active && (
                  <span className="inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 font-bold text-amber-800">
                    אתה כאן
                  </span>
                )}
              </span>
              <span
                className={`block font-bold leading-snug ${lg ? "text-[15px] sm:min-h-10" : "text-[13px] sm:min-h-9"} ${
                  active ? "text-stone-900" : "text-stone-600"
                }`}
              >
                {step.title}
              </span>
              <span
                className={`mt-0.5 block leading-relaxed ${lg ? "text-sm" : "text-xs"} ${
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
