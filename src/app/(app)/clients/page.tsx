"use client";

import { useState } from "react";
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
} from "lucide-react";
import { useClients, clientStore } from "@/lib/client-store";
import { formatDate } from "@/lib/format";
import { ClientFormModal } from "@/components/client-form-modal";
import type { Client } from "@/lib/types";

export default function ClientsPage() {
  const { items: clients } = useClients();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setModalOpen(true);
  }

  async function remove(client: Client) {
    if (confirm(`למחוק את ${client.name}?`)) await clientStore.remove(client.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-sm">
              <Users className="w-5 h-5 text-white" />
            </span>
            לקוחות
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">{clients.length} לקוחות בספר</p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
        >
          <UserPlus className="w-4 h-4" />
          לקוח חדש
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="card-soft p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-100 to-rose-100 flex items-center justify-center mx-auto mb-4">
            <Users className="w-7 h-7 text-orange-500" />
          </div>
          <h3 className="font-bold text-stone-900 mb-1">עדיין אין לקוחות</h3>
          <p className="text-sm text-stone-700 mb-5">הוסף את הלקוח הראשון שלך</p>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-md"
          >
            <UserPlus className="w-4 h-4" />
            הוסף לקוח
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((c) => (
            <div
              key={c.id}
              className="card-soft p-5 hover:shadow-md hover:-translate-y-0.5 transition-all group relative"
            >
              <div className="absolute top-3 left-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => openEdit(c)}
                  className="w-8 h-8 rounded-xl bg-white hover:bg-orange-50 text-stone-600 hover:text-orange-600 flex items-center justify-center shadow-sm border border-orange-100"
                  title="עריכה"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => remove(c)}
                  className="w-8 h-8 rounded-xl bg-white hover:bg-rose-50 text-stone-600 hover:text-rose-600 flex items-center justify-center shadow-sm border border-orange-100"
                  title="מחיקה"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-200 to-rose-200 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-orange-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-stone-900 truncate">{c.name}</h3>
                  {c.taxId && (
                    <p className="text-xs text-stone-600 mt-0.5">ח.פ / ת.ז: {c.taxId}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-1.5 text-sm">
                {c.phone && (
                  <div className="flex items-center gap-2 text-stone-800">
                    <Phone className="w-3.5 h-3.5 text-stone-500 flex-shrink-0" />
                    <span dir="ltr">{c.phone}</span>
                  </div>
                )}
                {c.email && (
                  <div className="flex items-center gap-2 text-stone-800 truncate">
                    <Mail className="w-3.5 h-3.5 text-stone-500 flex-shrink-0" />
                    <span dir="ltr" className="truncate">{c.email}</span>
                  </div>
                )}
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

              <div className="mt-4 pt-3 border-t border-orange-100 text-xs text-stone-500">
                נוסף בתאריך {formatDate(c.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      <ClientFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        client={editing}
      />
    </div>
  );
}
