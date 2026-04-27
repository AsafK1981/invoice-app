"use client";

import { useEffect, useState } from "react";
import { Mail, Eye, EyeOff, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { supabase } from "@/lib/supabase";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function EmailSettingsModal({ open, onClose }: Props) {
  const [gmailUser, setGmailUser] = useState("");
  const [gmailAppPassword, setGmailAppPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      setGmailUser(user?.user_metadata?.gmail_user || "");
      setGmailAppPassword(user?.user_metadata?.gmail_app_password || "");
    });
    setToast(null);
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setToast(null);
    const cleanedPassword = gmailAppPassword.replace(/\s+/g, "");
    const { error } = await supabase.auth.updateUser({
      data: {
        gmail_user: gmailUser.trim() || null,
        gmail_app_password: cleanedPassword || null,
      },
    });
    setSaving(false);
    if (error) {
      setToast({ kind: "error", text: error.message });
      return;
    }
    setToast({
      kind: "success",
      text: gmailUser
        ? `שמרתי. מעכשיו מסמכים יישלחו מ-${gmailUser}`
        : "ההגדרות נמחקו. מסמכים יישלחו דרך Resend (ברירת מחדל).",
    });
    setTimeout(() => onClose(), 1500);
  }

  async function handleDisconnect() {
    setGmailUser("");
    setGmailAppPassword("");
    setSaving(true);
    await supabase.auth.updateUser({
      data: { gmail_user: null, gmail_app_password: null },
    });
    setSaving(false);
    setToast({
      kind: "success",
      text: "החיבור הוסר. מסמכים יישלחו דרך Resend.",
    });
    setTimeout(() => onClose(), 1500);
  }

  const isConfigured = gmailUser && gmailAppPassword;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="הגדרות אימייל"
      subtitle="שלח מסמכים מחשבון Gmail שלך"
      icon={Mail}
      maxWidth="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 hover:bg-white"
          >
            סגור
          </button>
          {isConfigured && (
            <button
              onClick={handleDisconnect}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50"
            >
              נתק
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none"
          >
            {saving ? "שומר..." : "שמור"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-stone-800">
          <p className="font-semibold mb-1">למה צריך את זה?</p>
          <p className="text-xs leading-relaxed">
            כברירת מחדל, מסמכים נשלחים מכתובת ניטרלית של המערכת. אם תחבר את ה-Gmail שלך, הלקוחות יקבלו את המסמכים ישירות ממך - מה שנראה מקצועי יותר ומקטין סיכוי שזה יגיע לספאם.
          </p>
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-xs text-orange-700 hover:underline mt-2 font-semibold"
          >
            יצירת App Password של Google
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <FormField label="כתובת Gmail" hint="הכתובת שממנה ישלחו המסמכים">
          <input
            type="email"
            dir="ltr"
            value={gmailUser}
            onChange={(e) => setGmailUser(e.target.value)}
            placeholder="you@gmail.com"
            className="input-warm"
          />
        </FormField>

        <FormField
          label="App Password"
          hint='16 תווים מ-Google. דורש 2-Factor Authentication מופעל'
        >
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
              value={gmailAppPassword}
              onChange={(e) => setGmailAppPassword(e.target.value)}
              placeholder="xxxx xxxx xxxx xxxx"
              className="input-warm pr-10"
            />
          </div>
        </FormField>

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

        {isConfigured && !toast && (
          <div className="flex items-center gap-2 text-sm p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900">
            <CheckCircle2 className="w-4 h-4" />
            <span>מסמכים יישלחו מ-{gmailUser}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
