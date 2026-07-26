"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";

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

/**
 * /v2/status — same live health-check logic as /status (polls
 * /api/health every 30s), re-themed in the gold/obsidian v2 design.
 */
export default function V2StatusPage() {
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
  const badgeClass = loading
    ? "is-loading"
    : overallOk
    ? "is-ok"
    : "is-down";

  return (
    <>
      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      <main className="v2-main">
        <div className="v2-doc">
          <Link href="/" className="v2-back">
            <ArrowRight />
            חזרה לעמוד הבית
          </Link>

          <div className="v2-status-head">
            <div className={`v2-status-badge ${badgeClass}`}>
              {loading ? (
                <Activity className="pulse" />
              ) : overallOk ? (
                <CheckCircle2 />
              ) : (
                <AlertTriangle />
              )}
            </div>
            <div>
              <h1 className="v2-status-title">סטטוס המערכת</h1>
              <p className="v2-status-sub">
                {loading
                  ? "בודק..."
                  : overallOk
                  ? "כל המערכות פועלות תקין"
                  : "אחת המערכות לא זמינה"}
              </p>
            </div>
          </div>

          {error && (
            <div className="v2-status-error">
              לא הצלחנו להגיע לשרת. ייתכן שיש תקלה בחיבור שלך. ננסה שוב בעוד 30
              שניות.
            </div>
          )}

          {health && (
            <>
              <div className="v2-status-list">
                {Object.entries(health.checks).map(([name, check]) => (
                  <div
                    key={name}
                    className={`v2-status-row ${check.ok ? "is-ok" : "is-down"}`}
                  >
                    <span className="name">
                      {check.ok ? <CheckCircle2 /> : <AlertTriangle />}
                      {COMPONENT_LABELS[name] || name}
                    </span>
                    <span className="val">
                      {check.ok
                        ? `${check.latencyMs}ms`
                        : check.error || "תקלה"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="v2-status-meta">
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
                  className="v2-status-refresh"
                >
                  <RefreshCw className={refreshing ? "spin" : ""} />
                  רענן
                </button>
              </div>
            </>
          )}

          <p className="v2-status-note">
            הדף מתעדכן אוטומטית כל 30 שניות. אם אתה רואה תקלה שלא נפתרת תוך כמה
            דקות, צור קשר בכתובת{" "}
            <a href="mailto:asafkotlar@gmail.com">asafkotlar@gmail.com</a>.
          </p>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
