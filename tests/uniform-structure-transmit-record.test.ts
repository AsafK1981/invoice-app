import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What the recording layer must guarantee, none of which can be checked
 * against שע"ם yet:
 *
 *   - a business that never connected gov.il produces no row at all, because
 *     nothing was attempted;
 *   - a row exists BEFORE the upload starts, so a transmission that dies
 *     halfway is visible rather than lost;
 *   - the per-file identifiers are stored, since they are the only way to ask
 *     for the verdict later;
 *   - a failure records our own message, never a raw upstream body.
 */

const transmitUniformStructure = vi.fn();
const getFileStatus = vi.fn();
const getValidAccessToken = vi.fn();

vi.mock("@/lib/uniform-structure/transmit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/uniform-structure/transmit")>(
    "@/lib/uniform-structure/transmit",
  );
  return {
    ...actual, // keep the real formatPeriod: the date handling is part of what we assert
    transmitUniformStructure: (...a: unknown[]) => transmitUniformStructure(...a),
    getFileStatus: (...a: unknown[]) => getFileStatus(...a),
  };
});

vi.mock("@/lib/tax-authority-token", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-authority-token")>(
    "@/lib/tax-authority-token",
  );
  return {
    ...actual,
    getValidAccessToken: (...a: unknown[]) => getValidAccessToken(...a),
  };
});

const { transmitAndRecord, refreshTransmissionStatus } = await import(
  "@/lib/uniform-structure/transmit-record"
);

/** Minimal stand-in for the two supabase chains this module uses. */
function fakeSb(seedRow: Record<string, unknown> | null = null) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const sb = {
    inserts,
    updates,
    from() {
      return {
        insert(values: Record<string, unknown>) {
          inserts.push(values);
          return { select: () => ({ single: async () => ({ data: { id: "t-1" } }) }) };
        },
        update(values: Record<string, unknown>) {
          updates.push(values);
          return { eq: async () => ({ data: null }) };
        },
        select() {
          return {
            eq: () => ({ maybeSingle: async () => ({ data: seedRow }) }),
          };
        },
      };
    },
  };
  return sb as unknown as Parameters<typeof transmitAndRecord>[0]["sb"] & {
    inserts: Record<string, unknown>[];
    updates: Record<string, unknown>[];
  };
}

const baseArgs = {
  businessId: "b-1",
  caseNumber: "049040686",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  ini: new Uint8Array([1, 2, 3]),
  bkmvdata: new Uint8Array([4, 5, 6]),
};

beforeEach(() => {
  transmitUniformStructure.mockReset();
  getFileStatus.mockReset();
  getValidAccessToken.mockReset();
});

describe("transmitAndRecord", () => {
  it("writes nothing when the business never connected gov.il", async () => {
    getValidAccessToken.mockResolvedValue({ ok: false, reason: "not_connected" });
    const sb = fakeSb();

    const out = await transmitAndRecord({ sb, ...baseArgs });

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("not_connected");
    expect(sb.inserts).toHaveLength(0);
    expect(transmitUniformStructure).not.toHaveBeenCalled();
  });

  it("records the attempt before uploading and stores the file identifiers after", async () => {
    getValidAccessToken.mockResolvedValue({
      ok: true,
      accessToken: "tok",
      environment: "sandbox",
    });
    transmitUniformStructure.mockResolvedValue({
      uniqueId: "u-99",
      files: [
        { fileName: "INI.txt", fileUniqueId: "f-ini" },
        { fileName: "BKMVDATA.txt", fileUniqueId: "f-bkm" },
      ],
    });
    const sb = fakeSb();

    const out = await transmitAndRecord({ sb, ...baseArgs });

    expect(out).toEqual({ ok: true, transmissionId: "t-1", uniqueId: "u-99" });

    // The row goes in first, as 'pending', carrying the period as sent.
    expect(sb.inserts[0]).toMatchObject({
      business_id: "b-1",
      status: "pending",
      environment: "sandbox",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
    });

    expect(sb.updates[0]).toMatchObject({
      status: "sent",
      unique_id: "u-99",
      ini_file_unique_id: "f-ini",
      bkm_file_unique_id: "f-bkm",
    });
  });

  it("marks the row failed and keeps the upstream body out of the database", async () => {
    getValidAccessToken.mockResolvedValue({ ok: true, accessToken: "tok", environment: "sandbox" });
    transmitUniformStructure.mockRejectedValue(new Error("final chunk rejected: 400"));
    const sb = fakeSb();

    const out = await transmitAndRecord({ sb, ...baseArgs });

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("transmit_failed");
    expect(sb.updates[0]).toMatchObject({ status: "failed" });
    expect(String(sb.updates[0].error)).toContain("final chunk rejected");
  });
});

describe("refreshTransmissionStatus", () => {
  it("stores a verdict per file and surfaces the rejection reason", async () => {
    getValidAccessToken.mockResolvedValue({ ok: true, accessToken: "tok", environment: "sandbox" });
    getFileStatus.mockResolvedValue([
      { fileUniqueId: "f-ini", isFound: true, status: "Approved" },
      { fileUniqueId: "f-bkm", isFound: true, status: "Rejected", description: "רשומה C100 שגויה" },
    ]);
    const sb = fakeSb({
      business_id: "b-1",
      ini_file_name: "INI.txt",
      ini_file_unique_id: "f-ini",
      bkm_file_name: "BKMVDATA.txt",
      bkm_file_unique_id: "f-bkm",
    });

    await refreshTransmissionStatus(sb, "t-1");

    expect(sb.updates[0]).toMatchObject({
      ini_status: "Approved",
      bkm_status: "Rejected",
      rejection_reason: "רשומה C100 שגויה",
    });
  });

  it("does nothing for a row that never got identifiers", async () => {
    const sb = fakeSb({ business_id: "b-1" });
    await refreshTransmissionStatus(sb, "t-1");
    expect(getFileStatus).not.toHaveBeenCalled();
    expect(sb.updates).toHaveLength(0);
  });
});
