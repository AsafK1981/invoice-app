import iconv from "iconv-lite";
import type { ReportIssue } from "../invoice-report-preflight";
import { validPcnDate, validPcnVatId } from "../ita/pcn874";
import type { UniformInput, UniformOutput } from "./builder";
import { DOC_TYPE_CODE } from "./records";

const fits = (value: number, digits = 12, decimals = 2) => Number.isFinite(value) &&
  Math.round(Math.abs(value) * 10 ** decimals) < 10 ** (digits + decimals);
const compactDate = (v: string) => /^\d{8}$/.test(v) && validPcnDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);

/** Checks the unmodified snapshot. Never convert malformed values into zero here. */
export function validateUniformInput(input: UniformInput): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const add = (message: string, href?: string, sourceLabel?: string, level: ReportIssue["level"] = "error") => issues.push({ level, message, href, sourceLabel });
  if (!validPcnVatId(input.business.taxId)) add("מספר העוסק בהגדרות חייב להיות 9 ספרות עם ספרת ביקורת תקינה.", "/settings");
  if (!input.business.name?.trim()) add("חסר שם העסק בהגדרות.", "/settings");
  if (!validPcnDate(input.fromDate) || !validPcnDate(input.toDate) || input.fromDate > input.toDate || !Number.isInteger(input.taxYear) || input.taxYear < 1900 || input.taxYear > 9999)
    add("שנת המס או תאריכי הדוח אינם תקינים.");
  const text = (value: string | undefined, width: number, href?: string, label?: string) => {
    if (value && (value.length > width || iconv.decode(iconv.encode(value, "windows-1255"), "windows-1255") !== value))
      add("טקסט ארוך או תווים שאינם נתמכים יתקצרו או יוחלפו בקובץ. מומלץ לבדוק את הפרטים.", href, label, "warning");
  };
  text(input.business.name, 50, "/settings");
  text(input.business.address, 50, "/settings");
  const accounts = new Set<string>();
  for (const c of input.clients) {
    const key = `CLI-${c.id.slice(0, 10)}`;
    if (accounts.has(key)) add("מזהי לקוחות מתנגשים בשדה החשבון המקוצר. נדרש תיקון ייצוא לפני הורדה.", "/clients", c.name);
    accounts.add(key);
    if (c.taxId && !validPcnVatId(c.taxId)) add("מספר הזיהוי של הלקוח אינו נתמך בשדה הישראלי בקובץ. בדוק את המספר או את סיווג הלקוח.", "/clients", c.name);
    text(c.name, 50, "/clients", c.name);
    text(c.address, 50, "/clients", c.name);
  }
  const clientIds = new Set(input.clients.map(c => c.id));
  const docKeys = new Set<string>();
  for (const d of input.documents) {
    const href = `/documents/${d.id}`, label = `מסמך ${d.number}`;
    if (!validPcnDate(d.date)) { add("תאריך המסמך חסר או אינו תקין; לא ניתן לשייך אותו לשנת הדוח.", href, label); continue; }
    if (d.date < input.fromDate || d.date > input.toDate) continue;
    if (!(d.type in DOC_TYPE_CODE) || !Number.isSafeInteger(d.number) || d.number <= 0) add("סוג או מספר המסמך אינו תקין.", href, label);
    const key = `${d.type}:${d.number}`;
    if (docKeys.has(key)) add("מספר מסמך כפול באותו סוג מסמך. בדוק את המסמכים לפני הייצוא.", href, label);
    docKeys.add(key);
    if (d.currency && d.currency !== "ILS") add("ייצוא מבנה אחיד למסמכים במטבע זר עדיין אינו נתמך באופן מלא. לא ניתן להפיק קובץ תקין לשנה הכוללת מסמך זה.", href, label);
    if ((!d.currency || d.currency === "ILS") && [[d.subtotalIls, d.subtotal], [d.vatIls, d.vat], [d.totalIls, d.total]].some(([ils, original]) => ils != null && (!Number.isFinite(ils) || Math.abs(ils - original!) > 0.01)))
      add("סכומי השקל השמורים אינם תואמים לסכומי המסמך. נדרש תיקון הנתונים לפני הייצוא.", href, label);
    if (![d.subtotal, d.vat, d.total, d.discountAmount ?? 0, d.rounding ?? 0, d.subtotal + (d.discountAmount ?? 0)].every(v => fits(v)) || !fits(d.withholdingAmount ?? 0, 9)) add("סכום חסר, לא מספרי או חורג מגודל השדה בקובץ.", href, label);
    if (Math.abs(d.subtotal + d.vat + (d.rounding ?? 0) - d.total) > 0.03) add("הסכום לפני מע״מ בתוספת המע״מ והעיגול אינו תואם לסכום הכולל.", href, label);
    if (d.clientId && !clientIds.has(d.clientId)) add("הלקוח המקושר למסמך חסר בנתוני הדוח. יש לבדוק את קישור הלקוח.", href, label);
    if (d.items.length > 9999) add("מספר שורות המסמך חורג מגודל השדה בקובץ.", href, label);
    if (d.type !== "receipt" && Math.abs(d.items.reduce((sum, item) => sum + item.total, 0) - (d.discountAmount ?? 0) - d.subtotal) > 0.03)
      add("סכום שורות המסמך בניכוי ההנחה אינו תואם לסכום לפני מע״מ. בדוק את שורות המסמך.", href, label);
    for (const item of d.items) {
      if (!fits(item.quantity, 12, 4) || !fits(item.unitPrice) || !fits(item.total)) add("כמות או סכום בשורת המסמך חסרים או חורגים מגודל השדה.", href, label);
      text(item.description, 30, href, label);
    }
    text(d.clientName, 50, href, label);
    if (d.paymentMethod === "check") {
      const pd = d.paymentDetails;
      for (const [value, width] of [[pd?.checkBank, 10], [pd?.checkBranch, 10], [pd?.checkAccount, 15], [pd?.checkNumber, 10]] as const)
        if (!value || !new RegExp(`^\\d{1,${width}}$`).test(String(value))) add("חסרים פרטי המחאה מספריים תקינים: בנק, סניף, חשבון ומספר המחאה.", href, label);
      if (pd?.checkDueDate && !validPcnDate(pd.checkDueDate)) add("תאריך פירעון ההמחאה אינו תקין.", href, label);
    }
  }
  const categories = new Map<string, string>();
  for (const e of input.expenses) {
    if (!validPcnDate(e.date)) { add("תאריך ההוצאה אינו תקין; לא ניתן לשייך אותה לשנת הדוח.", "/expenses", e.supplier); continue; }
    if (e.date < input.fromDate || e.date > input.toDate) continue;
    if (!fits(e.amount)) add("סכום ההוצאה חסר או חורג מגודל השדה בקובץ.", "/expenses", e.supplier);
    const key = `EXP-${e.category}`.slice(0, 15);
    if (categories.has(key) && categories.get(key) !== e.category) add("שתי קטגוריות הוצאה מתנגשות בשם החשבון המקוצר. נדרש תיקון הייצוא.", "/expenses");
    categories.set(key, e.category);
  }
  return issues;
}

