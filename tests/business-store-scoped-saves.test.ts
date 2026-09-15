import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
  calls: [] as { table: string; update?: Record<string, unknown>; eq?: [string, string] }[],
  rows: 1,
  error: null as null | { message: string },
}));
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "business", onBusinessReady: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const call: (typeof state.calls)[number] = { table };
      state.calls.push(call);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        update(row: Record<string, unknown>) { call.update = row; return q; },
        eq(column: string, value: string) { call.eq = [column, value]; return q; },
        select: () => q,
        then(resolve: (v: unknown) => void) {
          return Promise.resolve(resolve({
            data: state.error ? null : Array.from({ length: state.rows }, () => ({ id: "b1" })),
            error: state.error,
          }));
        },
      };
      return q;
    },
  },
}));

import {
  saveBusiness,
  saveBusinessLogo,
  saveDocumentDesign,
  saveDunningSettings,
  saveMonthlyReminderSettings,
  saveRecurringSuggestionsEnabled,
} from "@/lib/business-store";
import type { Business } from "@/lib/types";

beforeEach(() => {
  state.calls = [];
  state.rows = 1;
  state.error = null;
  window.dispatchEvent = vi.fn();
});

const staleSnapshot: Business = {
  id: "b1",
  name: "העסק",
  businessType: "exempt",
  taxId: "123456782",
  address: "רחוב 1",
  logoUrl: "https://example.test/old-logo.png",
  dunningEnabled: true,
  dunningFromName: "ישן",
  monthlyReminderEnabled: true,
  monthlyReminderDays: [1],
  monthlyReminderHour: 9,
  monthlyReminderChannels: ["email"],
  recurringSuggestionsEnabled: true,
  incomeTaxAdvanceRate: 5,
  documentDesign: null,
};

describe("saveBusiness writes only the business-details columns", () => {
  it("never writes settings owned by other surfaces, even from a stale snapshot", async () => {
    await saveBusiness(staleSnapshot);
    const written = Object.keys(state.calls[0].update!).sort();
    expect(written).toEqual([
      "address",
      "bank_account",
      "bank_branch",
      "bank_name",
      "business_type",
      "default_doc_notes",
      "email",
      "name",
      "payment_notes",
      "phone",
      "round_total_default",
      "tax_id",
    ]);
  });
});

describe("column-scoped settings saves", () => {
  it("payment reminders write only their two columns", async () => {
    await saveDunningSettings("b1", { enabled: false, fromName: "  " });
    expect(state.calls[0]).toMatchObject({ table: "businesses", eq: ["id", "b1"] });
    expect(state.calls[0].update).toEqual({ dunning_enabled: false, dunning_from_name: null });
  });

  it("monthly reminder writes only its four columns, sanitized, and never last_sent", async () => {
    await saveMonthlyReminderSettings("b1", { enabled: true, days: [15, 1, 1, 40], hour: 25, channels: [] });
    expect(state.calls[0].update).toEqual({
      monthly_reminder_enabled: true,
      monthly_reminder_days: [1, 15],
      monthly_reminder_hour: 9,
      monthly_reminder_channels: ["email", "inapp"],
    });
  });

  it("design, logo and recurring suggestions each write a single column", async () => {
    await saveDocumentDesign("b1", null);
    await saveBusinessLogo("b1", undefined);
    await saveRecurringSuggestionsEnabled("b1", false);
    expect(state.calls.map((c) => c.update)).toEqual([
      { document_design: null },
      { logo_url: null },
      { recurring_suggestions_enabled: false },
    ]);
  });

  it("throws on an error or a refused (zero-row) update, and broadcasts only on success", async () => {
    state.error = { message: "denied" };
    await expect(saveDunningSettings("b1", { enabled: true })).rejects.toThrow("denied");
    state.error = null;
    state.rows = 0;
    await expect(saveRecurringSuggestionsEnabled("b1", true)).rejects.toThrow("השמירה לא בוצעה");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
    state.rows = 1;
    await saveRecurringSuggestionsEnabled("b1", true);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });
});

describe("every settings surface uses its own scoped save", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");
  const cases: [string, string][] = [
    ["src/components/dunning-settings-section.tsx", "saveDunningSettings("],
    ["src/components/monthly-reminder-settings-section.tsx", "saveMonthlyReminderSettings("],
    ["src/components/recurring-suggestions-settings-section.tsx", "saveRecurringSuggestionsEnabled("],
    ["src/components/document-design-section.tsx", "saveDocumentDesign("],
    ["src/components/document-design-section.tsx", "saveBusinessLogo("],
    ["src/components/business-form-modal.tsx", "saveBusinessLogo("],
    ["src/app/(app)/onboarding/page.tsx", "saveDocumentDesign("],
  ];
  it.each(cases)("%s calls %s", (file, call) => {
    expect(read(file)).toContain(call);
  });

  it("only the business details modal and onboarding call the whole-form saveBusiness", () => {
    for (const file of [
      "src/components/dunning-settings-section.tsx",
      "src/components/monthly-reminder-settings-section.tsx",
      "src/components/recurring-suggestions-settings-section.tsx",
      "src/components/document-design-section.tsx",
    ]) {
      expect(read(file)).not.toMatch(/saveBusiness\(/);
    }
  });
});
