"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  UserPlus,
  Users,
  Phone,
  Mail,
  Building2,
  Pencil,
  Trash2,
  StickyNote,
  MapPin,
  Upload,
  Download,
  Search,
  X,
} from "lucide-react";
import { useClients, useClientsPage, clientStore } from "@/lib/client-store";
import { resolveDocumentClientId } from "@/lib/client-picker";
import { useDocuments } from "@/lib/document-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { parseEmails } from "@/lib/emails";
import { ClientFormModal } from "@/components/client-form-modal";
import { CsvImportModal } from "@/components/csv-import-modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { exportClients } from "@/lib/csv-export";
import type { Client, InvoiceDocument } from "@/lib/types";

interface ClientStats {
  docCount: number;
  totalBilled: number;
  lastDocDate: string | null;
}

function buildStatsByClient(documents: InvoiceDocument[], clients: Client[]): Map<string, ClientStats> {
  const m = new Map<string, ClientStats>();
  for (const d of documents) {
    if (d.status === "draft" || d.status === "cancelled") continue;
    // Unlinked documents (client_id null) are attributed to the one client
    // their name / tax id identifies, so the per-client count here agrees
    // with the client page and the documents list.
    const clientId = resolveDocumentClientId(d, clients);
    if (!clientId) continue;
    // Credit notes are stored ALREADY NEGATIVE on save (receipt-editor.tsx
    // applies `sign = -1`), so a plain sum already subtracts them; applying
    // a sign here again would double-negate. `totalIls` normalizes
    // foreign-currency documents into shekels.
    const cur = m.get(clientId) ?? { docCount: 0, totalBilled: 0, lastDocDate: null };
    cur.docCount += 1;
    cur.totalBilled += (d.totalIls ?? d.total);
    if (!cur.lastDocDate || d.date > cur.lastDocDate) cur.lastDocDate = d.date;
    m.set(clientId, cur);
  }
  return m;
}

// Search used to be matched in-memory here (matchesClient); it now happens
// server-side in useClientsPage() (see client-store.ts) so a search over a
// list bigger than one page still searches the WHOLE list, not just the
// current page.

