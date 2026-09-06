"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  Inbox,
  Loader2,
  MailWarning,
  Paperclip,
  Pencil,
  Settings2,
  ShoppingBag,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isGmailConfirmUrl } from "@/lib/gmail-confirm-url";
import { formatCurrency, formatDate } from "@/lib/format";
import { ExpenseFormModal, COMMON_CATEGORIES } from "@/components/expense-form-modal";
import {
  useEmailInbox,
  approveEmailInboxItem,
  rejectEmailInboxItem,
  reasonText,
  gmailVerificationCode,
  InboxItemGoneError,
  type EmailInboxItem,
  type EmailInboxApproval,
} from "@/lib/email-inbox-client";
import type { Expense } from "@/lib/types";

/**
 * The /expenses queue for invoices that arrived by mail.
 *
 * Same promise as the recurring proposals on the dashboard: the app prepared
 * something, one click accepts it, and nothing was written until you clicked.
 * An expense feeds the VAT return, so approve sends the values the owner is
 * LOOKING AT - never a re-read of the row - and a scan missing supplier /
 * amount / date cannot be one-click approved at all: those cards send you to
 * the form, because a blank the scanner refused to guess must not become a
 * zero in a tax report.
 *
 * Renders nothing when the queue is empty, which is the normal state - the
 * feature is discovered in הגדרות, not by an empty banner here.
 */
export function EmailInboxQueue({ history }: { history?: Expense[] }) {
  const { items: all, ready, available } = useEmailInbox();
  // Optimistic hide: an approved / rejected card disappears on click, before
  // the refetch lands, so the list never feels stuck.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ item: EmailInboxItem; prefill: Prefill } | null>(null);

  if (!ready || !available) return null;

  const items = all.filter((i) => !hidden.has(i.id));
  const waiting = items.filter((i) => i.status === "pending");
  const verifications = items.filter(
    (i) => i.status === "failed" && i.reason === "gmail_verification",
  );
  const failed = items.filter((i) => i.status === "failed" && i.reason !== "gmail_verification");

  if (waiting.length === 0 && verifications.length === 0 && failed.length === 0) return null;

  function hide(id: string) {
    setHidden((prev) => new Set(prev).add(id));
  }

  function openEditor(item: EmailInboxItem) {
    setEditing({ item, prefill: prefillFor(item) });
  }

  return (
    <section aria-labelledby="email-inbox-queue" className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2
          id="email-inbox-queue"
          className="font-bold text-stone-900 flex items-center gap-2"
        >
          <Inbox className="w-4 h-4 text-pink-600" />
          חשבוניות שהגיעו במייל
        </h2>
        {waiting.length > 0 && (
          <span className="text-xs font-semibold bg-pink-100 text-pink-900 border border-pink-200 px-2.5 py-0.5 rounded-full">
            {waiting.length} ממתינות
          </span>
        )}
        <Link
          href="/settings#email-inbox"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 mr-auto"
        >
          <Settings2 className="w-3.5 h-3.5" />
          הגדרות הוצאות מהמייל
        </Link>
      </div>

      {verifications.map((item) => (
        <GmailVerificationCard key={item.id} item={item} onDone={() => hide(item.id)} />
      ))}

      {waiting.map((item) => (
        <PendingCard
          key={item.id}
          item={item}
          onDone={() => hide(item.id)}
          onEdit={() => openEditor(item)}
        />
      ))}

      {failed.length > 0 && (
        <ul className="space-y-1.5">
          {failed.map((item) => (
            <FailedRow key={item.id} item={item} onDone={() => hide(item.id)} />
          ))}
        </ul>
      )}

      {/* The same form a manual scan opens, pre-filled - only the save goes
          through approve instead of a plain insert. */}
      <ExpenseFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        prefill={editing?.prefill ?? null}
        history={history}
        submitLabel="אשר והוסף"
        onSave={async (record) => {
          const item = editing?.item;
          if (!item) return;
          try {
            await approveEmailInboxItem(item.id, approvalFrom(record));
          } catch (err) {
            if (err instanceof InboxItemGoneError) {
              hide(item.id);
              return;
            }
            throw err;
          }
          hide(item.id);
        }}
      />
    </section>
  );
}

