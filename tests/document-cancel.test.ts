import { describe, it, expect } from "vitest";
import { cancellationRoute, hasLeftPossession } from "@/lib/document-cancel";
import type { DocumentType } from "@/lib/types";

const base = { type: "tax_invoice" as DocumentType, status: "sent" as const };

describe("cancellationRoute (הוראות ניהול ספרים 23א)", () => {
  it("a draft is deleted, not reversed", () => {
    expect(cancellationRoute({ ...base, status: "draft" }, { vatRegistered: true })).toEqual({ kind: "delete" });
    expect(cancellationRoute({ ...base, status: "draft", emailedAt: "2026-09-01" }, { vatRegistered: true })).toEqual({
      kind: "delete",
    });
  });

  it("an already cancelled document offers nothing", () => {
    expect(cancellationRoute({ ...base, status: "cancelled" }, { vatRegistered: true })).toEqual({ kind: "none" });
  });

  it("23א(1): an undelivered document is cancelled by marking it מבוטל", () => {
    expect(cancellationRoute(base, { vatRegistered: true })).toEqual({ kind: "cancel", delivered: false });
    expect(cancellationRoute(base, { vatRegistered: false })).toEqual({ kind: "cancel", delivered: false });
  });

  it("23א(2): a delivered VAT-bearing document routes to a credit note, never a silent cancel", () => {
    for (const type of ["tax_invoice", "tax_invoice_receipt"] as DocumentType[]) {
      expect(cancellationRoute({ ...base, type, emailedAt: "2026-09-01T00:00:00Z" }, { vatRegistered: true })).toEqual({
        kind: "credit_note",
      });
      // A PDF the customer downloaded counts as leaving the taxpayer's hands
      // just as much as an email does.
      expect(
        cancellationRoute({ ...base, type, originalIssuedAt: "2026-09-01T00:00:00Z" }, { vatRegistered: true }),
      ).toEqual({ kind: "credit_note" });
    }
  });

  it("עוסק פטור has no credit note, so a delivered document is still cancelled", () => {
    expect(
      cancellationRoute({ ...base, emailedAt: "2026-09-01T00:00:00Z" }, { vatRegistered: false }),
    ).toEqual({ kind: "cancel", delivered: true });
  });

  it("documents that carry no VAT are cancelled even after delivery", () => {
    for (const type of ["quote", "proforma", "receipt", "credit_note"] as DocumentType[]) {
      expect(cancellationRoute({ ...base, type, emailedAt: "2026-09-01T00:00:00Z" }, { vatRegistered: true })).toEqual({
        kind: "cancel",
        delivered: true,
      });
    }
  });

  it("hasLeftPossession reads either delivery signal", () => {
    expect(hasLeftPossession(base)).toBe(false);
    expect(hasLeftPossession({ ...base, emailedAt: "x" })).toBe(true);
    expect(hasLeftPossession({ ...base, originalIssuedAt: "x" })).toBe(true);
    expect(hasLeftPossession({ ...base, emailedAt: null, originalIssuedAt: null })).toBe(false);
  });
});
