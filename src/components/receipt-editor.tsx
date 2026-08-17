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
  CreditCard,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { sendReceiptEmail } from "@/lib/email";
import { EmailVerificationModal } from "@/components/email-verification-modal";
import { createDocument, getNextDocumentNumber, linkConvertedDocument, markDocumentEmailed, useDocuments } from "@/lib/document-store";
import { getBusinessId, isPlaceholderBusinessName, isPlaceholderBusinessTaxId } from "@/lib/business-init";
import { parseEmails, joinEmails, isValidEmail } from "@/lib/emails";
import { getVatRate, computeAmounts, round2, canIssueTaxInvoices, type VatMode } from "@/lib/vat";
import {
  suggestedWithholding,
  netAfterWithholding,
  withholdingRateOnPanelOpen,
} from "@/lib/withholding";
import { requiresAllocationNumber } from "@/lib/tax-authority";
import { CURRENCIES, formatMoney } from "@/lib/currencies";
import { ilsEquivalents } from "@/lib/exchange-rate";
import { todayInIsrael } from "@/lib/date";
import { AllocationConnectBanner } from "@/components/allocation-connect-banner";
import { AllocationNextStepCard } from "@/components/allocation-next-step-card";
import { Expander } from "@/components/expander";
import { useTaxAuthorityStatus } from "@/lib/use-tax-authority-status";
import { getClientDefaults } from "@/lib/client-defaults";
import { getRecurringPrefill } from "@/lib/recurring-prefill";
import { documentsForClient, findMatchingClient, filterClientsByQuery } from "@/lib/client-picker";
import { clientStore } from "@/lib/client-store";
import {
  type Business,
  type Client,
  type Product,
  type PaymentMethod,
  type PaymentDetails,
  type DocumentType,
  type InvoiceDocument,
  PAYMENT_METHOD_LABELS,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/types";
import { DocumentPreview, type PreviewClient } from "./document-preview";
import { FormField } from "./ui/form-field";
import { NumberInput } from "./number-input";
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
// without going through Date(); avoids a UTC-vs-local off-by-one day.
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
  // Payment-recording documents (a קבלה or a חשבונית מס/קבלה) are the only ones
  // that record HOW the money arrived, so withholding-tax and payment-detail
  // controls appear only for them. Discount (הנחה) applies to any priced doc
  // except a credit note (which stores negative amounts).
  const isPaymentRecording =
    documentType === "receipt" || documentType === "tax_invoice_receipt";
  const allowDiscount = !isCreditNote;

  const [adhocMode, setAdhocMode] = useState<boolean>(false);
  const [clientId, setClientId] = useState<string>(prefilledClientId);
  const [adhocName, setAdhocName] = useState<string>("");
  const [adhocTaxId, setAdhocTaxId] = useState<string>("");
  const [adhocEmail, setAdhocEmail] = useState<string>("");
  // "לקוח חדש" (adhoc) mode: whether the typed customer should also be
  // saved as a real client for next time. Defaults ON - calling the mode
  // "new client" implies it gets saved, per Asaf's framing.
  const [saveAsClient, setSaveAsClient] = useState<boolean>(true);

  // "לקוח קיים" (catalog) picker: search box + scrollable list, visible the
  // moment the mode is selected instead of hidden behind a native <select>
  // click. Starts expanded unless a client is already chosen (prefill /
  // convert / draft-resume), per the "no empty search on a pre-set client"
  // requirement.
  const [clientPickerExpanded, setClientPickerExpanded] = useState<boolean>(() => !clientId);
  const [clientSearchQuery, setClientSearchQuery] = useState<string>("");
  const [clientHighlightIndex, setClientHighlightIndex] = useState<number>(-1);
  const clientSearchInputRef = useRef<HTMLInputElement>(null);

  const [date, setDate] = useState<string>(today);
  const [subject, setSubject] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [notes, setNotes] = useState<string>(business.defaultDocNotes || "");
  const [items, setItems] = useState<EditorItem[]>([
    { id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [vatMode, setVatMode] = useState<VatMode>("exclusive");
  // Round the final total to a whole shekel (הפרש עיגול). Defaults from the
  // business setting; overridable per document.
  const [roundTotal, setRoundTotal] = useState<boolean>(business.roundTotalDefault ?? false);

  // הנחה (document-level discount), collapsed by default. User enters a % or a
  // ₪ amount; we persist the resolved ₪ amount. Applied BEFORE VAT.
  const [showDiscount, setShowDiscount] = useState<boolean>(false);
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [discountInput, setDiscountInput] = useState<string>("");

  // ניכוי מס במקור (withholding tax), collapsed by default, payment docs only.
  // Rate % drives an auto-computed amount (on the total incl. VAT); the amount
  // stays editable for a manual override.
  const [showWithholding, setShowWithholding] = useState<boolean>(false);
  const [withholdingRateInput, setWithholdingRateInput] = useState<string>("");
  const [withholdingAmountInput, setWithholdingAmountInput] = useState<string>("");
  const [withholdingTouched, setWithholdingTouched] = useState<boolean>(false);

  // פירוט אמצעי תשלום: structured detail for the selected payment method.
  const [payDetails, setPayDetails] = useState<PaymentDetails>({});
  const updatePayDetails = (patch: Partial<PaymentDetails>) =>
    setPayDetails((p) => ({ ...p, ...patch }));

  const [sendEmail, setSendEmail] = useState<boolean>(true);
  const [emails, setEmails] = useState<string[]>([""]);
  const [emailOverridden, setEmailOverridden] = useState<boolean>(false);
  const [paymentMethodTouched, setPaymentMethodTouched] = useState<boolean>(false);
  const [showPreviewMobile, setShowPreviewMobile] = useState<boolean>(false);
  // "הגדרות מתקדמות" disclosure inside פרטי המסמך (currency, exchange rate,
  // zero-rated, rounding, logo). Collapsed by default; most documents never
  // need any of it.
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const saveInFlightRef = useRef(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [emailVerifyModalOpen, setEmailVerifyModalOpen] = useState(false);

  const [allocationNumber, setAllocationNumber] = useState<string>("");
  // Fetched ONCE here and handed to both the top-of-form connect banner and
  // the end-of-form next-step card, so they read the exact same connect
  // state and can never disagree for a beat (see use-tax-authority-status.ts).
  const taxAuthorityStatus = useTaxAuthorityStatus();
  // The document's number, shown while drafting and editable before finalizing.
  // Defaults to the next number for this type; the real number is reserved on save.
  const [docNumber, setDocNumber] = useState<string>("");
  // Server-draft this editor is bound to (set when resuming, or after the first
  // "שמור טיוטה"); subsequent saves update the same row, and finalizing deletes it.
  const serverDraftIdRef = useRef<string | null>(resumeDraftId);
  const [savingDraft, setSavingDraft] = useState<boolean>(false);
  // Set once handleSave successfully creates the real document, so the
  // exit-autosave effect below doesn't resurrect a server draft for a
  // document that just got finalized.
  const finalizedRef = useRef(false);
  // Kept in sync on every render with what a "שמור טיוטה" right now would
  // send, so the unmount cleanup (which can't read fresh state) has
  // something current to persist.
  const exitAutosaveRef = useRef<{ payload: DraftPayload; title: string } | null>(null);
  const [currency, setCurrency] = useState("ILS");
  const [zeroRated, setZeroRated] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateLoading, setRateLoading] = useState(false);

  // Credit note (#17): a זיכוי must reference the original tax invoice it
  // credits (Israeli law). The user either picks one of their issued tax
  // invoices or enters the number+date manually (for invoices issued
  // outside this app). Rendered as a structured Hebrew line in the notes; when
  // a picked invoice is used, a real FK is also persisted to the
  // `original_document_id` column (see originalDocumentId below).
  const [creditRefDocId, setCreditRefDocId] = useState<string>("");
  const [creditRefNumber, setCreditRefNumber] = useState<string>("");
  const [creditRefDate, setCreditRefDate] = useState<string>("");

  const { documents: allDocuments } = useDocuments();
  const selectedClient = clients.find((c) => c.id === clientId);
  const clientDefaults = useMemo(
    () => getClientDefaults(selectedClient, allDocuments, clients),
    [selectedClient, allDocuments, clients]
  );

  // Auto-fill payment method from the client's most recent doc, but only if
  // (a) user hasn't manually changed it this session, and (b) we're not editing
  // a copy of an existing doc (which has its own payment method already).
  // The clients list arrives asynchronously (useClients), so on a hard load
  // of a ?clientId= deep link it is still empty when the state above is
  // initialised. Apply the deep link once the list is in - unless a client
  // was already chosen (draft recovery, convert, or the user).
  useEffect(() => {
    const qsClient = searchParams.get("clientId");
    if (!qsClient || clientId || fromDocId || resumeDraftId) return;
    if (clients.some((c) => c.id === qsClient)) setClientId(qsClient);
  }, [clients]);

  useEffect(() => {
    if (paymentMethodTouched || fromDocId || !clientId) return;
    if (clientDefaults.paymentMethod && clientDefaults.paymentMethod !== paymentMethod) {
      setPaymentMethod(clientDefaults.paymentMethod);
    }
  }, [clientId, clientDefaults.paymentMethod]);

  // Collapse the "לקוח קיים" picker to its compact selected-row state
  // whenever a clientId appears - whether from a user picking a row, or
  // asynchronously from a prefill/convert/draft-resume effect running after
  // mount. Only depends on clientId so it never fights the "שנה" button,
  // which reopens the list without touching clientId.
  useEffect(() => {
    if (clientId) setClientPickerExpanded(false);
  }, [clientId]);

  // Re-collapse to the selected row whenever the user switches INTO "לקוח
  // קיים" mode and a client is already chosen (e.g. toggling away to "לקוח
  // חדש" and back). Only depends on adhocMode so it doesn't fight "שנה".
  useEffect(() => {
    if (!adhocMode && clientId) setClientPickerExpanded(false);
  }, [adhocMode]);

  // Auto-focus the search box whenever it becomes visible in "לקוח קיים"
  // mode - on first switching into the mode, and after reopening via "שנה".
  useEffect(() => {
    if (!adhocMode && clientPickerExpanded) {
      clientSearchInputRef.current?.focus();
    }
  }, [adhocMode, clientPickerExpanded]);

  // Reset keyboard highlight whenever the search query changes so it never
  // points at a row that scrolled out of the filtered results.
  useEffect(() => {
    setClientHighlightIndex(-1);
  }, [clientSearchQuery]);

  const filteredClients = useMemo(
    () => filterClientsByQuery(clients, clientSearchQuery),
    [clients, clientSearchQuery]
  );

  function selectClient(id: string) {
    setClientId(id);
    setClientPickerExpanded(false);
    setClientSearchQuery("");
    setClientHighlightIndex(-1);
  }

  function handleClientSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (filteredClients.length === 0) return;
      e.preventDefault();
      setClientHighlightIndex((i) => Math.min(i + 1, filteredClients.length - 1));
    } else if (e.key === "ArrowUp") {
      if (filteredClients.length === 0) return;
      e.preventDefault();
      setClientHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked =
        clientHighlightIndex >= 0
          ? filteredClients[clientHighlightIndex]
          : filteredClients.length === 1
            ? filteredClients[0]
            : undefined;
      if (picked) selectClient(picked.id);
    } else if (e.key === "Escape") {
      setClientHighlightIndex(-1);
      (e.target as HTMLInputElement).blur();
    }
  }

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
      setRoundTotal(d.roundTotal ?? business.roundTotalDefault ?? false);
      setItems(d.items);
      setShowDiscount(d.showDiscount ?? false);
      setDiscountMode(d.discountMode ?? "amount");
      setDiscountInput(d.discountInput ?? "");
      setShowWithholding(d.showWithholding ?? false);
      setWithholdingRateInput(d.withholdingRateInput ?? "");
      setWithholdingAmountInput(d.withholdingAmountInput ?? "");
      setWithholdingTouched(d.withholdingTouched ?? false);
      setPayDetails(d.payDetails ?? {});
      setDraftRecovered({ savedAt: stored.savedAt });
    }
    setDraftHydrated(true);
  }, []);

  // Smart prefill: a client who gets the same document every month ("שכר
  // דירה", "הופעות - חשבונית עבור חודש יולי") should not have to type it
  // again. Detect the recurring subject + items in the client's history and
  // propose them, with month/year tokens rolled forward to this doc's date.
  const recurringPrefill = useMemo(() => {
    if (!clientId) return null;
    // Imported / older documents may carry no client_id but name the same
    // customer - count those too, so a client with a year of imported rent
    // receipts gets the proposal from day one.
    const clientName = clients.find((c) => c.id === clientId)?.name.trim().toLowerCase();
    const clientDocs = allDocuments.filter(
      (d) =>
        d.clientId === clientId ||
        (!d.clientId && !!clientName && d.clientName?.trim().toLowerCase() === clientName)
    );
    return getRecurringPrefill(clientDocs, documentType, date);
  }, [clientId, clients, allDocuments, documentType, date]);
  // What we last wrote into the form, so we only ever overwrite OUR OWN
  // proposal (or an untouched form) - never something the user typed.
  const [prefillApplied, setPrefillApplied] = useState<{
    subject: string;
    itemsKey: string;
    sourceNumber: number;
    sourceDate: string;
    sourceType: DocumentType;
    occurrences: number;
  } | null>(null);
  // Client the user said "נקה" for this session - stay quiet for them.
  const [prefillDismissedFor, setPrefillDismissedFor] = useState<string>("");
  const itemsKey = (list: Pick<EditorItem, "description" | "quantity" | "unitPrice">[]) =>
    JSON.stringify(list.map((i) => [i.description, i.quantity, i.unitPrice]));
  const emptyItems = () => [{ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 }];
  const prefillIsLive =
    !!prefillApplied && subject === prefillApplied.subject && itemsKey(items) === prefillApplied.itemsKey;

  useEffect(() => {
    // Copy/convert/resume-draft bring their own content; wait for the
    // localStorage draft check so a recovered draft is never clobbered.
    if (!draftHydrated || fromDocId || resumeDraftId || isCreditNote) return;
    const formUntouched =
      !subject.trim() && items.every((i) => !i.description.trim() && !i.unitPrice);
    const stillOurs =
      !!prefillApplied && subject === prefillApplied.subject && itemsKey(items) === prefillApplied.itemsKey;
    if (!clientId || !recurringPrefill || prefillDismissedFor === clientId) {
      // Client changed to one with no pattern (or none): take our proposal
      // back out, but leave anything the user typed alone.
      if (stillOurs) {
        setSubject("");
        setItems(emptyItems());
        setPrefillApplied(null);
      }
      return;
    }
    if (!formUntouched && !stillOurs) return;
    const nextItems: EditorItem[] =
      recurringPrefill.items.length > 0
        ? recurringPrefill.items.map((i) => ({ id: crypto.randomUUID(), ...i }))
        : emptyItems();
    const nextKey = itemsKey(nextItems);
    if (subject === recurringPrefill.subject && itemsKey(items) === nextKey) return;
    setSubject(recurringPrefill.subject);
    setItems(nextItems);
    setPrefillApplied({
      subject: recurringPrefill.subject,
      itemsKey: nextKey,
      sourceNumber: recurringPrefill.source.number,
      sourceDate: recurringPrefill.source.date,
      sourceType: recurringPrefill.source.type,
      occurrences: recurringPrefill.occurrences,
    });
  }, [draftHydrated, clientId, recurringPrefill, prefillDismissedFor]);

  function clearRecurringPrefill() {
    setSubject("");
    setItems(emptyItems());
    setPrefillApplied(null);
    setPrefillDismissedFor(clientId);
  }

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
      roundTotal,
      items,
      showDiscount,
      discountMode,
      discountInput,
      showWithholding,
      withholdingRateInput,
      withholdingAmountInput,
      withholdingTouched,
      payDetails,
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
    roundTotal,
    items,
    showDiscount,
    discountMode,
    discountInput,
    showWithholding,
    withholdingRateInput,
    withholdingAmountInput,
    withholdingTouched,
    payDetails,
  ]);

  // Keep a live snapshot of "what a שמור טיוטה right now would send", so the
  // exit-autosave effect below (mount/unmount only, closed over stale state)
  // always has the latest content to persist instead of what existed at mount.
  useEffect(() => {
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
      roundTotal,
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      showDiscount,
      discountMode,
      discountInput,
      showWithholding,
      withholdingRateInput,
      withholdingAmountInput,
      withholdingTouched,
      payDetails,
      documentType,
      currency,
      zeroRated,
      rate,
      allocationNumber,
      documentNumber: docNumber,
    };
    exitAutosaveRef.current = isDraftEmpty(payload)
      ? null
      : { payload, title: buildClientName() || "ללא לקוח" };
  }, [
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
    roundTotal,
    items,
    showDiscount,
    discountMode,
    discountInput,
    showWithholding,
    withholdingRateInput,
    withholdingAmountInput,
    withholdingTouched,
    payDetails,
    documentType,
    currency,
    zeroRated,
    rate,
    allocationNumber,
    docNumber,
  ]);

  // Auto-save the in-progress document as a server draft when the user leaves
  // the editor without finishing it - same call as the manual "שמור טיוטה"
  // button, just fired from the unmount cleanup instead of a click. Runs on
  // every client-side route change away from this editor; skipped once the
  // document has actually been finalized (finalizedRef) or when there's
  // nothing worth keeping (exitAutosaveRef is null).
  useEffect(() => {
    return () => {
      if (finalizedRef.current) return;
      const snapshot = exitAutosaveRef.current;
      if (!snapshot) return;
      saveDraftToServer({
        id: serverDraftIdRef.current,
        documentType: snapshot.payload.documentType,
        title: snapshot.title,
        payload: snapshot.payload,
      }).catch(() => {});
    };
  }, []);

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
    setRoundTotal(business.roundTotalDefault ?? false);
    setItems([{ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 }]);
    setShowDiscount(false);
    setDiscountMode("amount");
    setDiscountInput("");
    setShowWithholding(false);
    setWithholdingRateInput("");
    setWithholdingAmountInput("");
    setWithholdingTouched(false);
    setPayDetails({});
    setDraftRecovered(null);
    setPrefillApplied(null);
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

  // Lines subtotal BEFORE any discount; drives the % calculation and validation.
  const linesSubtotal = useMemo(
    () => computeAmounts(items, effectiveVatRate, vatMode, false, 0).subtotal,
    [items, effectiveVatRate, vatMode]
  );

  const discountEntered =
    allowDiscount && showDiscount && discountInput.trim() !== "";
  const discountRaw = parseFloat(discountInput);
  const discountValid =
    !discountEntered ||
    (Number.isFinite(discountRaw) &&
      discountRaw > 0 &&
      (discountMode === "percent"
        ? discountRaw < 100
        : round2(discountRaw) < linesSubtotal));
  const discountAmount =
    discountEntered && discountValid
      ? discountMode === "percent"
        ? round2((linesSubtotal * discountRaw) / 100)
        : round2(discountRaw)
      : 0;

  const amounts = useMemo(
    () => computeAmounts(items, effectiveVatRate, vatMode, roundTotal, discountAmount),
    [items, effectiveVatRate, vatMode, roundTotal, discountAmount]
  );
  const { subtotal, vat, total, rounding, netUnitPriceFactor } = amounts;

  // ניכוי מס במקור, computed on the total incl. VAT and rounded to the nearest
  // whole shekel (Israeli practice: withholding is reported in whole shekels).
  // Keep the amount synced to that suggestion until the user manually edits the
  // amount field; a hand-typed amount is never rewritten.
  const withholdingEntered =
    isPaymentRecording && showWithholding && withholdingRateInput.trim() !== "";
  const withholdingRate = parseFloat(withholdingRateInput);
  useEffect(() => {
    if (withholdingTouched || !withholdingEntered) return;
    const c = suggestedWithholding(total, withholdingRate);
    setWithholdingAmountInput(c > 0 ? String(c) : "");
  }, [total, withholdingRate, withholdingTouched, withholdingEntered]);
  const withholdingAmount = withholdingEntered
    ? round2(parseFloat(withholdingAmountInput) || 0)
    : 0;
  const withholdingValid =
    !withholdingEntered ||
    (Number.isFinite(withholdingRate) &&
      withholdingRate >= 0 &&
      withholdingRate <= 50 &&
      withholdingAmount > 0 &&
      withholdingAmount <= total);

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
        console.warn("[convert] source doc belongs to a different business; abort");
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
        // Restore the ad-hoc customer tax id too; without it a duplicated
        // B2B tax invoice looks B2C (empty tax id) and the allocation banner
        // wrongly shows "no allocation number needed".
        setAdhocTaxId(srcDoc.client_tax_id || "");
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
      setRoundTotal(p.roundTotal ?? business.roundTotalDefault ?? false);
      setShowDiscount(p.showDiscount ?? false);
      setDiscountMode(p.discountMode ?? "amount");
      setDiscountInput(p.discountInput ?? "");
      setShowWithholding(p.showWithholding ?? false);
      setWithholdingRateInput(p.withholdingRateInput ?? "");
      setWithholdingAmountInput(p.withholdingAmountInput ?? "");
      setWithholdingTouched(p.withholdingTouched ?? false);
      setPayDetails(p.payDetails ?? {});
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

  // #18: hard gate, a legal document may not be issued while the business
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

  // Unconverted tax invoices of the selected client. Creating a standalone
  // receipt on top of one of these counts the same income twice in the
  // reports (isCountableRevenue only excludes invoices linked through the
  // convert flow), so the editor warns and offers the convert link instead.
  const clientOpenInvoices = useMemo(
    () =>
      isPaymentRecording && !fromDocId && !adhocMode && selectedClient
        ? documentsForClient(allDocuments, selectedClient, clients)
            .filter(
              (d) =>
                d.type === "tax_invoice" &&
                d.status !== "draft" &&
                d.status !== "cancelled" &&
                !d.convertedToId,
            )
            .sort((a, b) => b.number - a.number)
        : [],
    [isPaymentRecording, fromDocId, adhocMode, selectedClient, allDocuments, clients],
  );

  // Will this document need a מספר הקצאה the user does not have yet? Same
  // gate the in-editor banner uses (type + date-aware threshold on the PRE-VAT
  // ₪ amount + a BUSINESS customer), so the save button and the banner can
  // never tell two different stories.
  const allocCustomerTaxId =
    (adhocMode ? adhocTaxId.trim() : selectedClient?.taxId) || undefined;
  const allocSubtotalIls = currency === "ILS" ? subtotal : round2(subtotal * rate);
  // Does the DOCUMENT ITSELF need an allocation number (type + date-aware
  // threshold + a BUSINESS customer), independent of whether one has already
  // been typed into the manual-entry disclosure. Used to decide whether the
  // end-of-form next-step card renders at all: gating that on willNeedAllocation
  // below (which subtracts a typed-in number) would make the card - including
  // its OWN input - vanish out from under the user's cursor the instant they
  // type the first digit into it.
  const docNeedsAllocationNumber = requiresAllocationNumber(
    {
      type: documentType,
      date,
      subtotal: allocSubtotalIls,
      subtotalIls: allocSubtotalIls,
    } as Pick<InvoiceDocument, "type" | "date" | "subtotal" | "subtotalIls"> as InvoiceDocument,
    allocCustomerTaxId,
  );
  const willNeedAllocation = !allocationNumber.trim() && docNeedsAllocationNumber;
  // The document may not go out to the customer before its allocation number
  // exists (same rule the document page enforces on its send buttons). So the
  // "email it on save" option is held back rather than silently emailing a tax
  // invoice that is missing its number.
  const willSendEmail = sendEmail && !willNeedAllocation;

  const canSave =
    clientReady &&
    items.every((i) => i.description.trim() && i.quantity > 0 && i.unitPrice >= 0) &&
    (!willSendEmail || allEmailsValid) &&
    creditRefValid &&
    discountValid &&
    withholdingValid;

  // Why the save button is disabled, in one plain sentence. Rendered next to
  // BOTH save affordances (the desktop summary card and the mobile action bar),
  // so the mobile user is never left tapping a dead button with no explanation.
  const blockReason: string | null = canSave
    ? null
    : !clientReady
      ? "יש לבחור לקוח או למלא שם של לקוח מזדמן"
      : isCreditNote && !creditRefValid
        ? "יש לבחור/להזין את חשבונית המס המקורית שאותה מזכים"
        : !discountValid
          ? "יש לתקן את סכום ההנחה"
          : !withholdingValid
            ? "יש לתקן את סכום ניכוי המס במקור"
            : willSendEmail && !allEmailsValid
              ? 'יש להזין אימייל תקין בכרטיס "שליחה ללקוח"'
              : "כל פריט חייב תיאור, כמות חיובית ומחיר";

  // What the primary button says. When an allocation number will be needed, the
  // label names the next step instead of promising a finished document.
  const saveLabel = saving
    ? "שומר..."
    : rateLoading
      ? "טוען שער חליפין…"
      : willNeedAllocation
        ? "שמור והמשך לקבלת מספר הקצאה"
        : willSendEmail
          ? "שמור, הפק ושלח"
          : `שמור והפק ${docLabel}`;

  // Build the persisted PaymentDetails, keeping only the fields relevant to the
  // chosen method and dropping empties. Returns undefined when nothing was set.
  function buildPaymentDetails(): PaymentDetails | undefined {
    if (!isPaymentRecording || isPrePayment) return undefined;
    const clean: PaymentDetails = {};
    if (paymentMethod === "check") {
      if (payDetails.checkNumber?.trim()) clean.checkNumber = payDetails.checkNumber.trim();
      if (payDetails.checkBank?.trim()) clean.checkBank = payDetails.checkBank.trim();
      if (payDetails.checkBranch?.trim()) clean.checkBranch = payDetails.checkBranch.trim();
      if (payDetails.checkAccount?.trim()) clean.checkAccount = payDetails.checkAccount.trim();
      if (payDetails.checkDueDate?.trim()) clean.checkDueDate = payDetails.checkDueDate.trim();
    } else if (paymentMethod === "credit_card") {
      if (payDetails.cardLast4?.trim()) clean.cardLast4 = payDetails.cardLast4.trim();
      if (payDetails.cardApproval?.trim()) clean.cardApproval = payDetails.cardApproval.trim();
    } else if (
      paymentMethod === "bank_transfer" ||
      paymentMethod === "bit" ||
      paymentMethod === "paypal"
    ) {
      if (payDetails.reference?.trim()) clean.reference = payDetails.reference.trim();
    }
    return Object.keys(clean).length > 0 ? clean : undefined;
  }

  // The primary human reference mirrored into payment_reference so the bank-
  // import matcher / timeline keep working.
  function primaryPaymentReference(pd: PaymentDetails | undefined): string | undefined {
    if (!pd) return undefined;
    return (
      pd.reference ||
      pd.checkNumber ||
      pd.cardApproval ||
      pd.cardLast4 ||
      undefined
    );
  }

  function buildClientName(): string {
    if (adhocMode) return adhocName.trim();
    return selectedClient?.name || "";
  }

  // Save the current (possibly incomplete) state as a server draft to finish
  // later. No invoice number is allocated; that happens only on finalize.
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
        roundTotal,
        items: items.map((i) => ({
          id: i.id,
          productId: i.productId,
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        showDiscount,
        discountMode,
        discountInput,
        showWithholding,
        withholdingRateInput,
        withholdingAmountInput,
        withholdingTouched,
        payDetails,
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
    // is still in flight; `rate` still holds 1 / the previous currency's
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
      const paymentDetails = buildPaymentDetails();

      // "לקוח חדש" + "שמור אותו ברשימת הלקוחות שלי": link this document to a
      // real client instead of a one-off name. Reuses an existing client
      // (same normalized tax id, or same trimmed/case-insensitive name when
      // no tax id) rather than creating a duplicate. Saving the client is a
      // convenience, never a blocker - on any failure we fall back to
      // exactly today's adhoc behavior (empty clientId, typed details only).
      let effectiveClientId = adhocMode ? "" : selectedClient?.id || "";
      if (adhocMode && saveAsClient) {
        const name = adhocName.trim();
        if (name) {
          try {
            const taxId = adhocTaxId.trim() || undefined;
            const existing = findMatchingClient(clients, { name, taxId });
            if (existing) {
              effectiveClientId = existing.id;
            } else {
              const newClient: Client = {
                id: crypto.randomUUID(),
                name,
                taxId,
                email: adhocEmail.trim() || undefined,
                createdAt: today,
              };
              await clientStore.save(newClient);
              effectiveClientId = newClient.id;
            }
          } catch (err) {
            console.warn("[client-picker] failed to save the new client; document still saves with the typed details", err);
          }
        }
      }

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

      // #17: stamp the original-invoice reference onto a credit note's notes so
      // it renders on the document. The structured FK (when a doc was picked) is
      // persisted separately in originalDocumentId below.
      // Name the credited source by its actual type (a מס-קבלה credits differently
      // from a מס). Manual entry has no known type → default to "חשבונית מס".
      const creditRefTypeLabel = creditRefPicked
        ? DOCUMENT_TYPE_LABELS[creditRefPicked.type]
        : "חשבונית מס";
      const creditRefLine =
        isCreditNote && creditRefNum && creditRefDateVal
          ? `בגין ${creditRefTypeLabel} מספר ${creditRefNum} מתאריך ${formatDateHe(creditRefDateVal)}`
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
        clientId: effectiveClientId,
        clientName,
        clientTaxId: (adhocMode ? adhocTaxId.trim() : selectedClient?.taxId) || undefined,
        allocationNumber: allocationNumber.trim() || undefined,
        // Credit note: when the user picked an existing issued invoice from the
        // picker, persist a real FK to it. Manual-entry (external invoice) stays
        // null; its reference lives only in the notes line above. Additive to,
        // not a replacement for, the human-readable creditRefLine.
        originalDocumentId: creditRefPicked?.id || null,
        subject: subject.trim() || undefined,
        status:
          documentType === "receipt" || documentType === "tax_invoice_receipt"
            ? "paid"
            : "sent",
        items: persistItems,
        subtotal: round2(sign * subtotal),
        vat: round2(sign * vat),
        total: round2(sign * total),
        rounding: round2(sign * rounding),
        roundTotal,
        paymentMethod: isPrePayment ? undefined : paymentMethod,
        paymentDetails,
        paymentReference: primaryPaymentReference(paymentDetails),
        withholdingRate: withholdingEntered ? withholdingRate : undefined,
        withholdingAmount: withholdingEntered ? withholdingAmount : undefined,
        discountAmount: discountAmount > 0 ? discountAmount : undefined,
        notes: finalNotes,
        currency,
        exchangeRate: effectiveRate,
        zeroRated,
        ...ilsEquivalents(
          {
            subtotal: round2(sign * subtotal),
            vat: round2(sign * vat),
            total: round2(sign * total),
            rounding: round2(sign * rounding),
          },
          effectiveRate
        ),
      };

      const { id: docId, number: allocatedNumber } = await createDocument(draft);
      const doc = { ...draft, id: docId, number: allocatedNumber };

      // The doc actually persisted; clear the localStorage draft so it doesn't
      // come back to haunt the next "new document" session, and stop the
      // exit-autosave effect from resurrecting a server draft for it.
      clearDraft(documentType);
      finalizedRef.current = true;

      // If this was resumed from / saved as a server draft, remove it now that
      // it's become a real numbered document.
      if (serverDraftIdRef.current) {
        await deleteServerDraft(serverDraftIdRef.current).catch(() => {});
        serverDraftIdRef.current = null;
      }

      // If this was a convert-from-quote flow, link the original quote to
      // this new receipt and mark it paid. Failures are logged but
      // don't block the success toast; the receipt itself is already
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
      // failed; surface it so the user can reconcile (mark the quote paid
      // manually) instead of silently believing the conversion fully closed.
      const linkNote = linkFailed
        ? " שים לב: קישור הצעת המחיר המקורית נכשל, סמן אותה כשולמה ידנית."
        : "";

      if (willSendEmail) {
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
          if (result.code === "EMAIL_NOT_VERIFIED") {
            setEmailVerifyModalOpen(true);
            setToast({ kind: "error", text: "המסמך נשמר, אבל צריך לאמת קודם את כתובת המייל שלך כדי לשלוח אותו." });
            return;
          }
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
            // Don't fail the toast; the email already went out, just the
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
      // navigate away. When this doc still needs its allocation number, carry
      // that across the navigation so the document page can scroll straight
      // to the next-step card instead of leaving the user to find it.
      const nextUrl = willNeedAllocation
        ? `/documents/${doc.id}?needsAllocation=1`
        : `/documents/${doc.id}`;
      setTimeout(() => router.push(nextUrl), linkFailed ? 3500 : 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
      setToast({ kind: "error", text: `שמירת המסמך נכשלה: ${message}` });
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  // ONE set of props feeding ONE renderer (<DocumentPreview> → <DocumentBody>),
  // shared by the desktop pane and the mobile sheet. Every value is derived
  // from live form state, so the preview updates as the user types.
  const previewProps = {
    business,
    client: previewClient,
    documentType,
    number: parseInt(docNumber, 10) || null,
    date,
    subject: subject || undefined,
    items: previewItems,
    subtotal,
    vat,
    vatRate: effectiveVatRate,
    total,
    rounding,
    paymentMethod: isPrePayment ? undefined : paymentMethod,
    paymentDetails: buildPaymentDetails(),
    discount: discountAmount,
    withholdingRate:
      withholdingEntered && withholdingValid ? withholdingRate : undefined,
    withholdingAmount:
      withholdingEntered && withholdingValid ? withholdingAmount : undefined,
    notes: notes || undefined,
    allocationNumber: allocationNumber.trim() || undefined,
    currency,
    exchangeRate: currency === "ILS" ? 1 : rate,
    totalIls: currency === "ILS" ? total : round2(total * rate),
    zeroRated,
  };

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
        // configured, so the client won't see how to pay you. Surface this
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
      {clientOpenInvoices.length > 0 && (
        <div className="card-soft p-3 mb-4 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-base">⚠️</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-stone-900 text-sm">
                {clientOpenInvoices.length === 1
                  ? "ללקוח הזה יש חשבונית מס שלא הופקה לה קבלה"
                  : "ללקוח הזה יש חשבוניות מס שלא הופקה להן קבלה"}
              </p>
              <p className="text-xs text-stone-700 mt-0.5">
                אם הקבלה הזו היא עבור אחת מהחשבוניות האלה, צור אותה מתוך החשבונית - אחרת אותה הכנסה תיספר פעמיים בדוחות.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {clientOpenInvoices.slice(0, 3).map((inv) => (
                  <a
                    key={inv.id}
                    href={`/documents/new/receipt?from=${inv.id}&convert=1`}
                    className="inline-flex items-center text-xs font-semibold text-orange-700 hover:text-orange-800 underline"
                  >
                    צור מתוך חשבונית #{inv.number} · {formatCurrency(inv.totalIls ?? inv.total)} ←
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    {(documentType === "tax_invoice" ||
      documentType === "tax_invoice_receipt" ||
      documentType === "credit_note") && (
      <div className="mb-4">
        <AllocationConnectBanner
          documentType={documentType}
          subtotalIls={currency === "ILS" ? subtotal : round2(subtotal * rate)}
          date={date}
          customerTaxId={(adhocMode ? adhocTaxId.trim() : selectedClient?.taxId) || undefined}
          businessType={taxAuthorityStatus.businessType}
          connected={taxAuthorityStatus.connected}
          loaded={taxAuthorityStatus.loaded}
        />
      </div>
    )}
    {/* NOTE: no `items-start` here on purpose; the grid's default stretch is
        what gives the preview column a full-height track for `position:sticky`
        to travel in. With items-start the aside collapses to content height and
        the sticky pane scrolls away. */}
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* ── FORM COLUMN (inline-start / right in RTL) ───────────────────── */}
      <div className="lg:col-span-7 space-y-4">
        {/* Mobile/tablet: the live preview lives behind a button. It renders the
            very same <DocumentPreview> the desktop pane uses, one renderer. */}
        <button
          type="button"
          onClick={() => setShowPreviewMobile((s) => !s)}
          className="lg:hidden w-full inline-flex items-center justify-center gap-2 bg-white border-[1.5px] border-orange-300 text-orange-700 py-3 rounded-2xl text-sm font-semibold hover:bg-orange-50"
        >
          {showPreviewMobile ? (
            <>
              <EyeOff className="w-4 h-4" />
              הסתר תצוגה מקדימה
            </>
          ) : (
            <>
              <Eye className="w-4 h-4" />
              הצג תצוגה מקדימה חיה
            </>
          )}
        </button>
        {showPreviewMobile && (
          <div className="lg:hidden">
            <DocumentPreview {...previewProps} />
          </div>
        )}

        {/* ── לקוח ── */}
        <EditorCard title="לקוח" icon={UserPlus}>
          <div className="inline-flex bg-orange-50 rounded-xl p-1 text-xs font-semibold gap-1 mb-3">
            <button
              type="button"
              onClick={() => setAdhocMode(false)}
              className={`inline-flex items-center justify-center min-h-[36px] px-3.5 rounded-lg transition-colors ${
                !adhocMode
                  ? "bg-white text-orange-700 shadow-sm"
                  : "text-stone-600 hover:text-stone-800"
              }`}
            >
              לקוח קיים
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
              לקוח חדש
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
              <label className="flex items-center gap-2 md:col-span-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAsClient}
                  onChange={(e) => setSaveAsClient(e.target.checked)}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-stone-700">שמור אותו ברשימת הלקוחות שלי</span>
              </label>
              <p className="text-xs text-stone-600 md:col-span-2">
                {saveAsClient
                  ? "הלקוח יישמר ברשימת הלקוחות ותוכל לבחור בו בפעם הבאה."
                  : "הלקוח לא יישמר - שמו יופיע על המסמך הזה בלבד."}
              </p>
            </div>
          ) : clientId && !clientPickerExpanded && selectedClient ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-orange-100 bg-orange-50/60 px-3 py-2.5 min-h-[44px]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-900 truncate">
                    {selectedClient.name}
                  </p>
                  {(selectedClient.taxId || selectedClient.email) && (
                    <p className="text-xs text-stone-500 truncate">
                      {[selectedClient.taxId, selectedClient.email].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setClientPickerExpanded(true);
                    setClientSearchQuery("");
                  }}
                  className="shrink-0 inline-flex items-center justify-center min-h-[36px] px-3 text-xs font-semibold text-orange-700 hover:text-orange-800 hover:bg-orange-100 rounded-lg"
                >
                  שנה
                </button>
              </div>
              {clientDefaults.documentCount > 0 && (
                <p className="text-xs text-stone-600 mt-2">
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
          ) : (
            <>
              <input
                ref={clientSearchInputRef}
                type="text"
                value={clientSearchQuery}
                onChange={(e) => setClientSearchQuery(e.target.value)}
                onKeyDown={handleClientSearchKeyDown}
                placeholder="חיפוש לקוח לפי שם..."
                className="input-warm"
                aria-label="חיפוש לקוח"
              />
              {clients.length === 0 ? (
                <p className="text-xs text-stone-600 mt-2">
                  עדיין אין לקוחות שמורים{" "}
                  <button
                    type="button"
                    onClick={() => setAdhocMode(true)}
                    className="font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                  >
                    עבור ל&quot;לקוח חדש&quot;
                  </button>
                </p>
              ) : filteredClients.length === 0 ? (
                <p className="text-xs text-stone-600 mt-2">
                  לא נמצא לקוח בשם הזה{" "}
                  <button
                    type="button"
                    onClick={() => setAdhocMode(true)}
                    className="font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                  >
                    עבור ל&quot;לקוח חדש&quot;
                  </button>
                </p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-xl border border-orange-100 divide-y divide-orange-50 mt-2">
                  {filteredClients.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectClient(c.id)}
                      onMouseEnter={() => setClientHighlightIndex(i)}
                      className={`w-full text-right flex flex-col justify-center min-h-[44px] px-3 py-1.5 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                        i === clientHighlightIndex ? "bg-orange-100" : "hover:bg-orange-50"
                      }`}
                    >
                      <span className="text-sm font-semibold text-stone-900 truncate">
                        {c.name}
                      </span>
                      {(c.taxId || c.email) && (
                        <span className="text-xs text-stone-500 truncate">
                          {[c.taxId, c.email].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </EditorCard>

        {/* ── פרטי המסמך ── */}
        <EditorCard title="פרטי המסמך" icon={FileTextIcon}>
          {/* Two rows, by field NATURE rather than by equal share:
              row 1 holds the two known-width facts (a date, a 5-6 digit
              number) at their real size; row 2 gives the subject - free text,
              sentence length ("הופעות עם פיניש עבור יוני 5") - the whole card.
              The earlier one-row/three-track version starved the subject even
              after widening it, because a date input plus a number input eat
              ~19rem of a form column that is only ~31rem wide at lg.
              The number's LABEL is short ("מספר") on purpose: the doc type is
              already in the page heading, and "מספר חשבונית מס/קבלה" is 135px,
              which would have set the track width instead of the value. */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              <FormField label="תאריך" className="w-[8.75rem] shrink-0">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input-warm"
                />
              </FormField>

              <FormField
                label="מספר"
                hint="ישוריין בעת ההפקה"
                className="w-[7rem] shrink-0"
              >
                <input
                  type="number"
                  min={1}
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  className="input-warm tabular-nums text-center"
                  dir="ltr"
                />
              </FormField>
            </div>

            <FormField label="נושא">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="למשל: ייעוץ - אפריל 2026"
                className="input-warm"
              />
            </FormField>
          </div>

          {isCreditNote && (
            <div className="mt-3">
              <FormField label="בגין חשבונית מס מקורית" required>
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
            </div>
          )}

          {isQuote && (
            <div className="mt-3">
              <FormField label="תוקף ההצעה (אופציונלי)">
                <input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="input-warm"
                />
              </FormField>
            </div>
          )}

          {/* Quiet expander: everything most users never touch. */}
          <Expander
            label="הגדרות מתקדמות (מטבע, מע״מ, עיגול, לוגו)"
            open={showAdvanced}
            onToggle={() => setShowAdvanced((s) => !s)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

              {currency !== "ILS" && (
                <FormField label={`שער ${currency}→₪${rateLoading ? " …" : ""}`}>
                  <NumberInput
                    step="0.0001"
                    value={rate}
                    onValueChange={setRate}
                    className="input-warm font-mono"
                    aria-label={`שער ${currency}→₪`}
                  />
                  <span className="text-xs text-stone-500 block mt-1">
                    ≈ {formatMoney(round2(total * rate), "ILS")}
                  </span>
                </FormField>
              )}

              <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
                {business.logoUrl ? (
                  <span className="inline-flex items-center gap-2 text-xs text-stone-600">
                    <img
                      src={business.logoUrl}
                      alt=""
                      className="gk-logo-chip w-8 h-8 rounded-lg object-contain bg-white border border-stone-200"
                    />
                    הלוגו שלך יופיע על המסמך
                  </span>
                ) : (
                  <span className="text-xs text-stone-600">
                    ללא לוגו: המסמך יציג את שם העסק בלבד.
                  </span>
                )}
                <a
                  href="/settings"
                  className="text-xs font-semibold text-orange-700 hover:text-orange-800 underline"
                >
                  {business.logoUrl ? "החלף לוגו בהגדרות ←" : "העלה לוגו בהגדרות ←"}
                </a>
              </div>
            </div>

            <div className="space-y-2.5 mt-3">
              {canIssueTaxInvoices(business) && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={zeroRated}
                    onChange={(e) => setZeroRated(e.target.checked)}
                    className="w-4 h-4 accent-orange-500"
                  />
                  <span className="text-stone-700">עסקה בשיעור אפס (ייצוא)</span>
                </label>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={roundTotal}
                  onChange={(e) => setRoundTotal(e.target.checked)}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-stone-700">עגל סכום לתשלום (לשקל שלם)</span>
              </label>
            </div>
          </Expander>
        </EditorCard>

        {/* ── פריטים ── */}
        <EditorCard title="פריטים" icon={Package}>
          {prefillIsLive && prefillApplied && (
            <div
              className="mb-4 flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 flex-wrap"
              role="status"
            >
              <div className="flex items-start gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-stone-800 min-w-0">
                  <span className="font-semibold">הנושא והפריטים מולאו אוטומטית</span>
                  <span className="text-stone-600">
                    {" "}
                    לפי {prefillApplied.occurrences} המסמכים האחרונים ללקוח (האחרון:{" "}
                    {DOCUMENT_TYPE_LABELS[prefillApplied.sourceType]}{" "}
                    <bdi dir="ltr">#{prefillApplied.sourceNumber}</bdi> מ-
                    <bdi dir="ltr">{formatDateHe(prefillApplied.sourceDate)}</bdi>). אפשר לערוך הכל.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={clearRecurringPrefill}
                className="inline-flex items-center justify-center min-h-[36px] px-3 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-xl flex-shrink-0"
              >
                נקה והתחל ריק
              </button>
            </div>
          )}
          {effectiveVatRate > 0 && (
            <div className="mb-4 flex items-center justify-between gap-3 p-3 rounded-xl bg-orange-50/60 border border-orange-100 flex-wrap">
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
                className={`rounded-xl border border-orange-100 p-3 space-y-2 transition-opacity ${
                  draggedId === item.id ? "opacity-40" : ""
                }`}
              >
                {/* An item is TWO rows inside its own hairline box, not one
                    five-track row. Every width tier we tried for the single row
                    lost the same fight: the description is free text, but the
                    row it shared is not the viewport - from lg the preview
                    aside takes 5/12 and this column is only ~497px, so ~21.5rem
                    of fixed number tracks left the description input at 33px.
                    Splitting by NATURE settles it at every width: the free-text
                    field owns a full row, and the three numbers - each of known
                    width - sit below it at their real size.
                    The hairline box is what keeps two-row items from reading as
                    four loose rows once there is more than one item; it also
                    gives the drag-to-reorder target a visible shape. */}
                <div>
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
                      aria-label="תיאור השירות/מוצר"
                      className="input-warm flex-1"
                    />
                    <div className="relative">
                      <select
                        value={item.productId || ""}
                        onChange={(e) => pickProduct(item.id, e.target.value)}
                        className="input-warm w-12 text-transparent cursor-pointer appearance-none"
                        title="בחר מהקטלוג"
                        aria-label="בחר מהקטלוג"
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
                {/* The numbers row. Phone: twelfths, so כמות+מחיר share one
                    line and סה״כ+bin the next (280px of card interior can't
                    hold all four). From sm the same four sit on one line at
                    their true widths - 4.5rem holds a 1-2 digit quantity, 8rem
                    a price, 6.5rem the "999,999.99 ₪" total (6rem gave it a
                    97px content box and the ₪ sat on the border) - and the bin
                    is pushed to the row's end so it lines up across items. */}
                <div className="grid grid-cols-12 sm:flex sm:items-end gap-2 items-end">
                  <div className="col-span-4 sm:w-[4.5rem] sm:shrink-0">
                    {idx === 0 && <label className="text-xs font-semibold text-stone-700 mb-1 block">כמות</label>}
                    <NumberInput
                      min="0"
                      step="0.5"
                      value={item.quantity}
                      onValueChange={(v) => updateItem(item.id, { quantity: v })}
                      className="input-warm tabular-nums text-center"
                      placeholder="1"
                      aria-label="כמות"
                    />
                  </div>
                  <div className="col-span-8 sm:w-32 sm:shrink-0">
                    {idx === 0 && (
                      <label className="text-xs font-semibold text-stone-700 mb-1 block">
                        מחיר יחידה
                      </label>
                    )}
                    <NumberInput
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onValueChange={(v) => updateItem(item.id, { unitPrice: v })}
                      className="input-warm tabular-nums"
                      placeholder="0"
                      aria-label="מחיר יחידה"
                    />
                  </div>
                  <div className="col-span-10 sm:w-[6.5rem] sm:shrink-0">
                    {idx === 0 && <label className="text-xs font-semibold text-stone-700 mb-1 block">סה״כ</label>}
                    <div className="input-warm bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200 text-stone-900 font-bold text-left">
                      {formatCurrency(item.quantity * item.unitPrice)}
                    </div>
                  </div>
                  <div className="col-span-2 flex justify-end sm:ms-auto">
                    <button
                      onClick={() => removeItem(item.id)}
                      disabled={items.length === 1}
                      className="text-stone-400 hover:text-rose-500 disabled:opacity-30 disabled:cursor-not-allowed p-2.5 md:p-2 rounded-lg hover:bg-rose-50 transition-colors"
                      title="הסר פריט"
                      aria-label="הסר פריט"
                    >
                      <Trash2 className="w-5 h-5 md:w-4 md:h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {/* Same dashed affordance as "הוסף הנחה" below - one visual idea for
                "add another thing to this document". (It used to be blue text,
                the only blue in an orange/gold app, and the gold skin has no
                mapping for blue, so it stayed blue there too.) */}
            <button
              onClick={addItem}
              className="inline-flex items-center gap-1.5 min-h-[40px] rounded-xl border border-dashed border-orange-300 text-orange-700 hover:bg-orange-50 px-3.5 py-2 text-xs font-semibold"
            >
              <Plus className="w-4 h-4" />
              הוסף פריט
            </button>
          </div>

          {allowDiscount && (
            <div className="mt-4 pt-4 border-t border-stone-100">
              {!showDiscount ? (
                <button
                  type="button"
                  onClick={() => setShowDiscount(true)}
                  className="inline-flex items-center gap-1.5 min-h-[40px] rounded-xl border border-dashed border-orange-300 text-orange-700 hover:bg-orange-50 px-3.5 py-2 text-xs font-semibold"
                >
                  <Plus className="w-4 h-4" />
                  הוסף הנחה
                </button>
              ) : (
                <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-stone-800">הנחה</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDiscount(false);
                        setDiscountInput("");
                      }}
                      className="inline-flex items-center min-h-[36px] px-1 text-xs text-stone-600 hover:text-rose-600"
                    >
                      הסר
                    </button>
                  </div>
                  <div className="flex items-stretch gap-2">
                    <div className="inline-flex bg-white rounded-xl p-1 text-xs font-semibold gap-1 border border-orange-100">
                      <button
                        type="button"
                        onClick={() => setDiscountMode("amount")}
                        className={`inline-flex items-center justify-center min-h-[36px] px-3 rounded-lg transition-colors ${
                          discountMode === "amount"
                            ? "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm"
                            : "text-stone-700 hover:text-stone-900"
                        }`}
                      >
                        ₪
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscountMode("percent")}
                        className={`inline-flex items-center justify-center min-h-[36px] px-3 rounded-lg transition-colors ${
                          discountMode === "percent"
                            ? "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm"
                            : "text-stone-700 hover:text-stone-900"
                        }`}
                      >
                        %
                      </button>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value)}
                      placeholder={discountMode === "percent" ? "שיעור הנחה" : "סכום הנחה"}
                      className="input-warm tabular-nums flex-1"
                      dir="ltr"
                      aria-label="הנחה"
                    />
                  </div>
                  {discountEntered && discountValid && discountAmount > 0 && (
                    <p className="text-sm font-semibold text-stone-800">
                      הנחה: {formatCurrency(discountAmount)}
                      {discountMode === "percent" && <> ({discountRaw}%)</>}
                    </p>
                  )}
                  {discountEntered && !discountValid && (
                    <p className="text-xs text-rose-700">
                      {discountMode === "percent"
                        ? "שיעור ההנחה חייב להיות בין 0 ל-100."
                        : "ההנחה חייבת להיות חיובית ונמוכה מסכום הפריטים."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </EditorCard>

        {/* ── תשלום ── */}
        {!isPrePayment && (
          <EditorCard title="תשלום" icon={CreditCard}>
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

            {isPaymentRecording && (
              <div className="space-y-3 mt-3">
                {/* פירוט אמצעי תשלום: per-method optional detail. */}
                {(paymentMethod === "bank_transfer" ||
                  paymentMethod === "bit" ||
                  paymentMethod === "paypal") && (
                  <FormField label="אסמכתא (אופציונלי)">
                    <input
                      type="text"
                      value={payDetails.reference || ""}
                      onChange={(e) => updatePayDetails({ reference: e.target.value })}
                      placeholder="מספר אסמכתא / העברה"
                      className="input-warm"
                      dir="ltr"
                    />
                  </FormField>
                )}
                {paymentMethod === "check" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={payDetails.checkNumber || ""}
                      onChange={(e) => updatePayDetails({ checkNumber: e.target.value })}
                      placeholder="מס' שיק"
                      className="input-warm"
                      dir="ltr"
                    />
                    <input
                      type="text"
                      value={payDetails.checkBank || ""}
                      onChange={(e) => updatePayDetails({ checkBank: e.target.value })}
                      placeholder="בנק"
                      className="input-warm"
                    />
                    <input
                      type="text"
                      value={payDetails.checkBranch || ""}
                      onChange={(e) => updatePayDetails({ checkBranch: e.target.value })}
                      placeholder="סניף"
                      className="input-warm"
                      dir="ltr"
                    />
                    <input
                      type="text"
                      value={payDetails.checkAccount || ""}
                      onChange={(e) => updatePayDetails({ checkAccount: e.target.value })}
                      placeholder="מס' חשבון"
                      className="input-warm"
                      dir="ltr"
                    />
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-stone-700 mb-1 block">
                        תאריך פירעון (ז״פ)
                      </label>
                      <input
                        type="date"
                        value={payDetails.checkDueDate || ""}
                        onChange={(e) => updatePayDetails({ checkDueDate: e.target.value })}
                        className="input-warm"
                      />
                    </div>
                  </div>
                )}
                {paymentMethod === "credit_card" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={payDetails.cardLast4 || ""}
                      onChange={(e) =>
                        updatePayDetails({ cardLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })
                      }
                      placeholder="4 ספרות אחרונות"
                      className="input-warm"
                      dir="ltr"
                    />
                    <input
                      type="text"
                      value={payDetails.cardApproval || ""}
                      onChange={(e) => updatePayDetails({ cardApproval: e.target.value })}
                      placeholder="מס' אישור"
                      className="input-warm"
                      dir="ltr"
                    />
                  </div>
                )}

                {/* ניכוי מס במקור: collapsed by default. */}
                {!showWithholding ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowWithholding(true);
                      // Prefill the standard 35% rate so the amount + "שולם
                      // בפועל" calculation is already there for the user to
                      // approve, instead of a greyed-out placeholder that
                      // computes nothing. Only when the field is genuinely
                      // empty - a resumed draft / duplicate / hand-typed rate
                      // is never touched (see withholdingRateOnPanelOpen).
                      setWithholdingRateInput((prev) => withholdingRateOnPanelOpen(prev));
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] rounded-xl border border-dashed border-orange-300 text-orange-700 hover:bg-orange-50 px-3.5 py-2 text-xs font-semibold"
                  >
                    <Plus className="w-4 h-4" />
                    ניכוי מס במקור
                  </button>
                ) : (
                  <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-stone-800">ניכוי מס במקור</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowWithholding(false);
                          setWithholdingRateInput("");
                          setWithholdingAmountInput("");
                          setWithholdingTouched(false);
                        }}
                        className="inline-flex items-center min-h-[36px] px-1 text-xs text-stone-600 hover:text-rose-600"
                      >
                        הסר
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-stone-700 mb-1 block">
                          שיעור
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            max={50}
                            step="0.01"
                            value={withholdingRateInput}
                            onChange={(e) => {
                              setWithholdingRateInput(e.target.value);
                              setWithholdingTouched(false);
                            }}
                            className="input-warm tabular-nums"
                            style={{ paddingRight: "3rem" }}
                            dir="ltr"
                            placeholder="35"
                            aria-label="שיעור ניכוי מס במקור, אחוזים"
                          />
                          <span
                            className="pointer-events-none absolute inset-y-0 flex items-center text-xs font-medium text-stone-400"
                            style={{ right: "1.75rem" }}
                            aria-hidden="true"
                          >
                            %
                          </span>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-stone-700 mb-1 block">
                          סכום הניכוי
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={withholdingAmountInput}
                            onChange={(e) => {
                              setWithholdingAmountInput(e.target.value);
                              setWithholdingTouched(true);
                            }}
                            className="input-warm tabular-nums"
                            style={{ paddingRight: "3rem" }}
                            dir="ltr"
                            aria-label="סכום הניכוי, שקלים"
                          />
                          <span
                            className="pointer-events-none absolute inset-y-0 flex items-center text-xs font-medium text-stone-400"
                            style={{ right: "1.75rem" }}
                            aria-hidden="true"
                          >
                            ₪
                          </span>
                        </div>
                        {withholdingEntered && (
                          <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">
                            {total <= 0
                              ? "הזינו סכום למסמך והחישוב יופיע כאן."
                              : withholdingTouched
                                ? "סכום שהוזן ידנית."
                                : "מחושב אוטומטית לפי השיעור. אפשר לשנות."}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-stone-600">
                      מחושב על הסכום כולל מע״מ ומעוגל לשקל השלם הקרוב. אפשר לשנות את הסכום ידנית.
                      סכום המסמך אינו משתנה, זהו פיצול של התשלום.
                    </p>
                    {total > 0 && withholdingEntered && withholdingValid && withholdingAmount > 0 && (
                      <p className="text-sm font-semibold text-stone-800">
                        שולם בפועל: {formatCurrency(netAfterWithholding(total, withholdingAmount))}
                      </p>
                    )}
                    {withholdingEntered && !withholdingValid && (
                      <p className="text-xs text-rose-700">
                        סכום הניכוי חייב להיות בין 0 לסכום המסמך, והשיעור עד 50%.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </EditorCard>
        )}

        {/* ── הערות ── */}
        <EditorCard title="הערות" icon={StickyNote} optional>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="הערות אופציונליות שיופיעו על המסמך"
            rows={8}
            className="input-warm"
            aria-label="הערות"
          />
        </EditorCard>

        {/* ── שליחה ללקוח ── */}
        <EditorCard title="שליחה ללקוח" icon={Mail}>
          <label
            className={`flex items-center gap-2 text-sm mb-3 ${
              willNeedAllocation ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={sendEmail && !willNeedAllocation}
              disabled={willNeedAllocation}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="w-4 h-4 accent-orange-500"
            />
            <span className="text-stone-700">
              שלח את ה{docLabel} במייל ללקוח מיד כשאני לוחץ שמור
            </span>
          </label>
          {willNeedAllocation && (
            <p className="text-xs text-stone-700 bg-amber-50 border border-orange-100 rounded-xl p-3 mb-3 leading-relaxed">
              המסמך הזה צריך קודם מספר הקצאה מרשות המסים, ולכן אי אפשר לשלוח אותו כבר עכשיו.
              שומרים, מבקשים את המספר בלחיצה אחת, ואז שולחים ללקוח מעמוד המסמך.
            </p>
          )}
          <FormField label="אימייל לשליחה">
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
                    aria-label={`אימייל לשליחה ${i + 1}`}
                  />
                  {emails.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEmail(i)}
                      className="inline-flex items-center justify-center w-9 h-9 flex-shrink-0 rounded-xl bg-stone-100 text-stone-600 hover:bg-rose-50 hover:text-rose-600"
                      title="הסר אימייל"
                      aria-label="הסר אימייל"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
              <button
                type="button"
                onClick={addEmail}
                className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-orange-700 hover:text-orange-800"
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
                  className="inline-flex items-center min-h-[44px] text-xs text-orange-700 hover:underline"
                >
                  שחזר מהלקוח
                </button>
              )}
            </div>
            {!adhocMode && selectedClient && !selectedClient.email && (
              <p className="text-xs text-amber-700 mt-1">
                ללקוח זה אין אימייל שמור, מלא ידנית או ערוך את פרטי הלקוח
              </p>
            )}
          </FormField>
          {willSendEmail && (
            <p className="text-xs text-stone-600 mt-2">
              {emailRecipients.length > 0
                ? `יישלח ל-${emailRecipients.length} נמענים: ${emailTo}`
                : "מלא כתובת אימייל אחת לפחות, או בטל את הסימון למעלה."}
            </p>
          )}
        </EditorCard>

        {/* The next step, right where the work ends: fills in for the old
            top-of-form banner's walkthrough + manual field, moved down to
            the exact moment the user asked for ("ברגע שסיימת את המסמך").
            Gated on docNeedsAllocationNumber (not willNeedAllocation) so
            typing into its own manual-entry disclosure can't make it - and
            the input the user is mid-typing into - vanish; and on `loaded`
            so it doesn't pop in a beat after the connect banner above it
            has already decided whether to render. */}
        {docNeedsAllocationNumber && taxAuthorityStatus.loaded && (
          <AllocationNextStepCard
            allocationNumber={allocationNumber}
            onAllocationNumberChange={setAllocationNumber}
            connected={taxAuthorityStatus.connected}
            onSave={handleSave}
            saveLabel={saveLabel}
            saveDisabled={!canSave || saving || rateLoading || businessProfileIncomplete}
            saveBusy={saving || rateLoading}
            blockReason={
              businessProfileIncomplete
                ? "יש להשלים את שם העסק ומספר העוסק/ח.פ בהגדרות"
                : blockReason
            }
          />
        )}

        {/* Breathing room so the fixed mobile action bar never sits on top of
            the last field. Desktop keeps its action in the sticky aside. */}
        <div className="lg:hidden h-24" aria-hidden />
      </div>

      {/* ── PREVIEW + ACTION COLUMN (inline-end / left in RTL) ──────────── */}
      <aside className="lg:col-span-5">
        {/* Summary + primary action come FIRST in this column: the aside is a
            scroll container of its own, and with the A4 preview on top the save
            button sat below its fold, so the user had to scroll a pane they
            didn't know was scrollable to find it. */}
        <div className="lg:sticky lg:top-4 space-y-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pl-1">
          <div className="card-soft p-5 bg-gradient-to-br from-orange-50/50 to-amber-50/50 border-orange-200">
            <h3 className="font-semibold text-stone-900 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-orange-500" />
              סיכום ושליחה
            </h3>
            <div className="space-y-1.5 text-sm">
              {discountAmount > 0 && (
                <>
                  <SummaryRow label="סה״כ לפני הנחה" value={formatCurrency(subtotal + discountAmount)} />
                  <SummaryRow label="הנחה" value={`-${formatCurrency(discountAmount)}`} />
                </>
              )}
              {effectiveVatRate > 0 && (
                <>
                  <SummaryRow label="סכום ביניים" value={formatCurrency(subtotal)} />
                  <SummaryRow label={`מע״מ (${effectiveVatRate}%)`} value={formatCurrency(vat)} />
                </>
              )}
              {rounding !== 0 && <SummaryRow label="עיגול" value={formatCurrency(rounding)} />}
              <div className="flex justify-between items-baseline pt-2">
                <span className="text-stone-800 font-semibold">
                  {isQuote ? "סה״כ הצעה" : isCreditNote ? "סה״כ זיכוי" : "סה״כ לתשלום"}
                </span>
                <span className="text-2xl font-bold bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent">
                  {formatCurrency(total)}
                </span>
              </div>
              {withholdingEntered && withholdingValid && withholdingAmount > 0 && (
                <div className="flex justify-between items-baseline pt-2 mt-1 border-t border-orange-100">
                  <span className="text-stone-800 font-semibold">שולם בפועל</span>
                  <span className="text-lg font-bold text-stone-900">
                    {formatCurrency(netAfterWithholding(total, withholdingAmount))}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-4 space-y-2">
              <button
                onClick={handleSave}
                disabled={!canSave || saving || rateLoading || businessProfileIncomplete}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] bg-gradient-to-l from-orange-500 to-rose-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:from-stone-300 disabled:to-stone-300 disabled:cursor-not-allowed disabled:shadow-none transition-all"
              >
                {!saving && !rateLoading && (
                  willSendEmail ? <Send className="w-4 h-4" /> : <Save className="w-4 h-4" />
                )}
                {saveLabel}
              </button>
              {willNeedAllocation && !saving && (
                <p className="text-xs text-stone-600 text-center leading-relaxed">
                  אחרי השמירה תגיע לעמוד המסמך, ושם תבקש את מספר ההקצאה בלחיצה אחת.
                </p>
              )}
              <button
                onClick={handleSaveDraft}
                disabled={savingDraft || saving}
                className="w-full inline-flex items-center justify-center gap-2 bg-white text-stone-700 border border-stone-300 py-2.5 rounded-2xl text-sm font-semibold hover:bg-stone-50 hover:border-stone-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Save className="w-4 h-4" />
                {savingDraft ? "שומר טיוטה…" : "שמור טיוטה והמשך אחר כך"}
              </button>
              <p className="text-xs text-stone-600 text-center">
                טיוטה נשמרת בלי מספר, תוכל להמשיך אותה מלשונית &quot;טיוטות&quot;.
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
            {blockReason && !businessProfileIncomplete && (
              <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{blockReason}</span>
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
            <p className="flex items-center gap-2 text-xs font-semibold text-stone-700 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
              תצוגה חיה, מתעדכנת תוך כדי הקלדה
            </p>
            <DocumentPreview {...previewProps} />
          </div>
        </div>
      </aside>
    </div>

    {/* ── MOBILE ACTION BAR ────────────────────────────────────────────
        On a phone the summary card sits below the entire form, so the save
        button was effectively hidden. This bar rides along with the user:
        running total on one side, the primary action on the other, plus the
        reason it is disabled and the result toast, so nothing about saving
        happens off-screen. Hidden from lg up, where the sticky aside owns it. */}
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 no-print border-t border-orange-200 bg-white/95 backdrop-blur shadow-[0_-6px_20px_rgba(120,53,15,0.10)]">
      <div className="max-w-7xl mx-auto px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {toast && (
          <div
            className={`mb-2 text-xs p-2.5 rounded-xl flex items-start gap-2 ${
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
        {(blockReason || businessProfileIncomplete) && (
          <p className="mb-2 text-[11px] text-amber-800 leading-snug flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              {businessProfileIncomplete
                ? "יש להשלים את שם העסק ומספר העוסק/ח.פ בהגדרות"
                : blockReason}
            </span>
          </p>
        )}
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-stone-600 leading-none">
              {isQuote ? "סה״כ הצעה" : isCreditNote ? "סה״כ זיכוי" : "סה״כ לתשלום"}
            </p>
            <p className="mt-1 text-lg font-bold text-stone-900 leading-none tabular-nums">
              {formatCurrency(total)}
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={!canSave || saving || rateLoading || businessProfileIncomplete}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[48px] px-3 bg-gradient-to-l from-orange-500 to-rose-500 text-white rounded-2xl text-sm font-bold text-center leading-tight hover:shadow-lg hover:shadow-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:from-stone-300 disabled:to-stone-300 disabled:cursor-not-allowed disabled:shadow-none transition-all"
          >
            {!saving && !rateLoading && (
              willSendEmail ? (
                <Send className="w-4 h-4 flex-shrink-0" />
              ) : (
                <Save className="w-4 h-4 flex-shrink-0" />
              )
            )}
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
    <EmailVerificationModal
      open={emailVerifyModalOpen}
      onClose={() => setEmailVerifyModalOpen(false)}
    />
    </>
  );
}

/**
 * A titled section of the form, styled as the approved rounded card: gold icon
 * chip, hairline-separated header, roomy body. Replaces the old flat <Section>.
 */
function EditorCard({
  title,
  icon: Icon,
  optional = false,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="card-soft overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-orange-100">
        {Icon && <Icon className="w-4 h-4 text-orange-500 flex-shrink-0" />}
        <h2 className="font-semibold text-stone-900 text-[15px]">{title}</h2>
        {optional && (
          <span className="ms-auto text-[11px] text-stone-600">אופציונלי</span>
        )}
      </div>
      <div className="p-5">{children}</div>
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
