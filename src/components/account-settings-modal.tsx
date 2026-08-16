"use client";

import { useEffect, useState } from "react";
import { User, Lock, Trash2, AlertTriangle, CheckCircle2, AlertCircle, Eye, EyeOff, Download } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { supabase } from "@/lib/supabase";
import { signOut } from "@/lib/auth";
import { friendlyError } from "@/lib/error-message";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AccountSettingsModal({ open, onClose }: Props) {
  const [userEmail, setUserEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  useEffect(() => {
    if (!open) return;
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        setUserEmail(user?.email || "");
      })
      // Display-only field; an empty string is the same fallback the success
      // path already uses when there is no email.
      .catch(() => setUserEmail(""));
    setPassword("");
    setConfirmPassword("");
    setToast(null);
    setShowDeleteConfirm(false);
    setDeleteText("");
  }, [open]);

  async function handleChangePassword() {
    setToast(null);
    if (password.length < 6) {
      setToast({ kind: "error", text: "סיסמה חייבת להיות לפחות 6 תווים" });
      return;
    }
    if (password !== confirmPassword) {
      setToast({ kind: "error", text: "הסיסמאות לא תואמות" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setToast({ kind: "error", text: friendlyError(error, "שגיאה בעדכון הסיסמה") });
      return;
    }
    setToast({ kind: "success", text: "הסיסמה עודכנה בהצלחה" });
    setPassword("");
    setConfirmPassword("");
  }

  async function handleExport() {
    setSaving(true);
    setToast(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("לא מחובר - התחבר מחדש");
      const res = await fetch("/api/export-data", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "שגיאה בייצוא הנתונים");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `myfriendlyinvoiceapp-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToast({ kind: "success", text: "קובץ הנתונים הורד" });
    } catch (err) {
      setToast({ kind: "error", text: friendlyError(err, "שגיאה בייצוא הנתונים") });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteText !== "מחק") {
      setToast({ kind: "error", text: 'יש לכתוב "מחק" כדי לאשר' });
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("לא מחובר - התחבר מחדש");
      const res = await fetch("/api/delete-account", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "שגיאה במחיקת החשבון");
      }
      await signOut();
    } catch (err) {
      setSaving(false);
      setToast({ kind: "error", text: friendlyError(err, "שגיאה במחיקת החשבון") });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="הגדרות חשבון"
      subtitle="ניהול הסיסמה והחשבון שלך"
      icon={User}
      maxWidth="lg"
      footer={
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 hover:bg-white"
        >
          סגור
        </button>
      }
    >
      <div className="space-y-6">
        <div>
          <FormField label="כתובת אימייל">
            <input
              type="email"
              name="email"
              dir="ltr"
              value={userEmail}
              disabled
              autoComplete="email"
              className="input-warm bg-stone-50 cursor-not-allowed"
            />
          </FormField>
        </div>

        <div className="border-t border-orange-100 pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-4 h-4 text-orange-500" />
            <h3 className="font-semibold text-stone-900">שינוי סיסמה</h3>
          </div>
          <div className="space-y-3">
            <FormField label="סיסמה חדשה">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <input
                  type={showPassword ? "text" : "password"}
                  name="new-password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  autoComplete="new-password"
                  className="input-warm pl-3 pr-10"
                />
              </div>
            </FormField>
            <FormField label="אישור סיסמה">
              <input
                type={showPassword ? "text" : "password"}
                name="new-password"
                dir="ltr"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                autoComplete="new-password"
                className="input-warm"
              />
            </FormField>
            <button
              onClick={handleChangePassword}
              disabled={saving || !password}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200 disabled:opacity-50"
            >
              {saving ? "שומר..." : "עדכן סיסמה"}
            </button>
          </div>
        </div>

        {toast && (
          <div
            className={`flex items-start gap-2 text-sm p-3 rounded-xl ${
              toast.kind === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
                : "bg-rose-50 border border-rose-200 text-rose-900"
            }`}
          >
            {toast.kind === "success" ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
            )}
            <span>{toast.text}</span>
          </div>
        )}

        <div className="border-t border-orange-100 pt-6">
          <div className="flex items-center gap-2 mb-3">
            <Download className="w-4 h-4 text-orange-500" />
            <h3 className="font-semibold text-stone-900">ייצוא הנתונים שלי</h3>
          </div>
          <p className="text-sm text-stone-700 mb-3 leading-relaxed">
            הורד קובץ JSON עם כל הנתונים שלך: עסקים, לקוחות, מוצרים, מסמכים,
            פרטי הוצאות, יומן פעילות. מתאים לגיבוי או למעבר לשירות אחר.
          </p>
          <button
            onClick={handleExport}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {saving ? "מייצא..." : "הורד את הנתונים שלי"}
          </button>
        </div>

        <div className="border-t border-rose-100 pt-6">
          <div className="rounded-2xl border-2 border-rose-200 bg-rose-50/40 p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-stone-900">מחיקת חשבון</h3>
                <p className="text-sm text-stone-700 mt-1">
                  פעולה זו תמחק את החשבון שלך ואת כל הנתונים (לקוחות, מסמכים, הוצאות) לצמיתות. לא ניתן לבטל.
                </p>
                {!showDeleteConfirm ? (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-rose-200 text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    מחק את החשבון שלי
                  </button>
                ) : (
                  <div className="mt-4 space-y-3">
                    <FormField label='לאישור, הקלד "מחק" בעברית'>
                      <input
                        type="text"
                        value={deleteText}
                        onChange={(e) => setDeleteText(e.target.value)}
                        placeholder="מחק"
                        autoComplete="off"
                        className="input-warm"
                      />
                    </FormField>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeleteText("");
                        }}
                        className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 hover:bg-white"
                      >
                        ביטול
                      </button>
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deleteText !== "מחק" || saving}
                        className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {saving ? "מוחק..." : "מחק לצמיתות"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
