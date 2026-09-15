// Pure decisions behind the document editor's "start from an existing document"
// flows: convert (quote / proforma / tax invoice -> receipt), duplicate, and a
// credit note opened from the invoice it reverses. Kept out of
// receipt-editor.tsx so every rule here is unit-tested without a browser.
//
// Why this exists (audit 2026-09-15): the editor used to copy only the client,
// subject, notes and items. Currency, exchange rate, zero-rating, discount,
// rounding, withholding and language silently fell back to defaults, so a
// discounted invoice of 1,062 converted to a receipt of 1,180 and a zero-rated
// $2,000 export invoice converted to a receipt of 2,360 shekels. An issued
// document can only be undone with a credit note, so the copy has to be right.

import { DOCUMENT_TYPE_LABELS, type DocumentType } from "./types";
import { round2 } from "./vat";

/** The `documents` row columns the prefill reads (snake_case, as selected). */
export interface SourceDocRow {
  id: string;
  type: string;
  number: number | string;
  status?: string | null;
  converted_to_id?: string | null;
  original_document_id?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  client_tax_id?: string | null;
  subject?: string | null;
  notes?: string | null;
  currency?: string | null;
  exchange_rate?: number | string | null;
  zero_rated?: boolean | null;
  discount_amount?: number | string | null;
  round_total?: boolean | null;
  withholding_rate?: number | string | null;
  withholding_amount?: number | string | null;
  language?: string | null;
  total?: number | string | null;
}

export interface SourceItemRow {
  product_id?: string | null;
  description: string;
  quantity: number | string;
  unit_price: number | string;
}

export interface PrefillItem {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export type PrefillMode = "convert" | "duplicate" | "credit_note";

export interface SourcePrefill {
  mode: PrefillMode;
  client:
    | { kind: "saved"; clientId: string }
    | { kind: "adhoc"; name: string; taxId: string }
    | null;
  subject: string;
  notes: string;
  items: PrefillItem[];
  /** Stored unit prices are NET, so the copy is always priced VAT-exclusive. */
  vatMode: "exclusive";
  currency: string;
  zeroRated: boolean;
  roundTotal: boolean;
  language: "he" | "en";
  /**
   * The source's exchange rate, to be used instead of a fresh lookup while the
   * currency and date stay as prefilled. Set for convert and credit note (the
   * new document settles / reverses the very same shekel amounts), null for a
   * duplicate (a new sale at a new date takes the day's rate).
   */
  pinnedExchangeRate: number | null;
  /** Document-level discount (amount, document currency) for the editor's הנחה field. */
  discountAmount: number | null;
  /** Withholding RATE to carry into a payment document; the amount is recomputed from it. */
  withholdingRate: number | null;
  /**
   * For a convert: the source total (positive). The editor warns when its
   * computed total differs, e.g. a historical invoice issued at another VAT
   * rate. Null for duplicate and credit note (those are often edited on purpose).
   */
  expectedTotal: number | null;
}

const PAYMENT_RECORDING: DocumentType[] = ["receipt", "tax_invoice_receipt"];

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Floor to whole agorot, robust to float noise (12.3 * 100 = 1229.9999...). */
function floorAgora(n: number): number {
  return Math.floor(round2(n * 100) + 1e-9) / 100;
}

function linesSubtotal(items: PrefillItem[]): number {
  return round2(items.reduce((s, i) => s + round2(i.quantity * round2(i.unitPrice)), 0));
}

/**
 * A credit note stores negative amounts, so the editor offers it no discount
 * field. To credit a discounted invoice for exactly what was charged, the
 * discount is spread over the line prices instead (each unit price scaled by
 * the same factor, floored to agorot so the credit never exceeds the invoice),
 * and the few leftover agorot are put back on a quantity-1 line when there is
 * one. Without a quantity-1 line the credit can fall short by those agorot -
 * never over.
 */
export function prorateDiscountIntoItems(items: PrefillItem[], discount: number): PrefillItem[] {
  const base = linesSubtotal(items);
  const d = round2(discount);
  if (!(d > 0) || !(base > 0) || d >= base) return items.map((i) => ({ ...i }));
  const target = round2(base - d);
  const factor = target / base;
  const scaled = items.map((i) => ({ ...i, unitPrice: floorAgora(round2(i.unitPrice) * factor) }));

  const residual = round2(target - linesSubtotal(scaled));
  if (residual === 0) return scaled;

  // Prefer the largest quantity-1 line: it absorbs any agora amount exactly.
  const singles = scaled
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.quantity === 1)
    .sort((a, b) => b.it.unitPrice - a.it.unitPrice);
  if (singles.length > 0 && round2(singles[0].it.unitPrice + residual) >= 0) {
    scaled[singles[0].idx].unitPrice = round2(singles[0].it.unitPrice + residual);
    return scaled;
  }

