"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarRange, CheckCircle2, ChevronDown, ChevronLeft, FileMinus, MessageCircle } from "lucide-react";
import { IsraeliDateInput } from "@/components/israeli-date-input";
import { BusinessNumberHintText } from "@/components/business-number-hint";
import { updateExpenseFilingFields } from "@/lib/expense-store";
import { updateDocumentClientTaxId } from "@/lib/document-store";
import { saveBusinessTaxId } from "@/lib/business-store";
import { BUSINESS_NUMBER_MARKS, normalizeBusinessNumber } from "@/lib/israeli-id";
import { filingBusinessNumberSave } from "@/lib/business-number-hint";
import { IDENTIFIED_SALE_THRESHOLD, referenceDigits, validPcnDate } from "@/lib/ita/pcn874";
import { formatCurrencyWhole } from "@/lib/format";
import { withReturn } from "@/lib/return-to";
import { filingDataFixMessage, supportWhatsappHref } from "@/lib/support-link";
import type { FilingFixItem, FilingFixModel, FixControl } from "@/lib/filing-fix-items";

type Prepared = { ok: true; value: string } | { ok: false; message: string };

/** The RAW field value is judged (never digit-stripped first); a valid number is saved in its 9-digit form. */
const israeliNumber = (raw: string): Prepared => {
  const result = filingBusinessNumberSave(raw);
  return result.ok ? { ok: true, value: result.value ?? "" } : result;
};

/** A customer number may also be cleared (a passport or foreign id): the store writes null. */
const customerNumber = (raw: string): Prepared => {
  const result = filingBusinessNumberSave(raw, { allowEmpty: true });
  return result.ok ? { ok: true, value: result.value ?? "" } : result;
};

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
  /** Called with +1 when an inline save starts and -1 when it ends, so the report holds the download meanwhile. */
  onSaveInFlight?: (delta: 1 | -1) => void;
  /**
   * Called after an inline save lands. Reports whose check runs on the server
   * (the uniform export) re-check here; client-side reports refresh from the
   * store events and leave it out.
   */
  onSaved?: () => void;
}

interface Props extends Context {
  model: FilingFixModel;
  /**
   * An advisory report (the invoices-period listing) never blocks its
   * download: "action" items are findings that change its totals, and the
   * headline says so instead of "ready".
   */
  advisory?: boolean;
}

/** The single "what's left" panel shared by the filing reports. */
export function FilingFixPanel({ model, advisory = false, ...context }: Props) {
  const [notesOpen, setNotesOpen] = useState(false);
  const count = model.blocking.length;
  const affecting = advisory ? model.actions.length : 0;
  const headline = model.periodOnly
    ? "את הקובץ המפורט מורידים לתקופת דיווח"
    : count === 1
      ? "נשאר דבר אחד לפני ההורדה"
      : count > 1
        ? `נשארו ${count} דברים לפני ההורדה`
        : affecting === 1
          ? "דבר אחד משפיע על הסכומים בדוח"
          : affecting > 1
            ? `${affecting} דברים משפיעים על הסכומים בדוח`
            : "הכל מוכן";
  const tone = model.periodOnly ? "text-stone-800" : count ? "text-rose-800" : affecting ? "text-amber-800" : "text-emerald-800";
  const Icon = model.periodOnly ? CalendarRange : count || affecting ? AlertCircle : CheckCircle2;
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
    <li data-fix-code={item.code} data-fix-tier={item.tier} className={`rounded-xl border p-3 text-sm ${style}`}>
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
      {item.members && item.members.length > 0 && <GroupMembers members={item.members} context={context} />}
    </li>
  );
}

/** The individual notes behind a counted group, each with its own link or inline field. */
function GroupMembers({ members, context }: { members: FilingFixItem[]; context: Context }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        data-fix-members
        onClick={() => setOpen((value) => !value)}
        className="no-print inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-semibold bg-white border border-stone-300 text-stone-800 hover:bg-stone-50"
      >
        {open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronLeft className="w-4 h-4" aria-hidden="true" />}
        {open ? "הסתר את הפירוט" : `הצג את כל ה-${members.length}`}
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {members.map((member) => <FixItemCard key={member.key} item={member} context={context} />)}
        </ul>
      )}
    </div>
  );
}

