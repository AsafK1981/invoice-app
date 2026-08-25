"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId } from "./business-init";
import { sanitizeReminderDays } from "./reminder-schedule";
import { normalizeDocumentDesign } from "./document-themes";
import type { Business } from "./types";

const CHANGE_EVENT = "invoice-app:business-changed";

const defaultBusiness: Business = {
  id: "",
  name: "",
  businessType: "exempt",
  taxId: "",
  address: "",
};

export function useBusiness() {
  const [business, setBusiness] = useState<Business>(defaultBusiness);
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const bid = getBusinessId();
    let query = supabase.from("businesses").select("*");
    if (bid) query = query.eq("id", bid);
    const { data } = await query.limit(1).maybeSingle();

    setBusiness(
      data
        ? {
            id: data.id,
            name: data.name,
            businessType: data.business_type,
            taxId: data.tax_id,
            address: data.address,
            phone: data.phone ?? undefined,
            email: data.email ?? undefined,
            logoUrl: data.logo_url ?? undefined,
            bankName: data.bank_name ?? undefined,
            bankBranch: data.bank_branch ?? undefined,
            bankAccount: data.bank_account ?? undefined,
            paymentNotes: data.payment_notes ?? undefined,
            defaultDocNotes: data.default_doc_notes ?? undefined,
            dunningEnabled: data.dunning_enabled ?? false,
            dunningFromName: data.dunning_from_name ?? undefined,
            monthlyReminderEnabled: data.monthly_reminder_enabled ?? false,
            monthlyReminderDays: Array.isArray(data.monthly_reminder_days)
              ? data.monthly_reminder_days
              : [1],
            monthlyReminderHour: data.monthly_reminder_hour ?? 9,
            monthlyReminderChannels: Array.isArray(data.monthly_reminder_channels)
              ? data.monthly_reminder_channels
              : ["email", "inapp"],
            monthlyReminderLastSent: data.monthly_reminder_last_sent ?? undefined,
            roundTotalDefault: data.round_total_default ?? false,
            documentDesign: data.document_design ?? null,
          }
        : defaultBusiness
    );
    setReady(true);
  }, []);

  useEffect(() => {
    fetch();
    const handler = () => fetch();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [fetch]);

  return { business, ready, refetch: fetch };
}

export async function saveBusiness(business: Business): Promise<void> {
  const { data, error } = await supabase
    .from("businesses")
    .update({
      name: business.name,
      business_type: business.businessType,
      tax_id: business.taxId,
      address: business.address,
      phone: business.phone || null,
      email: business.email || null,
      logo_url: business.logoUrl || null,
      bank_name: business.bankName || null,
      bank_branch: business.bankBranch || null,
      bank_account: business.bankAccount || null,
      payment_notes: business.paymentNotes || null,
      default_doc_notes: business.defaultDocNotes || null,
      dunning_enabled: business.dunningEnabled ?? false,
      dunning_from_name: business.dunningFromName || null,
      monthly_reminder_enabled: business.monthlyReminderEnabled ?? false,
      monthly_reminder_days:
        sanitizeReminderDays(business.monthlyReminderDays).length > 0
          ? sanitizeReminderDays(business.monthlyReminderDays)
          : [1],
      monthly_reminder_hour: business.monthlyReminderHour ?? 9,
      monthly_reminder_channels:
        business.monthlyReminderChannels && business.monthlyReminderChannels.length > 0
          ? business.monthlyReminderChannels
          : ["email", "inapp"],
      round_total_default: business.roundTotalDefault ?? false,
      // Defense in depth: this is the client's own write path, but the raw
      // in-memory value could in principle be anything (a bug elsewhere, a
      // stale object). Never write anything to the DB that hasn't been
      // through the same normalizeDocumentDesign() validation that every
      // READ path also applies. `null` (no design chosen) round-trips as
      // `null`, not as `{template:"general",...}` - see the doc comment on
      // normalizeDocumentDesign for why that distinction matters.
      document_design: normalizeDocumentDesign(business.documentDesign),
    })
    .eq("id", business.id)
    .select();

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(
      "השמירה לא בוצעה - ייתכן שאין לך הרשאה לעדכן את העסק הזה. רענן את הדף ונסה שוב."
    );
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
