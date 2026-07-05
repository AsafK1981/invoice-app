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

export function ReceiptView({ business, client, document: doc }: Props) {
  const vatRate =
    doc.subtotal !== 0 ? Math.round((doc.vat / doc.subtotal) * 100) : 0;
  const bodyClient = toBodyClient(client, doc.clientName);

  return (
    <div className="receipt-view mx-auto max-w-[210mm] bg-white p-6 sm:p-12 shadow-lg print:shadow-none print:p-8">
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
        paymentMethod={doc.paymentMethod}
        notes={doc.notes}
        allocationNumber={doc.allocationNumber}
        currency={doc.currency}
        exchangeRate={doc.exchangeRate}
        totalIls={doc.totalIls}
        zeroRated={doc.zeroRated}
      />
    </div>
  );
}
