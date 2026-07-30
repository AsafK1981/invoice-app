"use client";

import { useState } from "react";
import { ShieldCheck, Landmark, ExternalLink, Pencil, X, Loader2, ChevronDown } from "lucide-react";
import { setAllocationNumber } from "@/lib/document-store";
import { requiresAllocationNumber, allocationThresholdSentence } from "@/lib/tax-authority";
import { AllocationSteps } from "@/components/allocation-steps";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { InvoiceDocument } from "@/lib/types";

interface Props {
  doc: InvoiceDocument;
  /** Buyer's business/VAT number, resolved by the page (doc's own client_tax_id
   *  or the linked client's tax_id). Absent/empty ⇒ private customer (B2C),
   *  which never needs an allocation number. */
  customerTaxId?: string;
}

const GOV_PORTAL_URL = "https://www.gov.il/he/pages/invoices-israel";

/**
 * Surfaces מספר הקצאה (Tax Authority allocation number) status on the doc
 * detail page. Visible only for tax invoices and credit notes; the user is
 * עוסק פטור so this is invisible for them today, but it's wired up so
 * עוסק מורשה customers (or this user post-upgrade) get it for free.
 *
 * Three states:
 *   1. Doc doesn't need an allocation number (under threshold), section
 *      is hidden entirely.
 *   2. Required and not yet set: the calm "next step" card, step 2 of the
 *      shared 3-step story, with ONE primary button that asks the Tax
 *      Authority for the number. Typing a number received elsewhere is
 *      folded away behind a disclosure so it doesn't compete with it.
 *   3. Set: green "received" card with the number + when it was entered
 *      + a small edit button to replace it.
 *
 * Deliberately NOT an alarming red panic card: needing a number is the normal,
 * expected next step of issuing a tax invoice, not an error the user caused.
 */
