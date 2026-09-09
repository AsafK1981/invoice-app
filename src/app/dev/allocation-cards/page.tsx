"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { AllocationNumberSection } from "@/components/allocation-number-section";
import { AllocationNextStepCard } from "@/components/allocation-next-step-card";
import type { InvoiceDocument } from "@/lib/types";

/**
 * DEV-ONLY preview of the two מספר הקצאה "next step" cards (the editor's
 * step 1 and the document page's step 2), so a change to how they point at
 * their button can be screenshotted at desktop + mobile without staging a
 * real over-threshold B2B tax invoice. 404s in production.
 */
const DOC: InvoiceDocument = {
  id: "00000000-0000-0000-0000-000000000000",
  type: "tax_invoice",
  number: 1042,
  date: "2026-09-09",
  clientId: "c1",
  clientName: "חברת דוגמה בע\"מ",
  clientTaxId: "514567890",
  status: "sent",
  items: [],
  subtotal: 12000,
  vat: 2160,
  total: 14160,
};

export default function AllocationCardsPreview() {
  const [num, setNum] = useState("");
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen p-6 space-y-10" dir="rtl">
      <div>
        <p className="mb-2 text-xs font-bold text-stone-500">
          עמוד המסמך - שלב 2 (עמודת תוכן מלאה)
        </p>
        <div className="max-w-[1100px]">
          <AllocationNumberSection doc={DOC} customerTaxId="514567890" />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold text-stone-500">העורך - שלב 1 (עמודת טופס)</p>
        <div className="max-w-[440px]">
          <AllocationNextStepCard
            allocationNumber={num}
            onAllocationNumberChange={setNum}
            connected
            onSave={() => {}}
            saveLabel="שמור והמשך לקבלת מספר הקצאה"
            saveDisabled={false}
            saveBusy={false}
            blockReason={null}
          />
        </div>
      </div>
    </div>
  );
}
