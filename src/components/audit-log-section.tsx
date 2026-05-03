"use client";

import { useState } from "react";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { useAuditLog, formatAuditAction, type AuditEntry } from "@/lib/audit-log";
import { formatDate } from "@/lib/format";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "לפני רגע";
  const min = Math.floor(sec / 60);
  if (min < 60) return `לפני ${min} דקות`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `לפני ${hr} ${hr === 1 ? "שעה" : "שעות"}`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `לפני ${day} ${day === 1 ? "יום" : "ימים"}`;
  return formatDate(iso.slice(0, 10));
}

function formatPayload(entry: AuditEntry): string | null {
  if (!entry.payload) return null;
  if (entry.action === "document.status_changed") {
    return `${entry.payload.from} → ${entry.payload.to}`;
  }
  return null;
}

export function AuditLogSection() {
  const { entries, ready } = useAuditLog(50);
  const [expanded, setExpanded] = useState(false);

  if (ready && entries.length === 0) {
    return (
      <div className="card-soft p-6">
        <div className="flex items-center gap-2 mb-2">
          <History className="w-4 h-4 text-orange-500" />
          <h2 className="font-semibold text-stone-900">היסטוריית פעולות</h2>
        </div>
        <p className="text-sm text-stone-700">
          כאן יופיעו פעולות מרכזיות שאתה עושה במערכת (יצירת מסמך, עדכון סטטוס, מחיקה).
          הרישום מתחיל מעכשיו והלאה.
        </p>
      </div>
    );
  }

  const visible = expanded ? entries : entries.slice(0, 10);

  return (
    <div className="card-soft p-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-orange-500" />
          <h2 className="font-semibold text-stone-900">היסטוריית פעולות</h2>
          <span className="text-xs text-stone-500">({entries.length})</span>
        </div>
      </div>

      <ul className="divide-y divide-orange-50">
        {visible.map((entry) => {
          const payloadText = formatPayload(entry);
          return (
            <li key={entry.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-900">
                  {formatAuditAction(entry.action)}
                </p>
                {entry.targetLabel && (
                  <p className="text-xs text-stone-700 mt-0.5 truncate">{entry.targetLabel}</p>
                )}
                {payloadText && (
                  <p className="text-xs text-stone-600 mt-0.5">{payloadText}</p>
                )}
              </div>
              <span className="text-xs text-stone-500 flex-shrink-0">
                {relativeTime(entry.createdAt)}
              </span>
            </li>
          );
        })}
      </ul>

      {entries.length > 10 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:text-orange-800"
        >
          {expanded ? (
            <>
              הצג פחות
              <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              הצג עוד ({entries.length - 10})
              <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
