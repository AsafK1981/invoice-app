"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { CalendarDays } from "lucide-react";
import { HEBREW_MONTHS, parseIsraeliDate, todayInIsrael } from "@/lib/date";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> & { value: string };
const displayDate = (iso: string) => iso ? iso.split("-").reverse().join(".") : "";

/** Button-driven editors must enforce field validity before persisting. */
export function reportInvalidIsraeliDate(scope: ParentNode = document): boolean {
  const invalid = scope.querySelector<HTMLInputElement>('input[data-israeli-date]:invalid');
  if (!invalid) return false;
  invalid.scrollIntoView({ block: "center", behavior: "instant" });
  invalid.focus({ preventScroll: true });
  invalid.reportValidity();
  // Native validation may scroll again after opening its message bubble.
  requestAnimationFrame(() => invalid.scrollIntoView({ block: "center", behavior: "instant" }));
  return true;
}

/** Israeli text presentation with the platform calendar retained for selection. */
export function IsraeliDateInput({ value, onChange, min, max, className, onBlur, ...props }: Props) {
  const [draft, setDraft] = useState(displayDate(value));
  const [error, setError] = useState("");
  const lastEmitted = useRef(value);
  const previousProps = useRef({ value, min, max });
  const picker = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  function validationMessage(iso: string | null): string {
    return iso === null ? "יש להזין תאריך תקין בסדר יום.חודש.שנה" :
      iso && min && iso < String(min) ? `יש לבחור תאריך החל מ-${displayDate(String(min))}` :
      iso && max && iso > String(max) ? `יש לבחור תאריך עד ${displayDate(String(max))}` : "";
  }
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setDraft(displayDate(value));
      setError("");
      textInput.current?.setCustomValidity("");
      lastEmitted.current = value;
    }
  }, [value]);

  useEffect(() => {
    const message = validationMessage(draft ? parseIsraeliDate(draft) : "");
    setError(message);
    textInput.current?.setCustomValidity(message);
  }, [draft, min, max]);

  useEffect(() => {
    const previous = previousProps.current;
    previousProps.current = { value, min, max };
    const boundsChanged = min !== previous.min || max !== previous.max;
    const iso = draft ? parseIsraeliDate(draft) : "";
    // A retained draft can become valid when the other range endpoint moves.
    // Commit it as well as clearing its error so the displayed and applied dates agree.
    if (boundsChanged && value === previous.value && iso !== null && !validationMessage(iso) && iso !== value && textInput.current) {
      const input = textInput.current;
      emit(iso, { target: input, currentTarget: input } as ChangeEvent<HTMLInputElement>);
    }
  }, [value, min, max, draft]);

  function emit(iso: string, event: ChangeEvent<HTMLInputElement>) {
    lastEmitted.current = iso;
    onChange?.({ ...event, target: { ...event.target, value: iso }, currentTarget: { ...event.currentTarget, value: iso } });
  }

  function change(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    setDraft(raw);
    const iso = raw ? parseIsraeliDate(raw) : "";
    const message = validationMessage(iso);
    setError(message);
    event.target.setCustomValidity(message);
    emit(message ? "" : iso || "", event);
  }

  return (
    <span className="relative inline-flex min-w-0 max-w-full flex-col" style={{ width: props.style?.width ?? (className?.includes("w-auto") ? "10rem" : "100%"), flexShrink: 1 }}>
      <span className="relative block min-w-0">
        <input {...props} ref={textInput} type="text" data-israeli-date value={draft} onChange={change}
          onBlur={(event) => { const iso = parseIsraeliDate(draft); if (iso && !error) setDraft(displayDate(iso)); onBlur?.(event); }}
          dir="ltr" inputMode="numeric" placeholder="DD.MM.YYYY" autoComplete="off"
          className={className} style={{ ...props.style, width: "100%", paddingLeft: "2.5rem" }}
          aria-invalid={!!error || undefined} aria-describedby={[props["aria-describedby"], error ? errorId : ""].filter(Boolean).join(" ") || undefined} />
        <button type="button" disabled={props.disabled || props.readOnly} aria-label="בחירת תאריך בלוח השנה"
          className="absolute left-0 top-0 bottom-0 flex w-10 items-center justify-center rounded-lg text-stone-500 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:opacity-40"
          onClick={() => { try { picker.current?.showPicker(); } catch { picker.current?.focus(); picker.current?.click(); } }}>
          <CalendarDays className="h-4 w-4" />
        </button>
        <input ref={picker} type="date" lang="he-IL" tabIndex={-1} aria-hidden="true" value={value} min={min} max={max}
          className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0" disabled={props.disabled || props.readOnly}
          onChange={(event) => { const message = validationMessage(event.target.value); setDraft(displayDate(event.target.value)); setError(message); textInput.current?.setCustomValidity(message); emit(message ? "" : event.target.value, event); }} />
      </span>
      {error && <span id={errorId} role="status" className="mt-1 text-xs text-red-700" dir="rtl">{error}</span>}
    </span>
  );
}

/** One familiar select with deterministic Hebrew month labels. */
export function IsraeliMonthInput({ value, onChange, className }: { value: string; onChange: (value: string) => void; className?: string }) {
  const year = Number(value.slice(0, 4)) || Number(todayInIsrael().slice(0, 4));
  return <select value={value} onChange={(event) => onChange(event.target.value)} className={className} dir="rtl">
    {Array.from({ length: 21 }, (_, i) => year - 10 + i).flatMap((y) => HEBREW_MONTHS.map((month, m) => {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}`;
      return <option key={iso} value={iso}>{month} {y}</option>;
    }))}
  </select>;
}
