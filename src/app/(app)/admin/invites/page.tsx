"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Gift,
  Copy,
  Trash2,
  Power,
  PowerOff,
  Plus,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";
import { formatDate } from "@/lib/format";

interface Invite {
  id: string;
  code: string;
  notes: string | null;
  max_redemptions: number;
  redemptions_count: number;
  days_granted: number;
  plan_tier: "free" | "pro";
  active: boolean;
  created_at: string;
  expires_at: string | null;
}

const SITE_BASE = "https://mysuperfriendlyinvoiceapp.vercel.app";

export default function AdminInvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Form
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [daysGranted, setDaysGranted] = useState(90);
  const [planTier, setPlanTier] = useState<"free" | "pro">("pro");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const ok = isAdminEmail(user?.email);
      setAllowed(ok);
      setChecked(true);
      if (!ok) setLoading(false);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/invites", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.ok) setInvites(data.invites);
      else setToast({ kind: "error", text: data.error || "שגיאה" });
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "שגיאה" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setToast(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: code.trim() || undefined,
          notes: notes.trim() || undefined,
          maxRedemptions,
          daysGranted,
          planTier,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ kind: "success", text: `קוד "${data.invite.code}" נוצר` });
        setCode("");
        setNotes("");
        load();
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה" });
      }
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "שגיאה" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(invite: Invite) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/invites/${invite.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ active: !invite.active }),
    });
    const data = await res.json();
    if (data.ok) load();
    else setToast({ kind: "error", text: data.error || "שגיאה" });
  }

  async function handleDelete(invite: Invite) {
    if (!confirm(`למחוק לצמיתות את הקוד "${invite.code}"?`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/invites/${invite.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const data = await res.json();
    if (data.ok) load();
    else setToast({ kind: "error", text: data.error || "שגיאה" });
  }

  async function copyLink(invite: Invite) {
    const url = `${SITE_BASE}/invite/${invite.code}`;
    await navigator.clipboard.writeText(url);
    setToast({ kind: "success", text: "הקישור הועתק" });
  }

  if (!checked) {
    return <div className="p-8 text-center text-stone-500">טוען...</div>;
  }
  if (!allowed) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-stone-900">404</h1>
        <p className="text-stone-600 mt-2">העמוד לא נמצא</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-sm">
              <Gift className="w-5 h-5 text-white" />
            </span>
            הזמנות בטא
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            צור קישורים שמעניקים גישה חינם — שלח לחברים, הם לוחצים, מתחברים עם Google ומקבלים גישה מיידית.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-orange-700"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לדשבורד
        </Link>
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
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={handleCreate} className="card-soft p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-emerald-600" />
          <h2 className="font-semibold text-stone-900">צור קוד חדש</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">
              קוד (ריק = יוצר אוטומטית)
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="BETA-XYZ123"
              className="input-warm w-full"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">הערות (פרטי)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="לדני וליאת"
              className="input-warm w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">מסלול</label>
            <select
              value={planTier}
              onChange={(e) => setPlanTier(e.target.value as "free" | "pro")}
              className="input-warm w-full"
            >
              <option value="pro">Pro</option>
              <option value="free">בסיסי</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">מספר שימושים</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(Math.max(1, parseInt(e.target.value) || 1))}
              className="input-warm w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">מספר ימים</label>
            <input
              type="number"
              min={1}
              max={3650}
              value={daysGranted}
              onChange={(e) => setDaysGranted(Math.max(1, parseInt(e.target.value) || 90))}
              className="input-warm w-full"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-emerald-500 to-teal-500 text-white hover:shadow-md hover:shadow-emerald-200 disabled:opacity-50"
        >
          {saving ? "יוצר..." : "צור קוד"}
        </button>
      </form>

      {/* List */}
      <div className="card-soft overflow-hidden">
        <div className="px-5 py-3 border-b border-orange-100 flex items-center justify-between">
          <h2 className="font-semibold text-stone-900">קודים קיימים</h2>
          <span className="text-xs text-stone-600">{invites.length} סה״כ</span>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-stone-500 italic">טוען...</p>
        ) : invites.length === 0 ? (
          <p className="p-5 text-sm text-stone-500 italic">אין קודים עדיין. צור אחד למעלה.</p>
        ) : (
          <ul className="divide-y divide-orange-50">
            {invites.map((inv) => {
              const exhausted = inv.redemptions_count >= inv.max_redemptions;
              const expired = inv.expires_at && new Date(inv.expires_at).getTime() < Date.now();
              const dead = !inv.active || exhausted || expired;
              return (
                <li key={inv.id} className="px-5 py-4 hover:bg-orange-50/40">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono font-bold text-stone-900 text-sm bg-stone-100 px-2 py-0.5 rounded">
                          {inv.code}
                        </code>
                        {dead ? (
                          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-stone-200 text-stone-600">
                            {!inv.active ? "מושבת" : exhausted ? "נוצל" : "פג"}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                            פעיל
                          </span>
                        )}
                        <span className="text-xs text-stone-600">
                          {inv.plan_tier === "pro" ? "Pro" : "בסיסי"} · {inv.days_granted} ימים ·{" "}
                          {inv.redemptions_count} / {inv.max_redemptions} ניצולים
                        </span>
                      </div>
                      {inv.notes && (
                        <p className="text-xs text-stone-600 mt-1">{inv.notes}</p>
                      )}
                      <p className="text-xs text-stone-500 mt-1">
                        נוצר {formatDate(inv.created_at.slice(0, 10))}
                        {inv.expires_at && (
                          <> · פג ב-{formatDate(inv.expires_at.slice(0, 10))}</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => copyLink(inv)}
                        title="העתק קישור"
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-600 hover:bg-orange-50 hover:text-orange-700"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <a
                        href={`/invite/${inv.code}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="פתח קישור"
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-600 hover:bg-orange-50 hover:text-orange-700"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => handleToggle(inv)}
                        title={inv.active ? "השבת" : "הפעל מחדש"}
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-600 hover:bg-amber-50 hover:text-amber-700"
                      >
                        {inv.active ? (
                          <PowerOff className="w-4 h-4" />
                        ) : (
                          <Power className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(inv)}
                        title="מחק"
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-600 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
