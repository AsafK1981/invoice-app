"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MessageCircle,
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  Unlink,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * Settings card for the WhatsApp channel.
 *
 * Two states:
 *   1. Not connected: shows the bot's number and a one-time code the user
 *      sends to it. Binding a phone to an account is what the code proves, so
 *      it is short-lived and single-use, and the countdown here mirrors the
 *      server's TTL rather than being decorative.
 *   2. Connected: shows the bound number, this month's usage against the cap,
 *      and an unlink button.
 *
 * The card hides itself entirely when the channel has no bot number configured,
 * so a deployment without WhatsApp credentials shows nothing rather than a
 * broken flow.
 */

const CAP = 200;

interface Status {
  connected: boolean;
  phone: string | null;
  usedThisMonth: number;
  botNumber: string | null;
}

export function WhatsAppSection() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"number" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/whatsapp/link", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.ok) setStatus(data);
    } catch {
      // Leave status null; the card stays hidden rather than showing a
      // half-broken connect flow.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only ticks while a code is live, so the card isn't re-rendering once a
  // second for the whole time the settings page is open.
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
  const codeLive = Boolean(code) && secondsLeft > 0;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/whatsapp/link", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "יצירת הקוד נכשלה.");
        return;
      }
      setCode(data.code);
      setExpiresAt(new Date(data.expiresAt).getTime());
      setNow(Date.now());
    } catch {
      setError("יצירת הקוד נכשלה.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    const ok = await confirm({
      title: "לנתק את הוואטסאפ?",
      message: "לא תוכל יותר להפיק מסמכים דרך הצ׳אט עד שתחבר מחדש. המסמכים שכבר הופקו לא מושפעים.",
      confirmLabel: "נתק",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch("/api/whatsapp/link", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      setCode(null);
      setExpiresAt(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, which: "number" | "code") {
    await navigator.clipboard.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied(null), 1800);
  }

  if (loading || !status?.botNumber) return null;

  return (
    <div className="card-soft p-6">
      <div className="flex items-center justify-between pb-4 border-b border-orange-100 mb-4 flex-wrap gap-2">
        <h2 className="font-semibold text-stone-900 flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-orange-500" />
          חיבור וואטסאפ
        </h2>
        {status.connected ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" />
            מחובר · <span dir="ltr">{status.phone}</span>
          </span>
        ) : (
          <span className="text-xs font-semibold bg-stone-100 text-stone-600 border border-stone-200 px-2.5 py-1 rounded-full">
            לא מחובר
          </span>
        )}
      </div>

      {status.connected ? (
        <>
          <p className="text-sm text-stone-700 leading-relaxed">
            אפשר להפיק מסמכים ולרשום הוצאות ישירות בצ׳אט, בלי לפתוח את האפליקציה.
          </p>
          <div className="mt-4">
            <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-l from-amber-300 to-amber-500"
                style={{ width: `${Math.min(100, (status.usedThisMonth / CAP) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-stone-600 mt-2">
              {status.usedThisMonth} מתוך {CAP} פעולות החודש
            </p>
          </div>
          <button
            onClick={unlink}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-rose-700 hover:text-rose-900 disabled:opacity-50"
          >
            <Unlink className="w-3.5 h-3.5" />
            נתק את החיבור
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-stone-700 leading-relaxed mb-4">
            הפק חשבוניות וקבלות בשיחה. שמור את המספר, שלח לו את הקוד, וזהו.
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl bg-amber-50/60 border border-amber-200 p-3">
              <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 text-xs font-bold flex items-center justify-center flex-shrink-0">
                1
              </span>
              <span className="text-sm text-stone-700 flex-1">שמור את המספר</span>
              <span className="font-mono text-sm font-bold text-stone-900" dir="ltr">
                {status.botNumber}
              </span>
              <button
                onClick={() => copy(status.botNumber!, "number")}
                className="text-xs font-semibold text-amber-900 border border-amber-300 bg-white rounded-lg px-2.5 min-h-[32px] hover:bg-amber-50"
              >
                {copied === "number" ? <Check className="w-3.5 h-3.5" /> : "העתק"}
              </button>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-amber-50/60 border border-amber-200 p-3">
              <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 text-xs font-bold flex items-center justify-center flex-shrink-0">
                2
              </span>
              <span className="text-sm text-stone-700 flex-1">שלח לו את הקוד</span>
              {codeLive ? (
                <>
                  <span className="font-mono text-sm font-bold tracking-wider text-stone-900" dir="ltr">
                    {code}
                  </span>
                  <button
                    onClick={() => copy(code!, "code")}
                    className="text-xs font-semibold text-amber-900 border border-amber-300 bg-white rounded-lg px-2.5 min-h-[32px] hover:bg-amber-50"
                  >
                    {copied === "code" ? <Check className="w-3.5 h-3.5" /> : "העתק"}
                  </button>
                </>
              ) : (
                <button
                  onClick={generate}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-950 bg-gradient-to-br from-amber-300 to-amber-500 rounded-lg px-3 min-h-[32px] disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {code ? "צור קוד חדש" : "צור קוד"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-amber-50/60 border border-amber-200 p-3">
              <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 text-xs font-bold flex items-center justify-center flex-shrink-0">
                3
              </span>
              <span className="text-sm text-stone-700 flex-1">זהו. סיימת.</span>
            </div>
          </div>

          {codeLive && (
            <p className="text-xs text-stone-600 mt-3">
              הקוד תקף עוד {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} דקות, ולשימוש חד פעמי.
            </p>
          )}
          {code && !codeLive && (
            <p className="text-xs text-rose-700 mt-3">פג תוקף הקוד. צור קוד חדש.</p>
          )}
          {error && <p className="text-xs text-rose-700 mt-3">{error}</p>}
        </>
      )}
    </div>
  );
}
