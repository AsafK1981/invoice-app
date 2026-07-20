"use client";

import { formatCurrency, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/currencies";
import {
  BUSINESS_TYPE_LABELS,
  DOC_SUM_LABEL,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
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
): string[] {
  if (!d) return [];
  const parts: string[] = [];
  if (method === "check") {
    if (d.checkNumber) parts.push(`שיק ${d.checkNumber}`);
    if (d.checkBank) parts.push(d.checkBank);
    if (d.checkBranch) parts.push(`סניף ${d.checkBranch}`);
    if (d.checkAccount) parts.push(`חשבון ${d.checkAccount}`);
    if (d.checkDueDate) parts.push(`ז״פ ${formatDate(d.checkDueDate)}`);
  } else if (method === "credit_card") {
    if (d.cardLast4) parts.push(`מסתיים ב-${d.cardLast4}`);
    if (d.cardApproval) parts.push(`אישור ${d.cardApproval}`);
  } else if (method === "bank_transfer" || method === "bit" || method === "paypal") {
    if (d.reference) parts.push(`אסמכתא ${d.reference}`);
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
  /** הפרש עיגול — signed rounding adjustment; a summary line renders when non-zero. */
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
  /** ניכוי מס במקור — withholding rate (%) and amount; renders a payment-split block. */
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
}: Props) {
  const currency = currencyProp || "ILS";
  const money = (n: number) => (currency === "ILS" ? formatCurrency(n) : formatMoney(n, currency));

  const numberStr = number != null ? String(number).padStart(4, "0") : "(אוטומטי)";
  const dateStr = date ? formatDate(date) : "—";
  const businessName = business.name || (placeholders ? "—" : "");
  const showItemsEmptyState =
    placeholders && (items.length === 0 || items.every((i) => !i.description));
  const hasWithholding = withholdingAmount != null && withholdingAmount > 0;

  // Business identity line: "עוסק מורשה 003244266" then address · phone · email.
  const bizContact = [business.address, business.phone, business.email].filter(Boolean);

  const paymentParts = paymentMethod
    ? paymentDetailsParts(paymentMethod, paymentDetails)
    : [];
  const bankLine = [
    business.bankName,
    business.bankBranch ? `סניף ${business.bankBranch}` : "",
    business.bankAccount ? `חשבון ${business.bankAccount}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const showBank = showPaymentInfo(documentType, business);

  return (
    <>
      {/* ── Header: business identity (start side) ↔ document identity ── */}
      <div className="doc-card doc-head">
        <div className="doc-biz">
          {/* Logo is OPTIONAL and there is deliberately NO placeholder/monogram
              fallback — a business without a logo simply shows its name. */}
          {business.logoUrl && (
            <img src={business.logoUrl} alt={business.name} className="doc-logo" />
          )}
          <div>
            <h1 className="doc-name doc-serif">{businessName}</h1>
            <p className="doc-bizline">
              {BUSINESS_TYPE_LABELS[business.businessType]}
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
          <div className="doc-orig">{copy ? "העתק" : "מקור"}</div>
          <div
            className={`doc-badge${documentType === "credit_note" ? " is-credit" : ""}`}
          >
            {DOCUMENT_TYPE_LABELS[documentType]}
          </div>
          <div className="doc-num doc-serif doc-mono">{numberStr}</div>
          <div className="doc-date doc-tab">{dateStr}</div>
        </div>
      </div>

      {/* ── Meta strip: allocation number · client · subject ── */}
      <div className="doc-strip">
        {allocationNumber && (
          <div className="doc-card doc-mini">
            <div className="doc-glabel">מספר הקצאה · חשבונית ישראל</div>
            <div className="doc-mini-v is-gold doc-mono">{allocationNumber}</div>
          </div>
        )}
        <div className="doc-card doc-mini">
          <div className="doc-glabel">לכבוד</div>
          {client ? (
            <>
              <div className="doc-mini-v doc-serif">{client.name}</div>
              {client.taxId && (
                <div className="doc-mini-sub">
                  ח.פ / ת.ז <span className="doc-mono">{client.taxId}</span>
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
            <div className="doc-mini-v is-empty">לקוח לא נבחר</div>
          )}
        </div>
        {subject && (
          <div className="doc-card doc-mini">
            <div className="doc-glabel">בגין</div>
            <div className="doc-mini-v is-reg">{subject}</div>
          </div>
        )}
      </div>

      {/* ── Line items ── */}
      <div className="doc-card doc-items">
        <div className="doc-glabel">פירוט</div>
        <table className="doc-table">
          <thead>
            <tr>
              <th className="c-desc">תיאור</th>
              <th className="c-qty">כמות</th>
              <th className="c-num">מחיר יחידה</th>
              <th className="c-num">סכום</th>
            </tr>
          </thead>
          <tbody>
            {showItemsEmptyState ? (
              <tr>
                <td colSpan={4} className="c-empty">
                  לא הוזנו פריטים עדיין
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="c-desc">{item.description || (placeholders ? "—" : "")}</td>
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
                <span>סה״כ לפני הנחה</span>
                <span className="doc-tab">{money(subtotal + discount)}</span>
              </div>
              <div className="doc-brow is-discount">
                <span>הנחה</span>
                <span className="doc-tab">
                  <bdi dir="ltr">-{money(discount)}</bdi>
                </span>
              </div>
            </>
          )}
          <div className="doc-brow">
            <span>סכום ביניים</span>
            <span className="doc-tab">{money(subtotal)}</span>
          </div>
          {zeroRated ? (
            <div className="doc-brow">
              <span>מע״מ</span>
              <span>עסקה בשיעור אפס — ייצוא שירותים</span>
            </div>
          ) : (
            vatRate > 0 && (
              <div className="doc-brow">
                <span>
                  מע״מ <bdi dir="ltr">{vatRate}%</bdi>
                </span>
                <span className="doc-tab">{money(vat)}</span>
              </div>
            )
          )}
          {rounding !== 0 && (
            <div className="doc-brow">
              <span>עיגול</span>
              <span className="doc-tab">{money(rounding)}</span>
            </div>
          )}
          <div className="doc-brow is-grand">
            <span>{DOC_SUM_LABEL[documentType]}</span>
            <span className="doc-grand-val doc-serif doc-tab">{money(total)}</span>
          </div>
          {currency !== "ILS" && (
            <div className="doc-note-line">
              סה״כ ב-₪ <bdi dir="ltr">(שער {Number(exchangeRate ?? 1).toFixed(4)})</bdi>:{" "}
              {formatMoney(Number(totalIls ?? 0), "ILS")}
            </div>
          )}
          {hasWithholding && (
            <div className="doc-brow is-deduct">
              <span>
                ניכוי מס במקור
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
            <div className="doc-paid-top">שולם בפועל</div>
            <div className="doc-paid-amount doc-serif doc-tab">
              {money(total - (withholdingAmount as number))}
            </div>
            <div className="doc-paid-note">
              הסכום נטו שהתקבל, אחרי ניכוי מס במקור
            </div>
          </div>
        )}
      </div>

      {/* ── Payment method · bank details · notes ── */}
      {(paymentMethod || showBank || notes) && (
        <div className="doc-infos">
          {paymentMethod && (
            <div className="doc-card doc-info">
              <div className="doc-glabel">אמצעי תשלום</div>
              <div className="doc-info-body">
                {PAYMENT_METHOD_LABELS[paymentMethod]}
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
              <div className="doc-glabel">פרטי תשלום</div>
              <div className="doc-info-body">
                {bankLine && (
                  <>
                    העברה בנקאית
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
            <div className="doc-card doc-info">
              <div className="doc-glabel">הערות</div>
              <div className="doc-info-body">{notes}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Footer: electronic-issuance statement + brand mark ── */}
      <div className="doc-foot">
        <div className="doc-foot-sig">
          מסמך זה הופק אלקטרונית{business.name ? ` · ${business.name}` : ""}
        </div>
        <div className="doc-foot-brand">
          הופק באמצעות MySuperFriendlyInvoiceApp · mysuperfriendlyinvoiceapp.vercel.app
        </div>
      </div>
    </>
  );
}
