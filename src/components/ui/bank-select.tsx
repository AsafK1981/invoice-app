"use client";

import { useState } from "react";
import { ISRAELI_BANKS, findIsraeliBank } from "@/lib/israeli-banks";

const OTHER = "__other__";

interface BankSelectProps {
  value: string;
  onChange: (value: string) => void;
  /** Placeholder for the free-text field shown when "אחר" is picked. */
  otherPlaceholder?: string;
  className?: string;
  id?: string;
  /**
   * Accessible name for the select. Required in practice: this renders a bare
   * <select> whose only visible cue is its first option ("בחר בנק"), and an
   * option is not an accessible name. Callers that have a real <label> pass
   * `id` instead and point htmlFor at it.
   */
  ariaLabel?: string;
}

/**
 * A native select listing every Israeli bank, plus an "אחר" row that reveals
 * a free-text input for banks not on the list. The stored value is always the
 * bank's display name (or the typed text), so callers keep a plain string.
 */
export function BankSelect({
  value,
  onChange,
  otherPlaceholder = "שם הבנק",
  className = "input-warm",
  id,
  ariaLabel,
}: BankSelectProps) {
  const known = findIsraeliBank(value);
  // "Other" mode sticks once chosen so the text field does not vanish while
  // the user is still typing (an empty value would otherwise look unselected).
  const [otherMode, setOtherMode] = useState(() => Boolean(value) && !known);
  const showOther = otherMode || (Boolean(value) && !known);
  const selectValue = showOther ? OTHER : known ? known.name : "";

  return (
    <div className="flex flex-col gap-2">
      <select
        id={id}
        aria-label={ariaLabel}
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER) {
            setOtherMode(true);
            onChange("");
            return;
          }
          setOtherMode(false);
          onChange(next);
        }}
        className={className}
      >
        <option value="">בחר בנק</option>
        {ISRAELI_BANKS.map((b) => (
          <option key={b.code} value={b.name}>
            {b.name}
          </option>
        ))}
        <option value={OTHER}>אחר (בנק שלא ברשימה)</option>
      </select>
      {showOther && (
        <input
          type="text"
          autoFocus={otherMode && !value}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          className={className}
          aria-label="שם הבנק"
        />
      )}
    </div>
  );
}
