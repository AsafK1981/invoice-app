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
import { formatDate } from "@/lib/format";
import { canIssueTaxInvoicesByType } from "@/lib/vat";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * Settings card for "חשבונית ישראל", Israel Tax Authority allocation
 * number API. Shows one of three states:
 *
 *   1. Vendor not configured: app owner hasn't registered with gov.il
 *      yet. No connect button is shown; the section just explains that
 *      this is coming soon.
 *   2. Exempt dealer: business_type is "exempt". Section is hidden
 *      (allocation numbers don't apply to עוסק פטור).
 *   3. Vendor configured + VAT-charging business (authorized / company)
 *      + not connected: shows a "Connect" button that starts OAuth.
 *   4. Connected: shows status (last used, expires when, environment)
 *      and a Disconnect button.
 *
 * Visual direction: "quietly premium institutional", a refined nod to
 * an official, secure government document (medallion icon with a halo,
 * an eyebrow trust label, a connected gradient stepper, and a faint
 * security-pattern dot texture) while staying cohesive with the app's
 * warm card-soft language.
 *
 * PALETTE. That composition used to be indigo/blue, as a "חשבונית ישראל
 * identity". The app has ONE palette - warm black and gold - so an indigo panel
 * read as a stray control rather than as a brand cue, exactly the complaint the
 * green import button drew. Every surface here is now the gold ramp (the coral
 * utilities app-skin.css re-tints, plus `.pgbtn-primary` on the connect button,
 * the app's one filled-button treatment). Two colours survive on purpose:
 * EMERALD for the connected state, because it means success, and ROSE for the
 * error rows and the disconnect link, because they mean danger.
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
  /**
   * Whether an operator ת.ז is on file for this connection. Only the flag
   * crosses the wire; the number itself stays on a service-role-only table.
   */
  hasOperatorTaxId?: boolean;
}

const CONNECT_STEPS = [
  "לחיצה על הכפתור תעביר אותך לאתר רשות המסים. התחבר עם פרטי השירותים הדיגיטליים שלך (ת.ז + קוד משתמש קבוע) ואשר את הגישה.",
  "תוחזר לכאן אוטומטית, והעסק שלך מחובר. אין מה למלא ידנית.",
  "מכאן, כל חשבונית מס מעל הסף תקבל מספר הקצאה מרשות המסים בלחיצה אחת.",
];

// Faint banknote-style dot guilloché; signals "official / secure" without
// shouting. The dot is the brand orange (--g2, #f97316) at 9%, not the
// indigo it used to be, so the texture sits under the orange stepper instead
// of tinting it cool.
const SECURITY_TEXTURE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(circle at 1px 1px, rgba(249,115,22,0.09) 1px, transparent 0)",
  backgroundSize: "15px 15px",
};