export function AllocationNumberSection({ doc, customerTaxId }: Props) {
  // All hooks must run unconditionally; early return MUST come after.
  // Same trap that produced the React #310 bug yesterday.
  const [editing, setEditing] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [value, setValue] = useState(doc.allocationNumber || "");
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const isTaxDoc =
    doc.type === "tax_invoice" ||
    doc.type === "tax_invoice_receipt" ||
    doc.type === "credit_note";
  // Private customers (no business/VAT number) are never gated; the section
  // stays hidden for B2C tax invoices regardless of amount.
  const required = requiresAllocationNumber(doc, customerTaxId ?? doc.clientTaxId);
  if (!isTaxDoc || !required) return null;

  // Use the date-aware threshold (honours the mid-2026 drop to ₪5,000) so the
  // displayed number matches what requiresAllocationNumber() actually gates on.
  // Otherwise a ₪7,000 June-2026 doc would claim a ₪10,000 threshold.
  const thresholdSentence = allocationThresholdSentence(
    doc.date ? new Date(doc.date) : new Date(),
  );
  const hasNumber = Boolean(doc.allocationNumber);

  // Tries our /api/tax-authority/request-allocation endpoint, which
  // hits gov.il using the business's stored OAuth tokens. On success
  // the server has already persisted the number on the document,
  // we update local UI so the user doesn't need to refresh.
  async function handleAutoFetch() {
    setFetching(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/tax-authority/request-allocation", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId: doc.id }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "שגיאה בקבלת מספר הקצאה");
        return;
      }
      // The server saved it on the doc; mirror locally so the UI flips
      // to "received" without a full reload.
      await setAllocationNumber(doc.id, data.allocationNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("יש להזין מספר הקצאה");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setAllocationNumber(doc.id, trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    // If the doc has already been emailed to the client, the allocation
    // is part of what was delivered; clearing it leaves the recipient
    // with a doc that cites a number we no longer have on record.
    // Require explicit confirmation in that case.
    if (doc.emailedAt) {
      const ok = await confirm({
        title: "המסמך כבר נשלח ללקוח",
        message:
          "המסמך כבר נשלח ללקוח עם מספר ההקצאה הזה. ניקוי המספר אינו מבטל את החשבונית. אם זו טעות, צור חשבונית זיכוי במקום. להמשיך בכל זאת?",
        tone: "danger",
        confirmLabel: "נקה בכל זאת",
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      await setAllocationNumber(doc.id, null);
      setValue("");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  // STATE 3: Already set
  if (hasNumber && !editing) {
    return (
      <div className="no-print card-soft p-4 max-w-[210mm] mx-auto bg-emerald-50/40 border-emerald-200">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <p className="text-sm font-bold text-stone-900">מספר ההקצאה התקבל ✓</p>
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 min-h-[40px] px-1 text-xs font-semibold text-stone-600 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-lg"
              >
                <Pencil className="w-3 h-3" />
                ערוך
              </button>
            </div>
            <p className="text-xs text-stone-700 mt-0.5">
              המספר מודפס על המסמך. אפשר לשלוח אותו ללקוח.
            </p>
            <p className="mt-1 text-base font-mono font-bold text-stone-900" dir="ltr">
              {doc.allocationNumber}
            </p>
            {doc.allocationSetAt && (
              <p className="mt-1 text-xs text-stone-600">
                נשמר{" "}
                {new Date(doc.allocationSetAt).toLocaleString("he-IL", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Typing a number the user already received elsewhere. Shared by the
  // disclosure inside the "next step" card and by the edit-existing state.
  const manualForm = (
    <>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="הקלד כאן את מספר ההקצאה"
          aria-label="מספר הקצאה"
          className="flex-1 px-3 min-h-[44px] rounded-xl border border-stone-300 bg-white text-sm font-mono focus:border-[color:var(--inputfocusline)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--goldline)]"
          dir="ltr"
          disabled={saving}
          inputMode="numeric"
          autoComplete="off"
        />
        <button
          onClick={handleSave}
          disabled={saving || value.trim().length === 0}
          className="pgbtn-primary inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "שומר..." : "שמור את המספר"}
        </button>
        {hasNumber && (
          <button
            onClick={() => {
              setEditing(false);
              setValue(doc.allocationNumber || "");
              setError(null);
            }}
            className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3 rounded-xl text-sm font-medium text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
          >
            <X className="w-4 h-4" />
            ביטול
          </button>
        )}
      </div>
      <a
        href={GOV_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-amber-800 hover:text-[color:var(--ink)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--goldline)] rounded-lg"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        לאתר חשבונית ישראל של רשות המסים
      </a>
      {hasNumber && (
        <button
          onClick={handleClear}
          disabled={saving}
          className="mt-1 block text-xs text-stone-500 hover:text-rose-700 underline min-h-[40px]"
        >
          נקה את המספר השמור
        </button>
      )}
    </>
  );

  const errorNote = error && (
    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3" dir="rtl">
      <p className="text-xs text-rose-800 font-semibold break-words">
        לא הצלחנו לקבל את המספר: {error}
      </p>
      <p className="text-xs text-rose-700 mt-1 leading-relaxed">
        אפשר לנסות שוב עוד רגע. אם זה חוזר, קבל את המספר באתר חשבונית ישראל והקלד אותו כאן.
      </p>
    </div>
  );

  // STATE 2b: replacing a number that is already saved. Just the form, no pitch.
  if (hasNumber) {
    return (
      <div className="no-print card-soft p-4 max-w-[210mm] mx-auto">
        <p className="text-sm font-bold text-stone-900 mb-2">עריכת מספר ההקצאה</p>
        {manualForm}
        {errorNote}
      </div>
    );
  }

  // STATE 2: required, not yet received. The next step of a normal flow, not an
  // error: calm gold (the app's one palette), one primary button, and the same
  // 3-step story the editor showed before saving.
  return (
    // card-soft sets `background` and `border` as shorthands, so tint/border
    // utilities on this element would be dead CSS; the gold accent comes from
    // the inset ring + the medallion instead.
    <div className="no-print card-soft p-4 sm:p-5 max-w-[210mm] mx-auto ring-1 ring-inset ring-[color:var(--goldtintline)]">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Landmark className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold tracking-wide text-amber-700">השלב הבא</p>
          <p className="text-[15px] font-extrabold text-stone-900 leading-tight mt-0.5">
            קבל מספר הקצאה מרשות המסים
          </p>
          <p className="text-xs text-stone-700 mt-1.5 leading-relaxed">
            המסמך נשמר. {thresholdSentence} לוחצים על הכפתור, ורשות המסים שולחת את המספר תוך
            שניות והוא נשמר על המסמך. עד שהמספר מתקבל אי אפשר לשלוח את המסמך ללקוח.
          </p>
        </div>
      </div>

      <AllocationSteps current={2} className="mt-3.5" />

      {/* One primary action: ask the Tax Authority for the number now. Uses
          /api/tax-authority/request-allocation with the business's stored
          credentials; if the business never connected, the failure shows up
          right here and the manual route below stays open.

          It wears `.pgbtn-primary` - the app's ONE filled-button treatment,
          the same class מסמך חדש wears on /documents - rather than its own copy
          of the gold gradient, so this reads as a primary action in exactly the
          visual language the user already knows. The class carries only the
          paint (background / ink / border-colour / shadow, plus the hover), so
          the size, radius and type below are still this button's own.

          NO `focus-visible:ring-*` here, deliberately: a Tailwind ring IS a
          box-shadow, and `.pgbtn-primary`'s own (unlayered) box-shadow would
          overwrite it, leaving a focus style that is in the markup and not on
          the screen. The app's global gold `:focus-visible` OUTLINE (globals.css
          + app-skin's `outline-color: var(--g3)`) is what rings this button -
          the same ring מסמך חדש gets, for the same reason. */}
      <button
        onClick={handleAutoFetch}
        disabled={fetching || saving}
        className="pgbtn-primary mt-3.5 w-full inline-flex items-center justify-center gap-2 min-h-[52px] rounded-2xl text-[15px] font-bold transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {fetching ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            מבקש את המספר מרשות המסים...
          </>
        ) : (
          <>
            <ShieldCheck className="w-[18px] h-[18px]" />
            קבל מספר הקצאה מרשות המסים
          </>
        )}
      </button>

      {errorNote}

      <div className="mt-3 pt-3 border-t border-orange-100">
        <button
          type="button"
          onClick={() => setManualOpen((s) => !s)}
          aria-expanded={manualOpen}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-xs font-semibold text-stone-700 hover:text-[color:var(--gold-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--goldline)] rounded-lg"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform ${manualOpen ? "rotate-180" : ""}`}
          />
          כבר קיבלתי מספר הקצאה, אקליד אותו בעצמי
        </button>
        {manualOpen && <div className="mt-2">{manualForm}</div>}
      </div>
    </div>
  );
}
