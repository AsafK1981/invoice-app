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
  UserPlus,
  Eye,
  EyeOff,
  Percent,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { sendReceiptEmail } from "@/lib/email";
import { createDocument } from "@/lib/document-store";
import { parseEmails, joinEmails, isValidEmail } from "@/lib/emails";
import { getVatRate, computeAmounts, round2, type VatMode } from "@/lib/vat";
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
import { DocumentPreview, type PreviewClient } from "./document-preview";
import { FormField } from "./ui/form-field";

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

  const vatRate = getVatRate(business);
  const isCreditNote = documentType === "credit_note";
  const sign = isCreditNote ? -1 : 1;

  const [adhocMode, setAdhocMode] = useState<boolean>(false);
  const [clientId, setClientId] = useState<string>("");
  const [adhocName, setAdhocName] = useState<string>("");
  const [adhocTaxId, setAdhocTaxId] = useState<string>("");
  const [adhocEmail, setAdhocEmail] = useState<string>("");

  const [date, setDate] = useState<string>(today);
  const [subject, setSubject] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<EditorItem[]>([
    { id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [vatMode, setVatMode] = useState<VatMode>("exclusive");

  const [sendEmail, setSendEmail] = useState<boolean>(true);
  const [emailTo, setEmailTo] = useState<string>("");
  const [emailOverridden, setEmailOverridden] = useState<boolean>(false);
  const [showPreviewMobile, setShowPreviewMobile] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const selectedClient = clients.find((c) => c.id === clientId);
  const previewClient: PreviewClient | null = (() => {
    if (adhocMode) {
      const name = adhocName.trim();
      if (!name) return null;
      return {
        name,
        taxId: adhocTaxId.trim() || undefined,
        email: adhocEmail.trim() || undefined,
      };
    }
    if (!selectedClient) return null;
    return {
      name: selectedClient.name,
      taxId: selectedClient.taxId,
      address: selectedClient.address,
      phone: selectedClient.phone,
      email: selectedClient.email,
    };
  })();

  const amounts = useMemo(
    () => computeAmounts(items, vatRate, vatMode),
    [items, vatRate, vatMode]
  );
  const { subtotal, vat, total, netUnitPriceFactor } = amounts;

  useEffect(() => {
    if (emailOverridden) return;
    if (adhocMode) {
      setEmailTo(adhocEmail);
    } else {
      setEmailTo(selectedClient?.email || "");
    }
  }, [selectedClient, emailOverridden, adhocMode, adhocEmail]);

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

      if (srcDoc.client_id) {
        setClientId(srcDoc.client_id);
        setAdhocMode(false);
      } else if (srcDoc.client_name) {
        setAdhocMode(true);
        setAdhocName(srcDoc.client_name);
      }
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

  const previewItems = useMemo(
    () =>
      items.map((i) => {
        const unitPrice = round2(i.unitPrice * netUnitPriceFactor);
        return {
          id: i.id,
          productId: i.productId,
          description: i.description,
          quantity: i.quantity,
          unitPrice,
          total: round2(i.quantity * unitPrice),
        };
      }),
    [items, netUnitPriceFactor]
  );

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

  const clientReady = adhocMode ? adhocName.trim().length > 0 : !!clientId;
  const canSave =
    clientReady &&
    items.every((i) => i.description.trim() && i.quantity > 0 && i.unitPrice >= 0) &&
    (!sendEmail || allEmailsValid);

  function buildClientName(): string {
    if (adhocMode) return adhocName.trim();
    return selectedClient?.name || "";
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setToast(null);

    try {
      const clientName = buildClientName();

      const persistItems = items.map((i) => {
        const netUnitPrice = round2(i.unitPrice * netUnitPriceFactor);
        return {
          id: i.id,
          productId: i.productId,
          description: i.description,
          quantity: sign * i.quantity,
          unitPrice: netUnitPrice,
          total: round2(sign * i.quantity * netUnitPrice),
        };
      });

      const draft: Omit<InvoiceDocument, "number"> = {
        id: crypto.randomUUID(),
        type: documentType,
        date,
        clientId: adhocMode ? "" : selectedClient?.id || "",
        clientName,
        subject: subject.trim() || undefined,
        status:
          documentType === "receipt" || documentType === "tax_invoice_receipt"
            ? "paid"
            : "sent",
        items: persistItems,
        subtotal: round2(sign * subtotal),
        vat: round2(sign * vat),
        total: round2(sign * total),
        paymentMethod: isQuote ? undefined : paymentMethod,
        notes: isQuote && validUntil
          ? `${notes.trim() ? notes.trim() + "\n" : ""}הצעה בתוקף עד: ${validUntil}`
          : notes.trim() || undefined,
      };

      const { id: docId, number: allocatedNumber } = await createDocument(draft);
      const doc = { ...draft, id: docId, number: allocatedNumber };

      if (sendEmail) {
        const result = await sendReceiptEmail({
          to: joinEmails(emailRecipients),
          clientName,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
      setToast({ kind: "error", text: `שמירת המסמך נכשלה: ${message}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 space-y-6">
        <Section title="פרטי המסמך" icon={FileTextIcon}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="לקוח" required className="md:col-span-2">
              <div className="space-y-2">
                <div className="inline-flex bg-orange-50 rounded-xl p-1 text-xs font-semibold gap-1">
                  <button
                    type="button"
                    onClick={() => setAdhocMode(false)}
                    className={`inline-flex items-center justify-center min-h-[36px] px-3.5 rounded-lg transition-colors ${
                      !adhocMode
                        ? "bg-white text-orange-700 shadow-sm"
                        : "text-stone-600 hover:text-stone-800"
                    }`}
                  >
                    מהקטלוג
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdhocMode(true)}
                    className={`inline-flex items-center justify-center gap-1 min-h-[36px] px-3.5 rounded-lg transition-colors ${
                      adhocMode
                        ? "bg-white text-orange-700 shadow-sm"
                        : "text-stone-600 hover:text-stone-800"
                    }`}
                  >
                    <UserPlus className="w-3 h-3" />
                    לקוח מזדמן
                  </button>
                </div>
                {adhocMode ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={adhocName}
                      onChange={(e) => setAdhocName(e.target.value)}
                      placeholder="שם הלקוח *"
                      className="input-warm"
                    />
                    <input
                      type="text"
                      value={adhocTaxId}
                      onChange={(e) => setAdhocTaxId(e.target.value)}
                      placeholder="ח.פ / ת.ז (אופציונלי)"
                      className="input-warm"
                    />
                    <input
                      type="email"
                      value={adhocEmail}
                      onChange={(e) => setAdhocEmail(e.target.value)}
                      placeholder="email@example.com (אופציונלי)"
                      dir="ltr"
                      className="input-warm md:col-span-2"
                    />
                    <p className="text-xs text-stone-600 md:col-span-2">
                      הלקוח לא יישמר במאגר - שמו יופיע על המסמך הזה בלבד.
                    </p>
                  </div>
                ) : (
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
                )}
              </div>
            </FormField>

            <FormField label="תאריך">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input-warm"
              />
            </FormField>

            <FormField label="נושא">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="למשל: ייעוץ - אפריל 2026"
                className="input-warm"
              />
            </FormField>

            {!isQuote && (
              <FormField label="אמצעי תשלום">
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
              </FormField>
            )}

            {isQuote && (
              <FormField label="תוקף ההצעה (אופציונלי)">
                <input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="input-warm"
                />
              </FormField>
            )}
          </div>
        </Section>

        <Section title="פריטים" icon={Package}>
          {vatRate > 0 && (
            <div className="mb-4 flex items-center justify-between gap-3 p-3 rounded-xl bg-orange-50/60 border border-orange-100">
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium text-stone-800">המחירים שאני מזין</span>
              </div>
              <div className="inline-flex bg-white rounded-xl p-1 text-xs font-semibold gap-1 border border-orange-100">
                <button
                  type="button"
                  onClick={() => setVatMode("exclusive")}
                  className={`inline-flex items-center justify-center min-h-[36px] px-3.5 rounded-lg transition-colors ${
                    vatMode === "exclusive"
                      ? "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm"
                      : "text-stone-700 hover:text-stone-900"
                  }`}
                >
                  לפני מע״מ
                </button>
                <button
                  type="button"
                  onClick={() => setVatMode("inclusive")}
                  className={`inline-flex items-center justify-center min-h-[36px] px-3.5 rounded-lg transition-colors ${
                    vatMode === "inclusive"
                      ? "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm"
                      : "text-stone-700 hover:text-stone-900"
                  }`}
                >
                  כולל מע״מ ({vatRate}%)
                </button>
              </div>
            </div>
          )}
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
                  {idx === 0 && (
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">
                      מחיר יחידה
                    </label>
                  )}
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
            <FormField label="נמענים">
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
                {emailTo && emailOverridden && (
                  <button
                    type="button"
                    onClick={() => {
                      setEmailTo(adhocMode ? adhocEmail : selectedClient?.email || "");
                      setEmailOverridden(false);
                    }}
                    className="text-xs text-orange-600 hover:underline"
                  >
                    שחזר מהלקוח
                  </button>
                )}
              </div>
              {!adhocMode && selectedClient && !selectedClient.email && (
                <p className="text-xs text-amber-700 mt-1">
                  ללקוח זה אין אימייל שמור - מלא ידנית או ערוך את פרטי הלקוח
                </p>
              )}
            </FormField>
          )}
        </Section>

        <button
          type="button"
          onClick={() => setShowPreviewMobile((s) => !s)}
          className="lg:hidden w-full inline-flex items-center justify-center gap-2 bg-white border-2 border-orange-200 text-stone-800 py-3 rounded-2xl text-sm font-semibold hover:bg-orange-50"
        >
          {showPreviewMobile ? (
            <>
              <EyeOff className="w-4 h-4" />
              הסתר תצוגה מקדימה
            </>
          ) : (
            <>
              <Eye className="w-4 h-4" />
              הצג תצוגה מקדימה
            </>
          )}
        </button>

        {showPreviewMobile && (
          <div className="lg:hidden">
            <DocumentPreview
              business={business}
              client={previewClient}
              documentType={documentType}
              date={date}
              subject={subject || undefined}
              items={previewItems}
              subtotal={subtotal}
              vat={vat}
              vatRate={vatRate}
              total={total}
              paymentMethod={isQuote ? undefined : paymentMethod}
              notes={notes || undefined}
            />
          </div>
        )}
      </div>

      <aside className="lg:col-span-5 space-y-4">
        <div className="card-soft p-5 sticky top-4 bg-gradient-to-br from-orange-50/50 to-amber-50/50 border-orange-200">
          <h3 className="font-semibold text-stone-900 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-500" />
            סיכום ושליחה
          </h3>
          <div className="space-y-1.5 text-sm">
            {vatRate > 0 && (
              <>
                <SummaryRow label="סכום ביניים" value={formatCurrency(subtotal)} />
                <SummaryRow label={`מע״מ (${vatRate}%)`} value={formatCurrency(vat)} />
              </>
            )}
            <div className="flex justify-between items-baseline pt-2">
              <span className="text-stone-800 font-semibold">
                {isQuote ? "סה״כ הצעה" : isCreditNote ? "סה״כ זיכוי" : "סה״כ לתשלום"}
              </span>
              <span className="text-2xl font-bold bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent">
                {formatCurrency(total)}
              </span>
            </div>
          </div>
          <div className="mt-4 space-y-2">
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
          </div>
          {!canSave && (
            <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {sendEmail && clientReady && !allEmailsValid
                  ? "יש להזין אימייל תקין לשליחה"
                  : !clientReady
                  ? "יש לבחור לקוח או למלא שם של לקוח מזדמן"
                  : "כל פריט חייב תיאור, כמות חיובית ומחיר"}
              </span>
            </div>
          )}
          {toast && (
            <div
              className={`mt-3 text-sm p-3 rounded-xl flex items-start gap-2 ${
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

        <div className="hidden lg:block">
          <h3 className="font-semibold text-stone-900 mb-3 flex items-center gap-2 text-sm">
            <Eye className="w-4 h-4 text-orange-500" />
            תצוגה מקדימה
          </h3>
          <DocumentPreview
            business={business}
            client={previewClient}
            documentType={documentType}
            date={date}
            subject={subject || undefined}
            items={previewItems}
            subtotal={subtotal}
            vat={vat}
            vatRate={vatRate}
            total={total}
            paymentMethod={isQuote ? undefined : paymentMethod}
            notes={notes || undefined}
          />
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-stone-700 font-medium">{label}</span>
      <span className="text-stone-900 font-semibold">{value}</span>
    </div>
  );
}
