"use client";

// Client store for the filing obligations calendar: the owner's preferences
// (cadences, detailed reporting, employees, reminders) and the deadlines they
// marked as filed. Backed by public.filing_preferences (one row per business,
// scripts/migrations/20260915-filing-preferences.sql). A missing row means the
// defaults; the first save creates it.
//
// Every write touches only the columns it owns, and a "filed" toggle re-reads
// the stored map before writing, so a second tab ticking a different deadline
// is merged instead of overwritten.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { mapFilingRow, stringMap, type FilingSettings, type FilingState } from "./filing-settings";

export { DEFAULT_FILING_SETTINGS, mapFilingRow, type FilingSettings, type FilingState } from "./filing-settings";

const CHANGE_EVENT = "invoice-app:filing-preferences-changed";

const COLUMNS = "business_id,vat_cadence,advance_cadence,detailed_reporter,has_employees,reminders_enabled,reminder_days_before,filed";

async function loadRow(businessId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("filing_preferences").select(COLUMNS).eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null) ?? null;
}

function toColumns(patch: Partial<FilingSettings>): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  if (patch.vatCadence) cols.vat_cadence = patch.vatCadence;
  if (patch.advanceCadence) cols.advance_cadence = patch.advanceCadence;
  if (patch.detailedReporter !== undefined) cols.detailed_reporter = patch.detailedReporter;
  if (patch.hasEmployees !== undefined) cols.has_employees = patch.hasEmployees;
  if (patch.remindersEnabled !== undefined) cols.reminders_enabled = patch.remindersEnabled;
  if (patch.reminderDaysBefore !== undefined) cols.reminder_days_before = patch.reminderDaysBefore;
  return cols;
}

/**
 * Write only the given settings columns. An upsert on business_id, so the
 * first save creates the row and a save racing another tab (or the reminder
 * cron's insert) updates instead of failing on the primary key.
 */
export async function saveFilingSettings(businessId: string, patch: Partial<FilingSettings>): Promise<void> {
  const cols = toColumns(patch);
  if (Object.keys(cols).length === 0) return;
  const { error } = await supabase.from("filing_preferences").upsert({ business_id: businessId, ...cols }, { onConflict: "business_id" });
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Create the row with the defaults if the owner has none yet. Called when the
 * calendar opens: that visit is what turns on the (clearly shown, switchable)
 * deadline reminders. Never overwrites an existing row.
 */
export async function ensureFilingRow(businessId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("filing_preferences")
    .upsert({ business_id: businessId }, { onConflict: "business_id", ignoreDuplicates: true })
    .select("business_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Mark or unmark one deadline as filed, merged into the stored map. */
export async function setDeadlineFiled(businessId: string, key: string, filed: boolean): Promise<void> {
  const existing = await loadRow(businessId);
  const map = stringMap(existing?.filed);
  if (filed) map[key] = new Date().toISOString();
  else delete map[key];
  const { error } = existing
    ? await supabase.from("filing_preferences").update({ filed: map }).eq("business_id", businessId)
    : await supabase.from("filing_preferences").upsert({ business_id: businessId, filed: map }, { onConflict: "business_id" });
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The business's filing settings and filed marks, refreshed after any save on the page. */
export function useFilingPreferences(businessId: string) {
  const [state, setState] = useState<FilingState | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    loadRow(businessId)
      .then((row) => {
        if (!active) return;
        setState(mapFilingRow(row));
        setError("");
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "טעינת ההגדרות נכשלה.");
      });
    return () => {
      active = false;
    };
  }, [businessId, version]);

  useEffect(() => {
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => window.removeEventListener(CHANGE_EVENT, refresh);
  }, [refresh]);

  return { state, error, refresh };
}
