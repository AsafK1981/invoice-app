"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Landmark,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  XCircle,
  Loader2,
  ShieldCheck,
  Check,
  ArrowDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { canIssueTaxInvoicesByType } from "@/lib/vat";

/**
 * Settings card for "חשבונית ישראל" — Israel Tax Authority allocation
 * number API. Shows one of three states:
 *
 *   1. Vendor not configured — app owner hasn't registered with gov.il
 *      yet. No connect button is shown; the section just explains that
 *      this is coming soon.
 *   2. Exempt dealer — business_type is "exempt". Section is hidden
 *      (allocation numbers don't apply to עוסק פטור).
 *   3. Vendor configured + VAT-charging business (authorized / company)
 *      + not connected — shows a "Connect" button that starts OAuth.
 *   4. Connected — shows status (last used, expires when, environment)
 *      and a Disconnect button.
 *
 * Visual direction: "quietly premium institutional" — a refined nod to
 * an official, secure government document (medallion icon with a halo,
 * an eyebrow trust label, a connected gradient stepper, and a faint
 * security-pattern dot texture) while staying cohesive with the app's
 * warm card-soft language.
 */
interface Status {
  ok: boolean;
  vendorConfigured: boolean;
  environment: "sandbox" | "production";
  businessType: "exempt" | "authorized" | "company" | null;
  connected: boolean;
  /** Current allocation-required threshold in ₪ (date-aware, from the server). */
  threshold?: number;
  credentials: {
    vat_number: string;
    connected_at: string;
    expires_at: string;
    last_used_at: string | null;
    environment: "sandbox" | "production";
    last_error: string | null;
  } | null;
}

const CONNECT_STEPS = [
  "לחיצה על הכפתור תעביר אותך לאתר רשות המסים. התחבר עם פרטי השירותים הדיגיטליים שלך (ת.ז + קוד משתמש קבוע) ואשר את הגישה.",
  "תוחזר לכאן אוטומטית — והעסק שלך מחובר. אין מה למלא ידנית.",
  "מכאן, כל חשבונית מס מעל הסף תקבל מספר הקצאה מרשות המסים בלחיצה אחת.",
];

// Faint banknote-style dot guilloché — signals "official / secure" without shouting.
const SECURITY_TEXTURE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(circle at 1px 1px, rgba(79,70,229,0.07) 1px, transparent 0)",
  backgroundSize: "15px 15px",
};

