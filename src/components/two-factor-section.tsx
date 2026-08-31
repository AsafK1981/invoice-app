"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shield, Smartphone, Check, X, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import { friendlyError } from "@/lib/error-message";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Factor = {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string;
  created_at: string;
};

/**
 * TOTP (Time-based One-Time Password) enrollment + management section.
 *
 * Info-security appendix §17 requires that the software house enforce
 * 2FA for its customers. We use Supabase Auth's MFA API:
 *   1. enroll → returns QR code (SVG string) + secret
 *   2. user scans into authenticator app (Google Authenticator, Authy,
 *      1Password, etc.)
 *   3. user types the 6-digit code from the app
 *   4. challenge + verify → factor is activated
 *
 * QR code is rendered as a data-URL <img> rather than via
 * dangerouslySetInnerHTML, Supabase's SVG is trusted but rendering
 * server-supplied SVG as live DOM is an unnecessary XSS surface.
 */
export function TwoFactorSection() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollData, setEnrollData] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error && data) {
      setFactors((data.totp || []) as Factor[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function startEnroll() {
    setError(null);
    setEnrolling(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator-${Date.now()}`,
    });
    if (error || !data) {
      setError(friendlyError(error, "שגיאה ביצירת המפתח"));
      setEnrolling(false);
      return;
    }
    setEnrollData({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function verifyCode() {
    if (!enrollData) return;
    setBusy(true);
    setError(null);

    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
      factorId: enrollData.factorId,
    });
    if (chErr || !ch) {
      setError(friendlyError(chErr, "שגיאה בעת אימות"));
      setBusy(false);
      return;
    }

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: enrollData.factorId,
      challengeId: ch.id,
      code: code.trim(),
    });
    if (vErr) {
      setError(friendlyError(vErr, "הקוד שגוי או שפג תוקפו, נסה שוב"));
      setBusy(false);
      return;
    }

    setEnrollData(null);
    setEnrolling(false);
    setCode("");
    setBusy(false);
    await refresh();
  }

  async function disableFactor(factorId: string) {
    const ok = await confirm({
      title: "להסיר את האימות הדו-שלבי?",
      message: "לאחר ההסרה תישאר רק הסיסמה כאמצעי הגנה על החשבון.",
      tone: "danger",
      confirmLabel: "הסר",
    });
    if (!ok) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    await refresh();
  }

  function cancelEnroll() {
    setEnrolling(false);
    setEnrollData(null);
    setCode("");
    setError(null);
  }

  const qrDataUrl = useMemo(() => {
    if (!enrollData) return "";
    // Supabase returns SVG XML; wrap as data URL for safe <img> rendering.
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(enrollData.qrCode)))}`;
  }, [enrollData]);

  const verifiedFactor = factors.find((f) => f.status === "verified");

  return (
    <div className="card-soft p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-500" />
            אימות דו-שלבי (2FA)
          </h2>
          <p className="text-sm text-stone-600 mt-1">
            רובד הגנה נוסף לחשבון שלך. נדרש לפי תקנות הגנת הפרטיות + נספח אבטחת מידע של רשות המסים.
          </p>
        </div>
        {verifiedFactor ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">
            <Check className="w-3.5 h-3.5" />
            פעיל
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />
            לא פעיל
          </span>
        )}
      </div>

      {loading && <div className="text-sm text-stone-500">טוען…</div>}

      {!loading && !verifiedFactor && !enrolling && (
        <div className="space-y-3">
          <p className="text-sm text-stone-700">
            לאחר ההפעלה, ביציאה והכניסה מחדש, תתבקש להזין קוד מתוך אפליקציית האימות (Google
            Authenticator, Authy, 1Password וכו׳) בנוסף לסיסמה.
          </p>
          <button
            onClick={startEnroll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm hover:opacity-90"
          >
            <Smartphone className="w-4 h-4" />
            הפעל 2FA
          </button>
        </div>
      )}

      {!loading && verifiedFactor && (
        <div className="space-y-3">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
            ✓ אימות דו-שלבי פעיל בחשבון שלך. הופעל ב-
            {formatDate(verifiedFactor.created_at)}.
          </div>
          <button
            onClick={() => disableFactor(verifiedFactor.id)}
            disabled={busy}
            className="text-sm text-rose-700 hover:underline disabled:opacity-50"
          >
            הסר אימות דו-שלבי
          </button>
        </div>
      )}

      {enrolling && enrollData && (
        <div className="space-y-4 mt-2">
          <ol className="space-y-3 text-sm text-stone-800 list-decimal pr-5">
            <li>
              פתח את אפליקציית האימות שלך (Google Authenticator / Authy / 1Password / וכו׳).
            </li>
            <li>
              סרוק את ה-QR Code הזה (או הזן את המפתח באופן ידני):
              <div className="mt-3 inline-block p-3 rounded-xl bg-white border border-stone-200">
                <img src={qrDataUrl} alt="QR code לסריקה באפליקציית האימות" className="w-40 h-40" />
              </div>
              <div className="mt-2 text-xs text-stone-600">
                מפתח ידני: <code className="bg-stone-100 px-2 py-0.5 rounded font-mono">{enrollData.secret}</code>
              </div>
            </li>
            <li>
              הזן את הקוד בן 6 הספרות שמופיע באפליקציה:
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="block w-32 mt-2 input-warm font-mono text-center text-lg tracking-widest"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </li>
          </ol>

          {error && (
            <div className="text-sm text-rose-700 flex items-center gap-1.5">
              <X className="w-4 h-4" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={verifyCode}
              disabled={code.length !== 6 || busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              אישור והפעלה
            </button>
            <button
              onClick={cancelEnroll}
              disabled={busy}
              className="px-4 py-2 rounded-xl text-sm font-semibold border-2 border-stone-200 text-stone-700 hover:bg-stone-50"
            >
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
