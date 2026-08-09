"use client";

import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Bell,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Banknote,
  CheckSquare,
  ShieldAlert,
  Settings2,
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
import { formatDate } from "@/lib/format";
import { toIsraelDate } from "@/lib/date";
import { MonthlyReminderSettingsSection } from "@/components/monthly-reminder-settings-section";
import { DunningSettingsSection } from "@/components/dunning-settings-section";

const KIND_STYLE: Record<
  NotificationKind,
  { icon: React.ElementType; iconColor: string; bg: string }
> = {
  dunning_sent: { icon: Mail, iconColor: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
  invoice_viewed: { icon: CheckCircle2, iconColor: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  payment_matched: { icon: Banknote, iconColor: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  quote_approved: { icon: CheckSquare, iconColor: "text-sky-700", bg: "bg-sky-50 border-sky-200" },
  ceiling_approaching: { icon: AlertTriangle, iconColor: "text-orange-700", bg: "bg-orange-50 border-orange-200" },
  tax_token_expiring: { icon: ShieldAlert, iconColor: "text-rose-700", bg: "bg-rose-50 border-rose-200" },
  monthly_reminder_sent: { icon: Mail, iconColor: "text-orange-700", bg: "bg-orange-50 border-orange-200" },
};

function fullTime(iso: string): string {
  const d = new Date(iso);
  const date = formatDate(toIsraelDate(d));
  const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

type TabKey = "feed" | "settings";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "feed", label: "מרכז ההתראות", icon: Bell },
  { key: "settings", label: "הגדרות תזכורות", icon: Settings2 },
];

export default function NotificationsPage() {
  const { items, unreadCount, ready } = useNotifications(100);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tab: TabKey = searchParams.get("tab") === "settings" ? "settings" : "feed";

  function setTab(next: TabKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "feed") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-sm">
              <Bell className="w-5 h-5 text-white" />
            </span>
            התראות
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            {tab === "feed"
              ? unreadCount > 0
                ? `${unreadCount} התראות חדשות`
                : "הכל נקרא"
              : "מתי ואיך תזכורות נשלחות ללקוחות ואליך"}
          </p>
        </div>
        {tab === "feed" && unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllRead()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-stone-200 text-stone-700 hover:bg-stone-50"
          >
            סמן הכל כנקרא
          </button>
        )}
      </div>

      <div
        className="inline-flex flex-wrap rounded-2xl p-1 bg-orange-50/60 border border-orange-100"
        role="tablist"
        aria-label="תצוגת התראות"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                active
                  ? "bg-white text-orange-700 shadow-sm"
                  : "text-stone-600 hover:text-orange-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              {t.key === "feed" && unreadCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[11px] font-bold">
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "feed" ? (
        <FeedTab ready={ready} items={items} />
      ) : (
        <div className="space-y-5 max-w-3xl">
          <MonthlyReminderSettingsSection />
          <DunningSettingsSection />
        </div>
      )}
    </div>
  );
}

function FeedTab({ ready, items }: { ready: boolean; items: Notification[] }) {
  if (!ready) {
    return <div className="card-soft p-10 text-center text-stone-500">טוען...</div>;
  }
  if (items.length === 0) {
    return (
      <div className="card-soft p-10 text-center">
        <Bell className="w-10 h-10 mx-auto text-stone-400 mb-3" />
        <p className="text-stone-700 font-medium">אין התראות עדיין</p>
        <p className="text-sm text-stone-500 mt-1">
          כשלקוח יפתח חשבונית, תשלום יזוהה, או הצעת מחיר תאושר, תקבל פה.
        </p>
      </div>
    );
  }
  return (
    <ul className="card-soft overflow-hidden divide-y divide-stone-100">
      {items.map((n) => (
        <NotificationRow key={n.id} notification={n} />
      ))}
    </ul>
  );
}

function NotificationRow({ notification: n }: { notification: Notification }) {
  const style = KIND_STYLE[n.kind] || KIND_STYLE.invoice_viewed;
  const Icon = style.icon;
  const isUnread = !n.readAt;
  const safeHref = isSafeHref(n.href) ? n.href : null;

  const body = (
    <div
      className={`flex items-start gap-4 px-5 py-4 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors ${
        isUnread ? "bg-orange-50/30 dark:bg-orange-950/15" : ""
      }`}
    >
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 border ${style.bg}`}>
        <Icon className={`w-5 h-5 ${style.iconColor}`} />
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
        {n.body && <p className="text-sm text-stone-600 dark:text-stone-400 mt-1">{n.body}</p>}
        <p className="text-xs text-stone-500 mt-1.5">{fullTime(n.createdAt)}</p>
      </div>
      {isUnread && <span className="w-2 h-2 rounded-full bg-orange-500 mt-2 flex-shrink-0" />}
    </div>
  );

  const handleClick = async () => {
    if (isUnread) await markRead(n.id);
  };

  return (
    <li>
      {safeHref ? (
        <Link href={safeHref} onClick={handleClick}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={handleClick} className="block w-full text-right">
          {body}
        </button>
      )}
    </li>
  );
}
