"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Trash2,
  Download,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/lib/business-store";
import { useClients } from "@/lib/client-store";
import { useProducts } from "@/lib/product-store";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { downloadFullBackupZip } from "@/lib/backup-zip";

type Stage = "idle" | "warning" | "confirm" | "running" | "done";

interface DeleteResult {
  ok: boolean;
  deleted?: Record<string, number>;
  errors?: Array<{ step: string; message: string }>;
  error?: string;
}

const COUNT_LABELS: Record<string, string> = {
  documents: "מסמכים",
  document_items: "שורות בתוך מסמכים",
  document_attachments: "קבצים מצורפים",
  expenses: "הוצאות",
  clients: "לקוחות",
  products: "מוצרים/שירותים",
  document_counters: "מונים של מספרי מסמכים",
  dunning_log: "תזכורות תשלום ביומן",
  notifications: "התראות",
  storage_attachments: "קבצים מצורפים שנמחקו מ-storage",
  storage_expense_receipts: "קבלות סרוקות שנמחקו מ-storage",
  recurring_templates: "תבניות חיובים חוזרים",
};

export function DangerZoneSection() {
  const { business } = useBusiness();
  const { items: clients } = useClients();
  const { items: products } = useProducts();
  const { documents } = useDocuments();
  const { items: expenses } = useExpenses();

  const [stage, setStage] = useState<Stage>("idle");
  const [confirmText, setConfirmText] = useState("");
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [result, setResult] = useState<DeleteResult | null>(null);

  function open() {
    setStage("warning");
    setConfirmText("");
    setBackupDownloaded(false);
    setBackupError(null);
    setResult(null);
  }

  function close() {
    if (stage === "running") return;
    setStage("idle");
  }

  async function handleDownloadBackup() {
    setBackupError(null);
    try {
      await downloadFullBackupZip({
        business,
        clients,
        products,
        documents,
        expenses,
      });
      setBackupDownloaded(true);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "שגיאה ביצירת גיבוי");
    }
  }

  async function executeDelete() {
    setStage("running");
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("פג תוקף החיבור. התחבר מחדש ונסה שוב.");
      const res = await fetch("/api/danger/delete-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ confirmation: confirmText }),
      });
      const json = (await res.json()) as DeleteResult;
      setResult(json);
      // Refresh local stores so the UI clears immediately if delete succeeded.
      if (json.ok && (json.deleted?.documents ?? 0) >= 0) {
        window.dispatchEvent(new Event("invoice-app:clients-changed"));
        window.dispatchEvent(new Event("invoice-app:products-changed"));
        window.dispatchEvent(new Event("invoice-app:expenses-changed"));
        window.dispatchEvent(new Event("invoice-app:documents-changed"));
        window.dispatchEvent(new Event("invoice-app:notifications-changed"));
      }
      setStage("done");
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "שגיאת רשת",
      });
      setStage("done");
    }
  }

  const nameMatches = (() => {
    const a = (business.name || "").toLowerCase().trim();
    const b = confirmText.toLowerCase().trim();
    return a.length > 0 && a === b;
  })();

  return (
    <>
      <div className="gk-danger card-soft p-5 border-rose-200 bg-rose-50/40">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-stone-900">מחיקת כל הנתונים</h3>
            <p className="text-sm text-stone-700 mt-1">
              מחיקה לצמיתות של כל הלקוחות, המוצרים, המסמכים, ההוצאות, התראות, יומן תזכורות, וקבצים מצורפים. פרטי העסק וההיסטוריה (audit log) נשמרים. לא ניתן לשחזר.
            </p>
            <button
              onClick={open}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="w-4 h-4" />
              התחל תהליך מחיקה
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={stage !== "idle"}
        onClose={close}
        title={
          stage === "done"
            ? result?.ok
              ? "המחיקה הושלמה"
              : "המחיקה לא הושלמה במלואה"
            : "מחיקת כל הנתונים"
        }
      >
        {stage === "warning" && (
          <WarningStage
            backupDownloaded={backupDownloaded}
            backupError={backupError}
            counts={{
              clients: clients.length,
              products: products.length,
              documents: documents.length,
              expenses: expenses.length,
            }}
            onDownload={handleDownloadBackup}
            onContinue={() => setStage("confirm")}
            onCancel={close}
          />
        )}
        {stage === "confirm" && (
          <ConfirmStage
            businessName={business.name || ""}
            confirmText={confirmText}
            setConfirmText={setConfirmText}
            nameMatches={nameMatches}
            onConfirm={executeDelete}
            onBack={() => setStage("warning")}
            onCancel={close}
          />
        )}
        {stage === "running" && <RunningStage />}
        {stage === "done" && result && <DoneStage result={result} onClose={close} />}
      </Modal>
    </>
  );
}

