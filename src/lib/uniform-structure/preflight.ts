import iconv from "iconv-lite";
import { normalizeBusinessNumber } from "../israeli-id";
import { validPcnDate, validPcnVatId } from "../ita/pcn874";
import { foreignIlsConsistent, isForeignCurrency, uniformAmounts } from "./amounts";
import { uniformCustomerVat } from "./customer-vat";
import type { UniformInput, UniformOutput } from "./builder";
import type { UniformIssue, UniformIssueCode } from "./issues";
import { DOC_TYPE_CODE } from "./records";

const fits = (value: number, digits = 12, decimals = 2) => Number.isFinite(value) &&
  Math.round(Math.abs(value) * 10 ** decimals) < 10 ** (digits + decimals);
const compactDate = (v: string) => /^\d{8}$/.test(v) && validPcnDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

type Where = Pick<UniformIssue, "source" | "sourceId" | "sourceLabel" | "current" | "imported">;

/**
 * Checks the unmodified snapshot. Never convert malformed values into zero here.
 * Uses the same normalizer and amount helpers the builder writes with, so a
 * value passes here exactly when the file carries it correctly.
 */
export function validateUniformInput(input: UniformInput): UniformIssue[] {
  const issues: UniformIssue[] = [];
  const add = (code: UniformIssueCode, message: string, where: Where = {}, level: UniformIssue["level"] = "error") =>
    issues.push({ code, level, message, ...where });
  const business: Where = { source: "business" };

  // Same decision as the builder: an 8-digit עוסק without its leading zero is valid and padded in the file.
  if (!normalizeBusinessNumber(input.business.taxId).value)
    add("dealer_number_invalid", "מספר העוסק בהגדרות אינו תקין: ספרות בלבד, עד 9 ספרות, עם ספרת ביקורת תקינה.", { ...business, current: input.business.taxId ?? "" });
  if (!input.business.name?.trim()) add("business_name_missing", "חסר שם העסק בהגדרות.", business);
  if (!validPcnDate(input.fromDate) || !validPcnDate(input.toDate) || input.fromDate > input.toDate || !Number.isInteger(input.taxYear) || input.taxYear < 1900 || input.taxYear > 9999)
    add("period_invalid", "שנת המס או תאריכי הדוח אינם תקינים.");
  const text = (value: string | undefined, width: number, where: Where) => {
    if (value && (value.length > width || iconv.decode(iconv.encode(value, "windows-1255"), "windows-1255") !== value))
      add("text_truncated", "טקסט ארוך או תווים שאינם נתמכים יתקצרו או יוחלפו בקובץ. מומלץ לבדוק את הפרטים.", where, "warning");
  };
  text(input.business.name, 50, business);
  text(input.business.address, 50, business);

  const clientById = new Map(input.clients.map((c) => [c.id, c]));
  for (const c of input.clients) {
    const where: Where = { source: "client", sourceId: c.id, sourceLabel: c.name };
    // B110 1419 is written blank for a number the normalizer refuses: a note, never a blocker.
    if (c.taxId && !normalizeBusinessNumber(c.taxId).value)
      add("client_number_not_israeli", "מספר הזיהוי של הלקוח אינו מספר עוסק ישראלי, ולכן שדה מספר העוסק בכרטיס הלקוח בקובץ יישאר ריק. אם זה לקוח מחו״ל אין צורך לעשות דבר.", where, "warning");
    text(c.name, 50, where);
    text(c.address, 50, where);
  }

  const docKeys = new Set<string>();
  for (const d of input.documents) {
    const where: Where = { source: "document", sourceId: d.id, sourceLabel: `מסמך ${d.number}`, imported: Boolean(d.importBatchId) };
    if (!validPcnDate(d.date)) { add("date_invalid", "תאריך המסמך חסר או אינו תקין; לא ניתן לשייך אותו לשנת הדוח.", where); continue; }
    if (d.date < input.fromDate || d.date > input.toDate) continue;
    if (!(d.type in DOC_TYPE_CODE) || !Number.isSafeInteger(d.number) || d.number <= 0) add("document_number_invalid", "סוג או מספר המסמך אינו תקין.", where);
    const key = `${d.type}:${d.number}`;
    if (docKeys.has(key)) add("duplicate_document_number", "מספר מסמך כפול באותו סוג מסמך. בדוק את המסמכים לפני הייצוא.", where);
    docKeys.add(key);

    const foreign = isForeignCurrency(d);
    if (foreign) {
      // The file is in shekels (1032 = ILS): the document needs its stored
      // shekel amounts, and the rate its lines, discount and withholding are
      // converted with.
      if (![d.subtotalIls, d.vatIls, d.totalIls].every(finite))
        add("foreign_currency_missing_ils", "במסמך במטבע חוץ חסרים סכומי שקל שמורים, ולכן אי אפשר לכתוב אותו בקובץ בשקלים. נדרש תיקון נתונים.", where);
      const rate = d.exchangeRate;
      const rateOk = /^[A-Z]{3}$/.test(String(d.currency)) && finite(rate) && rate > 0;
      if (!rateOk)
        add("foreign_currency_invalid", "במסמך במטבע חוץ חסר שער ההמרה או שקוד המטבע אינו תקין. נדרש תיקון נתונים.", where);
      // Native amounts stored as shekels (a missing conversion) look complete
      // but would report a USD 100 invoice as 100 shekels: the snapshots must
      // match the rate and add up, each within one agora.
      else if ([d.subtotalIls, d.vatIls, d.totalIls].every(finite) && !foreignIlsConsistent(d))
        add("foreign_currency_ils_mismatch", "סכומי השקל השמורים של מסמך במטבע חוץ אינם תואמים לשער ההמרה או אינם מסתכמים לסכום הכולל. נדרש תיקון נתונים לפני הייצוא.", where);
    } else if ([[d.subtotalIls, d.subtotal], [d.vatIls, d.vat], [d.totalIls, d.total]].some(([ils, original]) => ils != null && (!Number.isFinite(ils) || Math.abs(ils - original!) > 0.01))) {
      add("ils_mismatch", "סכומי השקל השמורים אינם תואמים לסכומי המסמך. נדרש תיקון הנתונים לפני הייצוא.", where);
    }
    const amounts = uniformAmounts(d);
    const shekelValues = foreign ? [amounts.subtotal, amounts.vat, amounts.total, amounts.discount, amounts.subtotal + amounts.discount].filter(Number.isFinite) : [];
    if (![d.subtotal, d.vat, d.total, d.discountAmount ?? 0, d.rounding ?? 0, d.subtotal + (d.discountAmount ?? 0), ...shekelValues].every((v) => fits(v)) || !fits(d.withholdingAmount ?? 0, 9))
      add("amount_invalid", "סכום חסר, לא מספרי או חורג מגודל השדה בקובץ.", where);
    // Stays blocking: the journal may post only the stored rounding, never a larger gap.
    if (Math.abs(d.subtotal + d.vat + (d.rounding ?? 0) - d.total) > 0.03) add("total_mismatch", "הסכום לפני מע״מ בתוספת המע״מ והעיגול אינו תואם לסכום הכולל.", where);
    if (d.clientId && !clientById.has(d.clientId)) add("client_missing", "הלקוח המקושר למסמך חסר בנתוני הדוח. יש לבדוק את קישור הלקוח.", where);
    if (d.items.length > 9999) add("too_many_lines", "מספר שורות המסמך חורג מגודל השדה בקובץ.", where);
    if (d.type !== "receipt" && Math.abs(d.items.reduce((sum, item) => sum + item.total, 0) - (d.discountAmount ?? 0) - d.subtotal) > 0.03)
      add("items_mismatch", "סכום שורות המסמך בניכוי ההנחה אינו תואם לסכום לפני מע״מ. בדוק את שורות המסמך.", where);
    for (const item of d.items) {
      if (!fits(item.quantity, 12, 4) || !fits(item.unitPrice) || !fits(item.total)) add("item_amount_invalid", "כמות או סכום בשורת המסמך חסרים או חורגים מגודל השדה.", where);
      text(item.description, 30, where);
    }
    text(d.clientName, 50, where);
    // C100 1215: the same helper records.ts writes with. Refused values are written as zeros.
    const customer = uniformCustomerVat(d, d.clientId ? clientById.get(d.clientId) : null);
    if (customer.refused)
      add("customer_number_not_israeli", "מספר הלקוח במסמך אינו מספר עוסק ישראלי, ולכן שדה מספר העוסק של הלקוח במסמך יישאר ריק בקובץ. אם זה לקוח מחו״ל אין צורך לעשות דבר.", { ...where, current: d.clientTaxId ?? "" }, "warning");
    if (customer.fallback)
      add("customer_number_from_client", "למסמך הזה לא נשמר מספר לקוח בזמן ההפקה, ולכן נכתב בקובץ המספר מכרטיס הלקוח. אם הוא השתנה מאז, הוסף למסמך את המספר המקורי.", { ...where, current: d.clientTaxId ?? "" }, "warning");
    if (d.paymentMethod === "check") {
      const pd = d.paymentDetails;
      const parts = [[pd?.checkBank, 10], [pd?.checkBranch, 10], [pd?.checkAccount, 15], [pd?.checkNumber, 10]] as const;
      if (parts.some(([value, width]) => !value || !new RegExp(`^\\d{1,${width}}$`).test(String(value))))
        add("check_details_invalid", "חסרים פרטי המחאה מספריים תקינים: בנק, סניף, חשבון ומספר המחאה.", where);
      if (pd?.checkDueDate && !validPcnDate(pd.checkDueDate)) add("check_due_date_invalid", "תאריך פירעון ההמחאה אינו תקין.", where);
    }
  }

  for (const e of input.expenses) {
    const where: Where = { source: "expense", sourceId: e.id, sourceLabel: e.supplier };
    if (!validPcnDate(e.date)) { add("date_invalid", "תאריך ההוצאה אינו תקין; לא ניתן לשייך אותה לשנת הדוח.", { ...where, current: e.date ?? "" }); continue; }
    if (e.date < input.fromDate || e.date > input.toDate) continue;
    if (!fits(e.amount)) add("expense_amount_invalid", "סכום ההוצאה חסר או חורג מגודל השדה בקובץ.", where);
  }
  return issues;
}

