import { describe, it, expect } from "vitest";
import { filingDataFixMessage, supportWhatsappHref } from "@/lib/support-link";

describe("support link", () => {
  it("builds a wa.me link to the support number with the text encoded", () => {
    expect(supportWhatsappHref("שלום & bye")).toBe(`https://wa.me/972549000684?text=${encodeURIComponent("שלום & bye")}`);
  });
  it("prefills only the document id and the error code", () => {
    const text = filingDataFixMessage("9bbd3d8a-d7d0-4a00-b573-1e16c3338517", "sign_mismatch");
    expect(text).toContain("9bbd3d8a-d7d0-4a00-b573-1e16c3338517");
    expect(text).toContain("sign_mismatch");
    expect(filingDataFixMessage(undefined, "file_structure")).not.toContain("undefined");
  });
  it("names the report the fix is for, PCN874 by default", () => {
    expect(filingDataFixMessage("d", "journal_unbalanced", "uniform")).toContain("מבנה אחיד");
    expect(filingDataFixMessage("d", "duplicate_number", "invoices_period")).toContain("דוח החשבוניות");
    expect(filingDataFixMessage("d", "sign_mismatch")).toContain("הדיווח המפורט");
  });
});
