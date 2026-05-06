"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";

type CheckResult = { ok: boolean; latencyMs?: number; error?: string };
type Health = {
  ok: boolean;
  status: string;
  timestamp: string;
  latencyMs: number;
  checks: Record<string, CheckResult>;
  version: string;
};

const COMPONENT_LABELS: Record<string, string> = {
  database: "מסד נתונים",
  storage: "אחסון קבצים",
  auth: "מערכת התחברות",
};

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "לא ניתן להגיע לשרת");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const overallOk = health?.ok === true;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium mb-6"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לעמוד הבית
        </Link>

        <div className="card-soft p-8 sm:p-12 space-y-8">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md ${
                loading
                  ? "bg-gradient-to-br from-stone-300 to-stone-400"
                  : overallOk
                  ? "bg-gradient-to-br from-emerald-400 to-teal-500"
                  : "bg-gradient-to-br from-rose-400 to-orange-500"
              }`}
            >
              {loading ? (
                <Activity className="w-6 h-6 text-white animate-pulse" />
              ) : overallOk ? (
                <CheckCircle2 className="w-6 h-6 text-white" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-stone-900">סטטוס המערכת</h1>
              <p className="text-sm text-stone-600 mt-1">
                {loading
                  ? "בודק..."
                  : overallOk
                  ? "כל המערכות פועלות תקין"
                  : "אחת המערכות לא זמינה"}
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              לא הצלחנו להגיע לשרת. ייתכן שהחיבור שלך נופל. ננסה שוב בעוד 30 שניות.
            </div>
          )}

          {health && (
            <>
              <div className="space-y-3">
                {Object.entries(health.checks).map(([name, check]) => (
                  <div
                    key={name}
                    className={`flex items-center justify-between rounded-2xl border-2 p-4 ${
                      check.ok
                        ? "border-emerald-200 bg-emerald-50/50"
                        : "border-rose-200 bg-rose-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {check.ok ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-rose-600" />
                      )}
                      <span className="font-semibold text-stone-900">
                        {COMPONENT_LABELS[name] || name}
                      </span>
                    </div>
                    <div className="text-sm">
                      {check.ok ? (
                        <span className="text-emerald-700 font-mono">
                          {check.latencyMs}ms
                        </span>
                      ) : (
                        <span className="text-rose-700">{check.error || "תקלה"}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-xs text-stone-500 pt-4 border-t border-orange-100">
                <span>
                  עדכון אחרון:{" "}
                  {new Date(health.timestamp).toLocaleTimeString("he-IL", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <button
                  onClick={load}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1 hover:text-orange-600 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
                  />
                  רענן
                </button>
              </div>
            </>
          )}

          <p className="text-xs text-stone-500 leading-relaxed">
            הדף מתעדכן אוטומטית כל 30 שניות. אם אתה רואה תקלה שלא נפתרת תוך כמה
            דקות, צור קשר לכתובת{" "}
            <a
              href="mailto:asafkotlar@gmail.com"
              className="text-orange-600 hover:text-orange-700"
            >
              asafkotlar@gmail.com
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
