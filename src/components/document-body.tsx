"use client";

import { formatCurrency, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/currencies";
import { netAfterWithholding } from "@/lib/withholding";
import { Ltr } from "@/components/ui/ltr";
import { CANONICAL_HOST, CANONICAL_ORIGIN } from "@/lib/public-url";
import { docStrings, type DocLang, type DocStrings } from "@/lib/document-strings";
import {
  type Business,
  type DocumentItem,
  type DocumentType,
  type PaymentDetails,
  type PaymentMethod,
} from "@/lib/types";

export interface DocumentBodyClient {
  name: string;
  taxId?: string;
  address?: string;
  phone?: string;
  email?: string;
}

/**
 * Human-readable pieces of the structured payment detail, per method, to render
 * discreetly next to the payment-method label (e.g. "אסמכתא 13094",
 * "שיק 4521 · בנק לאומי · ז\"פ 01/08/2026").
 */
function paymentDetailsParts(
  method: PaymentMethod,
  d: PaymentDetails | undefined,
  s: DocStrings,
  lang: DocLang,
): string[] {
  if (!d) return [];
  const parts: string[] = [];
  if (method === "check") {
    if (d.checkNumber) parts.push(s.check(d.checkNumber));
    if (d.checkBank) parts.push(d.checkBank);
    if (d.checkBranch) parts.push(s.branch(d.checkBranch));
    if (d.checkAccount) parts.push(s.account(d.checkAccount));
    if (d.checkDueDate) parts.push(s.checkDueDate(formatDate(d.checkDueDate, lang)));
  } else if (method === "credit_card") {
    if (d.cardLast4) parts.push(s.cardLast4(d.cardLast4));
    if (d.cardApproval) parts.push(s.cardApproval(d.cardApproval));
  } else if (method === "bank_transfer" || method === "bit" || method === "paypal") {
    if (d.reference) parts.push(s.reference(d.reference));
  }
  return parts;
}

function showPaymentInfo(type: DocumentType, business: Business): boolean {
  // Only show payment info on docs awaiting payment
  if (type === "receipt" || type === "tax_invoice_receipt" || type === "credit_note") {
    return false;
  }
  return Boolean(
    business.bankName ||
      business.bankBranch ||
      business.bankAccount ||
      business.paymentNotes
  );
}

interface Props {
  business: Business;
  client: DocumentBodyClient | null;
  documentType: DocumentType;
  number: number | null;
  date: string;
  subject?: string;
  items: DocumentItem[];
  subtotal: number;
  vat: number;
  vatRate: number;
  total: number;
  /** הפרש עיגול, signed rounding adjustment; a summary line renders when non-zero. */
  rounding?: number;
  paymentMethod?: PaymentMethod;
  /** Structured payment detail (check/bank/card), shown next to the payment method. */
  paymentDetails?: PaymentDetails;
  /**
   * Document-level discount (הנחה) in the document currency. When > 0 the totals
   * block shows a pre-discount total and a discount line; `subtotal` is expected
   * to already be the DISCOUNTED subtotal.
   */
  discount?: number;
  /** ניכוי מס במקור, withholding rate (%) and amount; renders a payment-split block. */
  withholdingRate?: number;
  withholdingAmount?: number;
  notes?: string;
  placeholders?: boolean;
  /** מספר הקצאה (Tax Authority allocation), shown on tax-invoice docs that have one. */
  allocationNumber?: string;
  /** ISO 4217 currency code. Defaults to "ILS". */
  currency?: string;
  /** Exchange rate (₪ per 1 unit of currency). Only relevant when currency !== "ILS". */
  exchangeRate?: number;
  /** Total in ₪ equivalent (snapshotted). Only relevant when currency !== "ILS". */
  totalIls?: number;
  /** Zero-rated export transaction (0% VAT, distinct from עוסק פטור). */
  zeroRated?: boolean;
  /**
   * Whether this render is a copy/reprint. `false` (default) prints the
   * legally-required "מקור" (original) label; `true` prints "העתק" (copy).
   * Owning pages should pass `copy` on any reprint/re-download of an
   * already-issued document.
   */
  copy?: boolean;
  /**
   * Whether to print the small "הופק באמצעות …" credit in the footer.
   * Defaults to `true` - the growth loop that puts the app in front of every
   * recipient. PAID subscribers get it suppressed (standard SaaS behaviour,
   * and a genuine upgrade incentive); the caller decides, since only the
   * server knows the document owner's plan. See
   * `src/app/api/public-document/[id]/route.ts` for how that flag is derived.
   */
  showBranding?: boolean;
  /**
   * The language the document itself is written in. "he" (default) keeps every
   * word and the RTL layout exactly as they have always been; "en" renders the
   * same document in English for a foreign customer. Setting `dir` on the paper
   * wrapper is the caller's job (receipt-view / document-preview), because that
   * element lives there.
   */
  language?: DocLang;
}

export function DocumentBody({
  business,
  client,
  documentType,
  number,
  date,
  subject,
  items,
  subtotal,
  vat,
  vatRate,
  total,
  rounding = 0,
  paymentMethod,
  paymentDetails,
  discount = 0,
  withholdingRate,
  withholdingAmount,
  notes,
  placeholders = false,
  allocationNumber,
  currency: currencyProp,
  exchangeRate,
  totalIls,
  zeroRated = false,
  copy = false,
  showBranding = true,
  language = "he",
}: Props) {
  const s = docStrings(language);
  const currency = currencyProp || "ILS";
  const money = (n: number) => (currency === "ILS" ? formatCurrency(n) : formatMoney(n, currency));

  const numberStr = number != null ? String(number).padStart(4, "0") : s.autoNumber;
  const dateStr = date ? formatDate(date, language) : "-";
  const businessName = business.name || (placeholders ? "-" : "");
  const showItemsEmptyState =
    placeholders && (items.length === 0 || items.every((i) => !i.description));
  // Historical imported documents (e.g. the Invoice4U migration) stored only a
  // total + subject, never per-line rows. Rather than show a headers-only table
  // with no body, synthesize ONE display row from the document itself: the
  // subject as the description (falling back to the document-type label), qty 1,
  // and the pre-VAT subtotal as the amount, which equals the grand total for
  // these zero-VAT (עוסק פטור) docs and stays consistent with the totals
  // breakdown for any future VAT doc. This is display-only and NEVER fires for a
  // document that actually has line items, nor in the editor placeholder state.
  const useFallbackRow = !placeholders && items.length === 0;
  const fallbackDescription = subject?.trim() || s.documentTypes[documentType];
  const hasWithholding = withholdingAmount != null && withholdingAmount > 0;

  // Business identity line: "עוסק מורשה 003244266" then address · phone · email.
  const bizContact = [business.address, business.phone, business.email].filter(Boolean);

  const paymentParts = paymentMethod
    ? paymentDetailsParts(paymentMethod, paymentDetails, s, language)
    : [];
  const bankLine = [
    business.bankName,
    business.bankBranch ? s.branch(business.bankBranch) : "",
    business.bankAccount ? s.account(business.bankAccount) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const showBank = showPaymentInfo(documentType, business);

  return (
    <>
      {/* ── Header: business identity (start side) ↔ document identity ── */}
      <div className="doc-card doc-head">
        <div className="doc-biz">
          {/* Business logo is OPTIONAL. Without one, the app's own mark takes
              the slot (Asaf, 2026-08-31) - never a monogram or initials. */}
          {business.logoUrl ? (
            <img src={business.logoUrl} alt={business.name} className="doc-logo" />
          ) : (
            <img src="/logo.svg" alt="" aria-hidden="true" className="doc-logo is-app" />
          )}
          <div>
            <h1 className="doc-name doc-serif">{businessName}</h1>
            <p className="doc-bizline">
              {s.businessTypes[business.businessType]}
              {business.taxId && (
                <>
                  {" "}
                  <span className="doc-mono">{business.taxId}</span>
                </>
              )}
              {bizContact.length > 0 && (
                <>
                  <br />
                  {bizContact.map((part, i) => (
                    <span key={i}>
                      {i > 0 && <>&nbsp;·&nbsp;</>}
                      <span className={i === 0 ? undefined : "doc-mono"}>{part}</span>
                    </span>
                  ))}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="doc-ident">
          <div className="doc-orig">{copy ? s.copy : s.original}</div>
          <div
            className={`doc-badge${documentType === "credit_note" ? " is-credit" : ""}`}
          >
            {s.documentTypes[documentType]}
          </div>
          <div className="doc-num doc-serif doc-mono">{numberStr}</div>
          <div className="doc-date doc-tab">{dateStr}</div>
        </div>
      </div>

      {/* ── Meta strip: client · allocation number · subject ──
          DOM order IS the visual order here (plain RTL flex row, no `order`),
          so the customer card renders at the reading start (right side) and
          stays first when the strip stacks to a column on narrow screens.
          The allocation number is metadata about the document, so it follows.
          Placement only: no field, label or value changes. */}
      <div className="doc-strip">
        <div className="doc-card doc-mini">
          <div className="doc-glabel">{s.toLabel}</div>
          {client ? (
            <>
              <div className="doc-mini-v doc-serif">{client.name}</div>
              {client.taxId && (
                <div className="doc-mini-sub">
                  {s.clientTaxId} <span className="doc-mono">{client.taxId}</span>
                </div>
              )}
              {client.address && <div className="doc-mini-sub">{client.address}</div>}
              {client.phone && (
                <div className="doc-mini-sub doc-mono">{client.phone}</div>
              )}
              {client.email && (
                <div className="doc-mini-sub doc-mono">{client.email}</div>
              )}
            </>
          ) : (
            <div className="doc-mini-v is-empty">{s.noClient}</div>
          )}
        </div>
        {allocationNumber && (
          <div className="doc-card doc-mini">
            <div className="doc-glabel">{s.allocationLabel}</div>
            <div className="doc-mini-v is-gold doc-mono">{allocationNumber}</div>
          </div>
        )}
        {subject && (
          <div className="doc-card doc-mini">
            <div className="doc-glabel">{s.subjectLabel}</div>
            <div className="doc-mini-v is-reg">{subject}</div>
          </div>
        )}
      </div>

      {/* ── Line items ── */}
      <div className="doc-card doc-items">
        <div className="doc-glabel">{s.itemsLabel}</div>
        <table className="doc-table">
          <thead>
            <tr>
              <th className="c-desc">{s.thDescription}</th>
              <th className="c-qty">{s.thQuantity}</th>
              <th className="c-num">{s.thUnitPrice}</th>
              <th className="c-num">{s.thAmount}</th>
            </tr>
          </thead>
          <tbody>
            {showItemsEmptyState ? (
              <tr>
                <td colSpan={4} className="c-empty">
                  {s.noItems}
                </td>
              </tr>
            ) : useFallbackRow ? (
              <tr>
                <td className="c-desc">{fallbackDescription}</td>
                <td className="c-qty doc-tab">1</td>
                <td className="c-num doc-tab">{money(subtotal)}</td>
                <td className="c-total doc-tab">{money(subtotal)}</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="c-desc">{item.description || (placeholders ? "-" : "")}</td>
                  <td className="c-qty doc-tab">{item.quantity}</td>
                  <td className="c-num doc-tab">{money(item.unitPrice)}</td>
                  <td className="c-total doc-tab">{money(item.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Money: breakdown ↔ gold-framed "שולם בפועל" ── */}
      <div className={`doc-money doc-totals${hasWithholding ? "" : " is-solo"}`}>
        <div className="doc-card doc-breakdown">
          {discount > 0 && (
            <>
              <div className="doc-brow">
                <span>{s.totalBeforeDiscount}</span>
                <span className="doc-tab">{money(subtotal + discount)}</span>
              </div>
              <div className="doc-brow is-discount">
                <span>{s.discount}</span>
                <span className="doc-tab">
                  <bdi dir="ltr">-{money(discount)}</bdi>
                </span>
              </div>
            </>
          )}
          <div className="doc-brow">
            <span>{s.subtotal}</span>
            <span className="doc-tab">{money(subtotal)}</span>
          </div>
          {zeroRated ? (
            <div className="doc-brow">
              <span>{s.vat}</span>
              <span>{s.zeroRatedNote}</span>
            </div>
          ) : (
            vatRate > 0 && (
              <div className="doc-brow">
                <span>
                  {s.vat} <bdi dir="ltr">{vatRate}%</bdi>
                </span>
                <span className="doc-tab">{money(vat)}</span>
              </div>
            )
          )}
          {rounding !== 0 && (
            <div className="doc-brow">
              <span>{s.rounding}</span>
              <span className="doc-tab">{money(rounding)}</span>
            </div>
          )}
          <div className="doc-brow is-grand">
            <span>{s.sumLabel[documentType]}</span>
            <span className="doc-grand-val doc-serif doc-tab">{money(total)}</span>
          </div>
          {currency !== "ILS" && (
            <div className="doc-note-line">
              {s.totalInIls}{" "}
              <bdi dir="ltr">{s.exchangeRate(Number(exchangeRate ?? 1).toFixed(4))}</bdi>:{" "}
              {formatMoney(Number(totalIls ?? 0), "ILS")}
            </div>
          )}
          {hasWithholding && (
            <div className="doc-brow is-deduct">
              <span>
                {s.withholding}
                {withholdingRate != null && withholdingRate > 0 && (
                  <>
                    {" "}
                    <bdi dir="ltr">{withholdingRate}%</bdi>
                  </>
                )}
              </span>
              <span className="doc-tab">
                <bdi dir="ltr">−{money(withholdingAmount as number)}</bdi>
              </span>
            </div>
          )}
        </div>

        {hasWithholding && (
          <div className="doc-paid">
            <div className="doc-paid-top">{s.paidActual}</div>
            <div className="doc-paid-amount doc-serif doc-tab">
              {money(netAfterWithholding(total, withholdingAmount as number))}
            </div>
            <div className="doc-paid-note">{s.paidNote}</div>
          </div>
        )}
      </div>

      {/* ── Payment method · bank details · notes ── */}
      {(paymentMethod || showBank || notes) && (
        <div className="doc-infos">
          {paymentMethod && (
            <div className="doc-card doc-info">
              <div className="doc-glabel">{s.paymentMethodLabel}</div>
              <div className="doc-info-body">
                {s.paymentMethods[paymentMethod]}
                {paymentParts.length > 0 && (
                  <>
                    <br />
                    <span className="doc-dim">{paymentParts.join(" · ")}</span>
                  </>
                )}
              </div>
            </div>
          )}
          {showBank && (
            <div className="doc-card doc-info">
              <div className="doc-glabel">{s.paymentDetailsLabel}</div>
              <div className="doc-info-body">
                {bankLine && (
                  <>
                    {s.bankTransfer}
                    <br />
                    <span className="doc-dim doc-mono">{bankLine}</span>
                  </>
                )}
                {business.paymentNotes && (
                  <>
                    {bankLine && <br />}
                    <span className="doc-dim">{business.paymentNotes}</span>
                  </>
                )}
              </div>
            </div>
          )}
          {notes && (
            <div className="doc-card doc-info doc-info-full">
              <div className="doc-glabel">{s.notesLabel}</div>
              <div className="doc-info-body">{notes}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Footer: electronic-issuance statement + brand mark ── */}
      <div className="doc-foot">
        <div className="doc-foot-sig">
          {s.footerIssued}
          {business.name ? ` · ${business.name}` : ""}
        </div>
        {showBranding && (
          // Growth loop: every document this app produces is seen by the
          // sender's CLIENT - often an עצמאי who needs invoicing themselves.
          // The credit is therefore a real <a>, not the inert text it was
          // before, and keeps the bare domain visible so it still works as a
          // call to action on PAPER/PDF (where nothing is clickable).
          // Deliberately restrained: this is a tax document, so it stays a
          // 10px footnote - the explicit CTA lives on the screen-only /view
          // page instead, where it can't cheapen the printed document.
          <div className="doc-foot-brand">
            {s.footerBrand}{" "}
            <a
              href={`${CANONICAL_ORIGIN}/?utm_source=document&utm_medium=doc_footer&utm_campaign=growth_loop`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Ltr>MyFriendlyInvoiceApp · {CANONICAL_HOST}</Ltr>
            </a>
          </div>
        )}
      </div>
    </>
  );
}
