// The invoices-period listing as one pure model, so the table on screen, the
// Excel file and the PDF say the same thing. Amounts are shekels. A document
// without usable shekel amounts gets empty cells and stays out of the totals,
// and any finding that can change the totals labels them partial, instead of
// silently adding foreign-currency numbers as if they were shekels.
import { validPcnDate } from "./ita/pcn874";
import { INVOICE_LIST_TITLES, invoiceReportTypes, type InvoiceListIssue, type InvoiceListIssueCode } from "./invoice-report-preflight";
import { DOCUMENT_TYPE_LABELS, type DocumentType, type InvoiceDocument } from "./types";
import { sheet } from "./xlsx-export";

export interface InvoicePeriodRow {
  id: string;
  type: DocumentType;
  number: number;
  date: string;
  customerTaxId: string;
  clientName: string;
  net: number | null;
  vat: number | null;
  total: number | null;
  allocation: string;
}

export interface InvoicePeriodReport {
  rows: InvoicePeriodRow[];
  totals: { net: number; vat: number; total: number };
  /** Rows left out of the totals for missing shekel amounts. */
  missingAmounts: number;
}

function shekelAmounts(doc: InvoiceDocument): { net: number; vat: number; total: number } | null {
  const foreign = Boolean(doc.currency) && doc.currency !== "ILS";
  const values = foreign
    ? [doc.subtotalIls, doc.vatIls, doc.totalIls]
    : [doc.subtotalIls ?? doc.subtotal, doc.vatIls ?? doc.vat, doc.totalIls ?? doc.total];
  if (!values.every((value): value is number => typeof value === "number" && Number.isFinite(value))) return null;
  return { net: values[0], vat: values[1], total: values[2] };
}

export function buildInvoicePeriodReport(documents: readonly InvoiceDocument[], start: string, end: string): InvoicePeriodReport {
  const usable = validPcnDate(start) && validPcnDate(end) && start <= end;
  const rows = usable
    ? documents
        .filter((d) => invoiceReportTypes.includes(d.type) && d.status !== "draft" && d.status !== "cancelled" && validPcnDate(d.date) && d.date >= start && d.date <= end)
        .map((d): InvoicePeriodRow => {
          const amounts = shekelAmounts(d);
          return {
            id: d.id,
            type: d.type,
            number: d.number,
            date: d.date,
            customerTaxId: d.clientTaxId || "",
            clientName: d.clientName,
            net: amounts?.net ?? null,
            vat: amounts?.vat ?? null,
            total: amounts?.total ?? null,
            allocation: d.allocationNumber || "",
          };
        })
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number))
    : [];
  const totals = { net: 0, vat: 0, total: 0 };
  let missingAmounts = 0;
  for (const row of rows) {
    if (row.net == null || row.vat == null || row.total == null) {
      missingAmounts += 1;
      continue;
    }
    totals.net += row.net;
    totals.vat += row.vat;
    totals.total += row.total;
  }
  return { rows, totals, missingAmounts };
}

/** Partial for ANY finding that can change the totals: missing amounts, a dropped row, a duplicate, a mismatch. */
export function invoicePeriodTotalsPartial(issues: readonly Pick<InvoiceListIssue, "level">[], report: Pick<InvoicePeriodReport, "missingAmounts">): boolean {
  return report.missingAmounts > 0 || issues.some((issue) => issue.level === "totals");
}

const LEVEL_PREFIX: Record<"totals" | "note", string> = {
  totals: "משפיע על הסכומים",
  note: "לבדיקה",
};
const MAX_LABELS = 10;

/** Plain lines written into the Excel file and printed above the table in the PDF. */
export function invoicePeriodStampLines(issues: readonly InvoiceListIssue[], report: Pick<InvoicePeriodReport, "missingAmounts">): string[] {
  const lines: string[] = [];
  if (report.missingAmounts === 1) lines.push("שורת הסיכום חלקית: מסמך אחד בלי סכומים בשקלים לא נכלל בה.");
  else if (report.missingAmounts > 1) lines.push(`שורת הסיכום חלקית: ${report.missingAmounts} מסמכים בלי סכומים בשקלים לא נכללו בה.`);
  else if (issues.some((issue) => issue.level === "totals")) lines.push("שורת הסיכום חלקית: יש ממצאים שמשפיעים על הסכומים, ראו למטה.");
  const groups = new Map<string, { level: "totals" | "note"; code: InvoiceListIssueCode; labels: string[] }>();
  for (const issue of issues) {
    if (issue.level === "error") continue;
    const key = `${issue.level}:${issue.code}`;
    const group = groups.get(key) ?? { level: issue.level, code: issue.code, labels: [] };
    if (issue.sourceLabel && !group.labels.includes(issue.sourceLabel)) group.labels.push(issue.sourceLabel);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === "totals" ? -1 : 1));
  for (const group of ordered) {
    const shown = group.labels.slice(0, MAX_LABELS).join(", ");
    const more = group.labels.length > MAX_LABELS ? ` ועוד ${group.labels.length - MAX_LABELS}` : "";
    lines.push(`${LEVEL_PREFIX[group.level]}: ${INVOICE_LIST_TITLES[group.code]}${shown ? ` (${shown}${more})` : ""}`);
  }
  return lines;
}

/** The styled sheet behind the "ייצוא Excel" button, with the stamp and a partial total label. */
export function invoicesPeriodSheet(params: { rows: InvoicePeriodRow[]; periodLabel: string; businessName?: string; stamp: string[]; incomplete: boolean }) {
  const { rows, periodLabel, businessName, stamp, incomplete } = params;
  return sheet<InvoicePeriodRow>({
    name: "חשבוניות",
    title: "דוח חשבוניות לתקופה",
    subtitle: incomplete
      ? `${periodLabel} · הסכומים חלקיים, ראו הערות מתחת לטבלה`
      : stamp.length > 0
        ? `${periodLabel} · יש הערות מתחת לטבלה`
        : periodLabel,
    businessName,
    countLabel: `${rows.length} מסמכים`,
    rows,
    totalLabel: incomplete ? "סה״כ (חלקי)" : "סה״כ",
    notes: stamp.length > 0 ? ["הערות לדוח:", ...stamp] : [],
    columns: [
      { header: "ת.ז / ח.פ", value: (r) => r.customerTaxId },
      { header: "מספר חשבונית", value: (r) => r.number, kind: "int", width: 13 },
      { header: "סוג", value: (r) => DOCUMENT_TYPE_LABELS[r.type] },
      { header: "לקוח", value: (r) => r.clientName },
      { header: "תאריך", value: (r) => r.date, kind: "date" },
      { header: "סכום ללא מע״מ", value: (r) => r.net, kind: "money", total: "sum" },
      { header: "מע״מ", value: (r) => r.vat, kind: "money", total: "sum" },
      { header: "סכום כולל מע״מ", value: (r) => r.total, kind: "money", total: "sum" },
      { header: "מספר הקצאה", value: (r) => r.allocation },
    ],
  });
}
