"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Phone,
  Mail,
  MapPin,
  StickyNote,
  TrendingUp,
  CalendarDays,
  Plus,
  Pencil,
} from "lucide-react";
import { useClients } from "@/lib/client-store";
import { useDocuments } from "@/lib/document-store";
import { DocumentsTable } from "@/components/documents-table";
import { formatCurrency, formatDate } from "@/lib/format";

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { items: clients, ready: clientsReady } = useClients();
  const { documents, ready: docsReady } = useDocuments();

  const client = clients.find((c) => c.id === id) ?? null;

  const { docs, totalBilled, totalPaid, lastDocDate, openCount } = useMemo(() => {
    if (!client) return { docs: [], totalBilled: 0, totalPaid: 0, lastDocDate: null, openCount: 0 };
    const mine = documents.filter((d) => d.clientId === client.id);
    // Total billed = all non-cancelled, non-draft documents (credit notes
    // subtract). This is the "total business done with this client" number.
    const billed = mine
      .filter((d) => d.status !== "draft" && d.status !== "cancelled")
      .reduce((s, d) => s + (d.type === "credit_note" ? -1 : 1) * d.total, 0);
    const paid = mine
      .filter((d) => d.status === "paid")
      .reduce((s, d) => s + (d.type === "credit_note" ? -1 : 1) * d.total, 0);
    const last = mine.length > 0 ? mine.map((d) => d.date).sort().at(-1) : null;
    const open = mine.filter(
      (d) => d.status === "sent" && (d.type === "quote" || d.type === "tax_invoice"),
    ).length;
    return { docs: mine, totalBilled: billed, totalPaid: paid, lastDocDate: last ?? null, openCount: open };
  }, [client, documents]);

  if (!clientsReady || !docsReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  if (!client) {
    return (
      <div className="card-soft p-12 text-center max-w-md mx-auto">
        <div className="text-4xl mb-3">🔍</div>
        <h2 className="font-bold text-stone-900 mb-2">הלקוח לא נמצא</h2>
        <p className="text-sm text-stone-700 mb-5">ייתכן שהלקוח נמחק או שהקישור אינו תקין</p>
        <Link
          href="/clients"
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-md"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה ללקוחות
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה ללקוחות
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/clients?edit=${client.id}`}
            className="inline-flex items-center gap-2 bg-white border border-stone-200 text-stone-800 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-stone-50"
          >
            <Pencil className="w-4 h-4" />
            ערוך פרטים
          </Link>
          <Link
            href={`/documents/new?clientId=${client.id}`}
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-orange-200"
          >
            <Plus className="w-4 h-4" />
            מסמך חדש
          </Link>
        </div>
      </div>

      <div className="card-soft p-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-200 to-rose-200 dark:from-orange-300 dark:to-rose-300 flex items-center justify-center flex-shrink-0 ring-1 ring-orange-300/40 dark:ring-orange-400/60">
            <Building2 className="w-7 h-7 text-orange-900" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-stone-900">{client.name}</h1>
            {client.taxId && (
              <p className="text-sm text-stone-600 mt-0.5">ח.פ / ת.ז: {client.taxId}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {client.phone && (
                <a
                  href={`tel:${client.phone.replace(/\s+/g, "")}`}
                  className="inline-flex items-center gap-1.5 text-stone-700 hover:text-orange-700"
                >
                  <Phone className="w-3.5 h-3.5 text-stone-500" />
                  <span dir="ltr">{client.phone}</span>
                </a>
              )}
              {client.email && (
                <a
                  href={`mailto:${client.email}`}
                  className="inline-flex items-center gap-1.5 text-stone-700 hover:text-orange-700"
                >
                  <Mail className="w-3.5 h-3.5 text-stone-500" />
                  <span dir="ltr">{client.email}</span>
                </a>
              )}
              {client.address && (
                <span className="inline-flex items-center gap-1.5 text-stone-700">
                  <MapPin className="w-3.5 h-3.5 text-stone-500" />
                  <span>{client.address}</span>
                </span>
              )}
            </div>
            {client.notes && (
              <p className="mt-3 text-sm text-stone-700 italic flex items-start gap-2">
                <StickyNote className="w-4 h-4 text-stone-500 flex-shrink-0 mt-0.5" />
                <span>{client.notes}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-soft p-4 bg-gradient-to-br from-emerald-50 to-teal-50 border-transparent">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-stone-600">סה״כ שולם</p>
              <p className="text-lg font-bold text-stone-900 truncate">{formatCurrency(totalPaid)}</p>
            </div>
          </div>
        </div>
        <div className="card-soft p-4 bg-gradient-to-br from-orange-50 to-amber-50 border-transparent">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-orange-700" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-stone-600">סה״כ חויב</p>
              <p className="text-lg font-bold text-stone-900 truncate">{formatCurrency(totalBilled)}</p>
            </div>
          </div>
        </div>
        <div className="card-soft p-4 bg-gradient-to-br from-blue-50 to-cyan-50 border-transparent">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <CalendarDays className="w-4 h-4 text-blue-700" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-stone-600">פעילות אחרונה</p>
              <p className="text-sm font-bold text-stone-900">
                {lastDocDate ? formatDate(lastDocDate) : "—"}
              </p>
            </div>
          </div>
        </div>
        <div className="card-soft p-4 bg-gradient-to-br from-amber-50 to-yellow-50 border-transparent">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
              <CalendarDays className="w-4 h-4 text-amber-700" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-stone-600">פתוחים</p>
              <p className="text-lg font-bold text-stone-900">{openCount}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card-soft overflow-hidden">
        <div className="px-6 py-4 border-b border-orange-100 flex items-center justify-between">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <span className="text-2xl">📋</span>
            כל המסמכים ({docs.length})
          </h2>
        </div>
        {docs.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">📭</div>
            <h3 className="font-bold text-stone-900 mb-1">אין מסמכים ללקוח זה</h3>
            <p className="text-sm text-stone-700 mb-4">צור את המסמך הראשון</p>
            <Link
              href={`/documents/new?clientId=${client.id}`}
              className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-md"
            >
              <Plus className="w-4 h-4" />
              מסמך חדש
            </Link>
          </div>
        ) : (
          <DocumentsTable documents={docs} />
        )}
      </div>
    </div>
  );
}