/** OPENFORMAT 1.31 field positions from records.ts and the local authority specification. */
export function validateUniformOutput(output: UniformOutput, sample = false): UniformIssue[] {
  const issues: UniformIssue[] = [];
  const add = (code: UniformIssueCode, message: string) => issues.push({ code, level: "error", message });
  const lines = output.bkmvdataText.split("\r\n").filter(Boolean);
  const ini = output.iniText.split("\r\n").filter(Boolean);
  const lengths: Record<string, number> = { A100: 95, Z900: 110, C100: 444, D110: 339, D120: 222, B100: 317, B110: 376, M100: 298 };
  const counts = new Map<string, number>();
  const recordNumbers = new Set<string>();
  const headers = new Map<string, string>();
  const accountKeyList = lines.filter(l => l.startsWith("B110")).map(l => l.slice(22, 37));
  const accounts = new Set(accountKeyList);
  const items = new Set(lines.filter(l => l.startsWith("M100")).map(l => l.slice(62, 82)));
  const journal = new Map<string, number>();
  const documentTotals = new Map<string, { count: number; total: number }>();
  const first = lines[0] ?? "", last = lines.at(-1) ?? "";
  if (!validPcnVatId(first.slice(13, 22))) add("file_dealer_invalid", "מספר העוסק בקובץ אינו תקין.");
  if (!first.startsWith("A100") || !last.startsWith("Z900") || first.slice(13, 45) !== last.slice(13, 45) || first.slice(37, 45) !== "&OF1.31&") add("file_envelope_mismatch", "רשומות הפתיחה והסיום או מזהי הקובץ אינם תואמים.");
  if (ini[0]?.length !== 466 || ini[0]?.slice(0, 4) !== "A000" || ini[0]?.slice(24, 56) !== first.slice(13, 45)) add("ini_header_mismatch", "כותרת INI אינה תואמת לקובץ הנתונים.");
  if (Number(last.slice(45, 60)) !== lines.length || Number(ini[0]?.slice(9, 24)) !== lines.length || output.counts.total !== lines.length) add("record_count_mismatch", "ספירת הרשומות בפתיחה או בסיום אינה תואמת לקובץ.");
  const signed = (s: string) => /^[+-]\d+$/.test(s) ? Number(s) : NaN;
  lines.forEach((line, index) => {
    const type = line.slice(0, 4);
    counts.set(type, (counts.get(type) ?? 0) + 1);
    if (line.length !== lengths[type] || Number(line.slice(4, 13)) < 1 || recordNumbers.has(line.slice(4, 13)) || !/^\d{9}$/.test(line.slice(4, 13)) || line.slice(13, 22) !== first.slice(13, 22)) add("record_invalid", `מבנה, מונה או מזהה עוסק לא תקין ברשומה ${index + 1}.`);
    recordNumbers.add(line.slice(4, 13));
    const dateOffsets: Record<string, number[]> = { C100: [45, 261, 400], D110: [296], D120: [95, 147], B100: [156, 164, 275] };
    if ((dateOffsets[type] ?? []).some(start => !compactDate(line.slice(start, start + 8)))) add("record_date_invalid", `תאריך לא תקין ברשומה ${index + 1}.`);
    const amounts: Record<string, Array<[number, number]>> = { C100: [[269,15],[287,15],[302,15],[317,15],[332,15],[347,15],[362,12]], D110: [[223,17],[240,15],[255,15],[270,15]], D120: [[103,15]], B100: [[206,15],[221,15],[236,12]], B110: [[277,15],[292,15],[307,15],[342,15]], M100: [[192,12],[204,12],[216,12]] };
    if ((amounts[type] ?? []).some(([start, width]) => !Number.isFinite(signed(line.slice(start, start + width))))) add("record_amount_invalid", `סכום או סימן לא תקין ברשומה ${index + 1}.`);
    if (type === "C100") {
      const link = line.slice(424, 431);
      if (!/^\d{7}$/.test(link) || Number(link) === 0 || headers.has(link)) add("document_link_invalid", "קישור כותרת מסמך חסר או כפול.");
      headers.set(link, line.slice(22, 45));
      const code = line.slice(22, 25), total = documentTotals.get(code) ?? { count: 0, total: 0 };
      total.count += 1; total.total += signed(line.slice(347, 362)); documentTotals.set(code, total);
    }
    if (type === "B100") {
      if (!accounts.has(line.slice(172, 187)) || !accounts.has(line.slice(187, 202))) add("journal_missing_account", "תנועת יומן מפנה לחשבון חסר.");
      const key = line.slice(22, 32), side = line[202];
      if (!"12".includes(side)) add("journal_side_invalid", "צד חובה או זכות אינו תקין בתנועת יומן.");
      journal.set(key, (journal.get(key) ?? 0) + signed(line.slice(206, 221)) * (side === "1" ? 1 : -1));
    }
    if (type === "D110" && !items.has(line.slice(73, 93))) add("detail_item_missing", "שורת פירוט מפנה לפריט חסר ברשימת הפריטים.");
  });
  for (const line of lines) {
    const type = line.slice(0, 4), offset = type === "D110" ? 304 : 155;
    if ((type === "D110" || type === "D120") && headers.get(line.slice(offset, offset + 7)) !== line.slice(22, 45)) add("detail_link_invalid", "שורת פירוט או תשלום אינה מקושרת לכותרת המסמך המתאימה.");
  }
  // Strict to 1 agora. The builder posts only the stored rounding (capped), so any other gap lands here.
  if ([...journal.values()].some(value => !Number.isFinite(value) || Math.abs(value) > 1))
    add("journal_unbalanced", "פקודת יומן אינה מאוזנת: הסכום הכולל אינו שווה לסכום לפני מע״מ, המע״מ והעיגול השמור במסמך. נדרש תיקון נתונים לפני הורדה.");
  if (accounts.size !== accountKeyList.length) add("account_key_duplicate", "שני חשבונות בקובץ קיבלו אותו מפתח. נדרש תיקון ייצוא לפני הורדה.");
  for (const [type, count] of counts) {
    if (type === "A100" || type === "Z900") { if (count !== 1) add("envelope_duplicate", "רשומת פתיחה או סיום כפולה."); continue; }
    const summaries = ini.slice(1).filter(l => l.slice(0, 4) === type);
    if (summaries.length !== 1 || summaries[0].length !== 19 || Number(summaries[0].slice(4)) !== count) add("ini_summary_mismatch", `סיכום ${type} בקובץ INI אינו תואם לספירה בפועל.`);
  }
  for (const summary of ini.slice(1)) {
    if (!counts.has(summary.slice(0, 4))) add("ini_summary_mismatch", "קובץ INI כולל סיכום לרשומות שאינן בקובץ הנתונים.");
  }
  for (const [code, value] of documentTotals) {
    const summary = output.docTypeSummary.find(row => row.code === code);
    if (!summary || summary.count !== value.count || Math.abs(Math.round(summary.total * 100) - value.total) > 1) add("doc_summary_mismatch", "סיכום המסמכים אינו תואם לסכומי כותרות המסמכים בקובץ.");
  }
  if (sample && (lines.length < 2000 || output.bkmvdata.length > 4 * 1024 * 1024)) add("sample_too_small", "קובץ הדוגמה לסימולטור הרישום חייב לכלול לפחות 2,000 רשומות וגודלו עד 4MB.");
  return issues;
}
