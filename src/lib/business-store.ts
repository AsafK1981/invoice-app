"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId } from "./business-init";
import { SESSION_LOST_MESSAGE, isSessionLost } from "./session-guard";
import { sanitizeReminderDays } from "./reminder-schedule";
import { normalizeDocumentDesign } from "./document-themes";
import type { Business } from "./types";
import { NOTIFICATION_KIND_LABELS, type NotificationKind } from "./notifications";

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
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    const bid = getBusinessId();
    let query = supabase.from("businesses").select("*");
    if (bid) query = query.eq("id", bid);
    const { data, error: readError } = await query.limit(1).maybeSingle();

    // A refused read is not an empty business. This used to drop the error
    // and fall back to defaultBusiness - whose id is "" - while still
    // reporting ready, so the onboarding form would happily enable "המשך"
    // and then save against an id that matches no row. Keep whatever we had
    // and say so instead.
    if (readError) {
      setError(isSessionLost(readError) ? SESSION_LOST_MESSAGE : readError.message);
      setReady(true);
      return;
    }
    setError(null);

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
            taxOfficerNoticeSentAt: data.tax_officer_notice_sent_at ?? undefined,
            // Opt-out, not opt-in: the assisted pass only notifies the owner,
            // so anything but an explicit false is "on".
            dunningWhatsappEnabled: data.dunning_whatsapp_enabled !== false,
            monthlyReminderEnabled: data.monthly_reminder_enabled ?? false,
            monthlyReminderDays: Array.isArray(data.monthly_reminder_days)
              ? data.monthly_reminder_days
              : [1],
            monthlyReminderHour: data.monthly_reminder_hour ?? 9,
            monthlyReminderChannels: Array.isArray(data.monthly_reminder_channels)
              ? data.monthly_reminder_channels
              : ["email", "inapp"],
            monthlyReminderLastSent: data.monthly_reminder_last_sent ?? undefined,
            // Opt-out, not opt-in: anything but an explicit false is "on".
            recurringSuggestionsEnabled: data.recurring_suggestions_enabled !== false,
            roundTotalDefault: data.round_total_default ?? false,
            incomeTaxAdvanceRate:
              data.income_tax_advance_rate == null ? undefined : Number(data.income_tax_advance_rate),
            textSize: data.text_size === "large" ? "large" : "normal",
            documentDesign: data.document_design ?? null,
            inboxToken: data.inbox_token ?? undefined,
            inboxEnabled: data.inbox_enabled ?? false,
            pushKinds: Array.isArray(data.push_kinds)
              ? (data.push_kinds as NotificationKind[])
              : [],
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

  return { business, ready, error, refetch: fetch };
}

/**
 * Persist only אחוז המקדמה. Its own small UPDATE (not saveBusiness) for the
 * same reason text-size.ts does it: the מקדמות report edits one number, and
 * a whole-row write from its snapshot could revert a logo / design / reminder
 * setting saved elsewhere in the meantime. Broadcasts the change so every
 * useBusiness() consumer refetches.
 */
