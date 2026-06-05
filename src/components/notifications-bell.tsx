"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Banknote,
  CheckSquare,
  ShieldAlert,
} from "lucide-react";
import {
  useNotifications,
  markRead,
  markAllRead,
} from "@/lib/notifications-store";
import {
  isSafeHref,
  type Notification,
  type NotificationKind,
} from "@/lib/notifications";

const KIND_STYLE: Record<
  NotificationKind,
  { icon: React.ElementType; iconColor: string; bg: string }
> = {
  dunning_sent: {
    icon: Mail,
    iconColor: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
  invoice_viewed: {
    icon: CheckCircle2,
    iconColor: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
  },
  payment_matched: {
    icon: Banknote,
    iconColor: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
  },
  quote_approved: {
    icon: CheckSquare,
    iconColor: "text-sky-700",
    bg: "bg-sky-50 border-sky-200",
  },
  ceiling_approaching: {
    icon: AlertTriangle,
    iconColor: "text-orange-700",
    bg: "bg-orange-50 border-orange-200",
  },
  tax_token_expiring: {
    icon: ShieldAlert,
    iconColor: "text-rose-700",
    bg: "bg-rose-50 border-rose-200",
  },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "עכשיו";
  const min = Math.floor(sec / 60);
  if (min < 60) return `לפני ${min} דק'`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `לפני ${hr} שעות`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `לפני ${days} ימים`;
  const wk = Math.floor(days / 7);
  return `לפני ${wk} שב'`;
}

export function NotificationsBell() {
  const { items, unreadCount } = useNotifications(20);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`התראות (${unreadCount} חדשות)`}
        className="relative p-2 rounded-2xl hover:bg-orange-50 dark:hover:bg-orange-900/25 transition-colors text-stone-700 dark:text-stone-200"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white dark:bg-stone-900 shadow-xl border border-stone-200 dark:border-stone-700 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-700 flex items-baseline justify-between">
            <h3 className="font-bold text-stone-900 dark:text-stone-100">התראות</h3>
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    await markAllRead();
                  }}
                  className="text-xs text-stone-600 dark:text-stone-300 hover:text-stone-900"
                >
                  סמן הכל כנקרא
                </button>
              )}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs text-orange-600 hover:text-orange-700 font-medium"
              >
                הכל
              </Link>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-10 px-4">
              אין התראות עדיין.
              <br />
              כשאירוע חשוב יקרה — תקבל כאן.
            </p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {items.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClose={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification: n,
  onClose,
}: {
  notification: Notification;
  onClose: () => void;
}) {
  const style = KIND_STYLE[n.kind] || KIND_STYLE.invoice_viewed;
  const Icon = style.icon;
  const isUnread = !n.readAt;
  const safeHref = isSafeHref(n.href) ? n.href : null;

  const body = (
    <div
      className={`flex items-start gap-3 px-4 py-3 border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors ${
        isUnread ? "bg-orange-50/30 dark:bg-orange-950/15" : ""
      }`}
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 border ${style.bg}`}>
        <Icon className={`w-4 h-4 ${style.iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-snug ${
            isUnread
              ? "font-semibold text-stone-900 dark:text-stone-100"
              : "text-stone-700 dark:text-stone-300"
          }`}
        >
          {n.title}
        </p>
        {n.body && (
          <p className="text-xs text-stone-600 dark:text-stone-400 mt-0.5 line-clamp-2">{n.body}</p>
        )}
        <p className="text-[11px] text-stone-500 dark:text-stone-500 mt-1">{timeAgo(n.createdAt)}</p>
      </div>
      {isUnread && (
        <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 flex-shrink-0" aria-label="לא נקרא" />
      )}
    </div>
  );

  const handleClick = async () => {
    if (isUnread) await markRead(n.id);
    onClose();
  };

  return (
    <li>
      {safeHref ? (
        <Link href={safeHref} onClick={handleClick}>
          {body}
        </Link>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="block w-full text-right"
        >
          {body}
        </button>
      )}
    </li>
  );
}

