"use client";

import { useEffect, useState } from "react";
import {
  Users,
  FileText,
  Wallet,
  TrendingUp,
  ShieldAlert,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";
import { formatCurrency, formatDate } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";

interface Stats {
  generatedAt: string;
  users: {
    total: number;
    activeLast7d: number;
    recentSignups: Array<{
      id: string;
      email?: string;
      provider: string;
      created_at: string;
      last_sign_in_at?: string;
    }>;
  };
  documents: {
    total: number;
    last7d: number;
    recent: Array<{
      created_at: string;
      type: DocumentType;
      number: number;
      client_name: string;
      total: number;
      status: string;
    }>;
    dailyChart: Array<{ date: string; count: number }>;
  };
  clients: { total: number };
  expenses: { total: number };
  revenue: { totalPaid: number };
}

interface Health {
  ok: boolean;
  status: string;
  latencyMs: number;
  checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);

  // Hard gate: confirm the current user is an admin BEFORE rendering anything
  // useful. The API enforces this too; this is purely UX so admins don't see
  // the loading state on a page they shouldn't be looking at.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const ok = isAdminEmail(user?.email);
      setAllowed(ok);
      setChecked(true);
      if (!ok) setLoading(false);
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
      // Fetch stats and health in parallel — they're independent and the
      // health check shouldn't block stats display if it's slow.
      const [statsRes, healthRes] = await Promise.all([
        fetch("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/health", { cache: "no-store" }).catch(() => null),
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
          // Health endpoint unreachable — leave previous value
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
            סטטיסטיקות אגרגטיביות על כל המשתמשים והנתונים במערכת
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-stone-200 text-stone-800 hover:bg-stone-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          רענן
        </button>
      </div>

      {error && (
        <div className="card-soft p-4 bg-rose-50 border-rose-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-700 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800">{error}</p>
        </div>
      )}

      {loading && !stats ? (
        <div className="text-center py-16 text-stone-500">טוען נתונים...</div>
      ) : stats ? (
        <>
          {/* System status — real per-component health from /api/health */}
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

          {/* Top stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="משתמשים רשומים"
              value={String(stats.users.total)}
              sub={`${stats.users.activeLast7d} פעילים השבוע`}
              icon={Users}
              gradient="from-violet-400 to-purple-500"
              bg="from-violet-50 to-purple-50"
            />
            <StatCard
              label="סה״כ מסמכים"
              value={String(stats.documents.total)}
              sub={`+${stats.documents.last7d} השבוע`}
              icon={FileText}
              gradient="from-orange-400 to-rose-500"
              bg="from-orange-50 to-rose-50"
            />
            <StatCard
              label="הכנסות באפליקציה"
              value={formatCurrency(stats.revenue.totalPaid)}
              sub="סה״כ מסמכים ששולמו"
              icon={TrendingUp}
              gradient="from-emerald-400 to-teal-500"
              bg="from-emerald-50 to-teal-50"
              ltr
            />
            <StatCard
              label="לקוחות / הוצאות"
              value={`${stats.clients.total} / ${stats.expenses.total}`}
              sub="סה״כ לקוחות / הוצאות"
              icon={Wallet}
              gradient="from-amber-400 to-orange-500"
              bg="from-amber-50 to-orange-50"
            />
          </div>

          {/* Daily docs chart */}
          <div className="card-soft p-5">
            <h2 className="font-semibold text-stone-900 mb-4">מסמכים שנוצרו — 14 ימים אחרונים</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.documents.dailyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#fed7aa" opacity={0.4} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} reversed />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent signups */}
          <div className="card-soft overflow-hidden">
            <div className="px-5 py-3 border-b border-orange-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-stone-900">הרשמות אחרונות</h2>
            </div>
            {stats.users.recentSignups.length === 0 ? (
              <p className="p-5 text-sm text-stone-500 italic">אין הרשמות עדיין</p>
            ) : (
              <ul className="divide-y divide-orange-50">
                {stats.users.recentSignups.map((u) => (
                  <li key={u.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-orange-50/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-900 truncate" dir="ltr">
                        {u.email || "(no email)"}
                      </p>
                      <p className="text-xs text-stone-600">
                        {u.provider} · נרשם {formatDate(u.created_at.slice(0, 10))}
                        {u.last_sign_in_at && (
                          <> · התחבר לאחרונה {formatDate(u.last_sign_in_at.slice(0, 10))}</>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent docs */}
          <div className="card-soft overflow-hidden">
            <div className="px-5 py-3 border-b border-orange-100 flex items-center gap-2">
              <FileText className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-stone-900">מסמכים אחרונים — כל המשתמשים</h2>
            </div>
            {stats.documents.recent.length === 0 ? (
              <p className="p-5 text-sm text-stone-500 italic">אין מסמכים עדיין</p>
            ) : (
              <ul className="divide-y divide-orange-50">
                {stats.documents.recent.map((d, i) => (
                  <li key={i} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-orange-50/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-900 truncate">
                        {DOCUMENT_TYPE_LABELS[d.type]} #{d.number} · {d.client_name}
                      </p>
                      <p className="text-xs text-stone-600">
                        {formatDate(d.created_at.slice(0, 10))} · {d.status}
                      </p>
                    </div>
                    <span className="font-bold text-stone-900 text-sm flex-shrink-0" dir="ltr">
                      {formatCurrency(d.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
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
          <p className={`text-2xl font-bold mt-2 text-stone-900 truncate`} {...(ltr ? { dir: "ltr" } : {})}>
            {value}
          </p>
          <p className="text-xs text-stone-600 mt-1">{sub}</p>
        </div>
        <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md flex-shrink-0`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}