function WarningStage({
  backupDownloaded,
  backupError,
  counts,
  onDownload,
  onContinue,
  onCancel,
}: {
  backupDownloaded: boolean;
  backupError: string | null;
  counts: { clients: number; products: number; documents: number; expenses: number };
  onDownload: () => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-rose-50 border-2 border-rose-200 p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-rose-900 leading-relaxed">
          <strong className="block mb-1">פעולה הרסנית — לא ניתן לשחזר.</strong>
          ימחקו לצמיתות:
          <ul className="list-disc mr-5 mt-1 space-y-0.5 text-xs">
            <li>{counts.documents} מסמכים + פירוטים + קבצים מצורפים</li>
            <li>{counts.expenses} הוצאות + קבלות סרוקות</li>
            <li>{counts.clients} לקוחות</li>
            <li>{counts.products} מוצרים/שירותים</li>
            <li>כל התזכורות שנשלחו וההתראות במערכת</li>
            <li>תבניות חיובים חוזרים</li>
            <li>מונים — חשבונית חדשה תתחיל מחדש מ-1001/201</li>
          </ul>
          <p className="mt-2 text-xs">פרטי העסק, חיבור לרשות המסים, ויומן הביקורת — נשארים.</p>
        </div>
      </div>

      <div className="rounded-2xl bg-emerald-50/70 border-2 border-emerald-200 p-4">
        <div className="flex items-start gap-3">
          <Download className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-bold text-emerald-900 text-sm">קודם — הורד גיבוי</h3>
            <p className="text-xs text-emerald-900 mt-1">
              קובץ ZIP אחד עם כל המסמכים, הלקוחות, המוצרים וההוצאות כ-CSV. שמור אותו במקום בטוח.
            </p>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Download className="w-4 h-4" />
                הורד גיבוי ZIP
              </button>
              {backupDownloaded && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  הגיבוי הורד
                </span>
              )}
              {backupError && (
                <span className="text-xs text-rose-700">{backupError}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50"
        >
          ביטול
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!backupDownloaded}
          title={
            backupDownloaded
              ? "המשך לאישור סופי"
              : "הורד קודם את הגיבוי כדי שלא תתחרט"
          }
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-100 border-2 border-rose-300 text-rose-800 hover:bg-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          הבנתי, המשך
        </button>
      </div>
    </div>
  );
}

function ConfirmStage({
  businessName,
  confirmText,
  setConfirmText,
  nameMatches,
  onConfirm,
  onBack,
  onCancel,
}: {
  businessName: string;
  confirmText: string;
  setConfirmText: (s: string) => void;
  nameMatches: boolean;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-rose-50 border-2 border-rose-300 p-4">
        <p className="text-sm text-rose-900 leading-relaxed">
          כדי לאשר את המחיקה — הקלד את שם העסק שלך בדיוק כפי שהוא מופיע למטה:
        </p>
        <p
          className="mt-3 px-3 py-2 rounded-lg bg-white border border-rose-200 text-sm font-mono text-stone-900 select-text"
          dir="auto"
        >
          {businessName || "(שם העסק לא הוגדר)"}
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-stone-700 mb-1">
          הקלד את שם העסק:
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          dir="auto"
          autoComplete="off"
          autoFocus
          className="w-full px-3 py-2 rounded-xl border-2 border-stone-300 bg-white focus:border-rose-400 focus:outline-none text-sm"
          placeholder={businessName}
        />
        {confirmText.length > 0 && !nameMatches && (
          <p className="text-xs text-rose-700 mt-1.5 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            השם לא תואם בדיוק
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-stone-600 hover:text-stone-900"
        >
          ← חזור
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!nameMatches}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            מחק את הכל לצמיתות
          </button>
        </div>
      </div>
    </div>
  );
}

function RunningStage() {
  return (
    <div className="py-10 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-full border-4 border-rose-200 border-t-rose-500 animate-spin" />
      <p className="text-stone-700 font-medium">מוחק את הנתונים...</p>
      <p className="text-xs text-stone-500">
        אל תסגור את החלון עד שזה יסתיים.
      </p>
    </div>
  );
}

function DoneStage({
  result,
  onClose,
}: {
  result: DeleteResult;
  onClose: () => void;
}) {
  const counts = result.deleted || {};
  const errors = result.errors || [];
  const ok = result.ok && errors.length === 0;
  return (
    <div className="space-y-4">
      <div
        className={`rounded-2xl border-2 p-4 flex items-start gap-3 ${
          ok
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200"
        }`}
      >
        {ok ? (
          <CheckCircle2 className="w-6 h-6 text-emerald-700 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-6 h-6 text-amber-700 flex-shrink-0 mt-0.5" />
        )}
        <div className="text-sm leading-relaxed">
          {ok ? (
            <p className="text-emerald-900">
              <strong>הכל נמחק.</strong> תוכל להתחיל מאפס.
            </p>
          ) : result.error ? (
            <p className="text-amber-900">
              <strong>שגיאה:</strong> {result.error}
            </p>
          ) : (
            <p className="text-amber-900">
              <strong>חלק נמחק, חלק נכשל.</strong> פירוט למטה — חלק מהנתונים עדיין כאן.
            </p>
          )}
        </div>
      </div>

      {Object.keys(counts).length > 0 && (
        <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4">
          <p className="text-xs font-semibold text-stone-700 mb-2">נמחק:</p>
          <ul className="text-xs text-stone-700 space-y-1">
            {Object.entries(counts).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-3">
                <span>{COUNT_LABELS[k] || k}</span>
                <span className="font-mono font-semibold">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4">
          <p className="text-xs font-semibold text-rose-800 mb-2">
            שגיאות ({errors.length}):
          </p>
          <ul className="text-xs text-rose-700 space-y-1">
            {errors.map((e, idx) => (
              <li key={idx}>
                <strong className="font-mono">{e.step}:</strong> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-stone-200 text-stone-800 hover:bg-stone-50"
        >
          סגור
        </button>
      </div>
    </div>
  );
}