  // Over the target (possible with fractional quantities): shave the largest
  // line until the credit is at or under the invoice.
  if (residual < 0) {
    const largest = scaled
      .map((it, idx) => ({ it, idx }))
      .sort((a, b) => b.it.quantity * b.it.unitPrice - a.it.quantity * a.it.unitPrice)[0];
    const q = largest.it.quantity || 1;
    const cut = Math.ceil(round2(-residual * 100) / q - 1e-9) / 100;
    scaled[largest.idx].unitPrice = Math.max(0, round2(largest.it.unitPrice - cut));
  }
  return scaled;
}

/**
 * Everything the editor should load from a source document. `targetType` is
 * the type being created; `isConvert` is the `?convert=1` flag.
 */
export function buildSourcePrefill(
  src: SourceDocRow,
  srcItems: SourceItemRow[],
  opts: { targetType: DocumentType; isConvert: boolean },
): SourcePrefill {
  const mode: PrefillMode =
    opts.targetType === "credit_note" ? "credit_note" : opts.isConvert ? "convert" : "duplicate";

  const client: SourcePrefill["client"] = src.client_id
    ? { kind: "saved", clientId: src.client_id }
    : src.client_name
      ? { kind: "adhoc", name: src.client_name, taxId: src.client_tax_id || "" }
      : null;

  let notes = src.notes || "";
  if (mode === "convert") {
    const srcLabel = DOCUMENT_TYPE_LABELS[src.type as DocumentType] ?? "מסמך";
    const noteText = `הומר מ${srcLabel} #${src.number}`;
    notes = notes ? `${notes}\n${noteText}` : noteText;
  }

  let items: PrefillItem[] = srcItems.map((row) => ({
    productId: row.product_id || undefined,
    description: row.description,
    // A credit note stores negative quantities; the editor applies the sign.
    quantity: Math.abs(Number(row.quantity)) || 1,
    unitPrice: Math.abs(Number(row.unit_price)) || 0,
  }));

  const currency = (src.currency || "ILS").toUpperCase();
  const rate = num(src.exchange_rate);
  const discount = Math.abs(num(src.discount_amount) ?? 0);

  let discountAmount: number | null = null;
  if (discount > 0) {
    if (mode === "credit_note") items = prorateDiscountIntoItems(items, discount);
    else discountAmount = round2(discount);
  }

  const srcWithholdingRate = num(src.withholding_rate);
  const withholdingRate =
    mode !== "credit_note" &&
    PAYMENT_RECORDING.includes(opts.targetType) &&
    srcWithholdingRate !== null &&
    srcWithholdingRate > 0 &&
    (num(src.withholding_amount) ?? 0) > 0
      ? srcWithholdingRate
      : null;

  const total = num(src.total);

  return {
    mode,
    client,
    subject: src.subject || "",
    notes,
    items,
    vatMode: "exclusive",
    currency,
    zeroRated: Boolean(src.zero_rated),
    roundTotal: Boolean(src.round_total),
    language: src.language === "en" ? "en" : "he",
    // Only a VAT document's rate is the rate of a real transaction: a receipt
    // for a tax invoice, or a credit note reversing it, keeps that rate so the
    // shekel figures match the invoice. A quote or proforma was never a
    // transaction, so converting one takes the rate of the new document's date
    // like any new document (council 2026-09-15).
    pinnedExchangeRate:
      mode !== "duplicate" &&
      (src.type === "tax_invoice" || src.type === "tax_invoice_receipt") &&
      currency !== "ILS" &&
      rate !== null &&
      rate > 0
        ? rate
        : null,
    discountAmount,
    withholdingRate,
    expectedTotal: mode === "convert" && total !== null ? Math.abs(total) : null,
  };
}

