"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  GripVertical,
  X,
  Plus,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { sendReceiptEmail } from "@/lib/email";
import { createDocument, getNextDocumentNumber, linkConvertedDocument, markDocumentEmailed, useDocuments } from "@/lib/document-store";
import { getBusinessId, isPlaceholderBusinessName, isPlaceholderBusinessTaxId } from "@/lib/business-init";
import { parseEmails, joinEmails, isValidEmail } from "@/lib/emails";
import { getVatRate, computeAmounts, round2, canIssueTaxInvoices, type VatMode } from "@/lib/vat";
import { CURRENCIES, formatMoney } from "@/lib/currencies";
import { ilsEquivalents } from "@/lib/exchange-rate";
import { todayInIsrael } from "@/lib/date";
import { AllocationConnectBanner } from "@/components/allocation-connect-banner";
import { getClientDefaults } from "@/lib/client-defaults";
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
import {
  loadDraft,
  saveDraft,
  clearDraft,
  isDraftEmpty,
  type EditorDraft,
} from "@/lib/draft-storage";
import {
  saveDraftToServer,
  getServerDraft,
  deleteServerDraft,
  type DraftPayload,
} from "@/lib/draft-store";

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

// Format a stored ISO date ("YYYY-MM-DD" or full timestamp) as DD/MM/YYYY
// without going through Date() — avoids a UTC-vs-local off-by-one day.
function formatDateHe(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export function ReceiptEditor({ business, clients, products, documentType = "receipt" }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromDocId = searchParams.get("from");
  const resumeDraftId = searchParams.get("draft");
  const isConvert = searchParams.get("convert") === "1";
  // Prefill client when arriving from a deep-link like /documents/new/quote?clientId=...
  // (typically from the client profile page's "מסמך חדש" button). Verify the
  // referenced client actually exists for this business before using it.
  const prefilledClientId = (() => {
    const qsClient = searchParams.get("clientId");
    if (!qsClient) return "";
    return clients.some((c) => c.id === qsClient) ? qsClient : "";
  })();
  const today = todayInIsrael();
  const isQuote = documentType === "quote";
  const isProforma = documentType === "proforma";
  // Both price quote (הצעת מחיר) and proforma (חשבון עסקה) are pre-payment
  // documents: no payment method is recorded at issue, and both can be
  // converted into a receipt / tax-invoice once the client pays.
  const isPrePayment = isQuote || isProforma;
  const docLabel = DOCUMENT_TYPE_LABELS[documentType];

  const baseVatRate = getVatRate(business);
  const isCreditNote = documentType === "credit_note";
  const sign = isCreditNote ? -1 : 1;

  const [adhocMode, setAdhocMode] = useState<boolean>(false);
  const [clientId, setClientId] = useState<string>(prefilledClientId);
  const [adhocName, setAdhocName] = useState<string>("");
  const [adhocTaxId, setAdhocTaxId] = useState<string>("");
  const [adhocEmail, setAdhocEmail] = useState<string>("");

  const [date, setDate] = useState<string>(today);
  const [subject, setSubject] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [notes, setNotes] = useState<string>(business.defaultDocNotes || "");
  const [items, setItems] = useState<EditorItem[]>([
    { id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [vatMode, setVatMode] = useState<VatMode>("exclusive");

  const [sendEmail, setSendEmail] = useState<boolean>(true);
  const [emails, setEmails] = useState<string[]>([""]);
  const [emailOverridden, setEmailOverridden] = useState<boolean>(false);
  const [paymentMethodTouched, setPaymentMethodTouched] = useState<boolean>(false);
  const [showPreviewMobile, setShowPreviewMobile] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const saveInFlightRef = useRef(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [allocationNumber, setAllocationNumber] = useState<string>("");
  // The document's number, shown while drafting and editable before finalizing.
  // Defaults to the next number for this type; the real number is reserved on save.
  const [docNumber, setDocNumber] = useState<string>("");
  // Server-draft this editor is bound to (set when resuming, or after the first
  // "שמור טיוטה"); subsequent saves update the same row, and finalizing deletes it.
  const serverDraftIdRef = useRef<string | null>(resumeDraftId);
  const [savingDraft, setSavingDraft] = useState<boolean>(false);
  const [currency, setCurrency] = useState("ILS");
  const [zeroRated, setZeroRated] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateLoading, setRateLoading] = useState(false);

  // Credit note (#17): a זיכוי must reference the original tax invoice it
  // credits (Israeli law). The user either picks one of their issued tax
  // invoices or enters the number+date manually (for invoices issued
  // outside this app). Stored as a structured Hebrew line in the notes —
  // a dedicated `original_document_id` column is a recommended follow-up.
  const [creditRefDocId, setCreditRefDocId] = useState<string>("");
  const [creditRefNumber, setCreditRefNumber] = useState<string>("");
  const [creditRefDate, setCreditRefDate] = useState<string>("");

  const { documents: allDocuments } = useDocuments();
  const clientDefaults = useMemo(
    () => getClientDefaults(clientId, allDocuments),
    [clientId, allDocuments]
  );

  // Auto-fill payment method from the client's most recent doc, but only if
  // (a) user hasn't manually changed it this session, and (b) we're not editing
  // a copy of an existing doc (which has its own payment method already).
  useEffect(() => {
    if (paymentMethodTouched || fromDocId || !clientId) return;
    if (clientDefaults.paymentMethod && clientDefaults.paymentMethod !== paymentMethod) {
      setPaymentMethod(clientDefaults.paymentMethod);
    }
  }, [clientId, clientDefaults.paymentMethod]);

  const [draftRecovered, setDraftRecovered] = useState<{ savedAt: number } | null>(null);
  const [draftDismissed, setDraftDismissed] = useState<boolean>(false);
  const [draftHydrated, setDraftHydrated] = useState<boolean>(false);

  // On mount: if there's no fromDocId (i.e. this is a fresh editor) and a saved
  // draft exists for this doc type, load it and offer the user the option to
  // discard. The hydration flag prevents the auto-save effect from overwriting
  // the draft before we've had a chance to read it.
  useEffect(() => {
    if (fromDocId || resumeDraftId) {
      // Copy/convert and resume-draft hydrate from their own sources; skip the
      // localStorage autosave recovery so it doesn't clobber them.
      setDraftHydrated(true);
      return;
    }
    const stored = loadDraft(documentType);
    if (stored && !isDraftEmpty(stored.draft)) {
      const d = stored.draft;
      setClientId(d.clientId);
      setAdhocMode(d.adhocMode);
      setAdhocName(d.adhocName);
      setAdhocTaxId(d.adhocTaxId);
      setAdhocEmail(d.adhocEmail);
      setDate(d.date);
      setSubject(d.subject);
      setValidUntil(d.validUntil);
      setPaymentMethod(d.paymentMethod);
      setNotes(d.notes);
      setVatMode(d.vatMode);
      setItems(d.items);
      setDraftRecovered({ savedAt: stored.savedAt });
    }
    setDraftHydrated(true);
  }, []);

  // Auto-save: write the current form state to localStorage whenever any
  // saveable field changes. Only after hydration so we don't blow away the
  // saved draft on the very first render.
  useEffect(() => {
    if (!draftHydrated || fromDocId || resumeDraftId) return;
    const draft: EditorDraft = {
      clientId,
      adhocMode,
      adhocName,
      adhocTaxId,
      adhocEmail,
      date,
      subject,
      validUntil,
      paymentMethod,
      notes,
      vatMode,
      items,
    };
    if (isDraftEmpty(draft)) {
      clearDraft(documentType);
    } else {
      saveDraft(documentType, draft);
    }
  }, [
    draftHydrated,
    fromDocId,
    documentType,
    clientId,
    adhocMode,
    adhocName,
    adhocTaxId,
    adhocEmail,
    date,
    subject,
    validUntil,
    paymentMethod,
    notes,
    vatMode,
    items,
  ]);

  function discardDraft() {
    clearDraft(documentType);
    setClientId("");
    setAdhocMode(false);
    setAdhocName("");
    setAdhocTaxId("");
    setAdhocEmail("");
    setDate(today);
    setSubject("");
    setValidUntil("");
    setPaymentMethod("bank_transfer");
    setNotes("");
    setVatMode("exclusive");
    setItems([{ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 }]);
    setDraftRecovered(null);
    setDraftDismissed(true);
  }

  function formatRelativeTime(savedAt: number): string {
    const diffMs = Date.now() - savedAt;
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return "לפני רגע";
    if (diffMin < 60) return `לפני ${diffMin} דקות`;
    const diffHr = Math.round(diffMin / 60);
    return `לפני ${diffHr} ${diffHr === 1 ? "שעה" : "שעות"}`;
  }

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

  const effectiveVatRate = zeroRated ? 0 : baseVatRate;

  useEffect(() => {
    if (currency === "ILS") { setRate(1); setRateLoading(false); return; }
    let cancelled = false;
    setRateLoading(true);
    fetch(`/api/exchange-rate?currency=${currency}&date=${date}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.ok && d.rate) setRate(d.rate); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRateLoading(false); });
    return () => { cancelled = true; };
  }, [currency, date]);

  const amounts = useMemo(
    () => computeAmounts(items, effectiveVatRate, vatMode),
    [items, effectiveVatRate, vatMode]
  );
  const { subtotal, vat, total, netUnitPriceFactor } = amounts;

  useEffect(() => {
    if (emailOverridden) return;
    setEmails([(adhocMode ? adhocEmail : selectedClient?.email || "") || ""]);
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
      // Sanity: srcDoc must belong to the currently-active business.
      // RLS already prevents cross-tenant reads, but if the user
      // switched business mid-flow (between clicking "Convert" and the
      // editor mounting) we'd silently apply the wrong VAT rate / sign.
      const currentBid = getBusinessId();
      if (currentBid && srcDoc.business_id !== currentBid) {
        console.warn("[convert] source doc belongs to a different business — abort");
        return;
      }
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
        const srcLabel = DOCUMENT_TYPE_LABELS[srcDoc.type as DocumentType] ?? "מסמך";
        const noteText = `הומר מ${srcLabel} #${srcDoc.number}`;
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

  // Resume an unfinished document from a saved server draft (?draft=<id>).
  useEffect(() => {
    if (!resumeDraftId) return;
    (async () => {
      const draft = await getServerDraft(resumeDraftId);
      if (!draft) {
        setToast({ kind: "error", text: "הטיוטה לא נמצאה." });
        return;
      }
      const p = draft.payload;
      setClientId(p.clientId || "");
      setAdhocMode(p.adhocMode);
      setAdhocName(p.adhocName || "");
      setAdhocTaxId(p.adhocTaxId || "");
      setAdhocEmail(p.adhocEmail || "");
      setDate(p.date || today);
      setSubject(p.subject || "");
      setValidUntil(p.validUntil || "");
      setPaymentMethod(p.paymentMethod);
      setNotes(p.notes || "");
      setVatMode(p.vatMode);
      if (Array.isArray(p.items) && p.items.length > 0) {
        setItems(
          p.items.map((it) => ({
            id: it.id || crypto.randomUUID(),
            productId: it.productId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
          }))
        );
      }
      setCurrency(p.currency || "ILS");
      setZeroRated(Boolean(p.zeroRated));
      setRate(p.rate || 1);
      setAllocationNumber(p.allocationNumber || "");
      setDocNumber(p.documentNumber || String(await getNextDocumentNumber(p.documentType || documentType)));
    })();
  }, [resumeDraftId]);

  // Prospective document number for a fresh editor (also copy/convert).
  // For a resumed server draft, the resume effect above sets it instead.
  useEffect(() => {
    if (resumeDraftId) return;
    let cancelled = false;
    getNextDocumentNumber(documentType).then((n) => {
      if (!cancelled) setDocNumber((cur) => cur || String(n));
    });
    return () => {
      cancelled = true;
    };
  }, [documentType, resumeDraftId]);

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

  const emailTo = useMemo(() => emails.map((e) => e.trim()).filter(Boolean).join(", "), [emails]);
  const emailRecipients = useMemo(() => parseEmails(emailTo), [emailTo]);
  const updateEmail = (i: number, val: string) => {
    setEmails((p) => p.map((e, idx) => (idx === i ? val : e)));
    setEmailOverridden(true);
  };
  const addEmail = () => {
    setEmails((p) => [...p, ""]);
    setEmailOverridden(true);
  };
  const removeEmail = (i: number) => {
    setEmails((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : [""]));
    setEmailOverridden(true);
  };
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

  const [draggedId, setDraggedId] = useState<string | null>(null);

  function handleDragStart(id: string) {
    setDraggedId(id);
  }

  function handleDragOver(e: React.DragEvent, overId: string) {
    e.preventDefault();
    if (!draggedId || draggedId === overId) return;
    setItems((curr) => {
      const fromIdx = curr.findIndex((i) => i.id === draggedId);
      const toIdx = curr.findIndex((i) => i.id === overId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return curr;
      const next = [...curr];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  function handleDragEnd() {
    setDraggedId(null);
  }

  const clientReady = adhocMode ? adhocName.trim().length > 0 : !!clientId;

  // #18: hard gate — a legal document may not be issued while the business
  // profile is still empty/placeholder (onboarding is skippable and
  // business-init.ts auto-creates a blank business). Drafts are exempt.
  const businessProfileIncomplete =
    isPlaceholderBusinessName(business.name) || isPlaceholderBusinessTaxId(business.taxId);

  // #17: resolve the original-invoice reference for a credit note. The user
  // either picked one of their issued tax invoices (creditRefDocId) or chose
  // manual entry (creditRefDocId === "__manual__").
  const creditRefManual = creditRefDocId === "__manual__";
  const creditRefPicked =
    isCreditNote && creditRefDocId && !creditRefManual
      ? allDocuments.find((d) => d.id === creditRefDocId)
      : undefined;
  const creditRefNum = creditRefPicked ? String(creditRefPicked.number) : creditRefNumber.trim();
  const creditRefDateVal = creditRefPicked ? creditRefPicked.date : creditRefDate;
  const creditRefValid =
    !isCreditNote || (creditRefNum.length > 0 && Boolean(creditRefDateVal));
  // Issued tax invoices this credit note can reference (newest first).
  const creditableInvoices = useMemo(
    () =>
      isCreditNote
        ? allDocuments
            .filter(
              (d) =>
                (d.type === "tax_invoice" || d.type === "tax_invoice_receipt") &&
                d.status !== "draft",
            )
            .sort((a, b) => b.number - a.number)
        : [],
    [isCreditNote, allDocuments],
  );

  const canSave =
    clientReady &&
    items.every((i) => i.description.trim() && i.quantity > 0 && i.unitPrice >= 0) &&
    (!sendEmail || allEmailsValid) &&
    creditRefValid;

  function buildClientName(): string {
    if (adhocMode) return adhocName.trim();
    return selectedClient?.name || "";
  }

  // Save the current (possibly incomplete) state as a server draft to finish
  // later. No invoice number is allocated — that happens only on finalize.
  async function handleSaveDraft() {
    if (savingDraft) return;
    setSavingDraft(true);
    setToast(null);
    try {
      const payload: DraftPayload = {
        clientId,
        adhocMode,
        adhocName,
        adhocTaxId,
        adhocEmail,
        date,
        subject,
        validUntil,
        paymentMethod,
        notes,
        vatMode,
        items: items.map((i) => ({
          id: i.id,
          productId: i.productId,
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        documentType,
        currency,
        zeroRated,
        rate,
        allocationNumber,
        documentNumber: docNumber,
      };
      const id = await saveDraftToServer({
        id: serverDraftIdRef.current,
        documentType,
        title: buildClientName() || "ללא לקוח",
        payload,
      });
      serverDraftIdRef.current = id;
      setToast({ kind: "success", text: 'הטיוטה נשמרה. אפשר להמשיך אחר כך מלשונית "טיוטות".' });
    } catch (e) {
      setToast({ kind: "error", text: e instanceof Error ? e.message : "שמירת הטיוטה נכשלה" });
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSave() {
    if (!canSave) return;
    // #11: never persist while the exchange-rate fetch for a non-ILS currency
    // is still in flight — `rate` still holds 1 / the previous currency's
    // value, which would be stamped onto exchangeRate/subtotalIls/totalIls.
    if (rateLoading) return;
    // #18: block issuing a legal document with an empty/placeholder business
    // profile. Draft-saving (handleSaveDraft) is intentionally exempt.
    if (businessProfileIncomplete) {
      setToast({
        kind: "error",
        text: "יש להשלים את שם העסק ומספר העוסק/ח.פ בהגדרות לפני הפקת מסמך.",
      });
      return;
    }
    // Hard double-click guard. The disabled-button-via-state approach loses
    // a race on rapid taps because React batches the disabled re-render
    // until after the click handler returns; a fast double-tap on mobile
    // reliably fires twice and would create two docs + two emails. The
    // ref check fires synchronously on the very first call.
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
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

      const effectiveRate = currency === "ILS" ? 1 : rate;

      // #17: stamp the original-invoice reference onto a credit note's notes
      // so it renders on the document (no dedicated DB column — see follow-up).
      const creditRefLine =
        isCreditNote && creditRefNum && creditRefDateVal
          ? `בגין חשבונית מס מספר ${creditRefNum} מתאריך ${formatDateHe(creditRefDateVal)}`
          : "";
      const baseNotes =
        isQuote && validUntil
          ? `${notes.trim() ? notes.trim() + "\n" : ""}הצעה בתוקף עד: ${validUntil}`
          : notes.trim();
      const finalNotes =
        (creditRefLine ? `${creditRefLine}${baseNotes ? "\n" + baseNotes : ""}` : baseNotes) ||
        undefined;

      const draft: Omit<InvoiceDocument, "number"> & { number?: number } = {
        id: crypto.randomUUID(),
        type: documentType,
        number: parseInt(docNumber, 10) || undefined,
        date,
        clientId: adhocMode ? "" : selectedClient?.id || "",
        clientName,
        clientTaxId: (adhocMode ? adhocTaxId.trim() : selectedClient?.taxId) || undefined,
        allocationNumber: allocationNumber.trim() || undefined,
        subject: subject.trim() || undefined,
        status:
          documentType === "receipt" || documentType === "tax_invoice_receipt"
            ? "paid"
            : "sent",
        items: persistItems,
        subtotal: round2(sign * subtotal),
        vat: round2(sign * vat),
        total: round2(sign * total),
        paymentMethod: isPrePayment ? undefined : paymentMethod,
        notes: finalNotes,
        currency,
        exchangeRate: effectiveRate,
        zeroRated,
        ...ilsEquivalents(
          { subtotal: round2(sign * subtotal), vat: round2(sign * vat), total: round2(sign * total) },
          effectiveRate
        ),
      };

      const { id: docId, number: allocatedNumber } = await createDocument(draft);
      const doc = { ...draft, id: docId, number: allocatedNumber };

      // The doc actually persisted; clear the localStorage draft so it doesn't
      // come back to haunt the next "new document" session.
      clearDraft(documentType);

      // If this was resumed from / saved as a server draft, remove it now that
      // it's become a real numbered document.
      if (serverDraftIdRef.current) {
        await deleteServerDraft(serverDraftIdRef.current).catch(() => {});
        serverDraftIdRef.current = null;
      }

      // If this was a convert-from-quote flow, link the original quote to
      // this new receipt and mark it paid. Failures are logged but
      // don't block the success toast — the receipt itself is already
      // created, the link is purely for navigation/UX.
      let linkFailed = false;
      if (isConvert && fromDocId) {
        try {
          await linkConvertedDocument(fromDocId, docId);
        } catch (err) {
          console.warn("[convert] failed to link source quote", err);
          linkFailed = true;
        }
      }
      // #32: the new doc was created fine, but linking/marking the source quote
      // failed — surface it so the user can reconcile (mark the quote paid
      // manually) instead of silently believing the conversion fully closed.
      const linkNote = linkFailed
        ? " שים לב: קישור הצעת המחיר המקורית נכשל — סמן אותה כשולמה ידנית."
        : "";

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
        // CRITICAL: stamp emailed_at on the new doc so the detail-page
        // indicator reads "המסמך נשלח במייל ✓" instead of "טרם נשלח".
        // Without this, the user thinks their email never went out and
        // panics. Bug found by Asaf 2026-05-04 sending a real invoice.
        if (!result.mocked) {
          try {
            await markDocumentEmailed(doc.id);
          } catch {
            // Don't fail the toast — the email already went out, just the
            // timestamp is stuck. Doc page will say "טרם נשלח" but the
            // user can re-click the email button to fix the marker.
          }
        }
        setToast({
          kind: "success",
          text: result.mocked
            ? `${docLabel} #${allocatedNumber} נשמרה. מייל מדומה נשלח ל-${emailTo}.${linkNote} פותח תצוגה...`
            : `${docLabel} #${allocatedNumber} נשמרה ונשלחה ל-${emailTo}.${linkNote} פותח תצוגה...`,
        });
      } else {
        setToast({
          kind: "success",
          text: `${docLabel} #${allocatedNumber} נשמרה.${linkNote} פותח תצוגה...`,
        });
      }

      // Give the user a beat longer to read the reconcile warning before we
      // navigate away.
      setTimeout(() => router.push(`/documents/${doc.id}`), linkFailed ? 3500 : 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
      setToast({ kind: "error", text: `שמירת המסמך נכשלה: ${message}` });
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      {draftRecovered && !draftDismissed && (
        <div className="card-soft p-4 mb-4 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Save className="w-4 h-4 text-amber-700" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-stone-900 text-sm">שחזרנו טיוטה שלא נשמרה</p>
              <p className="text-xs text-stone-700 mt-0.5">
                התחלת לערוך {docLabel} {formatRelativeTime(draftRecovered.savedAt)} ולא סיימת. הפרטים הוטענו אוטומטית.
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setDraftDismissed(true)}
                  className="inline-flex items-center justify-center min-h-[36px] px-3 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-xl"
                >
                  המשך מהטיוטה
                </button>
                <button
                  type="button"
                  onClick={discardDraft}
                  className="inline-flex items-center justify-center min-h-[36px] px-3 text-sm font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-xl"
                >
                  התחל מחדש
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {(() => {
        // Inline nudge: this doc type renders a "how to pay" block
        // (quote / tax_invoice), but the business has no bank/payment info
        // configured — so the client won't see how to pay you. Surface this
        // at the moment of creation, when a fix is most useful.
        const docShowsPayment =
          documentType === "quote" ||
          documentType === "proforma" ||
          documentType === "tax_invoice";
        const hasPaymentInfo = Boolean(
          business.bankName || business.bankBranch || business.bankAccount || business.paymentNotes,
        );
        if (!docShowsPayment || hasPaymentInfo) return null;
        return (
          <div className="card-soft p-3 mb-4 bg-amber-50 border-amber-200">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <span className="text-base">💳</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-stone-900 text-sm">
                  ללקוח לא יוצג איך לשלם
                </p>
                <p className="text-xs text-stone-700 mt-0.5">
                  לא הוגדרו פרטי בנק או אפשרויות תשלום בעסק. המסמך יופק ללא בלוק תשלום.
                </p>
                <a
                  href="/settings"
                  className="inline-flex items-center mt-2 text-xs font-semibold text-orange-700 hover:text-orange-800 underline"
                >
                  הוסף פרטי תשלום בהגדרות ←
                </a>
              </div>
            </div>
          </div>
        );
      })()}
    {(documentType === "tax_invoice" ||
      documentType === "tax_invoice_receipt" ||
      documentType === "credit_note") && (
      <div className="mb-4">
        <AllocationConnectBanner
          documentType={documentType}
          amountIls={currency === "ILS" ? total : round2(total * rate)}
          date={date}
          allocationNumber={allocationNumber}
          onAllocationNumberChange={setAllocationNumber}
        />
      </div>
    )}
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
                  <>
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
                    {clientId && clientDefaults.documentCount > 0 && (
                      <p className="text-xs text-stone-600 mt-1">
                        היסטוריה: {clientDefaults.documentCount}{" "}
                        {clientDefaults.documentCount === 1 ? "מסמך" : "מסמכים"}
                        {clientDefaults.averageTotal !== undefined && (
                          <> · ממוצע {formatCurrency(clientDefaults.averageTotal)}</>
                        )}
                        {clientDefaults.paymentMethod && (
                          <> · אמצעי תשלום אחרון: {PAYMENT_METHOD_LABELS[clientDefaults.paymentMethod]}</>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            </FormField>

            {isCreditNote && (
              <FormField label="בגין חשבונית מס מקורית" required className="md:col-span-2">
                <div className="space-y-2">
                  <select
                    value={creditRefDocId}
                    onChange={(e) => setCreditRefDocId(e.target.value)}
                    className="input-warm"
                  >
                    <option value="">בחר את חשבונית המס המקורית...</option>
                    {creditableInvoices.map((d) => (
                      <option key={d.id} value={d.id}>
                        #{d.number} · {formatDateHe(d.date)} · {d.clientName}
                      </option>
                    ))}
                    <option value="__manual__">אחר / הזנה ידנית</option>
                  </select>
                  {creditRefManual && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={1}
                        value={creditRefNumber}
                        onChange={(e) => setCreditRefNumber(e.target.value)}
                        placeholder="מספר החשבונית המקורית *"
                        className="input-warm tabular-nums"
                        dir="ltr"
                      />
                      <input
                        type="date"
                        value={creditRefDate}
                        onChange={(e) => setCreditRefDate(e.target.value)}
                        className="input-warm"
                      />
                    </div>
                  )}
                  <p className="text-xs text-stone-600">
                    חשבונית זיכוי חייבת להפנות לחשבונית המס המקורית שאותה היא מזכה. ההפניה תודפס על המסמך.
                  </p>
                </div>
              </FormField>
            )}

            <FormField label="תאריך">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input-warm"
              />
            </FormField>

            <FormField label={`מספר ${docLabel}`} hint="ישוריין בעת ההפקה — ניתן לשנות">
              <input
                type="number"
                min={1}
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                className="input-warm tabular-nums text-center"
                dir="ltr"
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

            <FormField label="אימייל לשליחה" className="md:col-span-2">
              <div className="space-y-2">
                {emails.map((em, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="email"
                      dir="ltr"
                      value={em}
                      onChange={(e) => updateEmail(i, e.target.value)}
                      placeholder="name@example.com"
                      className="input-warm flex-1"
                    />
                    {emails.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeEmail(i)}
                        className="inline-flex items-center justify-center w-9 h-9 flex-shrink-0 rounded-xl bg-stone-100 text-stone-500 hover:bg-rose-50 hover:text-rose-600"
                        title="הסר אימייל"
                        aria-label="הסר אימייל"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2">
                <button
                  type="button"
                  onClick={addEmail}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700 hover:text-orange-800"
                >
                  <Plus className="w-4 h-4" />
                  הוסף עוד אימייל
                </button>
                {emailOverridden && (
                  <button
                    type="button"
                    onClick={() => {
                      setEmails([(adhocMode ? adhocEmail : selectedClient?.email || "") || ""]);
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
                  ללקוח זה אין אימייל שמור — מלא ידנית או ערוך את פרטי הלקוח
                </p>
              )}
            </FormField>

            {!isPrePayment && (
              <FormField label="אמצעי תשלום">
                <select
                  value={paymentMethod}
                  onChange={(e) => {
                    setPaymentMethodTouched(true);
                    setPaymentMethod(e.target.value as PaymentMethod);
                  }}
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

            <FormField label="מטבע">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="input-warm"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </FormField>

            {canIssueTaxInvoices(business) && (
              <div className="flex items-center gap-2 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={zeroRated}
                    onChange={(e) => setZeroRated(e.target.checked)}
                    className="w-4 h-4 accent-orange-500"
                  />
                  <span className="text-stone-700">עסקה בשיעור אפס (ייצוא)</span>
                </label>
              </div>
            )}

            {currency !== "ILS" && (
              <FormField label={`שער ${currency}→₪${rateLoading ? " …" : ""}`}>
                <input
                  type="number"
                  step="0.0001"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value) || 0)}
                  className="input-warm font-mono"
                />
                <span className="text-xs text-stone-500 block mt-1">
                  ≈ {formatMoney(round2(total * rate), "ILS")}
                </span>
              </FormField>
            )}
          </div>
        </Section>

        <Section title="פריטים" icon={Package}>
          {effectiveVatRate > 0 && (
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
                  כולל מע״מ ({effectiveVatRate}%)
                </button>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div
                key={item.id}
                onDragOver={(e) => handleDragOver(e, item.id)}
                className={`grid grid-cols-12 gap-2 items-start transition-opacity ${
                  draggedId === item.id ? "opacity-40" : ""
                }`}
              >
                <div className="col-span-12 md:col-span-5">
                  {idx === 0 && <label className="text-xs font-semibold text-stone-700 mb-1 block">תיאור</label>}
                  <div className="flex gap-1 items-center">
                    {items.length > 1 && (
                      <div
                        draggable
                        onDragStart={() => handleDragStart(item.id)}
                        onDragEnd={handleDragEnd}
                        className="cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-600 p-1 -mr-1 hidden md:flex items-center self-stretch"
                        title="גרור כדי לסדר מחדש"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    )}
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
            <p className="text-xs text-stone-600">
              {emailRecipients.length > 0
                ? `יישלח ל-${emailRecipients.length} נמענים: ${emailTo} (לעריכה — שדה "אימייל לשליחה" בפרטי המסמך).`
                : 'מלא את הכתובת בשדה "אימייל לשליחה" בפרטי המסמך.'}
            </p>
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
              vatRate={effectiveVatRate}
              total={total}
              paymentMethod={isPrePayment ? undefined : paymentMethod}
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
            {effectiveVatRate > 0 && (
              <>
                <SummaryRow label="סכום ביניים" value={formatCurrency(subtotal)} />
                <SummaryRow label={`מע״מ (${effectiveVatRate}%)`} value={formatCurrency(vat)} />
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
              disabled={!canSave || saving || rateLoading || businessProfileIncomplete}
              className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:cursor-not-allowed disabled:shadow-none transition-all"
            >
              {saving ? (
                "שולח..."
              ) : rateLoading ? (
                "טוען שער חליפין…"
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
            <button
              onClick={handleSaveDraft}
              disabled={savingDraft || saving}
              className="w-full inline-flex items-center justify-center gap-2 bg-white text-stone-700 border border-stone-300 py-2.5 rounded-2xl text-sm font-semibold hover:bg-stone-50 hover:border-stone-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <Save className="w-4 h-4" />
              {savingDraft ? "שומר טיוטה…" : "שמור טיוטה והמשך אחר כך"}
            </button>
            <p className="text-xs text-stone-500 text-center">
              טיוטה נשמרת בלי מספר — תוכל להמשיך אותה מלשונית &quot;טיוטות&quot;.
            </p>
          </div>
          {businessProfileIncomplete && (
            <div className="mt-3 flex items-start gap-2 text-xs text-rose-800 bg-rose-50 p-3 rounded-xl border border-rose-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
              <span>
                לפני הפקת מסמך יש להשלים את שם העסק ומספר העוסק/ח.פ.{" "}
                <a href="/settings" className="font-semibold underline hover:text-rose-900">
                  להשלמת פרטי העסק בהגדרות ←
                </a>
              </span>
            </div>
          )}
          {!canSave && !businessProfileIncomplete && (
            <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {!clientReady
                  ? "יש לבחור לקוח או למלא שם של לקוח מזדמן"
                  : isCreditNote && !creditRefValid
                  ? "יש לבחור/להזין את חשבונית המס המקורית שאותה מזכים"
                  : sendEmail && !allEmailsValid
                  ? "יש להזין אימייל תקין לשליחה"
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
            vatRate={effectiveVatRate}
            total={total}
            paymentMethod={isQuote ? undefined : paymentMethod}
            notes={notes || undefined}
          />
        </div>
      </aside>
    </div>
    </>
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
