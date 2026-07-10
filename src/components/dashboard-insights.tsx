"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, TrendingUp, AlertTriangle, ArrowLeft, Info, Lightbulb } from "lucide-react";
import { supabase } from "@/lib/supabase";

type InsightKind = "positive" | "warning" | "action" | "info";

type Insight = {
  kind: InsightKind;
  text: string;
  href?: string | null;
};

const STYLES: Record<InsightKind, { bg: string; border: string; iconBg: string; iconText: string; icon: React.ElementType }> = {
  positive: {
    bg: "bg-emerald-50/80",
    border: "border-emerald-200",
    iconBg: "bg-gradient-to-br from-emerald-400 to-teal-500",
    iconText: "text-white",
    icon: TrendingUp,
  },
  warning: {
    bg: "bg-amber-50/80",
    border: "border-amber-200",
    iconBg: "bg-gradient-to-br from-amber-400 to-orange-500",
    iconText: "text-white",
    icon: AlertTriangle,
  },
  action: {
    bg: "bg-sky-50/80",
    border: "border-sky-200",
    iconBg: "bg-gradient-to-br from-sky-400 to-blue-500",
    iconText: "text-white",
    icon: Lightbulb,
  },
  info: {
    bg: "bg-stone-50",
    border: "border-stone-200",
    iconBg: "bg-gradient-to-br from-stone-400 to-stone-500",
    iconText: "text-white",
    icon: Info,
  },
};

export function DashboardInsights() {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (!cancelled) setLoading(false);
          return;
        }
        const res = await fetch("/api/dashboard/insights", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error || "טעינת תובנות נכשלה.");
        } else {
          setInsights((json.insights || []) as Insight[]);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "טעינת תובנות נכשלה.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="card-soft p-5 bg-gradient-to-br from-violet-50/60 to-fuchsia-50/40 border-violet-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white animate-pulse" />
          </div>
          <h2 className="font-bold text-stone-900">תובנות AI</h2>
          <span className="text-xs text-stone-500">מנתח את הנתונים שלך…</span>
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-violet-100 rounded-full w-3/4 animate-pulse" />
          <div className="h-4 bg-violet-100 rounded-full w-2/3 animate-pulse" />
          <div className="h-4 bg-violet-100 rounded-full w-5/6 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !insights || insights.length === 0) {
    return null;
  }

  return (
    <div className="card-soft p-5 bg-gradient-to-br from-violet-50/60 to-fuchsia-50/40 border-violet-100">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <h2 className="font-bold text-stone-900">תובנות AI</h2>
      </div>
      <div className="space-y-2.5">
        {insights.map((insight, idx) => {
          const style = STYLES[insight.kind] || STYLES.info;
          const Icon = style.icon;
          // Defense-in-depth: server already strips unsafe hrefs, but if a
          // future code path bypasses it, the Link must still refuse to
          // navigate anywhere except a same-origin relative path.
          const safeHref =
            typeof insight.href === "string" &&
            insight.href.startsWith("/") &&
            !insight.href.startsWith("//")
              ? insight.href
              : null;
          const body = (
            <div
              className={`gk-insight flex items-start gap-3 p-3 rounded-2xl border ${style.bg} ${style.border} ${
                safeHref ? "hover:shadow-sm transition-shadow cursor-pointer" : ""
              }`}
            >
              <div className={`w-7 h-7 rounded-xl ${style.iconBg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                <Icon className={`w-3.5 h-3.5 ${style.iconText}`} />
              </div>
              <p className="text-sm text-stone-800 leading-relaxed flex-1 pt-0.5">{insight.text}</p>
              {safeHref && <ArrowLeft className="w-4 h-4 text-stone-400 flex-shrink-0 mt-1.5" />}
            </div>
          );
          return safeHref ? (
            <Link key={idx} href={safeHref}>
              {body}
            </Link>
          ) : (
            <div key={idx}>{body}</div>
          );
        })}
      </div>
    </div>
  );
}
