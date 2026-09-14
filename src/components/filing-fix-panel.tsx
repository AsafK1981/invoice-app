"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarRange, CheckCircle2, ChevronDown, ChevronLeft, FileMinus, MessageCircle } from "lucide-react";
import { IsraeliDateInput } from "@/components/israeli-date-input";
import { BusinessNumberHintText } from "@/components/business-number-hint";
import { updateExpenseFilingFields } from "@/lib/expense-store";
import { updateDocumentClientTaxId } from "@/lib/document-store";
import { saveBusinessTaxId } from "@/lib/business-store";
import { normalizeBusinessNumber } from "@/lib/israeli-id";
import { referenceDigits, validPcnDate } from "@/lib/ita/pcn874";
import { formatCurrencyWhole } from "@/lib/format";
import { withReturn } from "@/lib/return-to";
import { filingDataFixMessage, supportWhatsappHref } from "@/lib/support-link";
import type { FilingFixItem, FilingFixModel, FixControl } from "@/lib/filing-fix-items";

const MARKS = /[\s.\-\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const onlyDigits = (value: string) => value.replace(/\D/g, "");
const israeliNumberProblem = (value: string) =>
  normalizeBusinessNumber(value).value ? null : "זה לא מספר עוסק ישראלי תקין. בדוק מול החשבונית.";

/** A valid Israeli number typed without its leading zero: the one hint worth showing next to a strict save. */
const isShortValidNumber = (value: string) => {
  const n = normalizeBusinessNumber(value);
  return n.reason === "ok" && n.digitCount < 9;
};

const LINK_BUTTON =
  "no-print inline-flex items-center gap-1.5 mt-2 min-h-[44px] px-3 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50";

interface Context {
  businessId: string;
  /** Where Layer 4 and "open" links come back to (same report, same period). */
  returnTo: string;
  /** Switches the report to the last ended bi-monthly period. */
  onUseFilingPeriod?: () => void;
}

interface Props extends Context {
  model: FilingFixModel;
}

/** The single "what's left before the download" panel on /reports/vat. */
export function FilingFixPanel({ model, ...context }: Props) {
  const [notesOpen, setNotesOpen] = useState(false);
  const count = model.blocking.length;
  const headline = model.periodOnly
    ? "את הקובץ המפורט מורידים לתקופת דיווח"
    : count === 0
      ? "הכל מוכן"
      : count === 1
        ? "נשאר דבר אחד לפני ההורדה"
        : `נשארו ${count} דברים לפני ההורדה`;
  const tone = model.periodOnly ? "text-stone-800" : count ? "text-rose-800" : "text-emerald-800";
  const Icon = model.periodOnly ? CalendarRange : count ? AlertCircle : CheckCircle2;
  return (
    <div data-testid="filing-fix-panel" className="mt-3 space-y-3">
      <p role="status" className={`flex items-center gap-2 text-base font-bold ${tone}`}>
        <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
        {headline}
      </p>
      {count > 0 && (
        <ul className="space-y-2">
          {model.blocking.map((item) => <FixItemCard key={item.key} item={item} context={context} />)}
        </ul>
      )}
      {model.actions.length > 0 && (
        <ul className="space-y-2">
          {model.actions.map((item) => <FixItemCard key={item.key} item={item} context={context} />)}
        </ul>
      )}
      {model.notes.length > 0 && (
        <div className="rounded-xl border border-stone-200 bg-white">
          <button
            type="button"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((open) => !open)}
            className="no-print w-full flex items-center justify-between gap-2 min-h-[44px] px-3 rounded-xl text-sm font-semibold text-stone-800 hover:bg-stone-50"
          >
            <span>כדאי לבדוק ({model.notes.length})</span>
            {notesOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronLeft className="w-4 h-4" aria-hidden="true" />}
          </button>
          {notesOpen && (
            <ul className="px-3 pb-3 space-y-2">
              {model.notes.map((item) => <FixItemCard key={item.key} item={item} context={context} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const TIER_STYLE: Record<FilingFixItem["tier"], string> = {
  blocking: "bg-rose-50 border-rose-200 text-rose-950",
  action: "bg-amber-50 border-amber-300 text-amber-950",
  note: "bg-stone-50 border-stone-200 text-stone-900",
};

function FixItemCard({ item, context }: { item: FilingFixItem; context: Context }) {
  const title =
    item.excludedVat != null
      ? `מע״מ תשומות של ${formatCurrencyWhole(item.excludedVat)} לא נכלל בדוח כי לחשבונית אין מספר הקצאה`
      : item.title;
  // A period that is not a filing period is a choice, not a mistake: calm styling.
  const style = item.control.kind === "period" ? "bg-sky-50 border-sky-200 text-sky-950" : TIER_STYLE[item.tier];
  return (
    <li data-fix-code={item.code} className={`rounded-xl border p-3 text-sm ${style}`}>
      <p className="font-semibold leading-relaxed">{title}</p>
      {item.labels.length > 0 && <p className="mt-0.5 text-xs text-stone-700">{item.labels.join(" · ")}</p>}
      {item.tier === "action" && item.excludedVat != null && (
        <p className="mt-1 text-xs leading-relaxed text-stone-700">לא חוסם את ההורדה. הוסף את מספר ההקצאה כדי שהמע״מ ייכלל בדוח.</p>
      )}
      {/* Merged findings usually say the same thing twice; the first message is the specific one. */}
      {item.excludedVat == null && item.messages[0] && (
        <p className="mt-1 text-xs leading-relaxed text-stone-700">{item.messages[0]}</p>
      )}
      <FixControlView control={item.control} context={context} />
    </li>
  );
}

function FixControlView({ control, context }: { control: FixControl; context: Context }) {
  const { businessId, returnTo, onUseFilingPeriod } = context;
  switch (control.kind) {
    case "supplier_tax_id":
      return (
        <InlineSave
          label="מספר עוסק של הספק"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showLeadingZeroHint
          normalize={onlyDigits}
          validate={israeliNumberProblem}
          onSave={(value) => updateExpenseFilingFields(control.expenseIds, { supplierTaxId: value })}
        />
      );
    case "supplier_reference":
      return (
        <InlineSave
          label="מספר חשבונית הספק"
          initial={control.current}
          placeholder="1042"
          validate={(value) => {
            const ref = referenceDigits(value);
            return ref && ref.length <= 9 && Number(ref) > 0 ? null : "מספר החשבונית צריך לכלול מספר של עד 9 ספרות.";
          }}
          onSave={(value) => updateExpenseFilingFields([control.expenseId], { reference: value })}
        />
      );
    case "expense_allocation":
      return (
        <InlineSave
          label="מספר הקצאה"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          normalize={(value) => value.replace(MARKS, "")}
          validate={(value) => (/^\d{9}$/.test(value) && !/^0+$/.test(value) ? null : "מספר הקצאה הוא 9 ספרות בדיוק.")}
          onSave={(value) => updateExpenseFilingFields([control.expenseId], { allocationNumber: value })}
        />
      );
    case "expense_date":
      return <DateSave initial={control.current} onSave={(value) => updateExpenseFilingFields([control.expenseId], { date: value })} />;
    case "business_tax_id":
      return (
        <InlineSave
          label="מספר העוסק של העסק"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showLeadingZeroHint
          normalize={onlyDigits}
          validate={israeliNumberProblem}
          onSave={(value) => saveBusinessTaxId(businessId, value)}
        />
      );
    case "customer_tax_id":
      return (
        <InlineSave
          label="מספר עוסק של הלקוח"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showLeadingZeroHint
          normalize={onlyDigits}
          validate={israeliNumberProblem}
          onSave={(value) => updateDocumentClientTaxId(control.documentId, value)}
        />
      );
    case "credit_note":
      return (
        <Link href={withReturn("/documents/new/credit-note", returnTo, { from: control.documentId })} className={LINK_BUTTON}>
          <FileMinus className="w-4 h-4" aria-hidden="true" />
          הפק זיכוי ומסמך מתוקן
        </Link>
      );
    case "support":
      return (
        <a
          href={supportWhatsappHref(filingDataFixMessage(control.documentId, control.code))}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_BUTTON}
        >
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
          שלח לתמיכה לתיקון הנתונים
        </a>
      );
    case "period":
      return onUseFilingPeriod ? (
        <button type="button" data-fix-period onClick={onUseFilingPeriod} className={LINK_BUTTON}>
          <CalendarRange className="w-4 h-4" aria-hidden="true" />
          עבור לתקופה הדו-חודשית האחרונה שהסתיימה
        </button>
      ) : null;
    case "open_expense":
      return <Link href={withReturn("/expenses", returnTo, { edit: control.expenseId })} className={LINK_BUTTON}>פתח את ההוצאה</Link>;
    case "open_document":
      return <Link href={withReturn(`/documents/${control.documentId}`, returnTo)} className={LINK_BUTTON}>פתח את המסמך</Link>;
    case "settings":
      return <Link href={withReturn("/settings", returnTo)} className={LINK_BUTTON}>פתח את ההגדרות</Link>;
    case "none":
      return null;
  }
}

function useInlineSave() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(task: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה. נסו שוב.");
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, setError, run };
}

function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-fix-save
      onClick={onClick}
      disabled={saving}
      className="no-print shrink-0 inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 hover:shadow-md disabled:opacity-50"
    >
      {saving ? "שומר..." : "שמור"}
    </button>
  );
}

function InlineSave({
  label,
  initial,
  placeholder,
  inputMode = "text",
  showLeadingZeroHint = false,
  normalize = (value: string) => value.trim(),
  validate,
  onSave,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  inputMode?: "text" | "numeric";
  /** Only the "missing a leading zero" line: a foreign number cannot be filed, so the save check speaks for the rest. */
  showLeadingZeroHint?: boolean;
  normalize?: (value: string) => string;
  validate: (value: string) => string | null;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const { saving, error, setError, run } = useInlineSave();
  function save() {
    const next = normalize(value);
    const problem = validate(next);
    if (problem) {
      setError(problem);
      return;
    }
    void run(() => onSave(next));
  }
  return (
    <div className="no-print mt-2">
      <div className="flex items-center gap-2">
        {/* .input-warm is full width; the wrapper keeps the field and its save button on one line. */}
        <div className="w-full max-w-[16rem]">
          <input
            aria-label={label}
            dir="ltr"
            inputMode={inputMode}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            className="input-warm text-sm py-2 px-3"
          />
        </div>
        <SaveButton saving={saving} onClick={save} />
      </div>
      {showLeadingZeroHint && isShortValidNumber(value) && <BusinessNumberHintText value={value} digitsOnlyField />}
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">{error}</p>}
    </div>
  );
}

function DateSave({ initial, onSave }: { initial: string; onSave: (value: string) => Promise<void> }) {
  const [value, setValue] = useState(validPcnDate(initial) ? initial : "");
  const { saving, error, setError, run } = useInlineSave();
  function save() {
    if (!validPcnDate(value)) {
      setError("הזן תאריך מלא ותקין.");
      return;
    }
    void run(() => onSave(value));
  }
  return (
    <div className="no-print mt-2">
      <div className="flex items-center gap-2">
        <div className="w-full max-w-[12rem]">
          <IsraeliDateInput aria-label="תאריך ההוצאה" value={value} onChange={(e) => setValue(e.target.value)} className="input-warm text-sm py-2 px-3" />
        </div>
        <SaveButton saving={saving} onClick={save} />
      </div>
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
