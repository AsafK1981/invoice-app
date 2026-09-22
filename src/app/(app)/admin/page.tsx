"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users,
  UserPlus,
  FileText,
  BarChart3,
  TrendingUp,
  ShieldAlert,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  Gift,
  Upload,
  Activity,
  Coins,
} from "lucide-react";
import { AdminHistoryChart } from "@/components/admin-history-chart";
import { supabase } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";
import { formatCurrency, formatDate, formatTimeAgo } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";
import { ActivityFeed } from "@/components/admin-activity-feed";

/**
 * One account, as the operator sees it: identity, dates and counts. Nothing a
 * customer typed. Do not add client names, subjects or amounts to this row.
 */
interface AdminUserRow {
  id: string;
  email?: string;
  provider: string;
  created_at: string;
  last_sign_in_at?: string;
  /** Ours (founder / father / demo / QA / bot), not a customer. */
  internal: boolean;
  hasBusiness: boolean;
  /** Documents this account produced in the app. Bulk imports excluded. */
  documents: number;
  documents30d: number;
}

interface Stats {
  generatedAt: string;
  users: {
    dailyChart: Array<{ date: string; count: number }>;
    recentSignups: AdminUserRow[];
  };
  /**
   * The product scoreboard. Every number here EXCLUDES our own accounts
   * (founder, father's tax-testing business, demo, QA, the Lynkeus bot), which
   * is the whole point: `registered` counts everyone, `real` counts customers.
   */
  people: {
    registered: number;
    internal: number;
    real: number;
    activeLast7d: number;
    activeLast30d: number;
    signupsLast30d: number;
    signupsPrev30d: number;
    withBusiness: number;
    producers: number;
    producers30d: number;
    producers7d: number;
    producedTotal: number;
    produced30d: number;
    avgPerProducer: number;
    medianPerProducer: number;
    topProducer: number;
    importedDocuments: number;
  };
  documents: {
    last30d: number;
    /**
     * Counts by type over the last 30 days. This replaced a "last 20 documents"
     * list that showed each document's client name, number and amount: operator
     * metadata, not operator reading material. Do not put contents back here.
     */
    byType30d: Array<{ type: DocumentType; count: number; drafts: number }>;
    dailyChart: Array<{ date: string; count: number }>;
  };
  revenue: { inAppTurnover: number; importedTurnover: number };
}

interface Health {
  ok: boolean;
  status: string;
  latencyMs: number;
  checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
}

import { useAdminActivityPager } from "@/lib/use-admin-activity-pager";


