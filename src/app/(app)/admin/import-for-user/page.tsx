"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import {
  Upload,
  Users as UsersIcon,
  Package,
  FileText,
  Wallet,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Search,
  Check,
  X as XIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";
import { formatDate } from "@/lib/format";

interface AppUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  business: {
    id: string;
    name: string;
    clients: number;
    products: number;
    documents: number;
  } | null;
}

type EntityType = "clients" | "products" | "expenses" | "documents";
type Row = Record<string, string>;

const ENTITY_META: Record<EntityType, { label: string; icon: typeof UsersIcon; cols: string[] }> = {
  clients: {
    label: "לקוחות",
    icon: UsersIcon,
    cols: ["שם", "ח.פ / ת.ז", "כתובת", "טלפון", "אימייל", "הערות"],
  },
  products: {
    label: "מוצרים",
    icon: Package,
    cols: ["שם", "תיאור", "מחיר", "יחידה"],
  },
  expenses: {
    label: "הוצאות",
    icon: Wallet,
    cols: ["תאריך", "קטגוריה", "ספק", "סכום", "תיאור"],
  },
  documents: {
    label: "מסמכים",
    icon: FileText,
    cols: ["סוג", "מספר", "תאריך", "לקוח", "תיאור", "סכום", 'מע"מ', "סטטוס"],
  },
};

