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
  ExternalLink,
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
 *
 * Lives in Settings and, since 2026-09-06 at Asaf's request, also at the
 * bottom of /expenses so the feature is found where it is used.
 * `onExpensesPage` drops the "go to /expenses" links, which would point at
 * the page the reader is already on.
 */
export function EmailInboxSection({ onExpensesPage = false }: { onExpensesPage?: boolean } = {}) {
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
            label={guideOpen ? "הסתר את המדריך" : "איך מגדירים העברה אוטומטית מ-Gmail (פעם אחת, במחשב)"}
            open={guideOpen}
            onToggle={() => setGuideOpen((o) => !o)}
          >
            <p className="text-xs text-stone-600 leading-relaxed mb-3">
              ההגדרה נעשית באתר Gmail במחשב, לא באפליקציה בטלפון. הכפתורים פותחים את המסך
              הנכון ב-Gmail בכרטיסייה חדשה, וכאן כתוב מה ללחוץ שם.
            </p>
            <ol className="space-y-2.5">
              <Step n={1} title="מחברים את הכתובת ל-Gmail">
                <GmailButton href="https://mail.google.com/mail/u/0/#settings/fwdandpop">
                  פתח את הגדרות ההעברה ב-Gmail
                </GmailButton>
                <ul className="mt-2 space-y-1.5">
                  <Sub>
                    לוחצים <b>הוספת כתובת להעברה</b>, מדביקים את הכתובת מלמעלה (כפתור &quot;העתק&quot;),
                    ואז <b>הבא</b> ← <b>המשך</b> ← <b>אישור</b>.
                  </Sub>
                  <Sub>
                    Gmail שולח קוד אימות לכתובת החדשה.{" "}
                    {onExpensesPage ? (
                      <>
                        <b>הקוד מופיע כאן, בראש עמוד ההוצאות, תוך כמה שניות</b> (בלי לרענן),
                      </>
                    ) : (
                      <>
                        <Link href="/expenses" className="font-semibold text-pink-800 hover:underline">
                          הקוד מופיע בראש עמוד ההוצאות
                        </Link>{" "}
                        תוך כמה שניות (בלי לרענן),
                      </>
                    )}{" "}
                    עם כפתור <b>אשר את ההעברה ב-Gmail</b>. לוחצים עליו, וזה סוגר את שלב 1.
                  </Sub>
                  <Sub warn>
                    באותו מסך, את הבחירה <b>השבתת ההעברה</b> משאירים כמו שהיא. לא לבחור
                    &quot;העבר עותק של דואר נכנס&quot;, כי זה מעביר את <b>כל</b> המייל שלכם.
                    הפילטר בשלב 2 מעביר רק חשבוניות.
                  </Sub>
                </ul>
              </Step>
              <Step n={2} title="פילטר שמעביר רק מיילים עם חשבונית">
                <GmailButton href="https://mail.google.com/mail/u/0/#settings/filters">
                  פתח את הפילטרים ב-Gmail
                </GmailButton>
                <ul className="mt-2 space-y-1.5">
                  <Sub>
                    בתחתית הרשימה לוחצים <b>יצירת פילטר חדש</b>. נפתח טופס חיפוש.
                  </Sub>
                  <Sub>
                    בשורה <b>כולל את המילים</b> מדביקים:
                    <CopyChip value="חשבונית OR קבלה OR invoice OR receipt" />
                  </Sub>
                  <Sub>
                    מסמנים <b>יש קובץ מצורף</b>, ולוחצים <b>יצירת פילטר</b> (לא &quot;חיפוש&quot;).
                  </Sub>
                  <Sub>
                    במסך הבא מסמנים <b>העבר אל</b> ובוחרים את הכתובת שלכם מהרשימה (היא מופיעה
                    שם רק אחרי שלב 1). לוחצים <b>יצירת פילטר</b>. זה הכול.
                  </Sub>
                </ul>
              </Step>
              <Step n={3} title="מעכשיו זה אוטומטי">
                כל מייל שמגיע אליכם עם חשבונית או קבלה מצורפת מועבר לבד, נקרא, ומופיע{" "}
                {onExpensesPage ? "כאן למעלה" : "בעמוד ההוצאות"} תוך דקה, ממתין לאישור שלכם.
                שום דבר לא נכנס לדוח בלי לחיצה שלכם.
              </Step>
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
            {!onExpensesPage && (
              <Link
                href="/expenses"
                className="group inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-pink-800 hover:text-pink-900 mr-auto"
              >
                לחשבוניות שהגיעו במייל
                <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
              </Link>
            )}
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

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl bg-pink-50/60 border border-pink-200 p-3">
      <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-pink-200 to-pink-400 text-pink-950 text-xs font-bold flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <div className="text-sm text-stone-700 leading-relaxed flex-1 min-w-0">
        <p className="font-semibold text-stone-900 mb-1.5">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** One instruction inside a step. `warn` marks the "don't do this" line. */
function Sub({ children, warn = false }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <li
      className={`flex items-start gap-2 text-sm leading-relaxed ${
        warn ? "text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5" : "text-stone-700"
      }`}
    >
      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">{children}</span>
    </li>
  );
}

/** Opens the exact Gmail settings screen in a new tab. */
function GmailButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-pink-300 bg-white text-xs font-semibold text-pink-900 hover:bg-pink-50"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      {children}
    </a>
  );
}

/** A value to paste somewhere else, with its own one-click copy. */
function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the value is still visible to select by hand */
    }
  }
  return (
    <span className="mt-1.5 flex items-center gap-2 flex-wrap">
      <code dir="ltr" className="font-mono text-xs bg-white border border-pink-200 rounded-md px-2 py-1 text-stone-900">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 text-xs font-semibold text-pink-900 border border-pink-300 bg-white rounded-md px-2 min-h-[30px] hover:bg-pink-50"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? "הועתק" : "העתק"}
      </button>
    </span>
  );
}
