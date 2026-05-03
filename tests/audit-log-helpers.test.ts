import { describe, it, expect } from "vitest";
import { formatAuditAction, type AuditAction } from "@/lib/audit-log";

describe("formatAuditAction", () => {
  it("returns Hebrew labels for every known action", () => {
    const actions: AuditAction[] = [
      "document.created",
      "document.status_changed",
      "document.deleted",
      "client.deleted",
      "product.deleted",
      "expense.deleted",
      "data.cleared",
      "recurring.deleted",
      "attachment.deleted",
    ];
    for (const a of actions) {
      const label = formatAuditAction(a);
      expect(label).toBeTruthy();
      expect(label).not.toBe(a); // shouldn't fall through to the raw key
      // every label should be Hebrew (sanity: contain at least one Hebrew character)
      expect(/[֐-׿]/.test(label)).toBe(true);
    }
  });

  it("falls through to the raw key for an unknown action (defensive)", () => {
    const fake = "totally.made.up" as AuditAction;
    expect(formatAuditAction(fake)).toBe("totally.made.up");
  });
});
