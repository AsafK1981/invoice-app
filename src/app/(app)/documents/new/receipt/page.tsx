"use client";

import Link from "next/link";
import { ArrowRight, ReceiptText } from "lucide-react";
import { ReceiptEditor } from "@/components/receipt-editor";
import { useClients } from "@/lib/client-store";
import { useProducts } from "@/lib/product-store";
import { useBusiness } from "@/lib/business-store";

export default function NewReceiptPage() {
  const { business } = useBusiness();
  const { items: clients } = useClients();
  const { items: products } = useProducts();

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
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-sm">
            <ReceiptText className="w-5 h-5 text-white" />
          </span>
          קבלה חדשה
        </h1>
      </div>

      <ReceiptEditor
        business={business}
        clients={clients}
        products={products}
      />
    </div>
  );
}
