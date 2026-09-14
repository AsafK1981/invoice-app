// Panel model for /reports/invoices-period. Advisory: only an unusable period
// blocks; findings that change the totals are visible "action" items, the
// rest are collapsed notes.
import { createFixCollector, splitFixTiers, type FilingFixModel, type FixControl, type FixTier } from "./filing-fix-items";
import { INVOICE_LIST_TITLES, type InvoiceListIssue, type InvoiceListIssueCode } from "./invoice-report-preflight";

function controlFor(issue: InvoiceListIssue, tier: FixTier): FixControl {
  if (!issue.documentId) return { kind: "none" };
  if (issue.code === "customer_number_not_israeli") return { kind: "customer_tax_id", documentId: issue.documentId, current: issue.current ?? "" };
  // Everything that changes the totals is data on an issued document: a data fix.
  if (tier === "action") return { kind: "support", documentId: issue.documentId, code: issue.code, report: "invoices_period" };
  return { kind: "open_document", documentId: issue.documentId };
}

export function buildInvoicePeriodFixModel(issues: readonly InvoiceListIssue[]): FilingFixModel {
  const collector = createFixCollector((code) => INVOICE_LIST_TITLES[code as InvoiceListIssueCode] ?? code);
  for (const issue of issues) {
    const tier: FixTier = issue.level === "error" ? "blocking" : issue.level === "totals" ? "action" : "note";
    collector.put(`${tier}:${issue.code}:${issue.documentId ?? ""}`, tier, issue.code, controlFor(issue, tier), issue.message, issue.sourceLabel);
  }
  return splitFixTiers(collector.items());
}
