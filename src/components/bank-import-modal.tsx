"use client";

import { useMemo, useRef, useState } from "react";
import {
  Upload,
  AlertCircle,
  CheckCircle2,
  Banknote,
  ArrowRightLeft,
  CircleX,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { supabase } from "@/lib/supabase";
import { getBusinessId } from "@/lib/business-init";
import { createNotificationClient } from "@/lib/notifications-store";
import type { InvoiceDocument } from "@/lib/types";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { parseCsvFile } from "@/lib/import-decode";
import { parseAmount } from "@/lib/import-mapping";

interface Props {
  open: boolean;
  onClose: () => void;
  unpaidDocuments: InvoiceDocument[];
  onPaid: () => void;
}

interface ParsedTx {
  rowIndex: number;
  date: string;
  description: string;
  amount: number;
  reference?: string;
}

interface MatchRow {
  tx: ParsedTx;
  candidates: InvoiceDocument[];
  selectedDocId: string | null;
  /** Whether the user wants to confirm this row */
  confirmed: boolean;
}

/**
 * Israeli-bank-CSV column header heuristics. Each bank exports slightly
 * differently: Hapoalim, Discount, Leumi, Mizrahi, even credit-card
 * statements. We look for the most common Hebrew/English variants.
 */
function detectColumn(headers: string[], variants: RegExp[]): string | null {
  for (const h of headers) {
    for (const v of variants) {
      if (v.test(h.trim())) return h;
    }
  }
  return null;
}

const DATE_COLS = [/^תאריך\s*עסקה$/i, /^תאריך\s*ערך$/i, /^תאריך$/i, /^date$/i, /^value\s*date$/i];
const AMOUNT_COLS = [/^סכום\s*בש["״'״]*ח$/i, /^סכום$/i, /^amount$/i];
const CREDIT_COLS = [/^זכות$/i, /^credit$/i];
const DEBIT_COLS = [/^חובה$/i, /^debit$/i];
const DESC_COLS = [/^תיאור\s*פעולה$/i, /^פרטים$/i, /^תיאור$/i, /^description$/i, /^memo$/i];
const REF_COLS = [/^אסמכתא$/i, /^reference$/i, /^ref$/i, /^transaction\s*id$/i];

// Deliberately local, NOT the shared normalizeImportDate: bank/credit-card
// statements are historical, so a 2-digit year pivots >50 → 19xx (an old
// statement from '98), whereas the shared importer always assumes 20xx. Do not
// replace this with normalizeImportDate.
function parseDate(raw: string): string | null {
  const s = raw.trim();
  // ISO format already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const day = m[1].padStart(2, "0");
    const month = m[2].padStart(2, "0");
    let year = m[3];
    if (year.length === 2) year = (parseInt(year, 10) > 50 ? "19" : "20") + year;
    return `${year}-${month}-${day}`;
  }
  return null;
}

const TOLERANCE_AMOUNT = 1.0;
const TOLERANCE_DAYS = 60;

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.abs((da - db) / 86400000);
}

function findCandidates(tx: ParsedTx, unpaid: InvoiceDocument[]): InvoiceDocument[] {
  return unpaid
    .filter((d) => Math.abs(d.total - tx.amount) <= TOLERANCE_AMOUNT)
    .filter((d) => daysBetween(d.date, tx.date) <= TOLERANCE_DAYS)
    .sort((a, b) => {
      // Prefer closer date match
      const da = daysBetween(a.date, tx.date);
      const db = daysBetween(b.date, tx.date);
      return da - db;
    });
}

export function BankImportModal({ open, onClose, unpaidDocuments, onPaid }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  const reset = () => {
    setStep("upload");
    setMatches([]);
    setError(null);
    setImporting(false);
    setImportedCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (importing) return;
    reset();
    onClose();
  };

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    // Decode with encoding detection (cp1255 Israeli bank exports) before
    // parsing; a raw Papa.parse(file) would mojibake Hebrew column headers.
    let rows: Record<string, string>[];
    try {
      ({ rows } = await parseCsvFile(file));
    } catch (err) {
      setError("שגיאה בקריאת הקובץ: " + (err instanceof Error ? err.message : String(err)));
      return;
    }

    if (rows.length === 0) {
      setError("הקובץ ריק");
      return;
    }

    const headers = Object.keys(rows[0] || {});
    const dateCol = detectColumn(headers, DATE_COLS);
    const amountCol = detectColumn(headers, AMOUNT_COLS);
    const creditCol = detectColumn(headers, CREDIT_COLS);
    const debitCol = detectColumn(headers, DEBIT_COLS);
    const descCol = detectColumn(headers, DESC_COLS);
    const refCol = detectColumn(headers, REF_COLS);

    if (!dateCol) {
      setError(
        `לא זוהה עמודת תאריך. עמודות בקובץ: ${headers.join(", ")}. שמרו את הקובץ מהבנק כ-CSV עם כותרות סטנדרטיות.`,
      );
      return;
    }
    if (!amountCol && !creditCol) {
      setError(
        `לא זוהתה עמודת סכום. עמודות: ${headers.join(", ")}. צריך עמודה "סכום", "Amount" או "זכות".`,
      );
      return;
    }

    const parsed: ParsedTx[] = [];
    rows.forEach((row, idx) => {
      const dateStr = parseDate(row[dateCol] || "");
      if (!dateStr) return;

      let amount: number | null = null;
      if (creditCol && row[creditCol]) {
        amount = parseAmount(row[creditCol]);
      } else if (amountCol) {
        const raw = parseAmount(row[amountCol] || "");
        if (raw != null) {
          if (debitCol && row[debitCol] && (parseAmount(row[debitCol]) ?? 0) > 0) {
            return; // it's a debit row
          }
          amount = raw;
        }
      }

      if (amount == null || amount <= 0) return;

      parsed.push({
        rowIndex: idx,
        date: dateStr,
        description: descCol ? row[descCol] || "" : "",
        amount,
        reference: refCol ? row[refCol] || undefined : undefined,
      });
    });

    if (parsed.length === 0) {
      setError(
        "לא נמצאו תנועות זכות (כסף נכנס) בקובץ. בדקו שהקובץ כולל את העמודות הנכונות.",
      );
      return;
    }

    const newMatches: MatchRow[] = parsed.map((tx) => {
      const candidates = findCandidates(tx, unpaidDocuments);
      return {
        tx,
        candidates,
        selectedDocId: candidates[0]?.id ?? null,
        confirmed: candidates.length > 0,
      };
    });

    setMatches(newMatches);
    setStep("review");
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    const toApply = matches.filter((m) => m.confirmed && m.selectedDocId);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("פג תוקף החיבור. התחבר מחדש ונסה שוב.");

      const businessId = getBusinessId();
      const userId = session.user.id;

      let updated = 0;
      for (const m of toApply) {
        const { error } = await supabase
          .from("documents")
          .update({
            status: "paid",
            paid_at: new Date(m.tx.date).toISOString(),
            payment_reference: m.tx.reference || m.tx.description || null,
          })
          .eq("id", m.selectedDocId!);
        if (error) throw new Error(error.message);
        updated++;
        // Notification: best-effort, never blocks the matching action.
        if (businessId) {
          const matchedDoc = unpaidDocuments.find((d) => d.id === m.selectedDocId);
          if (matchedDoc) {
            await createNotificationClient({
              businessId,
              userId,
              kind: "payment_matched",
              title: `תשלום זוהה: ${matchedDoc.clientName}`,
              body: `מסמך #${matchedDoc.number} (₪${matchedDoc.total.toLocaleString("he-IL")}) סומן כשולם לפי תנועה בבנק ב-${formatDate(m.tx.date)}.`,
              href: `/documents/${m.selectedDocId}`,
              documentId: m.selectedDocId!,
            });
          }
        }
      }
      setImportedCount(updated);
      setStep("done");
      onPaid();
      window.dispatchEvent(new Event("invoice-app:documents-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בעדכון המסמכים");
    } finally {
      setImporting(false);
    }
  }

  const stats = useMemo(() => {
    const auto = matches.filter((m) => m.candidates.length > 0 && m.confirmed).length;
    const manual = matches.filter((m) => m.candidates.length === 0).length;
    const total = matches.length;
    return { auto, manual, total };
  }, [matches]);

  return (
    <Modal open={open} onClose={handleClose} title="ייבוא תנועות מהבנק">
      <div className="space-y-5 max-h-[70vh] overflow-y-auto">
        {step === "upload" && (
          <>
            <div className="rounded-2xl bg-blue-50/70 border border-blue-200 p-4 text-sm text-stone-800 space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <Banknote className="w-4 h-4 text-blue-700" />
                איך זה עובד
              </div>
              <ol className="list-decimal mr-5 space-y-1 text-xs">
                <li>הורידו תדפיס חשבון בנק / Bit / PayBox בפורמט CSV</li>
                <li>העלו כאן, נזהה אוטומטית עמודות תאריך/סכום/תיאור</li>
                <li>נציע התאמה לחשבוניות פתוחות לפי סכום + תאריך</li>
                <li>תאשרו את ההתאמות, והחשבוניות יסומנו אוטומטית כשולמו</li>
              </ol>
            </div>

            <div className="text-center py-6">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFile}
                className="hidden"
                id="bank-csv-upload"
              />
              <label
                htmlFor="bank-csv-upload"
                className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-6 py-3 rounded-2xl text-sm font-semibold cursor-pointer hover:shadow-lg hover:shadow-orange-200 transition-all"
              >
                <Upload className="w-4 h-4" />
                בחרו קובץ CSV
              </label>
              <p className="text-xs text-stone-500 mt-3">
                תומך ב-Hapoalim, Discount, Leumi, Mizrahi, Bit וכל קובץ CSV עם כותרות תקניות
              </p>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3 text-sm text-rose-800">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </>
        )}

        {step === "review" && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-center">
                <p className="text-xs text-stone-700">התאמות אוטומטיות</p>
                <p className="text-2xl font-bold text-emerald-700">{stats.auto}</p>
              </div>
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-center">
                <p className="text-xs text-stone-700">ללא התאמה</p>
                <p className="text-2xl font-bold text-amber-700">{stats.manual}</p>
              </div>
              <div className="rounded-2xl bg-stone-50 border border-stone-200 p-3 text-center">
                <p className="text-xs text-stone-700">סה״כ תנועות</p>
                <p className="text-2xl font-bold text-stone-700">{stats.total}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-100">
                  <tr>
                    <th className="px-3 py-2 text-right font-semibold text-stone-700 w-8"></th>
                    <th className="px-3 py-2 text-right font-semibold text-stone-700">תאריך</th>
                    <th className="px-3 py-2 text-right font-semibold text-stone-700">תיאור</th>
                    <th className="px-3 py-2 text-left font-semibold text-stone-700">סכום</th>
                    <th className="px-3 py-2 text-right font-semibold text-stone-700">חשבונית מותאמת</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, idx) => {
                    const noMatch = m.candidates.length === 0;
                    return (
                      <tr
                        key={idx}
                        className={`border-t border-stone-200 ${
                          noMatch ? "bg-stone-50/50" : m.confirmed ? "bg-emerald-50/50" : ""
                        }`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            disabled={noMatch}
                            checked={m.confirmed}
                            onChange={(e) => {
                              setMatches((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, confirmed: e.target.checked } : row,
                                ),
                              );
                            }}
                            className="rounded text-orange-500 focus:ring-orange-500"
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-stone-800">
                          {formatDate(m.tx.date)}
                        </td>
                        <td className="px-3 py-2 text-stone-700 max-w-[200px] truncate" title={m.tx.description}>
                          {m.tx.description || "-"}
                        </td>
                        <td className="px-3 py-2 text-left font-mono font-semibold text-emerald-700 whitespace-nowrap">
                          {formatCurrency(m.tx.amount)}
                        </td>
                        <td className="px-3 py-2">
                          {noMatch ? (
                            <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                              <CircleX className="w-3.5 h-3.5" />
                              לא נמצאה התאמה
                            </span>
                          ) : m.candidates.length === 1 ? (
                            <CandidateLabel doc={m.candidates[0]} />
                          ) : (
                            <select
                              value={m.selectedDocId ?? ""}
                              onChange={(e) => {
                                setMatches((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, selectedDocId: e.target.value } : row,
                                  ),
                                );
                              }}
                              className="text-xs rounded-lg border border-stone-300 px-2 py-1 bg-white"
                            >
                              {m.candidates.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {DOCUMENT_TYPE_LABELS[c.type]} #{c.number} · {c.clientName}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3 text-sm text-rose-800">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-between items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => reset()}
                disabled={importing}
                className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-50"
              >
                העלה קובץ אחר
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || stats.auto === 0}
                className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowRightLeft className="w-4 h-4" />
                {importing ? "מסמן..." : `סמן ${stats.auto} חשבוניות כשולמו`}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <div className="text-center py-8 space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-lg font-bold text-stone-900">
              {importedCount} {importedCount === 1 ? "חשבונית סומנה" : "חשבוניות סומנו"} כשולמו
            </h3>
            <p className="text-sm text-stone-600">תוכלו לראות אותן בטבלת המסמכים</p>
            <button
              onClick={handleClose}
              className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-5 py-2 rounded-2xl text-sm font-semibold hover:bg-orange-50"
            >
              סיום
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CandidateLabel({ doc }: { doc: InvoiceDocument }) {
  return (
    <span className="text-xs text-stone-700">
      <span className="font-mono">#{doc.number}</span> · {DOCUMENT_TYPE_LABELS[doc.type]} ·{" "}
      <span className="text-stone-900">{doc.clientName}</span>
    </span>
  );
}
