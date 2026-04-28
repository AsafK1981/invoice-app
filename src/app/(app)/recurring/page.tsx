"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Calendar,
  Trash2,
  Plus,
  Power,
  PowerOff,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  useRecurringTemplates,
  saveTemplate,
  deleteTemplate,
  calculateNextDue,
  type RecurringTemplate,
} from "@/lib/recurring-store";
import { useClients } from "@/lib/client-store";
import { useBusiness } from "@/lib/business-store";
import { getNextNumber, saveDocument } from "@/lib/document-store";
import { getVatRate, calculateVat, canIssueTaxInvoices } from "@/lib/vat";
import { formatCurrency, formatDate } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, type InvoiceDocument } from "@/lib/types";

export default function RecurringPage() {
  const router = useRouter();
  const { templates } = useRecurringTemplates();
  const { items: clients } = useClients();
  const { business } = useBusiness();
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function handleGenerate(template: RecurringTemplate) {
    setCreatingId(template.id);
    setToast(null);
    try {
      const subtotal = template.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const vatRate = getVatRate(business);
      const vat = calculateVat(subtotal, vatRate);
      const total = subtotal + vat;
      const allocatedNumber = await getNextNumber(template.documentType);

      const doc: InvoiceDocument = {
        id: crypto.randomUUID(),
        type: template.documentType,
        number: allocatedNumber,
        date: new Date().toISOString().slice(0, 10),
        clientId: template.clientId,
        clientName: template.clientName,
        subject: template.subject,
        status: template.documentType === "receipt" ? "paid" : "sent",
        items: template.items.map((i) => ({
          id: crypto.randomUUID(),
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.quantity * i.unitPrice,
        })),
        subtotal,
        vat,
        total,
        paymentMethod: "bank_transfer",
      };
      await saveDocument(doc);

      const updated: RecurringTemplate = {
        ...template,
        nextDue: calculateNextDue(template.nextDue, template.frequency),
      };
      await saveTemplate(updated);

      setToast({ kind: "success", text: `מסמך #${allocatedNumber} נוצר. פותח...` });
      setTimeout(() => router.push(`/documents/${doc.id}`), 800);
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "שגיאה",
      });
    } finally {
      setCreatingId(null);
    }
  }

  async function handleToggleActive(template: RecurringTemplate) {
    await saveTemplate({ ...template, active: !template.active });
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק את התבנית הזו?")) return;
    await deleteTemplate(id);
  }

  const today = new Date().toISOString().slice(0, 10);
  const dueTemplates = templates.filter((t) => t.active && t.nextDue <= today);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-sm">
              <RefreshCw className="w-5 h-5 text-white" />
            </span>
            חיובים חוזרים
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            תבניות לחיובים חודשיים/שבועיים. צור תבנית פעם אחת, הפק חשבונית בלחיצה אחת.
          </p>
        </div>
      </div>

      {toast && (
        <div
          className={`flex items-start gap-2 text-sm p-3 rounded-2xl ${
            toast.kind === "success"
              ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
              : "bg-rose-50 text-rose-900 border border-rose-200"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 mt-0.5 text-rose-600" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {dueTemplates.length > 0 && (
        <div className="card-soft p-5 bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-violet-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-stone-900">
                {dueTemplates.length} {dueTemplates.length === 1 ? "תבנית מוכנה" : "תבניות מוכנות"} להפקה
              </h3>
              <p className="text-sm text-stone-700 mt-1">
                לחץ על "הפק עכשיו" ליד כל תבנית כדי ליצור את המסמך.
              </p>
            </div>
          </div>
        </div>
      )}

      <CreateTemplateCard clients={clients} />

      {templates.length === 0 ? (
        <div className="card-soft p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center mx-auto mb-4">
            <RefreshCw className="w-7 h-7 text-violet-500" />
          </div>
          <h3 className="font-bold text-stone-900 mb-1">אין תבניות עדיין</h3>
          <p className="text-sm text-stone-700">
            הוסף תבנית כדי להפיק חיובים חודשיים אוטומטית
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const subtotal = t.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
            const vat = calculateVat(subtotal, getVatRate(business));
            const total = subtotal + vat;
            const isDue = t.active && t.nextDue <= today;

            return (
              <div
                key={t.id}
                className={`card-soft p-5 ${
                  isDue ? "border-violet-300 bg-violet-50/30" : ""
                }`}
              >
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-stone-900">{t.clientName}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-700">
                        {DOCUMENT_TYPE_LABELS[t.documentType]}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                        {t.frequency === "monthly" ? "חודשי" : "שבועי"}
                      </span>
                      {!t.active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                          לא פעיל
                        </span>
                      )}
                    </div>
                    {t.subject && (
                      <p className="text-sm text-stone-700 mt-1">{t.subject}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-stone-600">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        תאריך הבא: {formatDate(t.nextDue)}
                      </span>
                      <span className="font-semibold text-stone-900">{formatCurrency(total)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleGenerate(t)}
                      disabled={!t.active || creatingId === t.id}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 ${
                        isDue
                          ? "bg-gradient-to-l from-violet-500 to-purple-500 text-white hover:shadow-md hover:shadow-violet-200"
                          : "bg-white border border-violet-200 text-violet-700 hover:bg-violet-50"
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      {creatingId === t.id ? "יוצר..." : "הפק עכשיו"}
                    </button>
                    <button
                      onClick={() => handleToggleActive(t)}
                      className="w-9 h-9 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
                      title={t.active ? "השבת" : "הפעל"}
                    >
                      {t.active ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="w-9 h-9 rounded-xl text-stone-400 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center"
                      title="מחק"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateTemplateCard({ clients }: { clients: { id: string; name: string }[] }) {
  const { business } = useBusiness();
  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "weekly">("monthly");
  const [docType, setDocType] = useState("receipt");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    const numAmount = parseFloat(amount);
    if (!clientId || !description.trim() || isNaN(numAmount) || numAmount <= 0) return;
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;

    setSaving(true);
    try {
      await saveTemplate({
        id: crypto.randomUUID(),
        clientId,
        clientName: client.name,
        documentType: docType as RecurringTemplate["documentType"],
        subject: subject.trim(),
        items: [{ description: description.trim(), quantity: 1, unitPrice: numAmount }],
        frequency,
        nextDue: new Date().toISOString().slice(0, 10),
        active: true,
        createdAt: new Date().toISOString(),
      });
      setShowForm(false);
      setClientId("");
      setSubject("");
      setDescription("");
      setAmount("");
    } finally {
      setSaving(false);
    }
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="card-soft p-4 w-full text-right border-2 border-dashed border-violet-200 hover:border-violet-400 hover:bg-violet-50/30 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-sm">
            <Plus className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-stone-900">תבנית חדשה</p>
            <p className="text-xs text-stone-700">הגדר חיוב חוזר ללקוח</p>
          </div>
        </div>
      </button>
    );
  }

  const canTaxInvoice = canIssueTaxInvoices(business);

  return (
    <div className="card-soft p-5 space-y-4">
      <h3 className="font-bold text-stone-900">תבנית חיוב חוזרת</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-stone-700 mb-1 block">לקוח</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="input-warm">
            <option value="">בחר לקוח</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-stone-700 mb-1 block">סוג מסמך</label>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="input-warm">
            <option value="receipt">קבלה</option>
            <option value="quote">חשבון עסקה</option>
            {canTaxInvoice && <option value="tax_invoice">חשבונית מס</option>}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-stone-700 mb-1 block">נושא</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="למשל: שירותי ייעוץ"
          className="input-warm"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-stone-700 mb-1 block">תיאור</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="ייעוץ חודשי - X שעות"
            className="input-warm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-stone-700 mb-1 block">סכום (₪)</label>
          <input
            type="number"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="2000"
            className="input-warm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-stone-700 mb-1 block">תדירות</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as "monthly" | "weekly")}
          className="input-warm"
        >
          <option value="monthly">חודשי</option>
          <option value="weekly">שבועי</option>
        </select>
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setShowForm(false)}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 hover:bg-stone-100"
        >
          ביטול
        </button>
        <button
          onClick={handleCreate}
          disabled={!clientId || !description.trim() || !amount || saving}
          className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-violet-500 to-purple-500 text-white hover:shadow-md hover:shadow-violet-200 disabled:opacity-50"
        >
          {saving ? "שומר..." : "צור תבנית"}
        </button>
      </div>
    </div>
  );
}
