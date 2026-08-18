"use client";

import { useState } from "react";
import Link from "next/link";
import { History, ChevronDown, ChevronUp, FilePlus2, ExternalLink } from "lucide-react";
import { useAuditLog, formatAuditAction, type AuditEntry } from "@/lib/audit-log";
import { useDocuments } from "@/lib/document-store";
import { useClients } from "@/lib/client-store";
import { normalizeName } from "@/lib/client-picker";
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

/**
 * Resolves "who was this document for?" for a history row so we can offer
 * "מסמך חדש לאותו לקוח" (Asaf, 2026-08-17: from the history, be able to send
 * a new document to the same person again). Sources, in order:
 *   1. the live document (targetId) - has clientId + clientName
 *   2. payload.clientId / payload.clientName - written by newer audit rows,
 *      survives the document being deleted
 *   3. the "· <name>" suffix of the label, matched against the clients list
 */
function resolveClient(
  entry: AuditEntry,
  documents: { id: string; clientId: string; clientName: string }[],
  clients: { id: string; name: string }[],
): { clientId?: string; clientName?: string; docExists: boolean } {
  if (entry.targetType !== "document") return { docExists: false };
  const doc = entry.targetId ? documents.find((d) => d.id === entry.targetId) : undefined;
  const payloadClientId = typeof entry.payload?.clientId === "string" ? (entry.payload.clientId as string) : undefined;
  const payloadClientName = typeof entry.payload?.clientName === "string" ? (entry.payload.clientName as string) : undefined;
  const labelName = entry.targetLabel?.includes(" · ") ? entry.targetLabel.split(" · ").slice(1).join(" · ").trim() : undefined;
  const clientName = doc?.clientName || payloadClientName || labelName || undefined;
  let clientId = doc?.clientId || payloadClientId || undefined;
  if (!clientId && clientName) {
    // Only an unambiguous name match: two saved clients with the same name
    // means we don't know which one, and offering the wrong one is worse
    // than offering none.
    const wanted = normalizeName(clientName);
    const matches = clients.filter((c) => normalizeName(c.name) === wanted);
    if (matches.length === 1) clientId = matches[0].id;
  }
  // A client that was deleted since would 404 in the editor's prefill check;
  // only offer the link when the id still resolves.
  if (clientId && !clients.some((c) => c.id === clientId)) clientId = undefined;
  return { clientId, clientName, docExists: Boolean(doc) };
}

export function AuditLogSection() {
  const { entries, ready } = useAuditLog(50);
  const { documents } = useDocuments();
  const { items: clients } = useClients();
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
          const who = resolveClient(entry, documents, clients);
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
                {(who.clientId || who.docExists) && (
                  <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                    {who.clientId && (
                      <Link
                        href={`/documents/new?clientId=${who.clientId}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-800 min-h-[40px]"
                        title={who.clientName ? `מסמך חדש ל${who.clientName}` : "מסמך חדש לאותו לקוח"}
                      >
                        <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                        מסמך חדש ל{who.clientName || "לקוח"}
                      </Link>
                    )}
                    {who.docExists && entry.targetId && (
                      <Link
                        href={`/documents/${entry.targetId}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900 min-h-[40px]"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        פתח מסמך
                      </Link>
                    )}
                  </div>
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
