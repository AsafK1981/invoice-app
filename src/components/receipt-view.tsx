"use client";

import {
  type Business,
  type Client,
  type InvoiceDocument,
} from "@/lib/types";
import { DocumentBody, type DocumentBodyClient } from "./document-body";

interface Props {
  business: Business;
  client: Client | null;
  document: InvoiceDocument;
  // מקור/העתק is decided by the caller, not here. הוראות ניהול ספרים 18ב says the
  // customer must always receive the מקור, while the owner's retained/reprinted
  // copy is an העתק once the doc has been issued. Only the owner-facing pages
  // pass copy=true; the public customer view defaults to false (מקור).
  copy?: boolean;
  /** Footer "הופק באמצעות" credit. Defaults to true; suppressed for paying
   * subscribers. Threaded straight through to DocumentBody. */
  showBranding?: boolean;
}

function toBodyClient(client: Client | null, fallbackName: string): DocumentBodyClient | null {
  if (client) {
    return {
      name: client.name,
      taxId: client.taxId,
      address: client.address,
      phone: client.phone,
      email: client.email,
    };
  }
  if (fallbackName) {
    return { name: fallbackName };
  }
  return null;
}

export function ReceiptView({
  business,
  client,
  document: doc,
  copy = false,
  showBranding = true,
}: Props) {
  const vatRate =
    doc.subtotal !== 0 ? Math.round((doc.vat / doc.subtotal) * 100) : 0;
  const bodyClient = toBodyClient(client, doc.clientName);

  return (
    <div className="receipt-view doc-paper is-fluid mx-auto max-w-[210mm] shadow-lg print:shadow-none">
      <DocumentBody
        business={business}
        client={bodyClient}
        documentType={doc.type}
        number={doc.number}
        date={doc.date}
        subject={doc.subject}
        items={doc.items}
        subtotal={doc.subtotal}
        vat={doc.vat}
        vatRate={vatRate}
        total={doc.total}
        rounding={doc.rounding}
        paymentMethod={doc.paymentMethod}
        paymentDetails={doc.paymentDetails}
        discount={doc.discountAmount}
        withholdingRate={doc.withholdingRate}
        withholdingAmount={doc.withholdingAmount}
        notes={doc.notes}
        allocationNumber={doc.allocationNumber}
        currency={doc.currency}
        exchangeRate={doc.exchangeRate}
        totalIls={doc.totalIls}
        zeroRated={doc.zeroRated}
        copy={copy}
        showBranding={showBranding}
      />
    </div>
  );
}
