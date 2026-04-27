"use client";

import Link from "next/link";
import { ArrowRight, FileCheck, AlertCircle } from "lucide-react";
import { ReceiptEditor } from "@/components/receipt-editor";
import { useClients } from "@/lib/client-store";
import { useProducts } from "@/lib/product-store";
import { useBusiness } from "@/lib/business-store";
import { canIssueTaxInvoices } from "@/lib/vat";

export default function NewTaxInvoicePage() {
  const { business } = useBusiness();
  const { items: clients } = useClients();
  const { items: products } = useProducts();

  if (!canIssueTaxInvoices(business)) {
    return (
      <div className="card-soft p-12 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6 text-amber-600" />
        </div>
        <h2 className="font-bold text-stone-900 mb-2">חשבונית מס זמינה רק לעוסק מורשה</h2>
        <p className="text-sm text-stone-700 mb-5">
          שנה את סוג העוסק להגדרות לעוסק מורשה כדי להפיק חשבוניות מס
        </p>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-md"
        >
          לעמוד ההגדרות
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/documents/new"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לבחירת סוג מסמך
        </Link>
        <h1 className="text-3xl font-bold text-stone-900 mt-3 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-sm">
            <FileCheck className="w-5 h-5 text-white" />
          </span>
          חשבונית מס חדשה
        </h1>
      </div>

      <ReceiptEditor
        business={business}
        clients={clients}
        products={products}
        documentType="tax_invoice"
      />
    </div>
  );
}