// ── Convert guard ────────────────────────────────────────────────────────────

export type ConversionBlock =
  | { kind: "not_found" }
  | { kind: "draft" }
  | { kind: "cancelled" }
  | { kind: "already_converted"; convertedToId: string };

/**
 * Whether a source may be converted right now. A second convert of the same
 * quote / invoice (browser Back, a second tab) would issue a second paid
 * receipt for one payment, and the link step would only fail after the
 * numbered receipt already exists.
 */
export function conversionBlock(
  src: Pick<SourceDocRow, "status" | "converted_to_id"> | null | undefined,
): ConversionBlock | null {
  if (!src) return { kind: "not_found" };
  if (src.converted_to_id) return { kind: "already_converted", convertedToId: src.converted_to_id };
  if (src.status === "cancelled") return { kind: "cancelled" };
  if (!src.status || src.status === "draft") return { kind: "draft" };
  return null;
}

export function conversionBlockMessage(
  block: ConversionBlock,
  src?: { type?: string; number?: number | string } | null,
): string {
  const label =
    src?.type && DOCUMENT_TYPE_LABELS[src.type as DocumentType]
      ? `${DOCUMENT_TYPE_LABELS[src.type as DocumentType]}${src.number != null ? ` #${src.number}` : ""}`
      : "המסמך המקורי";
  switch (block.kind) {
    case "already_converted":
      return `כבר נוצר מסמך מתוך ${label}, ולכן אי אפשר להמיר אותו שוב. אפשר לפתוח את המסמך שכבר נוצר.`;
    case "cancelled":
      return `אי אפשר להמיר מסמך מבוטל (${label}).`;
    case "draft":
      return `אי אפשר להמיר טיוטה (${label}). יש להפיק אותה קודם.`;
    case "not_found":
      return "המסמך המקורי לא נמצא, ולכן אי אפשר להמיר.";
  }
}

// ── Document number ──────────────────────────────────────────────────────────

/**
 * The number to send to create_document_atomic. Null lets the database take
 * the next free number at the moment of issue; an explicit number is sent only
 * when the user typed one. The editor used to always send the number it showed
 * at mount (or kept in a saved draft), so a draft resumed after another
 * document took that number failed forever with "number already exists".
 */
export function numberToSend(docNumber: string, touched: boolean): number | null {
  if (!touched) return null;
  const n = Number(String(docNumber).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * What a resumed server draft should show as its number: the typed number
 * only when the user had edited it, otherwise null (= look up a fresh one).
 * Drafts saved before the flag existed count as not edited.
 */
export function resumedDocumentNumber(p: {
  documentNumber?: string;
  documentNumberTouched?: boolean;
}): string | null {
  return p.documentNumberTouched && p.documentNumber ? p.documentNumber : null;
}

// ── Credit note reference ────────────────────────────────────────────────────

/** An issued, live tax invoice a credit note may reference. */
export function isCreditableInvoice(d: { type: string; status: string }): boolean {
  return (
    (d.type === "tax_invoice" || d.type === "tax_invoice_receipt") &&
    d.status !== "draft" &&
    d.status !== "cancelled"
  );
}

/**
 * The invoice a credit note opened with `?from=` should be linked to: the
 * source itself when it is a creditable invoice, or, when duplicating a credit
 * note, the invoice that one referenced. Empty when there is nothing to link.
 */
export function creditRefFromSource(
  src: Pick<SourceDocRow, "id" | "type" | "status" | "original_document_id">,
): string {
  if (isCreditableInvoice({ type: src.type, status: src.status || "draft" })) return src.id;
  if (src.type === "credit_note" && src.original_document_id) return src.original_document_id;
  return "";
}

// ── One issue per form ───────────────────────────────────────────────────────

/**
 * Whether the editor may start creating a document now. Once a document was
 * created from this form it never creates another: after a failed email send
 * (or during the redirect delay) a second click used to issue a second,
 * differently numbered document for the same sale.
 */
export function mayStartIssue(s: {
  inFlight: boolean;
  issuedDocumentId: string | null;
  convertBlocked: boolean;
}): boolean {
  return !s.inFlight && !s.issuedDocumentId && !s.convertBlocked;
}
