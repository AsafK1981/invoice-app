"use client";

import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { supabase } from "@/lib/supabase";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The signed-in user's own email - resend targets THIS address, never a
   *  client/recipient address, since it's the sender's identity being
   *  verified, not who they're emailing. Optional: if the caller doesn't
   *  already have it handy, the modal looks up the current session's email
   *  itself when it opens. */
  email?: string;
}

/**
 * Shown when /api/send-email returns { code: "EMAIL_NOT_VERIFIED" }. Deferred
 * email verification lets a new user into the app immediately at signup, but
 * sending mail to a real third party (the client) still requires the sender
 * to have proven their own email address first.
 */
export function EmailVerificationModal({ open, onClose, email: emailProp }: Props) {
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedEmail, setResolvedEmail] = useState<string | null>(emailProp ?? null);

  useEffect(() => {
    if (!open) return;
    // Reset transient state each time the modal is (re)opened.
    setSent(false);
    setError(null);
    if (emailProp) {
      setResolvedEmail(emailProp);
      return;
    }
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled) setResolvedEmail(data.user?.email ?? null);
      })
      // null is exactly what the success path stores when there is no email.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, emailProp]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function handleResend() {
    if (resending || cooldown > 0 || !resolvedEmail) return;
    setResending(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: resolvedEmail,
    });
    setResending(false);
    if (resendError) {
      setError(resendError.message);
    } else {
      setSent(true);
      setCooldown(60);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="כמעט שם, נשאר לאמת את המייל"
      icon={MailCheck}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 hover:bg-stone-100 transition-colors"
          >
            סגור
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || cooldown > 0 || !resolvedEmail}
            className="pgbtn-primary px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resending
              ? "שולח..."
              : cooldown > 0
                ? `שלח שוב בעוד ${cooldown} שנ׳`
                : "שלח קישור אימות שוב"}
          </button>
        </>
      }
    >
      <p className="text-sm text-stone-700 leading-relaxed">
        כדי לשלוח מסמכים ללקוחות שלך צריך לוודא שכתובת המייל שרשמת שייכת לך. שלחנו אליך קישור
        אימות כשנרשמת, ואפשר לשלוח אותו שוב עכשיו.
      </p>
      {sent && (
        <div className="mt-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
          שלחנו שוב. בדוק את תיבת הדואר, וגם בתיקיית הספאם.
        </div>
      )}
      {error && (
        <div className="mt-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
          {error}
        </div>
      )}
    </Modal>
  );
}