export default function ClientsPage() {
  // Full, unpaginated list: needed for the unfiltered "X לקוחות בספר" count,
  // the "export all" button (which must export every client regardless of
  // what's on screen), and the empty-catalog check - none of which may ever
  // be silently truncated to one page. The rendered grid below reads from
  // useClientsPage() instead, which does the real server-side pagination.
  const { items: clients } = useClients();
  const { documents } = useDocuments();
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const confirm = useConfirm();

  const statsByClient = useMemo(() => buildStatsByClient(documents, clients), [documents, clients]);

  const { items: filtered, total: filteredTotal, pageSize } = useClientsPage({ page, search });
  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));

  function updateSearch(value: string) {
    setSearch(value);
    setPage(0); // a new search always starts back at page 1
  }

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setModalOpen(true);
  }

  async function remove(client: Client) {
    const ok = await confirm({
      title: `למחוק את ${client.name}?`,
      message: "המסמכים שכבר הופקו עבור הלקוח יישמרו, אבל הלקוח יוסר מספר הלקוחות.",
      tone: "danger",
      confirmLabel: "מחק",
    });
    if (ok) await clientStore.remove(client.id);
  }

  return (
    <div className="space-y-6">
      <div>
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-teal flex items-center justify-center shadow-sm">
              <Users className="w-5 h-5 text-white" />
            </span>
            לקוחות
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            {search.trim()
              ? `${filteredTotal} מתוך ${clients.length} לקוחות`
              : `${clients.length} לקוחות בספר`}
          </p>
        </div>
      </div>

      {/* Primary alone at the inline-start (right, under the title), file
          chores pushed to the inline-end. See "PAGE ACTION BAR" in app-skin.css. */}
      <div className="pgbar">
        <button onClick={openNew} className="pgbtn pgbtn-primary pgbtn-hero">
          <UserPlus aria-hidden="true" />
          לקוח חדש
        </button>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => exportClients(clients)}
            disabled={clients.length === 0}
            className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50 disabled:opacity-40"
            title="ייצוא לקוחות ל-CSV"
          >
            <Download className="w-4 h-4" />
            ייצוא
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50"
            title="ייבוא מקובץ CSV"
          >
            <Upload className="w-4 h-4" />
            ייבוא
          </button>
        </div>
      </div>

      {clients.length > 0 && (
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            placeholder="חיפוש: שם, ח.פ, אימייל, טלפון, הערות..."
            className="input-warm pr-10 pl-9"
          />
          {search && (
            <button
              onClick={() => updateSearch("")}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              aria-label="נקה חיפוש"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          tone="teal"
          title="עדיין אין לקוחות"
          description="הלקוחות שלך הם בסיס הכל: כל מסמך שאתה מפיק שייך ללקוח. הוסף את הראשון, וכל מסמך שלו יקושר אוטומטית."
          primaryAction={{
            label: "הוסף לקוח ראשון",
            onClick: openNew,
            icon: UserPlus,
          }}
          secondaryAction={{
            label: "ייבוא מקובץ CSV",
            onClick: () => setImportOpen(true),
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="card-soft p-12 text-center">
          <div className="text-4xl mb-2">🔍</div>
          <h3 className="font-bold text-stone-900 mb-1">לא נמצאו לקוחות</h3>
          <p className="text-sm text-stone-700 mb-3">
            אין לקוחות התואמים ל-&quot;{search}&quot;
          </p>
          <button
            onClick={() => updateSearch("")}
            className="text-sm text-orange-600 hover:underline"
          >
            נקה חיפוש
          </button>
        </div>
      ) : (
        <>
        <div className="card-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="card-soft p-5 hover:shadow-md hover:-translate-y-0.5 transition-all group relative flex flex-col"
            >
              <div className="absolute top-3 left-3 flex gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                <Tooltip label="עריכת לקוח" align="start">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openEdit(c);
                    }}
                    className="w-10 h-10 sm:w-8 sm:h-8 rounded-xl bg-white hover:bg-orange-50 text-stone-600 hover:text-orange-600 flex items-center justify-center shadow-sm border border-orange-100"
                    aria-label="עריכת לקוח"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label="מחיקת לקוח" align="start">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      remove(c);
                    }}
                    className="w-10 h-10 sm:w-8 sm:h-8 rounded-xl bg-white hover:bg-rose-50 text-stone-600 hover:text-rose-600 flex items-center justify-center shadow-sm border border-orange-100"
                    aria-label="מחיקת לקוח"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>

              <div className="flex items-start gap-3">
                <Tooltip label={`כרטיס לקוח: ${c.name}`} side="bottom">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-200 to-rose-200 dark:from-orange-300 dark:to-rose-300 flex items-center justify-center flex-shrink-0 ring-1 ring-orange-300/40 dark:ring-orange-400/60">
                    <Building2 className="w-5 h-5 text-orange-900" strokeWidth={2.5} />
                  </div>
                </Tooltip>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-stone-900 truncate">{c.name}</h3>
                  {c.taxId && (
                    <p className="text-sm text-stone-700 mt-0.5">ח.פ / ת.ז: {c.taxId}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 mb-4 space-y-1.5 text-sm">
                {c.phone && (
                  <div className="flex items-center gap-2 text-stone-800">
                    <Phone className="w-3.5 h-3.5 text-stone-500 flex-shrink-0" />
                    <span dir="ltr">{c.phone}</span>
                  </div>
                )}
                {c.email && (() => {
                  const list = parseEmails(c.email);
                  if (list.length === 0) return null;
                  return (
                    <div className="flex items-start gap-2 text-stone-800">
                      <Mail className="w-3.5 h-3.5 text-stone-500 flex-shrink-0 mt-0.5" />
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {list.map((e, i) => (
                          <span
                            key={i}
                            dir="ltr"
                            className="truncate max-w-full"
                            title={e}
                          >
                            {e}
                            {i < list.length - 1 && <span className="text-stone-400 mx-1">·</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {c.address && (
                  <div className="flex items-center gap-2 text-stone-800 truncate">
                    <MapPin className="w-3.5 h-3.5 text-stone-500 flex-shrink-0" />
                    <span className="truncate">{c.address}</span>
                  </div>
                )}
                {c.notes && (
                  <div className="flex items-start gap-2 text-stone-700 text-xs italic pt-1">
                    <StickyNote className="w-3.5 h-3.5 text-stone-500 flex-shrink-0 mt-0.5" />
                    <span className="truncate">{c.notes}</span>
                  </div>
                )}
              </div>

              {(() => {
                const stats = statsByClient.get(c.id);
                if (!stats || stats.docCount === 0) {
                  return (
                    <div className="mt-auto pt-3 border-t border-orange-100 text-sm text-stone-700">
                      אין מסמכים עדיין · נוסף ב-{formatDate(c.createdAt)}
                    </div>
                  );
                }
                return (
                  <div className="mt-auto pt-3 border-t border-orange-100 flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-stone-700">
                      <span className="font-bold text-stone-900 text-base" dir="ltr">
                        {formatCurrency(stats.totalBilled)}
                      </span>{" "}
                      ב-{stats.docCount} {stats.docCount === 1 ? "מסמך" : "מסמכים"}
                    </span>
                    {stats.lastDocDate && (
                      <span className="text-stone-700">
                        אחרון: <span className="font-bold text-stone-900 tabular-nums">{formatDate(stats.lastDocDate)}</span>
                      </span>
                    )}
                  </div>
                );
              })()}
            </Link>
          ))}
        </div>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </>
      )}

      <ClientFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        client={editing}
      />

      <CsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="clients"
      />
    </div>
  );
}
