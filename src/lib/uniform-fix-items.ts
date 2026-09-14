// The "what's left before the download" model for the מבנה אחיד export on
// /reports. Pure: takes the route's coded issues and returns grouped items,
// each with the one control that fixes it. The panel only renders this.
import { createFixCollector, splitFixTiers, type FilingFixModel, type FixControl, type FixTier } from "./filing-fix-items";
import { UNIFORM_FIX_TITLES, type UniformIssue, type UniformIssueCode } from "./uniform-structure/issues";

function controlFor(issue: UniformIssue): FixControl {
  const support: FixControl = {
    kind: "support",
    ...(issue.source === "document" && issue.sourceId ? { documentId: issue.sourceId } : {}),
    code: issue.code,
    report: "uniform",
  };
  switch (issue.code) {
    case "dealer_number_invalid":
      return { kind: "business_tax_id", current: issue.current ?? "" };
    case "business_name_missing":
      return { kind: "settings" };
    case "period_invalid":
    case "software_registration_missing":
    case "data_load_failed":
    case "rate_limited":
      return { kind: "none" };
    case "client_number_not_israeli":
      return issue.sourceId ? { kind: "open_client", clientId: issue.sourceId } : { kind: "none" };
    case "customer_number_not_israeli":
    case "customer_number_from_client":
      // The document's own number, written through the path the immutability trigger allows.
      return issue.sourceId ? { kind: "customer_tax_id", documentId: issue.sourceId, current: issue.current ?? "" } : { kind: "none" };
    case "text_truncated":
      if (issue.source === "business") return { kind: "settings" };
      if (issue.source === "client" && issue.sourceId) return { kind: "open_client", clientId: issue.sourceId };
      if (issue.source === "document" && issue.sourceId) return { kind: "open_document", documentId: issue.sourceId };
      return { kind: "none" };
    case "date_invalid":
      return issue.source === "expense" && issue.sourceId ? { kind: "expense_date", expenseId: issue.sourceId, current: issue.current ?? "" } : support;
    case "items_synthesized":
      return issue.sourceId ? { kind: "open_document", documentId: issue.sourceId } : { kind: "none" };
    case "expense_amount_invalid":
      return issue.sourceId ? { kind: "open_expense", expenseId: issue.sourceId } : { kind: "none" };
    default:
      // Everything else is data on a locked document or a problem in the built
      // file: a data fix, requested with the document id and the code only.
      return support;
  }
}

export function buildUniformFixModel(issues: readonly UniformIssue[]): FilingFixModel {
  const collector = createFixCollector((code) => UNIFORM_FIX_TITLES[code as UniformIssueCode] ?? code);
  for (const issue of issues) {
    const tier: FixTier = issue.level === "error" ? "blocking" : "note";
    const control = controlFor(issue);
    // One support request per document and one per file-level code; every other finding on its own.
    const key = control.kind === "support" ? `support:${control.documentId ?? issue.code}` : `${tier}:${issue.code}:${issue.sourceId ?? ""}`;
    collector.put(key, tier, issue.code, control, issue.message, issue.sourceLabel);
  }
  return splitFixTiers(collector.items());
}
