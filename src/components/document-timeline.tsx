"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Send,
  Eye,
  CheckCircle2,
  Banknote,
  Mail,
  Stamp,
  Pencil,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import { toIsraelDate } from "@/lib/date";
import type { InvoiceDocument } from "@/lib/types";

interface Props {
  document: InvoiceDocument;
}

type EventColor =
  | "stone"
  | "blue"
  | "emerald"
  | "amber"
  | "sky"
  | "violet"
  | "orange"
  | "rose";

interface TimelineEvent {
  at: string;
  title: string;
  body?: string;
  icon: React.ElementType;
  color: EventColor;
}

const COLORS: Record<EventColor, { dot: string; ring: string; iconText: string }> = {
  stone: { dot: "bg-stone-100", ring: "ring-stone-200", iconText: "text-stone-700" },
  blue: { dot: "bg-blue-100", ring: "ring-blue-200", iconText: "text-blue-700" },
  emerald: { dot: "bg-emerald-100", ring: "ring-emerald-200", iconText: "text-emerald-700" },
  amber: { dot: "bg-amber-100", ring: "ring-amber-200", iconText: "text-amber-700" },
  sky: { dot: "bg-sky-100", ring: "ring-sky-200", iconText: "text-sky-700" },
  violet: { dot: "bg-violet-100", ring: "ring-violet-200", iconText: "text-violet-700" },
  orange: { dot: "bg-orange-100", ring: "ring-orange-200", iconText: "text-orange-700" },
  rose: { dot: "bg-rose-100", ring: "ring-rose-200", iconText: "text-rose-700" },
};

function fullTime(iso: string): string {
  const d = new Date(iso);
  const date = formatDate(toIsraelDate(d));
  const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

const ACTION_TO_EVENT: Record<
  string,
  { title: string; icon: React.ElementType; color: EventColor }
> = {
  "document.created": { title: "המסמך נוצר", icon: Plus, color: "blue" },
  "document.status_changed": { title: "סטטוס המסמך עודכן", icon: Pencil, color: "stone" },
  "document.deleted": { title: "המסמך נמחק", icon: AlertCircle, color: "rose" },
};

export function DocumentTimeline({ document: doc }: Props) {
  const [auditEntries, setAuditEntries] = useState<Array<{ action: string; created_at: string; payload: Record<string, unknown> | null }>>([]);
  const [dunningEntries, setDunningEntries] = useState<Array<{ day_bucket: number; sent_at: string; sent_to: string; success: boolean }>>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [auditRes, dunningRes] = await Promise.all([
        supabase
          .from("audit_log")
          .select("action, created_at, payload")
          .eq("target_id", doc.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("dunning_log")
          .select("day_bucket, sent_at, sent_to, success")
          .eq("document_id", doc.id)
          .order("sent_at", { ascending: true }),
      ]);
      if (cancelled) return;
      setAuditEntries((auditRes.data || []) as typeof auditEntries);
      setDunningEntries((dunningRes.data || []) as typeof dunningEntries);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [doc.id]);

  const events = useMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = [];

    // Synthetic events derived from the document itself. These are always
    // accurate because they're columns on the row, no audit log gap risk.
    if (doc.emailedAt) {
      out.push({
        at: doc.emailedAt,
        title: "המסמך נשלח במייל",
        icon: Send,
        color: "violet",
      });
    }
    if (doc.emailOpenedAt) {
      const count = doc.emailOpenCount || 1;
      out.push({
        at: doc.emailOpenedAt,
        title: "הלקוח פתח את המסמך",
        body: count > 1 ? `נצפה ${count} פעמים סה״כ` : undefined,
        icon: Eye,
        color: "emerald",
      });
    }
    if (doc.approvedAt) {
      out.push({
        at: doc.approvedAt,
        title: "הצעת המחיר אושרה",
        body: doc.approvalSignature ? `על ידי ${doc.approvalSignature}` : undefined,
        icon: CheckCircle2,
        color: "sky",
      });
    }
    if (doc.paidAt) {
      out.push({
        at: doc.paidAt,
        title: "המסמך סומן כשולם",
        body: doc.paymentReference ? `אסמכתא: ${doc.paymentReference}` : undefined,
        icon: Banknote,
        color: "emerald",
      });
    }
    if (doc.allocationSetAt && doc.allocationNumber) {
      out.push({
        at: doc.allocationSetAt,
        title: "מספר הקצאה נרשם",
        body: `חשבונית ישראל: ${doc.allocationNumber}`,
        icon: Stamp,
        color: "amber",
      });
    }

    for (const a of auditEntries) {
      const mapping = ACTION_TO_EVENT[a.action];
      if (!mapping) continue;
      // Skip status_changed entries that are redundant with the synthetic
      // paid/approved events; keeps the timeline from showing the same
      // moment twice in slightly different wording.
      if (a.action === "document.status_changed") {
        const next = (a.payload as { next?: string } | null)?.next;
        if (next === "paid" && doc.paidAt) continue;
      }
      out.push({
        at: a.created_at,
        title: mapping.title,
        body:
          a.action === "document.status_changed"
            ? statusChangeBody(a.payload as Record<string, unknown> | null)
            : undefined,
        icon: mapping.icon,
        color: mapping.color,
      });
    }

    for (const d of dunningEntries) {
      out.push({
        at: d.sent_at,
        title: d.success
          ? `נשלחה תזכורת תשלום (יום ${d.day_bucket})`
          : `כשל בשליחת תזכורת (יום ${d.day_bucket})`,
        body: `אל: ${d.sent_to}`,
        icon: Mail,
        color: d.success ? "amber" : "rose",
      });
    }

    return out.sort((a, b) => a.at.localeCompare(b.at));
  }, [doc, auditEntries, dunningEntries]);

  if (events.length === 0) return null;

  return (
    <div className="card-soft p-5 max-w-[210mm] mx-auto">
      <h3 className="font-bold text-stone-900 mb-4 flex items-baseline gap-2">
        ציר זמן
        <span className="text-xs font-normal text-stone-500">
          ({events.length} {events.length === 1 ? "אירוע" : "אירועים"})
        </span>
      </h3>
      <ol className="space-y-3.5 relative">
        {events.map((e, idx) => {
          const c = COLORS[e.color];
          const Icon = e.icon;
          return (
            <li key={idx} className="flex items-start gap-3 relative">
              {/* connector line to the next dot */}
              {idx < events.length - 1 && (
                <span
                  aria-hidden
                  className="absolute right-[15px] top-8 bottom-[-12px] w-px bg-stone-200"
                />
              )}
              <div
                className={`relative z-[1] w-8 h-8 rounded-full ${c.dot} ring-2 ${c.ring} flex items-center justify-center flex-shrink-0`}
              >
                <Icon className={`w-4 h-4 ${c.iconText}`} />
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="text-sm font-semibold text-stone-900">{e.title}</p>
                  <p className="text-xs text-stone-500 whitespace-nowrap" dir="ltr">
                    {fullTime(e.at)}
                  </p>
                </div>
                {e.body && <p className="text-xs text-stone-600 mt-0.5">{e.body}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function statusChangeBody(payload: Record<string, unknown> | null): string | undefined {
  if (!payload) return undefined;
  const prev = payload.prev as string | undefined;
  const next = payload.next as string | undefined;
  if (!next) return undefined;
  const labels: Record<string, string> = {
    draft: "טיוטה",
    sent: "נשלח",
    paid: "שולם",
    cancelled: "בוטל",
  };
  if (prev && labels[prev] && labels[next]) {
    return `${labels[prev]} → ${labels[next]}`;
  }
  return labels[next] || next;
}
