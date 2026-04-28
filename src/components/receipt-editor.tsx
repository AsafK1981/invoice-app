"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  FileText as FileTextIcon,
  Trash2,
  Package,
  StickyNote,
  Send,
  Mail,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Save,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { sendReceiptEmail } from "@/lib/email";
import { getNextNumber, saveDocument } from "@/lib/document-store";
import { parseEmails, joinEmails, isValidEmail } from "@/lib/emails";
import { getVatRate, calculateVat } from "@/lib/vat";
import {
  type Business,
  type Client,
  type Product,
  type PaymentMethod,
  type DocumentType,
  type InvoiceDocument,
  PAYMENT_METHOD_LABELS,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/types";

interface EditorItem {
  id: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

interface Props {
  business: Business;
  clients: Client[];
  products: Product[];
  documentType?: DocumentType;
}

export function ReceiptEditor({ business, clients, products, documentType = "receipt" }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromDocId = searchParams.get("from");
  const isConvert = searchParams.get("convert") === "1";
  const today = new Date().toISOString().slice(0, 10);
  const isQuote = documentType === "quote";
  const docLabel = DOCUMENT_TYPE_LABELS[documentType];

  const [clientId, setClientId] = useState<string>("");
  const [date, setDate] = useState<string>(today);
  const [subject, setSubject] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<EditorItem[]>([
    { id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [sendEmail, setSendEmail] = useState<boolean>(true);
  const [emailTo, setEmailTo] = useState<string>("");
  const [emailOverridden, setEmailOverridden] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const selectedClient = clients.find((c) => c.id === clientId);
  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0), [items]);
  const vatRate = getVatRate(business);
  const isCreditNote = documentType === "credit_note";
  const sign = isCreditNote ? -1 : 1;
  const vat = useMemo(() => calculateVat(subtotal, vatRate), [subtotal, vatRate]);
  const total = subtotal + vat;

  useEffect(() => {
    if (!emailOverridden) setEmailTo(selectedClient?.email || "");
  }, [selectedClient, emailOverridden]);

  useEffect(() => {
    if (!fromDocId) return;
    (async () => {
      const { data: srcDoc } = await supabase
        .from("documents")
        .select("*")
        .eq("id", fromDocId)
        .maybeSingle();
      if (!srcDoc) return;
      const { data: srcItems } = await supabase
        .from("document_items")
        .select("*")
        .eq("document_id", fromDocId)
        .order("sort_order");

      setClientId(srcDoc.client_id || "");
      if (isConvert) {
        const noteText = `הומר מהצעת מחיר #${srcDoc.number}`;
        setSubject(srcDoc.subject || "");
        setNotes(srcDoc.notes ? `${srcDoc.notes}\n${noteText}` : noteText);
      } else {
        setSubject(srcDoc.subject || "");
        setNotes(srcDoc.notes || "");
      }
      if (srcItems && srcItems.length > 0) {
        setItems(
          srcItems.map((row: { id: string; product_id: string | null; description: string; quantity: number; unit_price: number }) => ({
            id: crypto.randomUUID(),
            productId: row.product_id || undefined,
            description: row.description,
            quantity: Math.abs(Number(row.quantity)) || 1,
            unitPrice: Number(row.unit_price) || 0,
          }))
        );
      }
    })();
  }, [fromDocId, isConvert]);

  const emailRecipients = useMemo(() => parseEmails(emailTo), [emailTo]);
  const allEmailsValid =
    emailRecipients.length > 0 && emailRecipients.every(isValidEmail);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function updateItem(id: string, patch: Partial<EditorItem>) {
    setItems((curr) => curr.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function pickProduct(itemId: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    updateItem(itemId, {
      productId: product.id,
      description: product.name,
      unitPrice: product.price,
    });
  }

  function addItem() {
    setItems((curr) => [
      ...curr,
      { id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 },
    ]);
  }

  function removeItem(id: string) {
    setItems((curr) => (curr.length > 1 ? curr.filter((i) => i.id !== id) : curr));
  }

  const canSave =
    !!clientId &&
    items.every((i) => i.description.trim() && i.quantity > 0 && i.unitPrice >= 0) &&
    (!sendEmail || allEmailsValid);

  async function handleSave() {
    if (!canSave || !selectedClient) return;
    setSaving(true);
    setToast(null);

    try {
      const allocatedNumber = await getNextNumber(documentType);

      const doc: InvoiceDocument = {
        id: crypto.randomUUID(),
        type: documentType,
        number: allocatedNumber,
        date,
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        subject: subject.trim() || undefined,
        status:
          documentType === "receipt" || documentType === "tax_invoice_receipt"
            ? "paid"
            : "sent",
        items: items.map((i) => ({
          id: i.id,
          productId: i.productId,
          description: i.description,
          quantity: sign * i.quantity,
          unitPrice: i.unitPrice,
          total: sign * i.quantity * i.unitPrice,
        })),
        subtotal: sign * subtotal,
        vat: sign * vat,
        total: sign * total,
        paymentMethod: isQuote ? undefined : paymentMethod,
        notes: isQuote && validUntil
          ? `${notes.trim() ? notes.trim() + "\n" : ""}הצעה בתוקף עד: ${validUntil}`
          : notes.trim() || undefined,
      };

      await saveDocument(doc);

      if (sendEmail) {
        const result = await sendReceiptEmail({
          to: joinEmails(emailRecipients),
          clientName: selectedClient.name,
          receiptNumber: allocatedNumber,
          total,
          businessName: business.name,
          documentId: doc.id,
          logoUrl: business.logoUrl,
        });
        if (!result.ok) {
          setToast({ kind: "error", text: `המסמך נשמר אבל שליחת המייל נכשלה: ${result.error}` });
          return;
        }
        setToast({
          kind: "success",
          text: result.mocked
            ? `${docLabel} #${allocatedNumber} נשמרה. מייל מדומה נשלח ל-${emailTo}. פותח תצוגה...`
            : `${docLabel} #${allocatedNumber} נשמרה ונשלחה ל-${emailTo}. פותח תצוגה...`,
        });
      } else {
        setToast({
          kind: "success",
          text: `${docLabel} #${allocatedNumber} נשמרה. פותח תצוגה...`,
        });
      }

      setTimeout(() => router.push(`/documents/${doc.id}`), 1000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Section title="פרטי המסמך" icon={FileTextIcon}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="לקוח" required>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="input-warm"
              >
                <option value="">בחר לקוח...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="תאריך">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input-warm"
              />
            </Field>

            <Field label="נושא" className="md:col-span-2">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="למשל: ייעוץ טכנולוגי - אפריל 2026"
                className="input-warm"
              />
            </Field>

            {!isQuote && (
              <Field label="אמצעי תשלום">
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="input-warm"
                >
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {isQuote && (
              <Field label="תוקף ההצעה (אופציונלי)">
                <input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="input-warm"
                />
              </Field>
            )}
          </div>
        </Section>

        <Section title="פריטים" icon={Package}>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={item.id} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-12 md:col-span-5">
                  {idx === 0 && <label className="text-xs font-semibold text-stone-700 mb-1 block">תיאור</label>}
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      placeholder="תיאור השירות/מוצר"
                      className="input-warm flex-1"
                    />
                    <div className="relative">
                      <select
                        value={item.productId || ""}
                        onChange={(e) => pickProduct(item.id, e.target.value)}
                        className="input-warm w-12 text-transparent cursor-pointer appearance-none"
                        title="בחר מהקטלוג"
                      >
                        <option value=""></option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id} className="text-stone-800">
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <Package className="w-4 h-4 absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 text-orange-500 pointer-events-none" />
                    </div>
                  </div>
                </div>
                <div className="col-span-4 md:col-span-2">
                  {idx === 0 && <label className="text-xs font-semibold text-stone-700 mb-1 block">כמות</label>}
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={item.quantity}
                    onChange={(e) => updateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                    className="input-warm"
                  />
                </div>
                <div className="col-span-4 md:col-span-2">
                  {idx === 0 && <label className="text-xs font-semibold text-stone-700 mb-1 block">מחיר יחידה</label>}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(item.id, { unitPrice: parseFloat(e.target.value) || 0 })}
                    className="input-warm"
                  />
                </div>
                <div className="col-span-3 md:col-span-2">
                  {idx === 0 && <label className="text-xs font-semibold text-stone-700 mb-1 block">סה״כ</label>}
                  <div className="input-warm bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200 text-stone-900 font-bold text-left">
                    {formatCurrency(item.quantity * item.unitPrice)}
                  </div>
                </div>
                <div className="col-span-1 flex items-end h-full">
                  <button
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                    className="text-stone-300 hover:text-rose-500 disabled:opacity-30 disabled:cursor-not-allowed p-2 rounded-lg hover:bg-rose-50 transition-colors"
                    title="הסר פריט"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={addItem}
              className="text-sm text-blue-600 hover:text-blue-800 font-semibold"
            >
              + הוסף פריט
            </button>
          </div>
        </Section>

        <Section title="הערות" icon={StickyNote}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="הערות אופציונליות שיופיעו על המסמך"
            rows={3}
            className="input-warm"
          />
        </Section>

        <Section title="שליחה ללקוח" icon={Mail}>
          <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="w-4 h-4 accent-orange-500"
            />
            <span className="text-stone-700">שלח את ה{docLabel} אוטומטית במייל ללקוח כשאני לוחץ שמור</span>
          </label>
          {sendEmail && (
            <Field label="נמענים">
              <input
                type="text"
                dir="ltr"
                value={emailTo}
                onChange={(e) => {
                  setEmailTo(e.target.value);
                  setEmailOverridden(true);
                }}
                placeholder="email1@example.com, email2@example.com"
                className="input-warm"
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-stone-600">
                  {emailRecipients.length > 0
                    ? `יישלח ל-${emailRecipients.length} נמענים. הפרד אימיילים בפסיק.`
                    : "הפרד כמה אימיילים בפסיק"}
                </p>
                {emailTo && emailOverridden && selectedClient?.email && (
                  <button
                    type="button"
                    onClick={() => {
                      setEmailTo(selectedClient.email || "");
                      setEmailOverridden(false);
                    }}
                    className="text-xs text-orange-600 hover:underline"
                  >
                    שחזר מהלקוח
                  </button>
                )}
              </div>
              {selectedClient && !selectedClient.email && (
                <p className="text-xs text-amber-700 mt-1">
                  ללקוח זה אין אימייל שמור - מלא ידנית או ערוך את פרטי הלקוח
                </p>
              )}
            </Field>
          )}
        </Section>
      </div>

      <aside className="lg:col-span-1 space-y-4">
        <div className="card-soft p-5 sticky top-4 bg-gradient-to-br from-orange-50/50 to-amber-50/50 border-orange-200">
          <h3 className="font-semibold text-stone-900 mb-4 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-500" />
            תצוגת סיכום
          </h3>
          <div className="space-y-2 text-sm">
            <SummaryRow label="עסק" value={business.name} />
            <SummaryRow label={`מספר ${docLabel}`} value="אוטומטי בשמירה" />
            <SummaryRow label="תאריך" value={date} />
            <SummaryRow label="לקוח" value={selectedClient?.name || "—"} />
            <SummaryRow label="מספר פריטים" value={String(items.length)} />
            <div className="border-t border-orange-200 my-3" />
            {vatRate > 0 && (
              <>
                <SummaryRow label="סכום ביניים" value={formatCurrency(subtotal)} />
                <SummaryRow label={`מע״מ (${vatRate}%)`} value={formatCurrency(vat)} />
              </>
            )}
            <div className="flex justify-between items-baseline">
              <span className="text-stone-800 font-semibold">
                {isQuote ? "סה״כ הצעה" : isCreditNote ? "סה״כ זיכוי" : "סה״כ לתשלום"}
              </span>
              <span className="text-3xl font-bold bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent">
                {formatCurrency(total)}
              </span>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:cursor-not-allowed disabled:shadow-none transition-all"
            >
              {saving ? (
                "שולח..."
              ) : sendEmail ? (
                <>
                  <Send className="w-4 h-4" />
                  שמור, הפק ושלח
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  שמור והפק {docLabel}
                </>
              )}
            </button>
            <p className="text-xs text-stone-600 text-center pt-1">
              לאחר השמירה תועבר לתצוגת המסמך עם כפתור הדפסה/PDF
            </p>
          </div>
          {!canSave && (
            <div className="mt-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {sendEmail && clientId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)
                  ? "יש להזין אימייל תקין לשליחה"
                  : "יש למלא לקוח וכל פריט חייב תיאור וכמות חיובית"}
              </span>
            </div>
          )}
          {toast && (
            <div
              className={`mt-4 text-sm p-3 rounded-xl flex items-start gap-2 ${
                toast.kind === "success"
                  ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                  : "bg-rose-50 text-rose-900 border border-rose-200"
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
        </div>
      </aside>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="card-soft p-5">
      <h2 className="font-semibold text-stone-900 mb-4 flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-orange-500" />}
        {title}
      </h2>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  required,
  className,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-xs font-semibold text-stone-700 mb-1 block">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-stone-700 font-medium">{label}</span>
      <span className="text-stone-900 font-semibold">{value}</span>
    </div>
  );
}