/** OPENFORMAT 1.31 field positions from records.ts and the local authority specification. */
export function validateUniformOutput(output: UniformOutput, sample = false): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const add = (message: string) => issues.push({ level: "error", message });
  const lines = output.bkmvdataText.split("\r\n").filter(Boolean);
  const ini = output.iniText.split("\r\n").filter(Boolean);
  const lengths: Record<string, number> = { A100: 95, Z900: 110, C100: 444, D110: 339, D120: 222, B100: 317, B110: 376, M100: 298 };
  const counts = new Map<string, number>();
  const recordNumbers = new Set<string>();
  const headers = new Map<string, string>();
  const accounts = new Set(lines.filter(l => l.startsWith("B110")).map(l => l.slice(22, 37)));
  const items = new Set(lines.filter(l => l.startsWith("M100")).map(l => l.slice(62, 82)));
  const journal = new Map<string, number>();
  const documentTotals = new Map<string, { count: number; total: number }>();
  const first = lines[0] ?? "", last = lines.at(-1) ?? "";
  if (!validPcnVatId(first.slice(13, 22))) add("מספר העוסק בקובץ אינו תקין.");
  if (!first.startsWith("A100") || !last.startsWith("Z900") || first.slice(13, 45) !== last.slice(13, 45) || first.slice(37, 45) !== "&OF1.31&") add("רשומות הפתיחה והסיום או מזהי הקובץ אינם תואמים.");
  if (ini[0]?.length !== 466 || ini[0]?.slice(0, 4) !== "A000" || ini[0]?.slice(24, 56) !== first.slice(13, 45)) add("כותרת INI אינה תואמת לקובץ הנתונים.");
  if (Number(last.slice(45, 60)) !== lines.length || Number(ini[0]?.slice(9, 24)) !== lines.length || output.counts.total !== lines.length) add("ספירת הרשומות בפתיחה או בסיום אינה תואמת לקובץ.");
  const signed = (s: string) => /^[+-]\d+$/.test(s) ? Number(s) : NaN;
  lines.forEach((line, index) => {
    const type = line.slice(0, 4);
    counts.set(type, (counts.get(type) ?? 0) + 1);
    if (line.length !== lengths[type] || Number(line.slice(4, 13)) < 1 || recordNumbers.has(line.slice(4, 13)) || !/^\d{9}$/.test(line.slice(4, 13)) || line.slice(13, 22) !== first.slice(13, 22)) add(`מבנה, מונה או מזהה עוסק לא תקין ברשומה ${index + 1}.`);
    recordNumbers.add(line.slice(4, 13));
    const dateOffsets: Record<string, number[]> = { C100: [45, 261, 400], D110: [296], D120: [95, 147], B100: [156, 164, 275] };
    if ((dateOffsets[type] ?? []).some(start => !compactDate(line.slice(start, start + 8)))) add(`תאריך לא תקין ברשומה ${index + 1}.`);
    const amounts: Record<string, Array<[number, number]>> = { C100: [[269,15],[287,15],[302,15],[317,15],[332,15],[347,15],[362,12]], D110: [[223,17],[240,15],[255,15],[270,15]], D120: [[103,15]], B100: [[206,15],[221,15],[236,12]], B110: [[277,15],[292,15],[307,15],[342,15]], M100: [[192,12],[204,12],[216,12]] };
    if ((amounts[type] ?? []).some(([start, width]) => !Number.isFinite(signed(line.slice(start, start + width))))) add(`סכום או סימן לא תקין ברשומה ${index + 1}.`);
    if (type === "C100") {
      const link = line.slice(424, 431);
      if (!/^\d{7}$/.test(link) || Number(link) === 0 || headers.has(link)) add("קישור כותרת מסמך חסר או כפול.");
      headers.set(link, line.slice(22, 45));
      const code = line.slice(22, 25), total = documentTotals.get(code) ?? { count: 0, total: 0 };
      total.count += 1; total.total += signed(line.slice(347, 362)); documentTotals.set(code, total);
    }
    if (type === "B100") {
      if (!accounts.has(line.slice(172, 187)) || !accounts.has(line.slice(187, 202))) add("תנועת יומן מפנה לחשבון חסר.");
      const key = line.slice(22, 32), side = line[202];
      if (!"12".includes(side)) add("צד חובה או זכות אינו תקין בתנועת יומן.");
      journal.set(key, (journal.get(key) ?? 0) + signed(line.slice(206, 221)) * (side === "1" ? 1 : -1));
    }
    if (type === "D110" && !items.has(line.slice(73, 93))) add("שורת פירוט מפנה לפריט חסר ברשימת הפריטים.");
  });
  for (const line of lines) {
    const type = line.slice(0, 4), offset = type === "D110" ? 304 : 155;
    if ((type === "D110" || type === "D120") && headers.get(line.slice(offset, offset + 7)) !== line.slice(22, 45)) add("שורת פירוט או תשלום אינה מקושרת לכותרת המסמך המתאימה.");
  }
  if ([...journal.values()].some(value => !Number.isFinite(value) || Math.abs(value) > 1)) add("פקודת יומן אינה מאוזנת. ייתכן שהמסמך כולל עיגול שאינו נתמך עדיין בייצוא; נדרש תיקון לפני הורדה.");
  for (const [type, count] of counts) {
    if (type === "A100" || type === "Z900") { if (count !== 1) add("רשומת פתיחה או סיום כפולה."); continue; }
    const summaries = ini.slice(1).filter(l => l.slice(0, 4) === type);
    if (summaries.length !== 1 || summaries[0].length !== 19 || Number(summaries[0].slice(4)) !== count) add(`סיכום ${type} בקובץ INI אינו תואם לספירה בפועל.`);
  }
  for (const summary of ini.slice(1)) {
    if (!counts.has(summary.slice(0, 4))) add("קובץ INI כולל סיכום לרשומות שאינן בקובץ הנתונים.");
  }
  for (const [code, value] of documentTotals) {
    const summary = output.docTypeSummary.find(row => row.code === code);
    if (!summary || summary.count !== value.count || Math.abs(Math.round(summary.total * 100) - value.total) > 1) add("סיכום המסמכים אינו תואם לסכומי כותרות המסמכים בקובץ.");
  }
  if (sample && (lines.length < 2000 || output.bkmvdata.length > 4 * 1024 * 1024)) add("קובץ הדוגמה לסימולטור הרישום חייב לכלול לפחות 2,000 רשומות וגודלו עד 4MB.");
  return issues;
}
