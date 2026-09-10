"use client";

import { useEffect, useState } from "react";
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
  Mail,
  Unplug,
} from "lucide-react";
import { Expander } from "@/components/expander";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  useEmailInbox,
  setEmailInboxState,
  startGmailConnect,
  disconnectGmail,
  runGmailSync,
  type GmailSyncProgress,
} from "@/lib/email-inbox-client";

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
  const { enabled, address, ready, available, gmail } = useEmailInbox();
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
        חשבוניות שמגיעות אליכם במייל נקראות אוטומטית ומחכות לאישור שלכם בדף ההוצאות.
        כלום לא נכנס לדוח בלי לחיצה שלכם.
        {gmail.available ? " שתי דרכים לחבר: Gmail ישירות, או כתובת העברה שעובדת עם כל תיבת מייל." : ""}
      </p>

      {gmail.available && (
        <>
          <GmailBlock gmail={gmail} onExpensesPage={onExpensesPage} />
          <p className="mt-5 pt-4 border-t border-orange-100 text-xs font-semibold text-stone-500">
            {gmail.connected ? "חלופה: כתובת העברה (לתיבה שאינה Gmail)" : "או: כתובת העברה אישית"}
          </p>
        </>
      )}

      {!enabled ? (
        <button
          type="button"
          onClick={toggle}
          disabled={busy !== null}
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none transition-all"
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
            label={
              guideOpen
                ? "הסתר את המדריך"
                : gmail.connected
                  ? "מדריך העברה ידנית (לא נדרש כש-Gmail מחובר)"
                  : "איך מגדירים העברה אוטומטית מ-Gmail (פעם אחת, במחשב)"
            }
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
        <div role="alert" className="mt-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

type Period = "ytd" | "3m" | "12m";

function periodStart(period: Period, now: Date = new Date()): string {
  if (period === "ytd") return `${now.getFullYear()}-01-01`;
  const d = new Date(now);
  d.setMonth(d.getMonth() - (period === "3m" ? 3 : 12));
  return d.toISOString().slice(0, 10);
}

function formatSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * The direct Gmail connection: connect, scan a period, see it run, disconnect.
 *
 * The consent screen is Google's, and because the app is in "testing" status
 * it shows an "unverified app" warning first; the copy here tells the user
 * the two clicks that get past it, in Google's own words, because a scary
 * screen with no explanation is where people give up.
 */
function GmailBlock({
  gmail,
  onExpensesPage,
}: {
  gmail: { connected: boolean; email?: string; lastSyncAt?: string | null; needsReconnect?: boolean };
  onExpensesPage: boolean;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"connect" | "disconnect" | "sync" | null>(null);
  const [period, setPeriod] = useState<Period>("ytd");
  const [progress, setProgress] = useState<GmailSyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Google brings the user back to /expenses?gmail=connected|error. Read it
  // once, say what happened, and clean the address bar so a reload does not
  // repeat the message.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("gmail");
    if (!flag) return;
    if (flag === "connected") setNotice("Gmail מחובר. בחרו תקופה ולחצו \"סרוק עכשיו\" כדי לייבא חשבוניות שכבר קיבלתם.");
    else setError("החיבור ל-Gmail לא הושלם. נסו שוב, ובמסך של גוגל אשרו את ההרשאה לקריאת המייל.");
    url.searchParams.delete("gmail");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      await startGmailConnect();
      // The page is navigating away; nothing more to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : "החיבור נכשל.");
      setBusy(null);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: "לנתק את Gmail?",
      message: "הייבוא האוטומטי ייפסק. חשבוניות שכבר יובאו נשארות בהוצאות.",
      tone: "danger",
      confirmLabel: "נתק",
    });
    if (!ok) return;
    setBusy("disconnect");
    setError(null);
    try {
      await disconnectGmail();
      setProgress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הניתוק נכשל.");
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    setProgress({ messages: 0, queued: 0, failed: 0, skipped: 0, quotaHit: false, authError: false, throttled: false });
    try {
      const totals = await runGmailSync({ mode: "backfill", after: periodStart(period) }, setProgress);
      if (totals.authError) setError("גוגל ביטלה את ההרשאה. לחצו \"חבר את Gmail\" מחדש.");
      else if (totals.quotaHit) setError("נגמרה מכסת הסריקות החודשית. הסריקה תימשך בחודש הבא.");
      else if (totals.throttled) setError("Gmail ביקש הפסקה. נסו שוב בעוד כמה דקות; מה שכבר נסרק נשמר.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "הסריקה נכשלה.");
    } finally {
      setBusy(null);
    }
  }

  const syncing = busy === "sync";

  return (
    <div className="mt-4 rounded-xl border border-pink-200 bg-pink-50/60 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-semibold text-stone-900 flex items-center gap-2">
          <Mail className="w-4 h-4 text-pink-700" />
          {gmail.connected ? "Gmail מחובר" : "חיבור ישיר ל-Gmail"}
        </p>
        {gmail.connected && gmail.email && (
          <code dir="ltr" className="text-xs text-stone-700 bg-white border border-pink-200 rounded-md px-2 py-0.5">
            {gmail.email}
          </code>
        )}
      </div>

      {notice && <p className="mt-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

      {!gmail.connected ? (
        <>
          <p className="mt-2 text-sm text-stone-700 leading-relaxed">
            האפליקציה תמצא לבד חשבוניות וקבלות בתיבה שלכם, כולל ישנות, ותבדוק כל יום אם הגיעו חדשות.
            בלי פילטרים ובלי העברות. ההרשאה היא לקריאה בלבד.
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={busy !== null}
            className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none transition-all"
          >
            {busy === "connect" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            חבר את Gmail
          </button>
          <p className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
            גוגל תציג מסך &quot;Google hasn&apos;t verified this app&quot; (האפליקציה עוד לא עברה את האימות
            הרשמי של גוגל). לוחצים <b>Advanced</b> (מתקדם) ואז <b>Go to friendlyinvoice.co.il</b>, ומאשרים.
          </p>
        </>
      ) : (
        <>
          {gmail.needsReconnect && (
            <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              גוגל ביטלה את ההרשאה (למשל אחרי שינוי סיסמה). לחצו &quot;חבר את Gmail&quot; מחדש.
            </p>
          )}
          <p className="mt-2 text-xs text-stone-600">
            {gmail.lastSyncAt
              ? `בדיקה אחרונה: ${formatSince(gmail.lastSyncAt)}. מיילים חדשים נבדקים פעם ביום.`
              : "מיילים חדשים ייבדקו פעם ביום. לחשבוניות שכבר קיבלתם, סרקו תקופה:"}
          </p>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-stone-700" htmlFor="gmail-period">
              תקופה
            </label>
            <select
              id="gmail-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              disabled={syncing}
              className="min-h-[36px] rounded-lg border border-pink-300 bg-white px-2 text-sm text-stone-900"
            >
              <option value="ytd">מתחילת השנה</option>
              <option value="3m">3 חודשים אחרונים</option>
              <option value="12m">12 חודשים אחרונים</option>
            </select>
            {gmail.needsReconnect ? (
              <button
                type="button"
                onClick={connect}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 disabled:from-stone-300 disabled:to-stone-300"
              >
                {busy === "connect" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                חבר את Gmail מחדש
              </button>
            ) : (
              <button
                type="button"
                onClick={scan}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 disabled:from-stone-300 disabled:to-stone-300"
              >
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {syncing ? "סורק..." : "סרוק עכשיו"}
              </button>
            )}
            <button
              type="button"
              onClick={disconnect}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 text-xs font-semibold text-stone-600 hover:text-rose-800 mr-auto"
            >
              {busy === "disconnect" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
              נתק
            </button>
          </div>

          {progress && (
            <p className="mt-3 text-sm text-stone-800" aria-live="polite">
              {syncing ? "סורק את המייל... " : "הסריקה הסתיימה. "}
              נבדקו {progress.messages} מיילים, {progress.queued} חשבוניות{" "}
              {onExpensesPage ? "ממתינות למעלה לאישור" : "ממתינות לאישור בדף ההוצאות"}
              {progress.failed > 0 ? `, ${progress.failed} קבצים לא נקראו` : ""}
              {progress.skipped > 0 ? `, ${progress.skipped} כבר היו קיימים או ללא קובץ מתאים` : ""}.
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-rose-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </p>
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