export function TaxAuthoritySection() {
  const search = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [operatorInput, setOperatorInput] = useState("");
  const confirm = useConfirm();

  useEffect(() => {
    // After OAuth callback, gov.il redirects to /settings?tax_authority=connected or =error
    const flag = search.get("tax_authority");
    if (flag === "connected") {
      setToast({ kind: "success", text: "התחברת בהצלחה לרשות המסים." });
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

  async function handleSaveOperator() {
    setActing(true);
    setToast(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/tax-authority/operator", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operatorTaxId: operatorInput }),
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ kind: "success", text: "ת.ז מבצע ההקצאה נשמרה." });
        setOperatorInput("");
        load();
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה" });
      }
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "שגיאה" });
    } finally {
      setActing(false);
    }
  }

  async function handleDisconnect() {
    const ok = await confirm({
      title: "לנתק את החיבור לרשות המסים?",
      message: "תוכל לחבר מחדש בכל עת.",
      tone: "danger",
      confirmLabel: "נתק",
    });
    if (!ok) return;
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

  // Hide entirely for exempt businesses; allocation numbers don't apply.
  if (status?.businessType === "exempt") return null;

  return (
    <div className="card-soft relative overflow-hidden p-6 space-y-5">
      {/* Atmospheric corner glow: adds depth to an otherwise flat white card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -left-16 w-56 h-56 rounded-full bg-[color:var(--g1)]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-[color:var(--g2)] via-[color:var(--g1)] to-transparent"
      />

      <div className="relative flex items-start gap-3.5">
        {/* Medallion: layered gradient + inset highlight + soft halo ring */}
        <div className="relative flex-shrink-0">
          <div className="absolute inset-0 rounded-2xl bg-[color:var(--g2)]/30 blur-md" aria-hidden />
          <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-lg shadow-orange-400/40 ring-1 ring-inset ring-white/25">
            <Landmark className="w-[22px] h-[22px]" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-700 flex-shrink-0" />
            <span className="text-[11px] font-bold tracking-wide text-amber-700">
              שירות רשמי · רשות המסים
            </span>
          </div>
          <h2 className="font-extrabold text-stone-900 text-[15px] leading-tight">
            חשבונית ישראל: מספרי הקצאה
          </h2>
          <p className="text-sm text-stone-600 mt-1.5 leading-relaxed">
            חיבור פעם אחת, ואז כל חשבונית מס מעל הסף מקבלת מספר הקצאה רשמי בלחיצה אחת.
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
              <p className="font-semibold text-stone-900">בקרוב: האפליקציה בתהליך רישום ברשות המסים</p>
              <p className="text-stone-700 mt-1">
                התשתית מוכנה. ברגע שהרישום של MyFriendlyInvoiceApp כבית-תוכנה יושלם, יופיע
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
          {/* Connect walkthrough: a connected gradient stepper over a faint security texture */}
          <div className="relative overflow-hidden rounded-2xl border border-orange-100 bg-gradient-to-b from-amber-50 to-white p-5">
            <div aria-hidden className="absolute inset-0 opacity-60" style={SECURITY_TEXTURE} />
            <div className="relative">
              <p className="text-[11px] font-bold tracking-wide text-amber-700 mb-0.5">
                איך מתחברים
              </p>
              <p className="font-bold text-stone-900 mb-4">פעם אחת · פחות מדקה</p>
              <ol className="relative">
                {CONNECT_STEPS.map((step, i) => (
                  <li key={i}>
                    <div className="flex items-start gap-3 rounded-2xl border border-orange-100 bg-white/80 p-3.5 shadow-sm shadow-orange-100/60">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-xs font-bold flex items-center justify-center ring-2 ring-white">
                        {i + 1}
                      </span>
                      <span className="text-sm text-stone-700 leading-relaxed pt-0.5">{step}</span>
                    </div>
                    {i < CONNECT_STEPS.length - 1 && (
                      <div className="flex justify-center py-1.5" aria-hidden>
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 border border-orange-100 text-amber-700 shadow-sm">
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
            className="pgbtn-primary group relative w-full inline-flex items-center justify-center gap-2 overflow-hidden py-3.5 rounded-2xl text-sm font-semibold hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/30 to-transparent"
            />
            <ShieldCheck className="relative w-4 h-4" />
            <span className="relative">{acting ? "מעביר..." : "חבר לרשות המסים"}</span>
            {!acting && <span className="relative text-xs font-normal opacity-70">· פעם אחת</span>}
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
                  אפשר לבקש מספר הקצאה בלחיצה אחת מכל מסמך שדורש זאת
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
                    value: formatDate(status.credentials.connected_at),
                  },
                  status.credentials.last_used_at && {
                    label: "שימוש אחרון",
                    value: formatDate(status.credentials.last_used_at),
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
          {/* Companies only. A sole trader's עוסק number IS their ת.ז, so the
              allocation already carries a valid person ID and this would be
              noise. A חברה has a ח.פ., which is not a person, and רשות המסים
              expects the ID of whoever actually performs the allocation. */}
          {status.businessType === "company" && (
            <div
              className={`rounded-2xl border p-4 ${
                status.hasOperatorTaxId
                  ? "border-stone-200 bg-white/70"
                  : "border-amber-200 bg-amber-50/70"
              }`}
            >
              <p className="text-sm font-bold text-stone-900">ת.ז של מבצע ההקצאה</p>
              <p className="text-[11px] leading-relaxed text-stone-600 mt-1.5">
                רשות המסים מבקשת את תעודת הזהות של האדם שמבצע את ההקצאה, ולא את מספר
                החברה. אצל חברה בע&quot;מ אלה שני מספרים שונים, ולכן צריך למלא זאת פעם אחת.
                המספר נשמר אצלנו בלבד ואינו מוצג שוב.
              </p>
              {status.hasOperatorTaxId ? (
                <p className="mt-2.5 text-xs font-semibold text-emerald-700">
                  ✓ שמור. אפשר להחליף בהזנת מספר חדש.
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <input
                  value={operatorInput}
                  onChange={(e) => setOperatorInput(e.target.value.replace(/\D/g, "").slice(0, 9))}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="123456782"
                  aria-label="ת.ז של מבצע ההקצאה"
                  className="flex-1 min-w-0 rounded-xl border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
                />
                <button
                  onClick={handleSaveOperator}
                  disabled={acting || operatorInput.length !== 9}
                  className="flex-shrink-0 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  שמירה
                </button>
              </div>
            </div>
          )}
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