export async function saveIncomeTaxAdvanceRate(
  businessId: string,
  rate: number | undefined,
): Promise<void> {
  const value = rate != null && Number.isFinite(rate) ? rate : null;
  const { error } = await supabase
    .from("businesses")
    .update({ income_tax_advance_rate: value })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Persist only the web-push opt-in list, for the same reason
 * saveIncomeTaxAdvanceRate has its own UPDATE: the התרעות בדפדפן card flips
 * one switch, and a whole-row write from its snapshot could revert a logo /
 * design / reminder setting saved elsewhere in the meantime.
 *
 * Unknown values are dropped rather than stored: this list is read by the
 * sender on every notification, and it should only ever contain kinds the app
 * actually produces.
 */
export async function savePushKinds(
  businessId: string,
  kinds: NotificationKind[],
): Promise<void> {
  const clean = Array.from(new Set(kinds)).filter((k) => k in NOTIFICATION_KIND_LABELS);
  const { error } = await supabase
    .from("businesses")
    .update({ push_kinds: clean })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Persist only the assisted-WhatsApp switch, for the same reason
 * savePushKinds has its own UPDATE: the reminders card flips one boolean,
 * and a whole-row write from its snapshot could revert a logo / design /
 * reminder setting saved elsewhere in the meantime.
 */
export async function saveDunningWhatsappEnabled(
  businessId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({ dunning_whatsapp_enabled: enabled })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * הוראות ניהול ספרים 18ב(ב): the owner confirms (or un-confirms) that the
 * registered-mail notice to פקיד השומה was sent. Owned by this setter and
 * deliberately absent from saveBusiness() below, for the same reason as
 * dunning_whatsapp_enabled: a whole-row settings save made from a stale
 * snapshot must not silently clear a confirmation given in another tab.
 */
export async function saveTaxOfficerNoticeSentAt(
  businessId: string,
  sentAt: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({ tax_officer_notice_sent_at: sentAt })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Persist only the business number, from the VAT report's inline fix. Its own
 * UPDATE for the same reason as saveIncomeTaxAdvanceRate: a whole-row
 * saveBusiness() from this screen's snapshot could revert a setting saved in
 * another tab. A zero-row result means RLS refused, so it throws.
 */
export async function saveBusinessTaxId(businessId: string, taxId: string): Promise<void> {
  const { data, error } = await supabase
    .from("businesses")
    .update({ tax_id: taxId.trim() })
    .eq("id", businessId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("השמירה לא בוצעה. רענן את הדף ונסה שוב.");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * One scoped UPDATE for a settings surface: writes only `patch`, throws on an
 * error, and treats a zero-row result as a refusal (RLS), since supabase-js
 * reports "updated nothing" as success.
 */
async function updateBusinessColumns(
  businessId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase
    .from("businesses")
    .update(patch)
    .eq("id", businessId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("השמירה לא בוצעה. רענן את הדף ונסה שוב.");
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Persist only the business logo (business details modal, design page brand import). */
export async function saveBusinessLogo(
  businessId: string,
  logoUrl: string | undefined,
): Promise<void> {
  await updateBusinessColumns(businessId, { logo_url: logoUrl || null });
}

/**
 * Persist only the document design. Never writes anything that has not been
 * through the same normalizeDocumentDesign() validation every READ path
 * applies. `null` (no design chosen) round-trips as `null`, not as
 * `{template:"general",...}` - see normalizeDocumentDesign for why.
 */
export async function saveDocumentDesign(
  businessId: string,
  design: Business["documentDesign"],
): Promise<void> {
  await updateBusinessColumns(businessId, { document_design: normalizeDocumentDesign(design) });
}

/** Persist only the automatic client payment-reminder settings (email pass). */
export async function saveDunningSettings(
  businessId: string,
  settings: { enabled: boolean; fromName?: string },
): Promise<void> {
  await updateBusinessColumns(businessId, {
    dunning_enabled: settings.enabled,
    dunning_from_name: settings.fromName?.trim() || null,
  });
}

/** Persist only the monthly reminder settings. `monthly_reminder_last_sent` is the cron's, never written here. */
export async function saveMonthlyReminderSettings(
  businessId: string,
  settings: { enabled: boolean; days: number[]; hour: number; channels: string[] },
): Promise<void> {
  const days = sanitizeReminderDays(settings.days);
  const hour = Number.isInteger(settings.hour) && settings.hour >= 0 && settings.hour <= 23 ? settings.hour : 9;
  await updateBusinessColumns(businessId, {
    monthly_reminder_enabled: settings.enabled,
    monthly_reminder_days: days.length > 0 ? days : [1],
    monthly_reminder_hour: hour,
    monthly_reminder_channels: settings.channels.length > 0 ? settings.channels : ["email", "inapp"],
  });
}

/** Persist only the recurring-document suggestions switch. */
export async function saveRecurringSuggestionsEnabled(
  businessId: string,
  enabled: boolean,
): Promise<void> {
  await updateBusinessColumns(businessId, { recurring_suggestions_enabled: enabled });
}

/**
 * Persist the business DETAILS form: identity, contact, bank and document
 * defaults. Nothing else.
 *
 * Every other businesses column is owned by its own settings surface and
 * written by its own scoped setter above (logo, design, payment reminders,
 * monthly reminder, recurring suggestions, WhatsApp reminders, push kinds,
 * advance rate, tax-officer notice), or by /api/email-inbox (inbox_token,
 * inbox_enabled). This UPDATE writes the snapshot the form was opened with,
 * so any column included here could be silently reverted by a details save
 * from an old tab - which is exactly how saving business details used to
 * turn client payment reminders back on.
 */
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
      bank_name: business.bankName || null,
      bank_branch: business.bankBranch || null,
      bank_account: business.bankAccount || null,
      payment_notes: business.paymentNotes || null,
      default_doc_notes: business.defaultDocNotes || null,
      round_total_default: business.roundTotalDefault ?? false,
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
