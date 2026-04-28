"use client";

import { useEffect, useState } from "react";
import { User, Lock, Trash2, AlertTriangle, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { supabase } from "@/lib/supabase";
import { signOut } from "@/lib/auth";

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
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email || "");
    });
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
      setToast({ kind: "error", text: error.message });
      return;
    }
    setToast({ kind: "success", text: "הסיסמה עודכנה בהצלחה" });
    setPassword("");
    setConfirmPassword("");
  }

  async function handleDeleteAccount() {
    if (deleteText !== "מחק") {
      setToast({ kind: "error", text: 'יש לכתוב "מחק" כדי לאשר' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/delete-account", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "שגיאה במחיקת החשבון");
      }
      await signOut();
    } catch (err) {
      setSaving(false);
      setToast({ kind: "error", text: err instanceof Error ? err.message : "שגיאה" });
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
              dir="ltr"
              value={userEmail}
              disabled
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
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="input-warm pl-3 pr-10"
                />
              </div>
            </FormField>
            <FormField label="אישור סיסמה">
              <input
                type={showPassword ? "text" : "password"}
                dir="ltr"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
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
