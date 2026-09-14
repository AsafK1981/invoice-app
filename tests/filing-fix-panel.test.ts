import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "business", onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));

import { FilingFixPanel } from "@/components/filing-fix-panel";
import type { FilingFixItem, FilingFixModel } from "@/lib/filing-fix-items";

function render(item: FilingFixItem) {
  const model: FilingFixModel = { blocking: [item], actions: [], notes: [], periodOnly: false };
  return renderToStaticMarkup(createElement(FilingFixPanel, { model, businessId: "b", returnTo: "/reports/vat" }));
}

const base = { key: "k", tier: "blocking" as const, title: "t", messages: [], labels: [] };

describe("FilingFixPanel customer number", () => {
  it("offers clearing a foreign customer number and explains the unidentified-sale outcome", () => {
    const html = render({ ...base, code: "customer_number_invalid", control: { kind: "customer_tax_id", documentId: "d", current: "DE123456789" } });
    expect(html).toContain("data-fix-clear");
    expect(html).toContain("נקה את המספר");
    expect(html).toContain("לקוח לא מזוהה");
  });

  it("does not offer clearing when the document has no number yet", () => {
    const html = render({ ...base, code: "customer_number_missing", control: { kind: "customer_tax_id", documentId: "d", current: "" } });
    expect(html).not.toContain("data-fix-clear");
  });

  it("never offers clearing a supplier or business number", () => {
    const html = render({ ...base, code: "supplier_number_invalid", control: { kind: "supplier_tax_id", expenseIds: ["e"], current: "DE1" } });
    expect(html).not.toContain("data-fix-clear");
  });
});