/**
 * Quiet pointer from the /expenses header to the settings card, for the case
 * the queue itself cannot cover: the channel is on, nothing is waiting, and
 * the owner wants to check the address or the forwarding rule. Renders
 * nothing when the channel is off - the feature is discovered in הגדרות.
 */
export function EmailInboxLink() {
  const { enabled, ready, available } = useEmailInbox();
  if (!ready || !available) return null;
  // The setup card sits at the bottom of this same page (since 2026-09-06),
  // so the link is an in-page jump, and it shows even before the feature is
  // switched on: that is exactly when someone needs to find it.
  return (
    <a
      href="#email-inbox"
      className="inline-flex items-center gap-1.5 mt-1 mr-14 text-xs font-semibold text-stone-500 hover:text-pink-800"
    >
      <Inbox className="w-3.5 h-3.5" />
      {enabled ? "הוצאות מהמייל" : "הוצאות מהמייל - הפעלה"}
    </a>
  );
}

/* ── one pending invoice ────────────────────────────────────────────── */

function PendingCard({
  item,
  onDone,
  onEdit,
}: {
  item: EmailInboxItem;
  onDone: () => void;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = item.scan || {};
  const supplier = (scan.vendor || "").trim();
  const amount = typeof scan.amount === "number" ? scan.amount : null;
  const vat = typeof scan.vatAmount === "number" ? scan.vatAmount : 0;
  const date = scan.date || "";
  const category = normalizeCategory(scan.category);
  const unread = scan.unreadFields ?? [];
  // Everything the tax books need. Missing any of the three means the scanner
  // left it blank on purpose, so there is nothing honest to one-click approve.
  const complete = supplier !== "" && amount !== null && amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function approve() {
    if (!complete || amount === null) return;
    setBusy("approve");
    setError(null);
    try {
      await approveEmailInboxItem(item.id, {
        date,
        category,
        supplier,
        amount,
        vatAmount: vat,
        description: (scan.description || "").trim() || undefined,
      });
      onDone();
    } catch (err) {
      if (err instanceof InboxItemGoneError) {
        onDone();
        return;
      }
      setError(err instanceof Error ? err.message : "האישור נכשל.");
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    try {
      await rejectEmailInboxItem(item.id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "הדחייה נכשלה.");
      setBusy(null);
    }
  }

  return (
    <div className="card-soft p-4 bg-gradient-to-br from-pink-50 to-rose-50 border-pink-200">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-pink-100 flex items-center justify-center flex-shrink-0">
          <Inbox className="w-5 h-5 text-pink-700" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
            <p className="font-semibold text-stone-900 break-words">
              {supplier || "ספק לא זוהה"}
            </p>
            {date && (
              <span className="text-xs text-stone-600 tabular-nums">{formatDate(date)}</span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
              <ShoppingBag className="w-3 h-3" />
              {category}
            </span>
          </div>

          {amount !== null ? (
            <p className="mt-1.5 text-lg font-bold text-stone-900 tabular-nums">
              {formatCurrency(amount)}
            </p>
          ) : (
            <p className="mt-1.5 text-sm font-medium text-stone-500">סכום לא זוהה</p>
          )}
          {amount !== null && vat > 0 && (
            <p className="text-xs text-stone-600 tabular-nums">
              מתוכו מע״מ {formatCurrency(vat)} (לפני מע״מ {formatCurrency(amount - vat)})
            </p>
          )}

          {scan.description && (
            <p className="mt-1 text-sm text-stone-700 break-words">{scan.description}</p>
          )}

          <p className="mt-1.5 text-[11px] text-stone-500 break-words">
            {item.subject || "ללא נושא"}
            {item.from && (
              <>
                {" · "}
                <span dir="ltr" className="break-all">
                  {item.from}
                </span>
              </>
            )}
          </p>

          {item.receiptPath && (
            <ReceiptLink path={item.receiptPath} name={item.attachmentName} />
          )}

          {!complete && (
            <p className="mt-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-relaxed">
              {unread.length > 0
                ? `לא הצלחנו לקרוא בביטחון: ${unread.join(", ")}. השלימו ידנית לפני האישור.`
                : "חסרים פרטים כדי לרשום את ההוצאה. פתחו ומלאו ידנית."}
            </p>
          )}
          {complete && unread.length > 0 && (
            <p className="mt-2 text-xs text-stone-600">
              לא נקראו בביטחון: {unread.join(", ")}
            </p>
          )}

          {error && <p className="mt-2 text-xs font-medium text-rose-700">{error}</p>}

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {/* Exactly one filled control per card. A scan the model left
                incomplete has nothing to one-click approve, so there the
                FORM is the primary action rather than a greyed-out אשר. */}
            {complete && (
              <button
                type="button"
                onClick={approve}
                disabled={busy !== null}
                className="pgbtn pgbtn-primary disabled:opacity-60"
              >
                {busy === "approve" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                אשר
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              disabled={busy !== null}
              className={`pgbtn disabled:opacity-60 ${complete ? "pgbtn-quiet" : "pgbtn-primary"}`}
            >
              <Pencil className="w-4 h-4" />
              {complete ? "ערוך" : "ערוך והשלם"}
            </button>
            {confirmReject ? (
              <span className="inline-flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={reject}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60"
                >
                  {busy === "reject" && <Loader2 className="w-4 h-4 animate-spin" />}
                  בטוח? דחה
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReject(false)}
                  disabled={busy !== null}
                  className="inline-flex items-center min-h-[40px] px-2 text-sm font-medium text-stone-500 hover:text-stone-800"
                >
                  ביטול
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReject(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-medium text-stone-500 hover:text-rose-700 px-2 disabled:opacity-60"
              >
                <X className="w-4 h-4" />
                דחה
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Gmail's forwarding confirmation ────────────────────────────────── */

/**
 * Gmail refuses to forward to a new address until someone proves they can
 * read that address. The proof mail lands HERE, in the app, which is exactly
 * where the user cannot see it - so this card is not muted like the other
 * failures: it is the one thing standing between them and a working setup.
 */
function GmailVerificationCard({ item, onDone }: { item: EmailInboxItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = gmailVerificationCode(item.subject);

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* selection + manual copy still works */
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await rejectEmailInboxItem(item.id);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-soft p-4 bg-gradient-to-br from-sky-50 to-indigo-50 border-sky-200">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-sky-100 flex items-center justify-center flex-shrink-0">
          <MailWarning className="w-5 h-5 text-sky-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-900">אימות העברה מ-Gmail</p>
          <p className="mt-0.5 text-xs text-stone-600 break-words" dir="auto">
            {item.subject || "ללא נושא"}
          </p>

          {code && (
            <div className="mt-3 rounded-xl bg-white border border-sky-200 p-3 flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-stone-700 shrink-0">קוד האימות</span>
              <code
                dir="ltr"
                className="flex-1 min-w-0 font-mono text-base font-bold tracking-wider text-stone-900 whitespace-nowrap text-right"
              >
                {code}
              </code>
              <button
                type="button"
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-900 border border-sky-300 bg-white rounded-lg px-2.5 min-h-[36px] hover:bg-sky-50 shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "הועתק" : "העתק"}
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-stone-600 leading-relaxed">
            הדביקו את הקוד במסך ההגדרות של Gmail.
          </p>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {/* Validated a SECOND time, here, against the same rule the
                webhook used before storing it. The link came out of a mail
                anyone who knows the forwarding address can send, and this is
                the last place before it becomes a button the owner trusts -
                so a row whose detail is not a real Google confirmation URL
                (an old row, a hand-edited one) renders no link at all. */}
            {isGmailConfirmUrl(item.detail) && (
              <a
                href={item.detail as string}
                target="_blank"
                rel="noopener noreferrer"
                className="pgbtn pgbtn-primary"
              >
                <ExternalLink className="w-4 h-4" />
                אשר את ההעברה ב-Gmail
              </a>
            )}
            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-medium text-stone-500 hover:text-stone-800 px-2 disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              סיימתי, הסתר
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── a mail that never made it to a card ────────────────────────────── */

function FailedRow({ item, onDone }: { item: EmailInboxItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setBusy(true);
    try {
      await rejectEmailInboxItem(item.id);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-xl bg-stone-50 border border-stone-200 px-3 py-2.5 flex-wrap">
      <span className="text-sm font-medium text-stone-700">{reasonText(item.reason)}</span>
      <span className="text-xs text-stone-500 min-w-0 break-words flex-1">
        {item.subject || item.attachmentName || "מייל ללא נושא"}
      </span>
      <button
        type="button"
        onClick={dismiss}
        disabled={busy}
        aria-label="הסתר"
        className="w-9 h-9 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 flex items-center justify-center shrink-0 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
      </button>
    </li>
  );
}

/* ── shared bits ────────────────────────────────────────────────────── */

/** The original attachment, behind a short-lived signed URL - the same way
 *  the expenses table opens a stored receipt. */
function ReceiptLink({ path, name }: { path: string; name: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function open() {
    setBusy(true);
    setError(false);
    const { data, error: err } = await supabase.storage
      .from("expense-receipts")
      .createSignedUrl(path, 60 * 60);
    setBusy(false);
    if (err || !data?.signedUrl) {
      setError(true);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="mt-2 inline-flex items-center gap-1.5 max-w-full text-xs font-semibold text-sky-700 hover:text-sky-900 disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
      ) : (
        <Paperclip className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="truncate">
        {error ? "לא ניתן לפתוח את הקובץ" : name || "הצג את הקובץ המקורי"}
      </span>
    </button>
  );
}

type Prefill = {
  date?: string;
  category?: string;
  supplier?: string;
  amount?: number;
  vatAmount?: number;
  description?: string;
  receiptPath?: string;
  unreadFields?: string[];
};

function normalizeCategory(category: string | null | undefined): string {
  return category && COMMON_CATEGORIES.includes(category) ? category : "אחר";
}

function prefillFor(item: EmailInboxItem): Prefill {
  const scan = item.scan || {};
  return {
    // A date the scanner could not read stays EMPTY, never today - the form
    // blocks saving until it is filled, which is the point.
    date: scan.date || undefined,
    category: normalizeCategory(scan.category),
    supplier: scan.vendor || undefined,
    amount: typeof scan.amount === "number" ? scan.amount : undefined,
    vatAmount: typeof scan.vatAmount === "number" ? scan.vatAmount : undefined,
    description: scan.description || undefined,
    receiptPath: item.receiptPath || undefined,
    unreadFields: scan.unreadFields ?? [],
  };
}

/** The form's record, narrowed to what the approve endpoint accepts. */
function approvalFrom(record: Expense): EmailInboxApproval {
  return {
    date: record.date,
    category: record.category,
    supplier: record.supplier,
    amount: record.amount,
    vatAmount: record.vatAmount ?? 0,
    description: record.description,
    supplierTaxId: record.supplierTaxId,
    reference: record.reference,
    isEquipment: record.isEquipment,
    // The form collects it as "מספר הקצאה של חשבונית הספק"; without this line
    // an עוסק מורשה who typed it would watch it disappear on approve, and the
    // PCN874 for that input would go out without the allocation number.
    allocationNumber: record.allocationNumber,
  };
}
