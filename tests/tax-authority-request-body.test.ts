import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requestAllocation, type AllocationRequest } from "@/lib/tax-authority";

/**
 * The ITA v2 Approval request body had no test at all, which is how
 * `user_id = vatNumber` survived as a silent default. It is right by
 * coincidence for an עוסק מורשה, whose עוסק number IS their ת.ז, and wrong
 * for a חברה, where it sends a ח.פ. where the spec wants the ID of the human
 * performing the allocation.
 *
 * The first test is the one that matters most: five real allocations have
 * succeeded on the sole-trader path, and nothing here may move it.
 */

const BASE: AllocationRequest = {
  invoiceId: "doc-1",
  invoiceType: 320,
  vatNumber: "003244266", // the real working עוסק מורשה: a person's ת.ז
  invoiceReferenceNumber: "102",
  customerVatNumber: "514993666",
  invoiceDate: "2026-08-30",
  issuanceDate: "2026-08-30",
  amountBeforeDiscount: 13875,
  discount: 0,
  paymentAmount: 13875,
  vatAmount: 2497.5,
  paymentAmountIncludingVat: 16372.5,
};

let fetchMock: ReturnType<typeof vi.fn>;

function sentBody() {
  return JSON.parse(String(fetchMock.mock.calls[0][1].body));
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    // The gateway only counts as success when it says `approved: true` AND
    // returns a non-zero confirmation number; see requestAllocation.
    json: async () => ({ approved: true, confirmation_number: "123456789243064387", status: 200 }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ITA v2 Approval body", () => {
  it("sole trader with no operator id keeps sending the issuer number, unchanged", async () => {
    await requestAllocation("tok", BASE);

    const body = sentBody();
    expect(body.vat_number).toBe(3244266);
    // The fallback that makes the ONE working flow work. Removing it returns
    // code 446 ("Requeried one of the two fields: user ID or user name").
    expect(body.user_id).toBe(3244266);
  });

  it("a company's operator ת.ז overrides user_id and leaves vat_number alone", async () => {
    await requestAllocation("tok", {
      ...BASE,
      vatNumber: "515827020", // a ח.פ., not a person
      userId: "049040686", // the human who performs the allocation
    });

    const body = sentBody();
    expect(body.vat_number).toBe(515827020); // still the company
    expect(body.user_id).toBe(49040686); // now a person
    expect(body.user_id).not.toBe(body.vat_number);
  });

  it("both numbers go as numbers, not strings", async () => {
    // The published example shows strings; the production swagger rejects
    // them with a type error.
    await requestAllocation("tok", { ...BASE, userId: "049040686" });
    const body = sentBody();
    expect(typeof body.vat_number).toBe("number");
    expect(typeof body.user_id).toBe("number");
    expect(typeof body.customer_vat_number).toBe("number");
  });

  it("posts to the v2 Approval endpoint", async () => {
    await requestAllocation("tok", BASE);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/Invoices/v2/Approval");
  });

  it("returns the 9 right-most digits of the confirmation number", async () => {
    const res = await requestAllocation("tok", BASE);
    expect(res.allocationNumber).toBe("243064387");
  });

  it("a rejection returns a Hebrew reason and never the raw upstream text", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: {
          errors: [
            { code: 448, param: "vat_number", message: "Vat number is not allowed to issue an invoice" },
          ],
        },
      }),
    });

    const res = await requestAllocation("tok", BASE);
    expect(res.allocationNumber).toBeNull();
    expect(res.resultCode).toBe("448");
    expect(res.resultMessage).toContain("אינו רשאי להפיק חשבוניות");
    expect(res.resultMessage).not.toContain("Vat number is not allowed");
  });
});
