"use client";
import { useEffect, useRef } from "react";
import { Users, Upload, FilePlus2, Mail, Banknote, Receipt, UserPlus, LogIn } from "lucide-react";
import { describeAdminActivity, type AdminActivityKind } from "@/lib/admin-activity";
import { activityNearBottom, type ActivityPagerState } from "@/lib/admin-activity-pager";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { formatTimeAgo } from "@/lib/format";

const ACTIVITY_STYLE: Record<
  AdminActivityKind,
  { icon: typeof Users; iconText: string; bg: string }
> = {
  "data.imported": { icon: Upload, iconText: "text-orange-700", bg: "bg-orange-100" },
  "document.created": { icon: FilePlus2, iconText: "text-orange-700", bg: "bg-orange-100" },
  "document.emailed": { icon: Mail, iconText: "text-sky-700", bg: "bg-sky-100" },
  "document.paid": { icon: Banknote, iconText: "text-emerald-700", bg: "bg-emerald-100" },
  "expense.created": { icon: Receipt, iconText: "text-amber-700", bg: "bg-amber-100" },
  "client.created": { icon: UserPlus, iconText: "text-violet-700", bg: "bg-violet-100" },
  "user.signed_in": { icon: LogIn, iconText: "text-stone-600", bg: "bg-stone-100" },
};

function exactTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })} ${d.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  })}`;
}

export function ActivityFeed({ state, onLoadMore, onRetry }: { state: ActivityPagerState; onLoadMore: () => void; onRetry: () => void }) {
  const root = useRef<HTMLUListElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);
  const canLoad = state.initialized && !!state.nextCursor && !state.loading && !state.error;
  useEffect(() => {
    if (!canLoad || !root.current || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onLoadMore();
    }, { root: root.current, rootMargin: "160px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [canLoad, state.events.length, onLoadMore]);
  return (
    <ul ref={root} tabIndex={0} onScroll={event => { if (canLoad && activityNearBottom(event.currentTarget)) onLoadMore(); }} aria-label="פעילות אחרונה" aria-busy={state.loading} className="divide-y divide-orange-50 max-h-[32rem] overflow-y-auto">
      {state.events.map((e) => {
        const style = ACTIVITY_STYLE[e.kind] ?? ACTIVITY_STYLE["document.created"];
        const Icon = style.icon;
        // Two lines, never one truncating line: an email is LTR inside an RTL
        // sentence, and on a phone the action was the part that got cut off.
        // Line 1 is who (the business name they chose, or their email), line 2
        // is what they did, with the email as a bidi-isolated tail.
        return (
          <li key={e.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-orange-50/40">
            <span
              className={`w-8 h-8 rounded-xl ${style.bg} flex items-center justify-center flex-shrink-0`}
              aria-hidden="true"
            >
              <Icon className={`w-4 h-4 ${style.iconText}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-stone-900 truncate">
                {e.businessName ? (
                  e.businessName
                ) : e.email ? (
                  <bdi dir="ltr">{e.email}</bdi>
                ) : (
                  "משתמש לא מזוהה"
                )}
              </p>
              <p className="text-xs text-stone-600 truncate">
                {describeAdminActivity(e, DOCUMENT_TYPE_LABELS)}
                {/* On a phone the email tail truncated from its START (it is
                    LTR at the end of an RTL line); the business name above
                    already identifies the account there. */}
                {e.businessName && e.email && (
                  <span className="hidden sm:inline">
                    <span className="text-stone-400"> · </span>
                    <bdi dir="ltr">{e.email}</bdi>
                  </span>
                )}
              </p>
            </div>
            <time
              dateTime={e.at}
              title={exactTime(e.at)}
              className="text-xs text-stone-500 whitespace-nowrap flex-shrink-0"
            >
              {formatTimeAgo(e.at)}
            </time>
          </li>
        );
      })}
      <li ref={sentinel} className="px-5 py-3 text-sm text-stone-500" aria-live="polite">
        {state.loading ? "טוען פעילות..." : state.error ? (
          <><span role="alert">{state.error}</span>{" "}<button type="button" onClick={onRetry}>נסה שוב</button></>
        ) : state.nextCursor ? (
          <button type="button" onClick={onLoadMore}>טען פעילות קודמת</button>
        ) : state.initialized ? (state.events.length ? "הוצגה כל הפעילות הזמינה" : "אין פעילות להצגה") : "טוען פעילות..."}
      </li>
    </ul>
  );
}

