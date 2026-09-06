"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Inbox,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { Expander } from "@/components/expander";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useEmailInbox, setEmailInboxState } from "@/lib/email-inbox-client";

/**
 * Settings card for "הוצאות מהמייל".
 *
 * The whole feature is one address: turn it on, forward (or auto-forward) an
 * invoice to it, and it lands on /expenses as a card to approve. So this card
 * is mostly the address itself plus the one-time forwarding setup, in the same
 * shape as the WhatsApp card above it - header + status pill, then numbered
 * steps in a tinted box.
 *
 * The steps live behind a disclosure on purpose: a user who already set the
 * filter up should see an address and nothing else, and a settings page whose
 * every card is expanded is a wall.
 *
 * Hides itself entirely when `/api/email-inbox` is not answering, rather than
 * offering a switch that cannot be flipped.
 */
export function EmailInboxSection() {
  const { enabled, address, ready, available } = useEmailInbox();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"toggle" | "rotate" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  if (!ready || !available) return null;

  async function toggle() {
    setBusy("toggle");
    setError(null);
    try {
      await setEmailInboxState(enabled ? "disable" : "enable");
      // A freshly created address is useless until it is forwarded to, so
      // open the setup steps for the user instead of making them find them.
      if (!enabled) setGuideOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הפעולה נכשלה.");
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    const ok = await confirm({
      title: "ליצור כתובת חדשה?",
      message:
        "הכתובת הנוכחית תפסיק לעבוד מיד, ותצטרכו לעדכן את כלל ההעברה ב-Gmail או ב-Outlook. חשבוניות שכבר הגיעו נשארות ברשימה.",
      tone: "danger",
      confirmLabel: "צור כתובת חדשה",
    });
    if (!ok) return;
    setBusy("rotate");
    setError(null);
    try {
      await setEmailInboxState("rotate");
      setGuideOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הפעולה נכשלה.");
    } finally {
      setBusy(null);
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("ההעתקה נכשלה. סמנו את הכתובת והעתיקו ידנית.");
    }
  }

  return (
    <div id="email-inbox" className="card-soft p-6 scroll-mt-6">
      <div className="flex items-center justify-between pb-4 border-b border-orange-100 mb-4 flex-wrap gap-2">
        <h2 className="font-semibold text-stone-900 flex items-center gap-2">
          <Inbox className="w-4 h-4 text-orange-500" />
          הוצאות מהמייל
        </h2>
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
            enabled
              ? "bg-pink-50 text-pink-800 border-pink-200"
              : "bg-stone-100 text-stone-600 border-stone-200"
          }`}
        >
          {enabled ? "מופעל" : "כבוי"}
        </span>
      </div>

      <p className="text-sm text-stone-700 leading-relaxed">
        העבירו חשבוניות שקיבלתם במייל לכתובת האישית שלכם, ואנחנו נקרא אותן ונציע
        להוסיף אותן להוצאות. כלום לא נכנס לדוח בלי אישור שלכם.
      </p>

      {!enabled ? (
        <button
          type="button"
          onClick={toggle}
          disabled={busy !== null}
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-rose-500 hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none transition-all"
        >
          {busy === "toggle" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />}
          הפעל
        </button>
      ) : (
        <>
          {/* The address. It sits in a flex-1 block with `break-all`, so a long
              token wraps INSIDE the card on a phone instead of pushing the
              copy button off the edge. */}
          <div className="mt-4 rounded-xl bg-pink-50/60 border border-pink-200 p-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[11rem]">
              <span className="block text-xs font-semibold text-stone-700">הכתובת שלכם</span>
              <code
                dir="ltr"
                /* dir=ltr renders the address correctly; text-right keeps the block
                   hugging the RTL card's inline start, right under its label. */
                className="block mt-0.5 font-mono text-sm font-bold text-stone-900 break-all text-right"
              >
                {address || "-"}
              </code>
            </div>
            <button
              type="button"
              onClick={copyAddress}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-pink-900 border border-pink-300 bg-white rounded-lg px-2.5 min-h-[36px] hover:bg-pink-50 shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  הועתק
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  העתק
                </>
              )}
            </button>
          </div>

          <Expander
            label={guideOpen ? "הסתר את מדריך ההעברה האוטומטית" : "איך מעבירים חשבוניות אוטומטית (3 צעדים)"}
            open={guideOpen}
            onToggle={() => setGuideOpen((o) => !o)}
          >
            <ol className="space-y-2.5">
              <Step n={1}>
                ב-Gmail: <b>הגדרות</b> ← <b>העברה ו-POP/IMAP</b> ← <b>הוסף כתובת העברה</b>.
                הדביקו את הכתובת ואשרו. Gmail שולח קוד אימות לכתובת החדשה -{" "}
                <Link href="/expenses" className="font-semibold text-pink-800 hover:underline">
                  קוד האימות יופיע בעמוד ההוצאות
                </Link>
                .
              </Step>
              <Step n={2}>
                צרו פילטר: <b>יש קובץ מצורף</b> + מילים כמו <b>חשבונית / קבלה / invoice</b>. פעולה:{" "}
                <b>העבר אל</b> הכתובת.
              </Step>
              <Step n={3}>מעכשיו כל חשבונית מגיעה לכאן לאישור.</Step>
            </ol>
            <p className="text-xs text-stone-600 mt-3 leading-relaxed">
              ב-Outlook: <b>הגדרות</b> ← <b>דואר</b> ← <b>כללים</b> ← כלל חדש, תנאי
              &quot;יש קובץ מצורף&quot;, פעולה &quot;העבר אל&quot; עם אותה כתובת.
            </p>
          </Expander>

          <div className="mt-4 pt-4 border-t border-orange-100 flex items-center gap-4 flex-wrap">
            <button
              type="button"
              onClick={toggle}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-stone-600 hover:text-stone-900 disabled:opacity-50"
            >
              {busy === "toggle" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              כבה
            </button>
            <button
              type="button"
              onClick={rotate}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-stone-500 hover:text-rose-700 disabled:opacity-50"
            >
              {busy === "rotate" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              צור כתובת חדשה
            </button>
            <Link
              href="/expenses"
              className="group inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-pink-800 hover:text-pink-900 mr-auto"
            >
              לחשבוניות שהגיעו במייל
              <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
            </Link>
          </div>
        </>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-xl bg-pink-50/60 border border-pink-200 p-3">
      <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-pink-200 to-pink-400 text-pink-950 text-xs font-bold flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <span className="text-sm text-stone-700 leading-relaxed flex-1 min-w-0">{children}</span>
    </li>
  );
}