function FixControlView({ control, context }: { control: FixControl; context: Context }) {
  const { businessId, returnTo, onUseFilingPeriod, onSaveInFlight, onSaved } = context;
  switch (control.kind) {
    case "supplier_tax_id":
      return (
        <InlineSave
          onSaveInFlight={onSaveInFlight}
          label="מספר עוסק של הספק"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showLeadingZeroHint
          prepare={israeliNumber}
          onSave={(value) => updateExpenseFilingFields(control.expenseIds, { supplierTaxId: value })}
          onSaved={onSaved}
        />
      );
    case "supplier_reference":
      return (
        <InlineSave
          onSaveInFlight={onSaveInFlight}
          label="מספר חשבונית הספק"
          initial={control.current}
          placeholder="1042"
          prepare={(raw) => {
            const value = raw.trim();
            const ref = referenceDigits(value);
            return ref && ref.length <= 9 && Number(ref) > 0 ? { ok: true, value } : { ok: false, message: "מספר החשבונית צריך לכלול מספר של עד 9 ספרות." };
          }}
          onSave={(value) => updateExpenseFilingFields([control.expenseId], { reference: value })}
          onSaved={onSaved}
        />
      );
    case "expense_allocation":
      return (
        <InlineSave
          onSaveInFlight={onSaveInFlight}
          label="מספר הקצאה"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          prepare={(raw) => {
            const value = raw.replace(BUSINESS_NUMBER_MARKS, "");
            return /^\d{9}$/.test(value) && !/^0+$/.test(value) ? { ok: true, value } : { ok: false, message: "מספר הקצאה הוא 9 ספרות בדיוק." };
          }}
          onSave={(value) => updateExpenseFilingFields([control.expenseId], { allocationNumber: value })}
          onSaved={onSaved}
        />
      );
    case "expense_date":
      return <DateSave initial={control.current} onSaveInFlight={onSaveInFlight} onSave={(value) => updateExpenseFilingFields([control.expenseId], { date: value })} onSaved={onSaved} />;
    case "business_tax_id":
      return (
        <InlineSave
          onSaveInFlight={onSaveInFlight}
          label="מספר העוסק של העסק"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showLeadingZeroHint
          prepare={israeliNumber}
          onSave={(value) => saveBusinessTaxId(businessId, value)}
          onSaved={onSaved}
        />
      );
    case "customer_tax_id":
      return (
        <InlineSave
          onSaveInFlight={onSaveInFlight}
          label="מספר עוסק של הלקוח"
          initial={control.current}
          placeholder="123456789"
          inputMode="numeric"
          showLeadingZeroHint
          prepare={customerNumber}
          clearable={{
            label: "נקה את המספר",
            note: `בלי מספר, מכירה של פחות מ-${formatCurrencyWhole(IDENTIFIED_SALE_THRESHOLD)} לפני מע״מ מדווחת כעסקה ללקוח לא מזוהה.`,
          }}
          onSave={(value) => updateDocumentClientTaxId(control.documentId, value)}
          onSaved={onSaved}
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
          href={supportWhatsappHref(filingDataFixMessage(control.documentId, control.code, control.report))}
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
    case "open_client":
      return <Link href={withReturn(`/clients/${control.clientId}`, returnTo)} className={LINK_BUTTON}>פתח את הלקוח</Link>;
    case "settings":
      return <Link href={withReturn("/settings", returnTo)} className={LINK_BUTTON}>פתח את ההגדרות</Link>;
    case "none":
      return null;
  }
}

function useInlineSave(onSaveInFlight?: (delta: 1 | -1) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(task: () => Promise<void>) {
    setSaving(true);
    setError(null);
    onSaveInFlight?.(1);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה. נסו שוב.");
    } finally {
      setSaving(false);
      onSaveInFlight?.(-1);
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
  prepare,
  clearable,
  onSaveInFlight,
  onSave,
  onSaved,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  inputMode?: "text" | "numeric";
  /** Only the "missing a leading zero" line: a foreign number cannot be filed, so the save check speaks for the rest. */
  showLeadingZeroHint?: boolean;
  /** Judges the raw field value: the value to save, or the specific reason it is refused. */
  prepare: (raw: string) => Prepared;
  /** A secondary "clear" action, offered only while the record still holds a number. */
  clearable?: { label: string; note: string };
  onSaveInFlight?: (delta: 1 | -1) => void;
  onSave: (value: string) => Promise<void>;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const { saving, error, setError, run } = useInlineSave(onSaveInFlight);
  function save() {
    const next = prepare(value);
    if (!next.ok) {
      setError(next.message);
      return;
    }
    void run(async () => {
      await onSave(next.value);
      onSaved?.();
    });
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
      {clearable && initial.trim() !== "" && (
        <div className="mt-2">
          <button
            type="button"
            data-fix-clear
            disabled={saving}
            onClick={() => {
              setValue("");
              void run(async () => {
                await onSave("");
                onSaved?.();
              });
            }}
            className="no-print inline-flex items-center min-h-[44px] px-3 rounded-xl text-sm font-semibold text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-50"
          >
            {clearable.label}
          </button>
          <p className="mt-1 text-xs leading-relaxed text-stone-700">{clearable.note}</p>
        </div>
      )}
    </div>
  );
}

function DateSave({ initial, onSave, onSaveInFlight, onSaved }: { initial: string; onSave: (value: string) => Promise<void>; onSaveInFlight?: (delta: 1 | -1) => void; onSaved?: () => void }) {
  const [value, setValue] = useState(validPcnDate(initial) ? initial : "");
  const { saving, error, setError, run } = useInlineSave(onSaveInFlight);
  function save() {
    if (!validPcnDate(value)) {
      setError("הזן תאריך מלא ותקין.");
      return;
    }
    void run(async () => {
      await onSave(value);
      onSaved?.();
    });
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
