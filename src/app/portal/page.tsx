"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, CheckCircle2, AlertCircle } from "lucide-react";

function PortalLoginInner() {
  const params = useSearchParams();
  const errorParam = params.get("error");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(
    errorParam === "expired" ? "הקישור פג תוקף, בקשו חדש" : null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSending(true);
    try {
      const res = await fetch("/api/portal/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error || "שגיאה לא ידועה");
        return;
      }
      setSent(true);
    } catch {
      setErr("שגיאת רשת");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-lg p-8 max-w-md w-full">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center mb-4">
          <Mail className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-stone-900 text-center mb-2">
          פורטל הלקוחות
        </h1>
        <p className="text-sm text-stone-600 text-center mb-6">
          הזינו את כתובת המייל שלכם ונשלח אליה קישור לצפייה בכל החשבוניות.
        </p>

        {sent ? (
          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-5 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600 mb-3" />
            <h2 className="font-bold text-emerald-900 mb-1">בדקו את המייל</h2>
            <p className="text-sm text-emerald-800">
              אם הכתובת רשומה אצל אחד מהעסקים, הקישור בדרך אליכם.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="portal-email" className="block text-sm font-medium text-stone-700 mb-1">
                כתובת מייל
              </label>
              <input
                id="portal-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                inputMode="email"
                disabled={sending}
                className="w-full px-4 py-2.5 rounded-xl border border-stone-300 bg-white focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={sending || !email}
              className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-5 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "שולח..." : "שלחו לי קישור"}
            </button>
          </form>
        )}

        {err && (
          <div className="mt-4 bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2 text-sm text-rose-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        <p className="text-xs text-stone-500 text-center mt-6">
          ללא צורך ברישום. הקישור תקף 24 שעות.
        </p>
      </div>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <PortalLoginInner />
    </Suspense>
  );
}