export function TaxAuthoritySection() {
  const search = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    // After OAuth callback, gov.il redirects to /settings?tax_authority=connected or =error
    const flag = search.get("tax_authority");
    if (flag === "connected") {
      setToast({ kind: "success", text: "התחברת בהצלחה לרשות המיסים." });
    } else if (flag === "error") {
      const reason = search.get("reason") || "שגיאה";
      setToast({ kind: "error", text: `החיבור נכשל: ${reason}` });
    }
  }, [search]);

  async function load() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/tax-authority/status", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.ok) setStatus(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleConnect() {
    setActing(true);
    setToast(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/tax-authority/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.href = data.url;
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה" });
        setActing(false);
      }
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "שגיאה" });
      setActing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("לנתק את החיבור לרשות המיסים? תוכל לחבר מחדש בכל עת.")) return;
    setActing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/tax-authority/status", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ kind: "success", text: "החיבור נותק." });
        load();
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה" });
      }
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="card-soft p-5">
        <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
      </div>
    );
  }

  // Hide entirely for exempt businesses — allocation numbers don't apply.
  if (status?.businessType === "exempt") return null;

  return (
    <div className="card-soft relative overflow-hidden p-6 space-y-5">
      {/* Atmospheric corner glow — adds depth to an otherwise flat white card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -left-16 w-56 h-56 rounded-full bg-indigo-300/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-indigo-500 via-blue-500 to-transparent"
      />

      <div className="relative flex items-start gap-3.5">
        {/* Medallion: layered gradient + inset highlight + soft halo ring */}
        <div className="relative flex-shrink-0">
          <div className="absolute inset-0 rounded-2xl bg-indigo-400/30 blur-md" aria-hidden />
          <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-400/40 ring-1 ring-inset ring-white/25">
            <Landmark className="w-[22px] h-[22px] text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
            <span className="text-[11px] font-bold tracking-wide text-indigo-600/90">
              שירות רשמי · רשות המסים
            </span>
          </div>
          <h2 className="font-extrabold text-stone-900 text-[15px] leading-tight">
            חשבונית ישראל — מספרי הקצאה
          </h2>
          <p className="text-sm text-stone-600 mt-1.5 leading-relaxed">
            חיבור פעם אחת — וכל חשבונית מס מעל הסף מקבלת מספר הקצאה רשמי אוטומטית.
          </p>
          <span className="inline-flex items-center gap-1 mt-2.5 px-2.5 py-1 rounded-full bg-stone-100/80 border border-stone-200/70 text-[11px] font-semibold text-stone-600">
            סף נוכחי
            <span className="font-mono text-stone-900">
              ₪{(status?.threshold ?? 5000).toLocaleString("he-IL")}
            </span>
          </span>
        </div>
      </div>

      {toast && (
        <div
          className={`relative flex items-start gap-2 text-sm p-3.5 rounded-2xl ${
            toast.kind === "success"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
              : "bg-rose-50 border border-rose-200 text-rose-900"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
          ) : (
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {!status?.vendorConfigured && (
        <div className="relative rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-stone-900">בקרוב — האפליקציה בתהליך רישום ברשות המסים</p>
              <p className="text-stone-700 mt-1">
                התשתית מוכנה. ברגע שהרישום של MySuperFriendlyInvoiceApp כבית-תוכנה יושלם, יופיע
                כפתור "חיבור" כאן.
              </p>
            </div>
          </div>
        </div>
      )}

      {status?.vendorConfigured && status?.businessType === null && (
        <p className="relative text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-3.5">
          השלם קודם את פרטי העסק (סוג עסק = עוסק מורשה) למעלה.
        </p>
      )}

      {status?.vendorConfigured &&
        canIssueTaxInvoicesByType(status?.businessType) &&
        !status?.connected && (
        <div className="relative space-y-4">
          {/* Connect walkthrough — a connected gradient stepper over a faint security texture */}
          <div className="relative overflow-hidden rounded-2xl border border-indigo-100/80 bg-gradient-to-b from-indigo-50/60 to-white p-5">
            <div aria-hidden className="absolute inset-0 opacity-60" style={SECURITY_TEXTURE} />
            <div className="relative">
              <p className="text-[11px] font-bold tracking-wide text-indigo-600/80 mb-0.5">
                איך מתחברים
              </p>
              <p className="font-bold text-stone-900 mb-4">פעם אחת · פחות מדקה</p>
              <ol className="relative">
                {CONNECT_STEPS.map((step, i) => (
                  <li key={i}>
                    <div className="flex items-start gap-3 rounded-2xl border border-indigo-100/90 bg-white/80 p-3.5 shadow-sm shadow-indigo-100/60">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-white text-xs font-bold flex items-center justify-center shadow-sm shadow-indigo-400/50 ring-2 ring-white">
                        {i + 1}
                      </span>
                      <span className="text-sm text-stone-700 leading-relaxed pt-0.5">{step}</span>
                    </div>
                    {i < CONNECT_STEPS.length - 1 && (
                      <div className="flex justify-center py-1.5" aria-hidden>
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-500 shadow-sm">
                          <ArrowDown className="w-3.5 h-3.5" strokeWidth={2.5} />
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <button
            onClick={handleConnect}
            disabled={acting}
            className="group relative w-full inline-flex items-center justify-center gap-2 overflow-hidden bg-gradient-to-l from-indigo-600 to-blue-600 text-white py-3.5 rounded-2xl text-sm font-semibold shadow-lg shadow-indigo-500/25 ring-1 ring-inset ring-white/15 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/20 to-transparent"
            />
            <ShieldCheck className="relative w-4 h-4" />
            <span className="relative">{acting ? "מעביר..." : "חבר לרשות המיסים"}</span>
            {!acting && <span className="relative text-white/70 text-xs font-normal">· פעם אחת</span>}
          </button>
          <p className="text-center text-[11px] text-stone-400">
            מאובטח · החיבור מתבצע ישירות מול רשות המסים
          </p>
        </div>
      )}

      {status?.connected && status.credentials && (
        <div className="relative space-y-3">
          <div className="relative overflow-hidden rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50 via-emerald-50/70 to-teal-50/40 p-5 shadow-sm shadow-emerald-100/60">
            <div className="flex items-center gap-3 mb-3.5">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-sm shadow-emerald-300/60 ring-2 ring-white">
                <Check className="w-[18px] h-[18px] text-white" strokeWidth={3} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-extrabold text-emerald-900 text-sm leading-none">מחובר ומאומת</p>
                  {status.credentials.environment === "sandbox" && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                      SANDBOX
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-emerald-700/80 mt-1.5">
                  מספרי הקצאה יופקו אוטומטית לחשבוניות מעל הסף
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-emerald-100 bg-emerald-100/40 text-xs">
              {(
                [
                  status.credentials.vat_number && {
                    label: "מספר עוסק",
                    value: status.credentials.vat_number,
                    mono: true,
                  },
                  {
                    label: "חובר ב-",
                    value: new Date(status.credentials.connected_at).toLocaleDateString("he-IL"),
                  },
                  status.credentials.last_used_at && {
                    label: "שימוש אחרון",
                    value: new Date(status.credentials.last_used_at).toLocaleDateString("he-IL"),
                  },
                  status.credentials.last_error && {
                    label: "שגיאה אחרונה",
                    value: status.credentials.last_error,
                    error: true,
                  },
                ].filter(Boolean) as {
                  label: string;
                  value: string;
                  mono?: boolean;
                  error?: boolean;
                }[]
              ).map((row) => (
                <div
                  key={row.label}
                  className={`flex items-start justify-between gap-2 px-3 py-2 ${
                    row.error ? "bg-rose-50/80" : "bg-white/70"
                  }`}
                >
                  <dt className={`flex-shrink-0 ${row.error ? "text-rose-600" : "text-stone-500"}`}>
                    {row.label}
                  </dt>
                  <dd
                    className={`text-left ${
                      row.error
                        ? "text-rose-700"
                        : row.mono
                          ? "font-mono text-stone-900"
                          : "text-stone-800"
                    }`}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={acting}
            className="text-xs text-stone-500 hover:text-rose-700 underline underline-offset-2 transition-colors"
          >
            ניתוק חיבור
          </button>
        </div>
      )}
    </div>
  );
}
