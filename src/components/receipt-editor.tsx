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
  Users,
  ChevronDown,
  Search,
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
import { BusinessFormModal } from "@/components/business-form-modal";
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
  // Opens the business-details modal straight from the "profile incomplete"
  // block below, so a user who is one field away from issuing fixes it here
  // instead of being sent to /settings and losing what they just filled in.
  const [bizModalOpen, setBizModalOpen] = useState(false);
  const searchParams = useSearchParams();
  const fromDocId = searchParams.get("from");
  const resumeDraftId = searchParams.get("draft");
  // Set when another screen deliberately handed this editor a prefilled draft
  // (today: approving-with-edits an automation's invoice proposal). The draft
  // is then expected, not recovered wreckage from an abandoned session, so the
  // "we restored an unsaved draft" banner would be telling the user something
  // untrue about their own click. Everything else about the load is identical.
  const prefilled = searchParams.get("prefill");
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
  // Inline "add the ח.פ to this saved client" draft, see clientTaxIdMissing.
  const [clientTaxIdDraft, setClientTaxIdDraft] = useState<string>("");
  const [savingClientTaxId, setSavingClientTaxId] = useState(false);
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
  // The "לקוח קיים" picker is a dropdown (Asaf 2026-08-27): CLOSED by default,
  // opened by the chevron trigger, so a user with 20 clients is not greeted by
  // all 20 rows. `clientPickerExpanded` = the menu is open.
  const [clientPickerExpanded, setClientPickerExpanded] = useState<boolean>(false);
  const [clientSearchQuery, setClientSearchQuery] = useState<string>("");
  const [clientHighlightIndex, setClientHighlightIndex] = useState<number>(-1);
  const clientSearchInputRef = useRef<HTMLInputElement>(null);
  const clientMenuRef = useRef<HTMLDivElement>(null);

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
  // The phone-only bottom action bar below is position:fixed, so anything else
  // pinned to the bottom edge (the assistant launcher) lands on top of the
  // save button. Publish the bar's live height as a CSS variable and let the
  // launcher lift itself above it (see .assistant-launcher in app-skin.css).
  const mobileDockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mobileDockRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--mobile-dock-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--mobile-dock-h");
    };
  }, []);
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

  // Close the client dropdown on a click/tap anywhere outside it.
  useEffect(() => {
    if (!clientPickerExpanded) return;
    function onPointerDown(e: PointerEvent) {
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node)) {
        setClientPickerExpanded(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [clientPickerExpanded]);

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
      e.preventDefault();
      setClientHighlightIndex(-1);
      setClientPickerExpanded(false);
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
      if (!prefilled) setDraftRecovered({ savedAt: stored.savedAt });
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

  // Saves a ח.פ/ת.ז typed into the missing-number nag onto the SELECTED saved
  // client. The parent page holds `clients` via useClients(), which re-reads on
  // the store's change event, so selectedClient.taxId updates by itself and the
  // warning by the save button clears without any local override.
  async function saveClientTaxId() {
    if (!selectedClient) return;
    const taxId = clientTaxIdDraft.trim();
    if (!taxId) return;
    setSavingClientTaxId(true);
    try {
      await clientStore.save({ ...selectedClient, taxId });
      setClientTaxIdDraft("");
    } finally {
      setSavingClientTaxId(false);
    }
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
  // Missing customer ח.פ/ת.ז (Asaf 2026-08-27): the field is optional, so a
  // distracted user ships a חשבונית מס with no customer number at all (and
  // requiresAllocationNumber then treats the customer as private and skips the
  // מספר הקצאה gate). Asaf's spec, chosen with buttons: ONE place, next to the
  // save button; every document type except הצעת מחיר; a warning that never
  // blocks (a private person legitimately has no ח.פ); and for a saved client
  // an inline input that writes the number to the client card as well.
  const clientTaxIdMissing = !isQuote && clientReady && !allocCustomerTaxId;
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
  // Sending is a BUTTON, not a checkbox (Asaf, 2026-08-27: the "email it when
  // I click save" tick was confusing). The user types an address in the
  // "שליחה ללקוח" card and then picks "save and issue" or "save, issue and
  // send by email" at the end. The send button only exists when every typed
  // address is valid AND no allocation number is pending: the document may
  // not go out to the customer before its number exists (same rule the
  // document page enforces on its send buttons).
  const emailsTyped = emailTo.length > 0;
  const canSend = allEmailsValid && !willNeedAllocation;

  const canSave =
    clientReady &&
    items.every((i) => i.description.trim() && i.quantity > 0 && i.unitPrice >= 0) &&
    creditRefValid &&
    discountValid &&
    withholdingValid;
  // One place for "why the buttons are off": the desktop bar, the mobile
  // card, the mobile dock and the allocation card all read these.
  const saveDisabled = !canSave || saving || rateLoading || businessProfileIncomplete;
  const draftDisabled = savingDraft || saving;

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
            : "כל פריט חייב תיאור, כמות חיובית ומחיר";

  // What the two issue buttons say. When an allocation number will be needed,
  // the label names the next step instead of promising a finished document.
  const busyLabel = saving ? "שומר..." : rateLoading ? "טוען שער חליפין…" : null;
  // Each finishing button starts with its own verb (הפק / שמור טיוטה) so the
  // three are told apart by the first word; "שמור והפק" next to "שמור טיוטה"
  // read as the same action to a first-time user.
  const saveLabel =
    busyLabel ?? (willNeedAllocation ? "שמור והמשך לקבלת מספר הקצאה" : `הפק ${docLabel}`);
  const sendLabel = busyLabel ?? "הפק ושלח במייל";

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

  async function handleSave(opts: { send?: boolean } = {}) {
    if (!canSave) return;
    const send = opts.send === true && canSend;
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

      if (send) {
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
          {/* Mode switch (Asaf 2026-08-27): the old white-on-peach pill was too
              quiet - users could not tell which tab was on. The first fix (a
              full orange-rose fill on the active tab) overshot: the switch
              became the loudest thing on the page. Now the active tab is a
              soft orange tint with an orange-300 frame, the same frame the
              open client picker wears, so it reads as "selected" without
              competing with the real call to action. */}
          <div
            role="tablist"
            aria-label="סוג הלקוח"
            className="grid grid-cols-2 bg-white rounded-xl p-1 text-sm font-semibold gap-1 mb-2 border border-orange-100"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!adhocMode}
              onClick={() => setAdhocMode(false)}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-lg transition-colors ${
                !adhocMode
                  ? "bg-orange-50 text-orange-700 border border-orange-300"
                  : "border border-transparent text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              }`}
            >
              <Users className="w-4 h-4" />
              לקוח קיים
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={adhocMode}
              onClick={() => setAdhocMode(true)}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-lg transition-colors ${
                adhocMode
                  ? "bg-orange-50 text-orange-700 border border-orange-300"
                  : "border border-transparent text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              }`}
            >
              <UserPlus className="w-4 h-4" />
              לקוח חדש
            </button>
          </div>
          <p className="text-xs text-stone-600 mb-3">
            {adhocMode
              ? "לקוח חדש או מזדמן: הקלד את פרטיו כאן והם יופיעו על המסמך."
              : clientId && selectedClient
                ? "נבחר לקוח מרשימת הלקוחות שלך. לחיצה על השדה פותחת את הרשימה להחלפה."
                : "פתח את הרשימה ובחר לקוח מהלקוחות השמורים שלך."}
          </p>
          {adhocMode ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                value={adhocName}
                onChange={(e) => setAdhocName(e.target.value)}
                placeholder="הקלד את שם הלקוח החדש *"
                className="input-warm"
                aria-label="שם הלקוח החדש"
              />
              <input
                type="text"
                value={adhocTaxId}
                onChange={(e) => setAdhocTaxId(e.target.value)}
                placeholder={isQuote ? "ח.פ / ת.ז (אופציונלי)" : "ח.פ / ת.ז של הלקוח"}
                className="input-warm"
                aria-label="ח.פ / ת.ז של הלקוח"
                // Inline: app-skin.css styles `html .input-warm`, which outranks
                // a Tailwind border utility, so the amber "fill me" ring is a style.
                style={
                  clientTaxIdMissing
                    ? { borderColor: "#f59e0b", boxShadow: "0 0 0 3px #fde68a" }
                    : undefined
                }
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
          ) : clients.length === 0 ? (
            <p className="text-sm text-stone-600">
              עדיין אין לקוחות שמורים.{" "}
              <button
                type="button"
                onClick={() => setAdhocMode(true)}
                className="font-semibold text-orange-600 hover:text-orange-700 hover:underline"
              >
                עבור ל&quot;לקוח חדש&quot;
              </button>
            </p>
          ) : (
            <>
              {/* Select-style trigger: looks like a field, carries a big
                  chevron, and shows either the chosen client or the "click
                  here" prompt. The search box + list live in the panel below
                  and exist only while the menu is open. */}
              <div ref={clientMenuRef}>
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={clientPickerExpanded}
                  aria-label={selectedClient ? `לקוח נבחר: ${selectedClient.name}. לחץ להחלפה` : "בחירת לקוח קיים"}
                  onClick={() => {
                    setClientSearchQuery("");
                    setClientPickerExpanded((open) => !open);
                  }}
                  className={`input-warm flex items-center justify-between gap-3 text-right min-h-[48px] cursor-pointer ${
                    clientPickerExpanded ? "rounded-b-none border-orange-300" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    {selectedClient ? (
                      <>
                        <span className="block text-sm font-semibold text-stone-900 truncate">
                          {selectedClient.name}
                        </span>
                        {(selectedClient.taxId || selectedClient.email) && (
                          <span className="block text-xs text-stone-500 truncate">
                            {[selectedClient.taxId, selectedClient.email].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="block text-sm text-stone-500">
                        לחץ כאן כדי לבחור מהלקוחות הקיימים
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm transition-transform ${
                      clientPickerExpanded ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </span>
                </button>
                {clientPickerExpanded && (
                  <div
                    role="listbox"
                    aria-label="הלקוחות השמורים"
                    className="rounded-b-xl border border-t-0 border-orange-300 bg-white shadow-md"
                  >
                    <div className="relative p-2 border-b border-orange-100">
                      <Search className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                      <input
                        ref={clientSearchInputRef}
                        type="text"
                        value={clientSearchQuery}
                        onChange={(e) => setClientSearchQuery(e.target.value)}
                        onKeyDown={handleClientSearchKeyDown}
                        placeholder="חיפוש לפי שם..."
                        className="input-warm !pr-9 text-sm"
                        aria-label="חיפוש לקוח ברשימה"
                      />
                    </div>
                    {filteredClients.length === 0 ? (
                      <p className="text-xs text-stone-600 px-3 py-3">
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
                      <div className="max-h-56 overflow-y-auto divide-y divide-orange-50">
                        {filteredClients.map((c, i) => (
                          <button
                            key={c.id}
                            type="button"
                            role="option"
                            aria-selected={c.id === clientId}
                            onClick={() => selectClient(c.id)}
                            onMouseEnter={() => setClientHighlightIndex(i)}
                            className={`w-full text-right flex flex-col justify-center min-h-[44px] px-3 py-1.5 transition-colors last:rounded-b-xl ${
                              i === clientHighlightIndex
                                ? "bg-orange-100"
                                : c.id === clientId
                                  ? "bg-orange-50/70"
                                  : "hover:bg-orange-50"
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
                  </div>
                )}
              </div>
              {selectedClient && !clientPickerExpanded && clientDefaults.documentCount > 0 && (
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
                  effectiveVatRate > 0 ? "pb-7" : ""
                } ${draggedId === item.id ? "opacity-40" : ""}`}
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
                  <div className="col-span-10 sm:w-[6.5rem] sm:shrink-0 relative">
                    {idx === 0 && <label className="text-xs font-semibold text-stone-700 mb-1 block">סה״כ</label>}
                    <div className="input-warm bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200 text-stone-900 font-bold text-left">
                      {formatCurrency(item.quantity * item.unitPrice)}
                    </div>
                    {/* The other side of the VAT line, right next to where the
                        price was typed (Asaf 2026-08-27): the preview already
                        shows it, but the user should not have to look away from
                        the input to learn what the line is worth with/without
                        VAT. Same per-line rounding as computeAmounts so the
                        figures agree with the totals card. Absolutely positioned
                        (the card's pb-7 reserves its room) so the row's
                        items-end alignment of qty/price/total/bin is untouched. */}
                    {effectiveVatRate > 0 && item.quantity * item.unitPrice > 0 && (
                      <p className="absolute top-full left-0 mt-1 text-[11px] leading-tight text-stone-500 tabular-nums text-left whitespace-nowrap">
                        {vatMode === "exclusive" ? "כולל מע״מ" : "לפני מע״מ"}{" "}
                        <span className="font-semibold text-stone-700">
                          {formatCurrency(
                            vatMode === "exclusive"
                              ? round2(
                                  round2(item.quantity * round2(item.unitPrice)) *
                                    (1 + effectiveVatRate / 100)
                                )
                              : round2(item.quantity * round2(item.unitPrice * netUnitPriceFactor))
                          )}
                        </span>
                      </p>
                    )}
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
            rows={4}
            className="input-warm"
            aria-label="הערות"
          />
        </EditorCard>

        {/* ── שליחה ללקוח ── */}
        <EditorCard title="שליחה ללקוח" icon={Mail}>
          {!willNeedAllocation && (
            <p className="text-sm text-stone-700 mb-3 leading-relaxed">
              רוצה לשלוח את ה{docLabel}{" "}ללקוח במייל? כתוב כאן את הכתובת, ובסוף לחץ
              &quot;שמור, הפק ושלח במייל&quot;. בלי כתובת, המסמך רק יופק.
            </p>
          )}
          {willNeedAllocation && (
            <p className="text-xs text-stone-700 bg-amber-50 border border-orange-100 rounded-xl p-3 mb-3 leading-relaxed">
              המסמך הזה צריך קודם מספר הקצאה מרשות המסים, ולכן אי אפשר לשלוח אותו כבר עכשיו.
              שומרים, מבקשים את המספר בלחיצה אחת, ואז שולחים ללקוח מעמוד המסמך.
            </p>
          )}
          <FormField label="אימייל הלקוח">
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
          {!willNeedAllocation && emailsTyped && (
            <p className={`text-xs mt-2 ${allEmailsValid ? "text-stone-600" : "text-rose-700"}`}>
              {allEmailsValid
                ? `"שמור, הפק ושלח במייל" ישלח ל-${
                    emailRecipients.length === 1 ? "כתובת אחת" : `${emailRecipients.length} נמענים`
                  }: ${emailTo}`
                : "כתובת האימייל לא תקינה, ולכן אי אפשר לשלוח. תקן אותה או מחק אותה."}
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
            onSave={() => handleSave()}
            saveLabel={saveLabel}
            saveDisabled={saveDisabled}
            saveBusy={saving || rateLoading}
            blockReason={
              businessProfileIncomplete
                ? "יש להשלים את שם העסק ומספר העוסק/ח.פ בהגדרות"
                : blockReason
            }
          />
        )}

        {/* Breathing room so the fixed mobile action bar never sits on top of
            the last field. */}
        <div className="lg:hidden h-24" aria-hidden />

        {/* ── DESKTOP ACTION BAR ──────────────────────────────────────────
            The form reads top to bottom, and the action used to live at the
            top of the OTHER column, so finishing a document meant scrolling
            back up and crossing left (Asaf, 2026-08-27). This bar sticks to
            the bottom of the viewport while the column is taller than the
            screen and settles into its natural place at the column's end, so
            the total and both save buttons are reachable from any scroll
            position. Mobile keeps its fixed bar further down. */}
        <div className="hidden lg:block lg:sticky lg:bottom-0 z-20 no-print pt-2">
          <div className="rounded-2xl border-2 border-[color:var(--goldline)] bg-white/95 backdrop-blur dock-shadow px-5 py-3.5 space-y-3">
            {toast && <ResultToast toast={toast} />}
            {businessProfileIncomplete && <BusinessProfileNag onFix={() => setBizModalOpen(true)} />}
            {clientTaxIdMissing && !saving && (
              <ClientTaxIdNag
                inline
                adhocMode={adhocMode}
                canEdit={!adhocMode && !!selectedClient}
                draft={clientTaxIdDraft}
                onDraftChange={setClientTaxIdDraft}
                onSave={saveClientTaxId}
                saving={savingClientTaxId}
              />
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="min-w-[9rem]">
                <p className="text-xs font-medium text-stone-600 leading-none">
                  {isQuote ? "סה״כ הצעה" : isCreditNote ? "סה״כ זיכוי" : "סה״כ לתשלום"}
                </p>
                <p className="mt-1.5 text-2xl font-bold text-stone-900 leading-none tabular-nums">
                  {formatCurrency(total)}
                </p>
                {effectiveVatRate > 0 && (
                  <p className="mt-1 text-[11px] text-stone-600 leading-none">
                    כולל מע״מ {formatCurrency(vat)}
                  </p>
                )}
                {withholdingEntered && withholdingValid && withholdingAmount > 0 && (
                  <p className="mt-1 text-[11px] text-stone-700 leading-none">
                    שולם בפועל{" "}
                    <span className="font-semibold text-stone-900">
                      {formatCurrency(netAfterWithholding(total, withholdingAmount))}
                    </span>
                  </p>
                )}
              </div>
              {blockReason && !businessProfileIncomplete && (
                <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200 max-w-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{blockReason}</span>
                </div>
              )}
              {/* The mobile card shows this hint next to a block reason; in the
                  one-row bar two competing notices would crowd the total. */}
              {willNeedAllocation && !saving && !blockReason && (
                <p className="text-[11px] text-stone-600 leading-snug max-w-[16rem]">
                  אחרי השמירה תגיע לעמוד המסמך, ושם תבקש את מספר ההקצאה בלחיצה אחת.
                </p>
              )}
              <div className="ms-auto flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                <button
                  onClick={handleSaveDraft}
                  disabled={draftDisabled}
                  title="טיוטה נשמרת בלי מספר, תוכל להמשיך אותה מלשונית טיוטות"
                  className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 bg-white text-stone-700 border border-stone-300 rounded-2xl text-sm font-semibold hover:bg-stone-50 hover:border-stone-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Save className="w-4 h-4" />
                  {savingDraft ? "שומר טיוטה…" : "שמור טיוטה"}
                </button>
                <IssueButtons
                  canSend={canSend}
                  disabled={saveDisabled}
                  busy={saving || rateLoading}
                  saveLabel={saveLabel}
                  sendLabel={sendLabel}
                  onIssue={() => handleSave()}
                  onSend={() => handleSave({ send: true })}
                />
              </div>
              {!willNeedAllocation && !saving && !blockReason && <NextStepsHint />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PREVIEW COLUMN (inline-end / left in RTL) ────────────────────
          On desktop this column is ONLY the live preview: the summary and the
          save buttons moved to the sticky bar at the end of the form column
          (see DESKTOP ACTION BAR above). The summary card below is kept for
          phones, where it sits under the form and holds the draft button and
          the tax-id nag that the fixed mobile bar scrolls to. */}
      <aside className="lg:col-span-5">
        <div className="lg:sticky lg:top-4 space-y-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pl-1 lg:pt-4">
          <div className="lg:hidden card-soft p-5 bg-gradient-to-br from-orange-50/50 to-amber-50/50 border-orange-200">
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
              <IssueButtons
                stacked
                canSend={canSend}
                disabled={saveDisabled}
                busy={saving || rateLoading}
                saveLabel={saveLabel}
                sendLabel={sendLabel}
                onIssue={() => handleSave()}
                onSend={() => handleSave({ send: true })}
              />
              {!willNeedAllocation && !saving && <NextStepsHint className="text-center" />}
              {willNeedAllocation && !saving && (
                <p className="text-xs text-stone-600 text-center leading-relaxed">
                  אחרי השמירה תגיע לעמוד המסמך, ושם תבקש את מספר ההקצאה בלחיצה אחת.
                </p>
              )}
              {clientTaxIdMissing && !saving && (
                <ClientTaxIdNag
                  id="client-taxid-nag"
                  adhocMode={adhocMode}
                  canEdit={!adhocMode && !!selectedClient}
                  draft={clientTaxIdDraft}
                  onDraftChange={setClientTaxIdDraft}
                  onSave={saveClientTaxId}
                  saving={savingClientTaxId}
                />
              )}
              <button
                onClick={handleSaveDraft}
                disabled={draftDisabled}
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
              <BusinessProfileNag className="mt-3" onFix={() => setBizModalOpen(true)} />
            )}
            {blockReason && !businessProfileIncomplete && (
              <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{blockReason}</span>
              </div>
            )}
            {toast && <ResultToast toast={toast} className="mt-3 text-sm p-3" />}
          </div>

          {/* Light-orange frame with a legend tab so the preview reads as one
              deliberate object next to the form, not a loose sheet. */}
          <div className="hidden lg:block relative rounded-3xl border-[3px] border-[color:var(--goldline)] bg-[color:var(--goldtint)] px-3.5 pb-3.5 pt-6">
            <p className="absolute -top-[15px] right-5 inline-flex items-center gap-2 h-[30px] px-3.5 rounded-full bg-white border-2 border-[color:var(--goldline)] text-[13px] font-bold text-[color:var(--gold-text)] whitespace-nowrap">
              <Eye className="w-[15px] h-[15px]" />
              תצוגה מקדימה
              <span className="font-medium text-stone-600">· מתעדכנת תוך כדי הקלדה</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
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
        happens off-screen. Hidden from lg up, where the desktop action bar
        at the end of the form column owns it. */}
    <div ref={mobileDockRef} className="lg:hidden fixed inset-x-0 bottom-0 z-40 no-print border-t border-orange-200 bg-white/95 backdrop-blur dock-shadow">
      <div className="max-w-7xl mx-auto px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {toast && <ResultToast toast={toast} className="mb-2 text-xs p-2.5" />}
        {(blockReason || businessProfileIncomplete || clientTaxIdMissing) && (
          <p className="mb-2 text-[11px] text-amber-800 leading-snug flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            {businessProfileIncomplete || blockReason ? (
              <span>
                {businessProfileIncomplete
                  ? "יש להשלים את שם העסק ומספר העוסק/ח.פ בהגדרות"
                  : blockReason}
              </span>
            ) : (
              /* The fix lives in the aside box at the bottom of a long mobile
                 page, so the one-liner is a tap that scrolls there. */
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("client-taxid-nag")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
                className="text-right underline underline-offset-2 font-medium"
              >
                חסר ח.פ / ת.ז של הלקוח, אפשר להפיק גם בלי. לחץ להשלמה
              </button>
            )}
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
            onClick={() => handleSave({ send: canSend })}
            disabled={saveDisabled}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[48px] px-3 bg-gradient-to-l from-orange-500 to-rose-500 text-white rounded-2xl text-sm font-bold text-center leading-tight hover:shadow-lg hover:shadow-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:from-stone-300 disabled:to-stone-300 disabled:cursor-not-allowed disabled:shadow-none transition-all"
          >
            {!saving && !rateLoading && (
              canSend ? (
                <Send className="w-4 h-4 flex-shrink-0" />
              ) : (
                <Save className="w-4 h-4 flex-shrink-0" />
              )
            )}
            {canSend ? sendLabel : saveLabel}
          </button>
        </div>
      </div>
    </div>
    <EmailVerificationModal
      open={emailVerifyModalOpen}
      onClose={() => setEmailVerifyModalOpen(false)}
    />
    {/* `business` is a server-passed prop, so after the modal saves we ask the
        route to re-render rather than mutating local state - that way the
        gate's isPlaceholder* checks re-run against what was actually stored,
        not against what we hoped was stored. */}
    <BusinessFormModal
      open={bizModalOpen}
      onClose={() => {
        setBizModalOpen(false);
        router.refresh();
      }}
      business={business}
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

type ToastState = { kind: "success" | "error"; text: string };

const ISSUE_BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 min-h-[48px] px-5 bg-gradient-to-l from-orange-500 to-rose-500 text-white rounded-2xl text-sm font-bold hover:shadow-lg hover:shadow-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:from-stone-300 disabled:to-stone-300 disabled:cursor-not-allowed disabled:shadow-none transition-all";
const ISSUE_BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 min-h-[48px] px-5 bg-white text-stone-800 border-2 border-[color:var(--goldline)] rounded-2xl text-sm font-bold hover:bg-[color:var(--goldtint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all";

/** The one or two ways to finish a document: "save and issue" always, plus
 *  "save, issue and send by email" once a valid address exists. The send
 *  button is the gradient one when it exists; otherwise issuing is. `stacked`
 *  puts the send button on top (the mobile card). */
function IssueButtons({
  stacked = false,
  canSend,
  disabled,
  busy,
  saveLabel,
  sendLabel,
  onIssue,
  onSend,
}: {
  stacked?: boolean;
  canSend: boolean;
  disabled: boolean;
  busy: boolean;
  saveLabel: string;
  sendLabel: string;
  onIssue: () => void;
  onSend: () => void;
}) {
  const w = stacked ? " w-full" : "";
  const issue = (
    <button
      key="issue"
      onClick={onIssue}
      disabled={disabled}
      className={(canSend ? ISSUE_BTN_SECONDARY : ISSUE_BTN_PRIMARY) + w}
    >
      {!busy && <Save className="w-4 h-4 flex-shrink-0" />}
      {saveLabel}
    </button>
  );
  if (!canSend) return issue;
  const send = (
    <button key="send" onClick={onSend} disabled={disabled} className={ISSUE_BTN_PRIMARY + w}>
      {!busy && <Send className="w-4 h-4 flex-shrink-0" />}
      {sendLabel}
    </button>
  );
  return stacked ? [send, issue] : [issue, send];
}

/** What comes after the issue button. Asaf (2026-08-27) wanted the delivery
 *  options visible already under "הפק", so nobody wonders what pressing it
 *  leads to; the document must exist before it can be sent, so this is the
 *  honest version: one sentence naming the four ways the next screen offers. */
function NextStepsHint({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] text-stone-600 leading-snug ${className}`}>
      אחרי ההפקה תוכלו לשלוח במייל או בוואטסאפ, להוריד PDF או להדפיס.
    </p>
  );
}

/** Save result notice; the same block used to be pasted into all three save
 *  surfaces (desktop bar, mobile card, mobile dock). */
function ResultToast({ toast, className = "text-sm p-3" }: { toast: ToastState; className?: string }) {
  return (
    <div
      className={`rounded-xl flex items-start gap-2 ${className} ${
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
  );
}

/** The gate for a business profile without a name / tax id. Was a link to
 *  /settings. Onboarding deliberately stopped requiring the tax ID (requiring
 *  it was the biggest hole in the signup funnel), so the first time a user
 *  meets this rule is HERE - already in the editor, with a filled document in
 *  front of them. Sending them to another page at that exact moment is where
 *  they leave. The same modal settings uses is opened in place instead. */
function BusinessProfileNag({ onFix, className = "" }: { onFix: () => void; className?: string }) {
  return (
    <div className={`flex items-start gap-2 text-xs text-rose-800 bg-rose-50 p-3 rounded-xl border border-rose-200 ${className}`}>
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
      <span>
        לפני הפקת מסמך יש להשלים את שם העסק ומספר העוסק/ח.פ.{" "}
        <button type="button" onClick={onFix} className="font-semibold underline hover:text-rose-900">
          להשלמת פרטי העסק כאן ←
        </button>
      </span>
    </div>
  );
}

/** "Client has no tax id" nudge with the inline fix. `inline` lays the copy
 *  and the input side by side (the desktop bar); stacked otherwise. */
function ClientTaxIdNag({
  id,
  inline = false,
  adhocMode,
  canEdit,
  draft,
  onDraftChange,
  onSave,
  saving,
}: {
  id?: string;
  inline?: boolean;
  adhocMode: boolean;
  canEdit: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div
      id={id}
      role="status"
      className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
    >
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
      <div className={inline ? "min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-2" : "min-w-0 flex-1"}>
        <div>
          <p className="font-semibold">חסר ח.פ / ת.ז של הלקוח</p>
          <p className="mt-0.5 leading-relaxed text-amber-800">
            {adhocMode
              ? "אפשר להפיק גם בלי, אבל מומלץ להשלים אותו בשדה המסומן בכרטיס \"לקוח\"."
              : "אפשר להפיק גם בלי. הוסף אותו כאן והוא יישמר גם בכרטיס הלקוח:"}
          </p>
        </div>
        {canEdit && (
          <div className={inline ? "flex items-center gap-2 flex-1 min-w-[16rem]" : "mt-2 flex items-center gap-2"}>
            <input
              type="text"
              inputMode="numeric"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSave();
                }
              }}
              placeholder="ח.פ / ת.ז של הלקוח"
              dir="ltr"
              className="input-warm flex-1 min-w-0 text-sm py-2"
              aria-label="ח.פ / ת.ז של הלקוח"
            />
            <button
              type="button"
              onClick={onSave}
              disabled={!draft.trim() || saving}
              className="shrink-0 inline-flex items-center justify-center min-h-[40px] px-3 rounded-xl bg-gradient-to-l from-orange-500 to-rose-500 text-white text-xs font-semibold disabled:from-stone-300 disabled:to-stone-300 disabled:cursor-not-allowed"
            >
              {saving ? "שומר…" : "שמור ללקוח"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