export default function AdminImportForUserPage() {
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [entityType, setEntityType] = useState<EntityType>("clients");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
    targetBusinessName?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const ok = isAdminEmail(user?.email);
      setAllowed(ok);
      setChecked(true);
    });
  }, []);

  const loadUsers = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/users${search ? `?q=${encodeURIComponent(search)}` : ""}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const data = await res.json();
    if (data.ok) setUsers(data.users);
  }, [search]);

  useEffect(() => {
    if (allowed) loadUsers();
  }, [allowed, loadUsers]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setFileName(file.name);
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setRows(results.data);
      },
      error: (err) => {
        setError(`שגיאה בקריאת הקובץ: ${err.message}`);
      },
    });
  }

  async function handleImport() {
    if (!selectedUser || rows.length === 0) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/import-for-user", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetUserId: selectedUser.id,
          entityType,
          rows,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "שגיאה");
        return;
      }
      setResult({
        imported: data.imported,
        skipped: data.skipped,
        errors: data.errors || [],
        targetBusinessName: data.targetBusinessName,
      });
      // Reset for the next import
      setRows([]);
      setFileName(null);
      if (fileInput.current) fileInput.current.value = "";
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSubmitting(false);
    }
  }

  if (!checked) return <div className="p-8 text-center text-stone-500">טוען...</div>;
  if (!allowed) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-stone-900">404</h1>
        <p className="text-stone-600 mt-2">העמוד לא נמצא</p>
      </div>
    );
  }

  const EntityIcon = ENTITY_META[entityType].icon;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-sm">
              <Upload className="w-5 h-5 text-white" />
            </span>
            ייבוא בשביל משתמש (Concierge)
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14 leading-relaxed">
            חבר ששלח לך CSV ב-WhatsApp? בחר אותו, העלה את הקובץ, וההוא יראה את הנתונים בפנים — כאילו הוא ייבא בעצמו.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-orange-700"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לדשבורד
        </Link>
      </div>

      {error && (
        <div className="card-soft p-4 bg-rose-50 border-rose-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-700 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800">{error}</p>
        </div>
      )}

      {/* Step 1: pick user */}
      <div className="card-soft p-5 space-y-4">
        <h2 className="font-semibold text-stone-900 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
            1
          </span>
          בחר משתמש יעד
        </h2>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="חיפוש לפי אימייל או שם עסק..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-warm pr-10 w-full"
          />
        </div>
        <ul className="divide-y divide-orange-50 max-h-72 overflow-y-auto rounded-xl border border-orange-100">
          {users.length === 0 ? (
            <li className="p-4 text-sm text-stone-500 italic">אין משתמשים תואמים</li>
          ) : (
            users.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => setSelectedUser(u)}
                  className={`w-full text-right p-3 hover:bg-orange-50/40 flex items-center justify-between gap-3 ${
                    selectedUser?.id === u.id ? "bg-violet-50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-900 truncate" dir="ltr">
                      {u.email}
                    </p>
                    <p className="text-xs text-stone-600 mt-0.5">
                      {u.business ? (
                        <>
                          <strong>{u.business.name}</strong> · {u.business.clients} לקוחות ·{" "}
                          {u.business.products} מוצרים · {u.business.documents} מסמכים
                        </>
                      ) : (
                        <span className="text-amber-700">אין עסק (לא השלים onboarding)</span>
                      )}
                      {u.last_sign_in_at && <> · התחבר {formatDate(u.last_sign_in_at.slice(0, 10))}</>}
                    </p>
                  </div>
                  {selectedUser?.id === u.id && (
                    <Check className="w-4 h-4 text-violet-600 flex-shrink-0" />
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      {/* Step 2: pick entity */}
      {selectedUser && (
        <div className="card-soft p-5 space-y-4">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
              2
            </span>
            איזה סוג נתונים?
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(ENTITY_META) as EntityType[]).map((e) => {
              const Icon = ENTITY_META[e].icon;
              return (
                <button
                  key={e}
                  onClick={() => setEntityType(e)}
                  className={`p-3 rounded-xl border text-sm font-semibold flex flex-col items-center gap-1 transition-colors ${
                    entityType === e
                      ? "border-violet-300 bg-violet-50 text-violet-900"
                      : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {ENTITY_META[e].label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-stone-600">
            עמודות צפויות:{" "}
            {ENTITY_META[entityType].cols.map((c) => (
              <code key={c} className="font-mono bg-stone-100 px-1.5 py-0.5 rounded mr-1">
                {c}
              </code>
            ))}
          </p>
        </div>
      )}

      {/* Step 3: upload CSV */}
      {selectedUser && (
        <div className="card-soft p-5 space-y-4">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
              3
            </span>
            העלה קובץ CSV
          </h2>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="block w-full text-sm text-stone-700 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-gradient-to-l file:from-violet-500 file:to-purple-500 file:text-white hover:file:opacity-90 file:cursor-pointer"
          />
          {fileName && (
            <p className="text-xs text-stone-600">
              קובץ: <strong>{fileName}</strong> · {rows.length} שורות נטענו
            </p>
          )}

          {rows.length > 0 && (
            <>
              <div className="rounded-xl border border-orange-100 max-h-60 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 text-stone-700 sticky top-0">
                    <tr>
                      {Object.keys(rows[0]).map((k) => (
                        <th key={k} className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-orange-50">
                    {rows.slice(0, 8).map((r, i) => (
                      <tr key={i}>
                        {Object.values(r).map((v, j) => (
                          <td key={j} className="px-3 py-1.5 text-stone-800 max-w-xs truncate">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 8 && (
                <p className="text-xs text-stone-500">+ עוד {rows.length - 8} שורות (לא מוצגות)</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 4: confirm */}
      {selectedUser && rows.length > 0 && (
        <div className="card-soft p-5 bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-violet-200 text-violet-800 text-xs font-bold flex items-center justify-center">
              4
            </span>
            אישור ייבוא
          </h2>
          <div className="rounded-xl bg-white p-4 text-sm space-y-1">
            <p>
              <strong>{rows.length}</strong> שורות של{" "}
              <strong>{ENTITY_META[entityType].label}</strong>
            </p>
            <p>
              ייובאו לחשבון של <strong dir="ltr">{selectedUser.email}</strong>
              {selectedUser.business && <> ({selectedUser.business.name})</>}
            </p>
            <p className="text-xs text-stone-600 mt-2">
              <EntityIcon className="w-3.5 h-3.5 inline" /> שורות כפולות/חסרות שדות חובה ידולגו
              אוטומטית. הפעולה תירשם ב-audit log של המשתמש.
            </p>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleImport}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-l from-violet-500 to-purple-500 text-white py-3 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-violet-200/60 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {submitting ? "מייבא..." : "ייבא עכשיו"}
            </button>
            <button
              onClick={() => {
                setRows([]);
                setFileName(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
              disabled={submitting}
              className="px-4 py-3 rounded-xl text-sm font-semibold text-stone-700 hover:bg-white disabled:opacity-50"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card-soft p-5 bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-2">
            <CheckCircle2 className="w-5 h-5" />
            ייבוא הסתיים
          </div>
          <div className="space-y-1 text-sm text-stone-800">
            <p>
              <strong>{result.imported}</strong> שורות יובאו בהצלחה לחשבון של{" "}
              {result.targetBusinessName || "המשתמש"}
            </p>
            {result.skipped > 0 && (
              <p className="text-amber-700">
                <strong>{result.skipped}</strong> שורות דולגו (כפילות / חסרים שדות / נתונים לא תקינים)
              </p>
            )}
            {result.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-rose-700 font-semibold">{result.errors.length} שגיאות:</p>
                <ul className="text-xs text-rose-700 list-disc pr-5 mt-1">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