export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const { state: activity, pager: activityPager } = useAdminActivityPager();
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);

  // Hard gate: confirm the current user is an admin BEFORE rendering anything
  // useful. The API enforces this too; this is purely UX so admins don't see
  // the loading state on a page they shouldn't be looking at.
  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        const ok = isAdminEmail(user?.email);
        setAllowed(ok);
        setChecked(true);
        if (!ok) setLoading(false);
      })
      // Without this the promise could reject on a flaky connection and
      // `setChecked` would never run, leaving the gate spinning forever with
      // no way out. Deny and stop: a "not allowed" screen is at least a state
      // the user can act on, and denying is the safe default for an admin gate.
      .catch(() => {
        setAllowed(false);
        setChecked(true);
        setLoading(false);
      });
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("לא מחובר");
        return;
      }
      // Fetch stats and health in parallel; they're independent and the
      // health check shouldn't block stats display if it's slow.
      void activityPager.refresh();
      const [statsRes, healthRes] = await Promise.all([
        fetch("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } }),
        // Pass the admin bearer so /api/health includes the deploy SHA
        // (the public endpoint hides it from anonymous callers).
        fetch("/api/health", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null),
      ]);
      const statsData = await statsRes.json();
      if (!statsData.ok) {
        setError(statsData.error || "שגיאה בטעינת הסטטיסטיקות");
        return;
      }
      setStats(statsData);
      if (healthRes) {
        try {
          const healthData = await healthRes.json();
          setHealth(healthData);
        } catch {
          // Health endpoint unreachable; leave previous value
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  if (!checked) {
    return <div className="text-center py-16 text-stone-500">בודק הרשאות...</div>;
  }

  if (!allowed) {
    return (
      <div className="card-soft p-12 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-rose-100 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-7 h-7 text-rose-600" />
        </div>
        <h2 className="font-bold text-stone-900 mb-2">אין לך גישה</h2>
        <p className="text-sm text-stone-700">העמוד הזה נגיש רק למנהלי המערכת.</p>
      </div>
    );
  }

  const chartStartedAt = stats
    ? [stats.documents.dailyChart[0]?.date, stats.users.dailyChart[0]?.date].filter(Boolean).sort()[0]
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-stone-700 to-stone-900 flex items-center justify-center shadow-sm">
              <ShieldAlert className="w-5 h-5 text-white" />
            </span>
            פאנל ניהול
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            מי נרשם, מי חוזר, ומה הם מפיקים. החשבונות שלי ושל ה-QA לא נספרים.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/invites"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-emerald-500 to-teal-500 text-white hover:shadow-md hover:shadow-emerald-200"
          >
            <Gift className="w-4 h-4" />
            הזמנות בטא
          </Link>
          <Link
            href="/admin/budget"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-amber-500 to-orange-500 text-white hover:shadow-md hover:shadow-amber-200"
          >
            <Coins className="w-4 h-4" />
            תקציב
          </Link>
          <Link
            href="/admin/import-for-user"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-violet-500 to-purple-500 text-white hover:shadow-md hover:shadow-violet-200"
          >
            <Upload className="w-4 h-4" />
            Concierge import
          </Link>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-stone-200 text-stone-800 hover:bg-stone-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            רענן
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="card-soft p-4 bg-rose-50 border-rose-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-700 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800">{error}</p>
        </div>
      )}

      {loading && !stats ? (
        <div className="text-center py-16 text-stone-500">טוען נתונים...</div>
      ) : stats ? (
        <>
          {/* System status: real per-component health from /api/health */}
          {health ? (
            <div
              className={`card-soft p-4 border ${
                health.ok
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-rose-50 border-rose-200"
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                {health.ok ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-rose-700" />
                )}
                <div className="flex-1">
                  <p
                    className={`text-sm font-semibold ${
                      health.ok ? "text-emerald-900" : "text-rose-900"
                    }`}
                  >
                    {health.ok ? "כל הרכיבים תקינים" : "יש רכיב לא תקין"}
                  </p>
                  <p
                    className={`text-xs ${
                      health.ok ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    זמן בדיקה: {health.latencyMs}ms · עודכן{" "}
                    {new Date(stats.generatedAt).toLocaleTimeString("he-IL")}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(health.checks).map(([name, c]) => (
                  <div
                    key={name}
                    className={`rounded-xl border p-2.5 text-center ${
                      c.ok
                        ? "bg-white border-emerald-200"
                        : "bg-white border-rose-300"
                    }`}
                  >
                    <p className="text-xs text-stone-600">
                      {name === "database"
                        ? "DB"
                        : name === "storage"
                          ? "Storage"
                          : "Auth"}
                    </p>
                    <p
                      className={`text-sm font-bold ${
                        c.ok ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {c.ok ? `✓ ${c.latencyMs}ms` : "✗ down"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card-soft p-4 bg-stone-50 border-stone-200 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-stone-500" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-stone-700">
                  סטטוס מערכת לא זמין
                </p>
                <p className="text-xs text-stone-500">
                  עודכן: {new Date(stats.generatedAt).toLocaleString("he-IL")}
                </p>
              </div>
            </div>
          )}

          {/* Colour follows the brand ramps remapped in globals.css, not the
              Tailwind names: violet/purple resolve to charcoal (a neutral
              fact), amber/orange to the brand accent (the growth number, the
              one orange touch in this row), emerald to the positive state.
              Do not reach for sky or fuchsia here - they are charcoal too,
              and three names for one colour only mislead the next reader.

              People: how many customers there are and how many are alive.
              Every figure excludes our own accounts; the raw signup total is
              shown as the smaller line so the two are never confused. This
              replaced a "clients / expenses" card that counted rows inside
              customers' address books - platform data volume, which answered
              no question the operator actually has. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="משתמשים אמיתיים"
              value={String(stats.people.real)}
              sub={`${stats.people.registered} רשומים, מהם ${stats.people.internal} חשבונות שלי`}
              icon={Users}
              gradient="from-violet-400 to-purple-500"
              bg="from-violet-50 to-purple-50"
            />
            <StatCard
              label="נכנסו ב-7 ימים"
              value={String(stats.people.activeLast7d)}
              sub={`${stats.people.activeLast30d} נכנסו ב-30 יום`}
              icon={Activity}
              gradient="from-violet-400 to-purple-500"
              bg="from-violet-50 to-purple-50"
            />
            <StatCard
              label="נרשמו ב-30 יום"
              value={String(stats.people.signupsLast30d)}
              sub={signupTrend(stats.people.signupsPrev30d)}
              icon={UserPlus}
              gradient="from-amber-400 to-orange-500"
              bg="from-amber-50 to-orange-50"
            />
            <StatCard
              label="משתמשים שמפיקים"
              value={String(stats.people.producers)}
              sub={`${stats.people.producers30d} הפיקו החודש, ${stats.people.producers7d} השבוע`}
              icon={FileText}
              gradient="from-emerald-400 to-teal-500"
              bg="from-emerald-50 to-teal-50"
            />
          </div>

          {/* Volume: what all those people actually made. */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              label="מסמכים שהפיקו לקוחות"
              value={String(stats.people.producedTotal)}
              sub={`${stats.people.produced30d} הופקו החודש · ${stats.people.importedDocuments} יובאו מתוכנה אחרת`}
              icon={FileText}
              gradient="from-orange-500 to-orange-700"
              bg="from-orange-50 to-orange-100"
            />
            <StatCard
              label="מסמכים למשתמש"
              value={String(stats.people.avgPerProducer)}
              sub={`חציון ${stats.people.medianPerProducer}, הכי פעיל ${stats.people.topProducer}`}
              icon={BarChart3}
              gradient="from-violet-400 to-purple-500"
              bg="from-violet-50 to-purple-50"
            />
            <StatCard
              label="מחזור שנוצר באפליקציה"
              value={formatCurrency(Math.round(stats.revenue.inAppTurnover))}
              sub={`לפני מע״מ · לא כולל ${formatCurrency(Math.round(stats.revenue.importedTurnover))} היסטוריה מיובאת`}
              icon={TrendingUp}
              gradient="from-emerald-400 to-teal-500"
              bg="from-emerald-50 to-teal-50"
              ltr
            />
          </div>

          <AdminHistoryChart
            title="מסמכים שנוצרו"
            seriesLabel="מסמכים"
            daily={stats.documents.dailyChart}
            generatedAt={stats.generatedAt}
            startedAt={chartStartedAt}
          />
          <AdminHistoryChart
            title="נרשמים חדשים"
            seriesLabel="נרשמים חדשים"
            daily={stats.users.dailyChart}
            generatedAt={stats.generatedAt}
            startedAt={chartStartedAt}
            color="#7C3AED"
          />

          {/* Live usage: who did what KIND of thing, and when. Metadata by
              construction (see src/lib/admin-activity.ts): the account, its
              own business name, the document type and the timestamp. Never a
              number, a client, or an amount. */}
          <div className="card-soft overflow-hidden">
            <div className="px-5 py-3 border-b border-orange-100 flex items-center gap-2 flex-wrap">
              <Activity className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-stone-900">פעילות אחרונה</h2>
              <span className="text-xs text-stone-500 mr-auto">
                מטא-דאטה בלבד: בלי סכומים, בלי שמות לקוחות
              </span>
            </div>
            <ActivityFeed state={activity} onLoadMore={activityPager.loadMore} onRetry={activityPager.retry} />
          </div>

          {/* One account per row: who signed up, whether they came back, and
              how much they actually produced. Replaced a signup list that
              showed only dates, which could not answer "who is using this". */}
          <UsersTable rows={stats.users.recentSignups} internalCount={stats.people.internal} />

          {/* Onboarding funnel */}
          <div className="card-soft p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingDown className="w-4 h-4 text-orange-500" />
                <h2 className="font-semibold text-stone-900">משפך הצטרפות</h2>
                <span className="text-xs text-stone-500 mr-auto">
                  בלי החשבונות שלי
                </span>
              </div>
            <FunnelBars people={stats.people} />
          </div>

          {/* Documents by type, last 30 days. Counts only, on purpose: this
              card replaced a "last 20 documents" list that named each client
              and amount. The operator needs volume, not contents. */}
          <div className="card-soft overflow-hidden">
            <div className="px-5 py-3 border-b border-orange-100 flex items-center gap-2">
              <FileText className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-stone-900">מסמכים ב-30 יום לפי סוג</h2>
              <span className="text-xs text-stone-500 mr-auto">
                {stats.documents.last30d} סה״כ
              </span>
            </div>
            {stats.documents.byType30d.length === 0 ? (
              <p className="p-5 text-sm text-stone-500 italic">
                לא נוצרו מסמכים ב-30 הימים האחרונים
              </p>
            ) : (
              <DocTypeCounts rows={stats.documents.byType30d} />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

type SortKey = "signup" | "documents" | "lastSeen";

/** Rebuilding this on every render and every sort click bought nothing. */
const USER_SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "documents", label: "לפי מסמכים" },
  { key: "signup", label: "לפי הרשמה" },
  { key: "lastSeen", label: "לפי כניסה" },
];

/**
 * The shared picker turns into a five-column grid under 640px, which squeezed
 * three Hebrew labels until the last one ran into the border. Wrapping instead
 * of gridding keeps every label whole at any width.
 */
const SORT_GROUP = { display: "inline-flex", flexWrap: "wrap" } as const;

/**
 * The previous 30 days, spelled out, so the headline number has something to
 * be measured against. Stated as a plain comparison rather than a delta or a
 * percentage: with single-digit signups a "+1300%" would be noise, and zero
 * prior signups has no percentage at all.
 */
function signupTrend(previous: number): string {
  if (previous === 0) return "אף הרשמה ב-30 יום שלפני";
  return `לעומת ${previous} ב-30 יום שלפני`;
}

/**
 * Every account in one sortable table: identity, whether they came back, and
 * how many documents they produced. Counts and dates only.
 *
 * Our own accounts are hidden by default and counted in the header, so the
 * table answers "how are my customers doing" without the founder, the QA bot
 * and the demo account padding every column.
 */
function UsersTable({ rows, internalCount }: { rows: AdminUserRow[]; internalCount: number }) {
  const [sort, setSort] = useState<SortKey>("documents");
  const [showInternal, setShowInternal] = useState(false);

  // The page re-renders on every refresh and health poll; without this the
  // whole list is filtered and sorted again each time for nothing.
  const visible = useMemo(
    () =>
      rows
        .filter((r) => showInternal || !r.internal)
        .sort((a, b) => {
          if (sort === "documents") return b.documents - a.documents;
          if (sort === "lastSeen") return (b.last_sign_in_at || "").localeCompare(a.last_sign_in_at || "");
          return (b.created_at || "").localeCompare(a.created_at || "");
        }),
    [rows, sort, showInternal],
  );

  return (
    <div className="card-soft overflow-hidden">
      <div className="px-5 py-3 border-b border-orange-100 flex items-center gap-x-3 gap-y-2 flex-wrap">
        <Users className="w-4 h-4 text-orange-500 flex-shrink-0" />
        <h2 className="font-semibold text-stone-900">משתמשים</h2>
        <span className="text-xs text-stone-500">{visible.length} שורות</span>
        <div className="flex items-center gap-2 mr-auto flex-wrap">
          {/* The app's segmented picker (.dash-range + .rpt-modes), the same
              control /reports, /expenses, /obligations and the aging report
              use. The inline style is how the other call sites opt out of the
              five-up mobile grid the CSS assumes. */}
          <div className="dash-range rpt-modes" style={SORT_GROUP} role="group" aria-label="מיון המשתמשים">
            {USER_SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSort(option.key)}
                aria-pressed={sort === option.key}
                className={`dash-range-btn${sort === option.key ? " is-active" : ""}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {internalCount > 0 && (
            <label className="flex items-center gap-1.5 py-2 text-xs text-stone-600 hover:text-stone-900 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={showInternal}
                onChange={(e) => setShowInternal(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-600"
              />
              הצג גם את {internalCount} החשבונות שלי
            </label>
          )}
          {/* נספח ה' (ה): the software house customer book, printable. */}
          <button
            type="button"
            onClick={() => void downloadCustomerBook()}
            className="text-xs text-stone-600 underline hover:text-stone-900"
            title="ספר לקוחות של בית התוכנה (הוראות ניהול ספרים, נספח ה' (ה))"
          >
            ספר לקוחות (CSV)
          </button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="p-5 text-sm text-stone-500 italic">אין הרשמות עדיין</p>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto" tabIndex={0} aria-label="משתמשים">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-stone-50 text-xs text-stone-600 shadow-[0_1px_0_0_var(--color-orange-100)]">
              <tr>
                <th scope="col" className="text-right font-medium px-5 py-2">חשבון</th>
                <th scope="col" className="text-center font-medium px-2 py-2">מסמכים</th>
                <th scope="col" className="text-center font-medium px-2 py-2 hidden sm:table-cell">ב-30 יום</th>
                <th scope="col" className="text-right font-medium px-2 py-2 hidden md:table-cell">נרשם</th>
                <th scope="col" className="text-right font-medium px-5 py-2 hidden md:table-cell">כניסה אחרונה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-orange-50">
              {visible.map((u) => <UserRow key={u.id} user={u} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** One account. Split out so the signup date is formatted once per row. */
function UserRow({ user }: { user: AdminUserRow }) {
  const signedUp = formatDate(user.created_at.slice(0, 10));
  return (
    <tr className="hover:bg-orange-50/40">
      <td className="px-5 py-3 max-w-0">
        <p className="font-medium text-stone-900 truncate" dir="ltr" title={user.email || ""}>
          {user.email || "(no email)"}
        </p>
        <p className="text-xs text-stone-600 truncate">
          {user.provider}
          {user.internal && <span className="text-stone-500"> · חשבון שלי</span>}
          {!user.internal && !user.hasBusiness && (
            <span className="text-rose-700"> · לא השלים פרטי עסק</span>
          )}
          {!user.internal && user.hasBusiness && user.documents === 0 && (
            <span className="text-amber-700"> · עוד לא הפיק מסמך</span>
          )}
          {/* The dates hidden on narrow screens still have to be readable
              there, so they repeat under the address. */}
          <span className="md:hidden">{` · נרשם ${signedUp}`}</span>
        </p>
      </td>
      <td className="px-2 py-3 text-center font-semibold text-stone-900 tabular-nums">
        {user.documents}
      </td>
      <td className="px-2 py-3 text-center text-stone-700 tabular-nums hidden sm:table-cell">
        {user.documents30d}
      </td>
      <td className="px-2 py-3 text-stone-700 whitespace-nowrap hidden md:table-cell">
        {signedUp}
      </td>
      <td className="px-5 py-3 text-stone-700 whitespace-nowrap hidden md:table-cell">
        {user.last_sign_in_at ? formatTimeAgo(user.last_sign_in_at) : "לא נכנס"}
      </td>
    </tr>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  gradient,
  bg,
  ltr,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Users;
  gradient: string;
  bg: string;
  ltr?: boolean;
}) {
  return (
    <div className={`card-soft p-5 bg-gradient-to-br ${bg} border-transparent`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-stone-700">{label}</p>
          <p className={`text-xl sm:text-2xl font-bold mt-2 text-stone-900 truncate`} {...(ltr ? { dir: "ltr" } : {})}>
            {value}
          </p>
          <p className="text-xs text-stone-600 mt-1">{sub}</p>
        </div>
        {/* Hidden on phones: in the two-column grid the icon ate the width
            the number needs, and the figure truncated to "19..." */}
        <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${gradient} hidden sm:flex items-center justify-center shadow-md flex-shrink-0`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

function FunnelBars({ people }: { people: Stats["people"] }) {
  const max = Math.max(people.real, 1);
  const stages: Array<{ label: string; count: number; gradient: string }> = [
    { label: "נרשמו", count: people.real, gradient: "from-orange-500 to-orange-700" },
    {
      label: "השלימו פרטי עסק",
      count: people.withBusiness,
      gradient: "from-amber-400 to-orange-500",
    },
    {
      label: "הפיקו מסמך ראשון",
      count: people.producers,
      gradient: "from-emerald-400 to-teal-500",
    },
  ];
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const pct = Math.round((s.count / max) * 100);
        const fromPrev =
          i === 0 || stages[i - 1].count === 0
            ? null
            : Math.round((s.count / stages[i - 1].count) * 100);
        return (
          <div key={s.label}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-stone-700">{s.label}</span>
              <span className="font-semibold text-stone-900">
                {s.count}
                {fromPrev !== null && (
                  <span className="text-xs text-stone-500 mr-2">({fromPrev}% מהשלב הקודם)</span>
                )}
              </span>
            </div>
            <div className="h-3 rounded-full bg-stone-100 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-l ${s.gradient}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DocTypeCounts({
  rows,
}: {
  rows: Array<{ type: DocumentType; count: number; drafts: number }>;
}) {
  // Bars are relative to the busiest type, not to the total: with one dominant
  // type every other bar would be an invisible sliver against the total.
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="divide-y divide-orange-50">
      {rows.map((r) => (
        <li key={r.type} className="px-5 py-3 hover:bg-orange-50/40">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-sm font-medium text-stone-900">
              {DOCUMENT_TYPE_LABELS[r.type] || r.type}
            </span>
            <span className="text-sm font-bold text-stone-900">
              {r.count}
              {r.drafts > 0 && (
                <span className="text-xs font-normal text-stone-500 mr-2">
                  ({r.drafts} טיוטות)
                </span>
              )}
            </span>
          </div>
          <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-l from-orange-500 to-orange-700"
              style={{ width: `${Math.round((r.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Downloads the software-house customer book (נספח ה' (ה)) as CSV through the
 * admin-only route; the route logs the access.
 */
async function downloadCustomerBook() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;
  const res = await fetch("/api/admin/customer-book", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    window.alert("הורדת ספר הלקוחות נכשלה");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `customer-book-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
