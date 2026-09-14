import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { filingDataKey, isFilingDataRefreshing } from "@/lib/filing-report-data";
import { filingDownloadGate } from "@/lib/filing-fix-items";

describe("isFilingDataRefreshing", () => {
  it("is true in the same render as the version bump, before any effect runs", () => {
    const loaded = filingDataKey("b", true, 0);
    expect(isFilingDataRefreshing("b", filingDataKey("b", true, 0), loaded)).toBe(false);
    expect(isFilingDataRefreshing("b", filingDataKey("b", true, 1), loaded)).toBe(true);
  });

  it("is true while nothing has loaded yet and false without a business", () => {
    expect(isFilingDataRefreshing("b", filingDataKey("b", true, 0), null)).toBe(true);
    expect(isFilingDataRefreshing("", filingDataKey("", true, 0), null)).toBe(false);
  });

  it("treats a business or expenses switch as a refresh", () => {
    const loaded = filingDataKey("b", true, 3);
    expect(isFilingDataRefreshing("c", filingDataKey("c", true, 3), loaded)).toBe(true);
    expect(isFilingDataRefreshing("b", filingDataKey("b", false, 3), loaded)).toBe(true);
  });
});

describe("filingDownloadGate", () => {
  it("holds the download while an inline save is in flight or the data is refreshing", () => {
    expect(filingDownloadGate({ fileReady: true, refreshing: false, savesInFlight: 0 })).toBe("ready");
    expect(filingDownloadGate({ fileReady: true, refreshing: false, savesInFlight: 1 })).toBe("updating");
    expect(filingDownloadGate({ fileReady: true, refreshing: true, savesInFlight: 0 })).toBe("updating");
    expect(filingDownloadGate({ fileReady: false, refreshing: false, savesInFlight: 0 })).toBe("blocked");
    expect(filingDownloadGate({ fileReady: false, refreshing: true, savesInFlight: 0 })).toBe("updating");
  });
});
