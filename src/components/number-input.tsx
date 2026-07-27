"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";

/**
 * A controlled `<input type="number">` backed by a numeric value, without the
 * two warts a naive `value={num} onChange={parseFloat}` has:
 *
 * 1. **Stray leading zero.** React skips writing back to a number input when
 *    the DOM string and the numeric prop are loosely equal, so typing 4200 into
 *    a field holding 0 leaves the box showing "04200" (the parsed value, and
 *    therefore the totals, were right; it just looked broken).
 * 2. **Can't be emptied.** Clearing the box parsed to 0 and immediately snapped
 *    a "0" back into it, so you had to select-all before typing.
 *
 * The fix is to keep the text the user is typing in local state and only push
 * the parsed number upward. A zero value shows as an empty box (the placeholder
 * carries the meaning), so typing replaces rather than appends.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (value: number) => void;
};

function toDraft(value: number): string {
  return value === 0 ? "" : String(value);
}

export function NumberInput({ value, onValueChange, ...rest }: Props) {
  const [draft, setDraft] = useState(() => toDraft(value));

  // Re-sync when the value changes from the outside (picking a product, an
  // exchange-rate fetch, loading a draft), but never while the two already
  // agree numerically, otherwise we'd fight the user mid-keystroke ("1." → "1").
  useEffect(() => {
    const parsed = draft.trim() === "" ? 0 : Number.parseFloat(draft);
    if (parsed !== value) setDraft(toDraft(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      value={draft}
      onChange={(e) => {
        // "007" → "7", but keep "0", "0.5" and a lone "-" intact.
        const next = e.target.value.replace(/^(-?)0+(?=\d)/, "$1");
        setDraft(next);
        const parsed = Number.parseFloat(next);
        onValueChange(Number.isFinite(parsed) ? parsed : 0);
      }}
    />
  );
}
