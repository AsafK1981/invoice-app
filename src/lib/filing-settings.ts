// Filing calendar settings: the shape, the defaults and the row mapping.
// Neutral module (no "use client", no Supabase client) so the browser store
// (filing-preferences-store.ts) and the reminder cron share one definition.

import { DEFAULT_FILING_PREFERENCES, type Cadence, type FilingPreferences } from "./ita/filing-calendar";

export interface FilingSettings extends FilingPreferences {
  remindersEnabled: boolean;
  reminderDaysBefore: number;
}

export const DEFAULT_FILING_SETTINGS: FilingSettings = {
  ...DEFAULT_FILING_PREFERENCES,
  remindersEnabled: true,
  reminderDaysBefore: 3,
};

export interface FilingState {
  settings: FilingSettings;
  /** Deadline key -> ISO time the owner marked it filed. */
  filed: Record<string, string>;
}

const cadence = (v: unknown): Cadence => (v === "monthly" ? "monthly" : "bimonthly");
export const stringMap = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string") out[k] = val;
  return out;
};

export function mapFilingRow(row: Record<string, unknown> | null): FilingState {
  if (!row) return { settings: DEFAULT_FILING_SETTINGS, filed: {} };
  const days = Number(row.reminder_days_before);
  return {
    settings: {
      vatCadence: cadence(row.vat_cadence),
      advanceCadence: cadence(row.advance_cadence),
      detailedReporter: row.detailed_reporter === true,
      hasEmployees: row.has_employees === true,
      remindersEnabled: row.reminders_enabled !== false,
      reminderDaysBefore: Number.isInteger(days) && days >= 1 && days <= 14 ? days : 3,
    },
    filed: stringMap(row.filed),
  };
}
