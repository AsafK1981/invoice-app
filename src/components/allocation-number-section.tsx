"use client";

import { useState } from "react";
import { ShieldCheck, AlertTriangle, ExternalLink, Pencil, X, Sparkles, Loader2 } from "lucide-react";
import { setAllocationNumber } from "@/lib/document-store";
import { requiresAllocationNumber, getAllocationThresholdForYear } from "@/lib/tax-authority";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { InvoiceDocument } from "@/lib/types";

interface Props {
  doc: InvoiceDocument;
}

const GOV_PORTAL_URL = "https://invoices.gov.il";

/**
 * Surfaces מספר הקצאה (Tax Authority allocation number) status on the doc
 * detail page. Visible only for tax invoices and credit notes; the user is
 * עוסק פטור so this is invisible for them today, but it's wired up so
 * עוסק מורשה customers (or this user post-upgrade) get it for free.
 *
 * Three states:
 *   1. Doc doesn't need an allocation number (under threshold) — section
 *      is hidden entirely.
 *   2. Required and not yet set — red warning + input to paste the number
 *      after getting it from the gov portal.
 *   3. Set — green "received" card with the number + when it was entered
 *      + a small edit button to replace it.
 */
export function AllocationNumberSection({ doc }: Props) {
  // All hooks must run unconditionally — early return MUST come after.
  // Same trap that produced the React #310 bug yesterday.
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doc.allocationNumber || "");
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTaxDoc =
    doc.type === "tax_invoice" ||
    doc.type === "tax_invoice_receipt" ||
    doc.type === "credit_note";
  const required = requiresAllocationNumber(doc);
  if (!isTaxDoc || !required) return null;

  const docYear = parseInt(doc.date.slice(0, 4), 10) || new Date().getFullYear();
  const threshold = getAllocationThresholdForYear(docYear);
  const hasNumber = Boolean(doc.allocationNumber);

  // Tries our /api/tax-authority/request-allocation endpoint, which
  // hits gov.il using the business's stored OAuth tokens. On success
  // the server has already persisted the number on the document —
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
    // is part of what was delivered — clearing it leaves the recipient
    // with a doc that cites a number we no longer have on record.
    // Require explicit confirmation in that case.
    if (doc.emailedAt) {
      const ok = window.confirm(
        "המסמך כבר נשלח ללקוח עם מספר ההקצאה הזה. ניקוי המספר אינו מבטל את החשבונית — אם זו טעות, צור חשבונית זיכוי במקום. להמשיך בכל זאת?",
      );
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
              <p className="text-sm font-bold text-stone-900">מספר הקצאה התקבל ✓</p>
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-stone-600 hover:text-stone-900"
              >
                <Pencil className="w-3 h-3" />
                ערוך
              </button>
            </div>
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

  // STATE 2: Required, not yet set, OR editing
  return (
    <div className="no-print card-soft p-4 max-w-[210mm] mx-auto bg-rose-50/40 border-rose-200">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-rose-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-stone-900">
            נדרש מספר הקצאה (חשבונית ישראל)
          </p>
          <p className="text-xs text-stone-700 mt-1 leading-relaxed">
            המסמך הזה מעל סף החובה ל-{docYear} ({formatCurrency(threshold)}).{" "}
            הגש את המסמך בפורטל רשות המסים, קבל מספר הקצאה, והדבק אותו כאן.
            אסור לשלוח את המסמך ללקוח לפני שמספר ההקצאה משויך אליו.
          </p>

          {/* Auto-fetch via our /api/tax-authority/request-allocation — works
              if the business has connected to gov.il in /settings. Falls
              back gracefully (just shows an error in this card) if the
              connection isn't set up; the manual paste flow below stays
              available either way. */}
          <button
            onClick={handleAutoFetch}
            disabled={fetching || saving}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-gradient-to-l from-blue-500 to-indigo-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-blue-200/60 disabled:opacity-50"
          >
            {fetching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                שולח בקשה לרשות המיסים...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                קבל אוטומטית מרשות המיסים
              </>
            )}
          </button>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <p className="text-xs text-stone-600">או — הזן את המספר ידנית אם קיבלת אותו במקום אחר:</p>
            <a
              href={GOV_PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:text-rose-900 underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              פתח את חשבונית ישראל
            </a>
          </div>

          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="הדבק כאן את מספר ההקצאה"
              className="flex-1 px-3 py-2 rounded-xl border border-stone-300 bg-white focus:border-rose-400 focus:outline-none text-sm font-mono"
              dir="ltr"
              disabled={saving}
              inputMode="numeric"
              autoComplete="off"
            />
            <button
              onClick={handleSave}
              disabled={saving || value.trim().length === 0}
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-l from-emerald-500 to-teal-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "שומר..." : "שמור"}
            </button>
            {hasNumber && (
              <button
                onClick={() => {
                  setEditing(false);
                  setValue(doc.allocationNumber || "");
                  setError(null);
                }}
                className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
                ביטול
              </button>
            )}
          </div>
          {hasNumber && (
            <button
              onClick={handleClear}
              disabled={saving}
              className="mt-2 text-xs text-stone-500 hover:text-rose-700 underline"
            >
              נקה את המספר השמור
            </button>
          )}
          {error && (
            <p className="mt-2 text-xs text-rose-700 font-medium">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
