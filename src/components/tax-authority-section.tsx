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
} from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Settings card for "חשבונית ישראל" — Israel Tax Authority allocation
 * number API. Shows one of three states:
 *
 *   1. Vendor not configured — app owner hasn't registered with gov.il
 *      yet. No connect button is shown; the section just explains that
 *      this is coming soon.
 *   2. Not licensed dealer — business_type is "exempt". Section is
 *      hidden (allocation numbers don't apply to עוסק פטור).
 *   3. Vendor configured + licensed dealer + not connected — shows a
 *      "Connect" button that initiates the OAuth flow.
 *   4. Connected — shows status (last used, expires when, environment)
 *      and a Disconnect button.
 */
interface Status {
  ok: boolean;
  vendorConfigured: boolean;
  environment: "sandbox" | "production";
  businessType: "exempt" | "licensed" | null;
  connected: boolean;
  credentials: {
    vat_number: string;
    connected_at: string;
    expires_at: string;
    last_used_at: string | null;
    environment: "sandbox" | "production";
    last_error: string | null;
  } | null;
}

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
    <div className="card-soft p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center shadow-md flex-shrink-0">
          <Landmark className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="font-bold text-stone-900">חשבונית ישראל — מספרי הקצאה</h2>
          <p className="text-sm text-stone-700 mt-1 leading-relaxed">
            רשות המיסים דורשת מספר הקצאה על חשבוניות מס מעל סף מסוים (₪10,000 ב-2026,
            ₪5,000 מיוני 2026). חיבור פעם אחת כאן — המספר יוקצה אוטומטית לכל חשבונית רלוונטית.
          </p>
        </div>
      </div>

      {toast && (
        <div
          className={`flex items-start gap-2 text-sm p-3 rounded-xl ${
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
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-4 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-stone-900">בקרוב — האפליקציה בתהליך רישום ברשות המסים</p>
              <p className="text-stone-700 mt-1">
                התשתית מוכנה. ברגע שהרישום של MySuperFriendlyInvoiceApp כבית-תוכנה יושלם, יופיע
                כפתור "חיבור" כאן. הצפי: 1-3 שבועות.
              </p>
            </div>
          </div>
        </div>
      )}

      {status?.vendorConfigured && status?.businessType === null && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
          השלם קודם את פרטי העסק (סוג עסק = עוסק מורשה) למעלה.
        </p>
      )}

      {status?.vendorConfigured && status?.businessType === "licensed" && !status?.connected && (
        <button
          onClick={handleConnect}
          disabled={acting}
          className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-l from-blue-500 to-indigo-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-blue-200/60 disabled:opacity-50"
        >
          <ExternalLink className="w-4 h-4" />
          {acting ? "מעביר..." : "חבר לרשות המיסים (פעם אחת)"}
        </button>
      )}

      {status?.connected && status.credentials && (
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/60 p-4">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-2">
              <CheckCircle2 className="w-4 h-4" />
              מחובר
              {status.credentials.environment === "sandbox" && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                  SANDBOX
                </span>
              )}
            </div>
            <ul className="text-xs text-stone-700 space-y-0.5">
              {status.credentials.vat_number && (
                <li>
                  מספר עוסק:{" "}
                  <code className="font-mono">{status.credentials.vat_number}</code>
                </li>
              )}
              <li>
                חובר ב-
                {new Date(status.credentials.connected_at).toLocaleDateString("he-IL")}
              </li>
              {status.credentials.last_used_at && (
                <li>
                  שימוש אחרון:{" "}
                  {new Date(status.credentials.last_used_at).toLocaleDateString("he-IL")}
                </li>
              )}
              {status.credentials.last_error && (
                <li className="text-rose-700 mt-1">שגיאה אחרונה: {status.credentials.last_error}</li>
              )}
            </ul>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={acting}
            className="text-xs text-stone-600 hover:text-rose-700 underline"
          >
            ניתוק חיבור
          </button>
        </div>
      )}
    </div>
  );
}
