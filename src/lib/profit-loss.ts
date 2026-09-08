import { isCountableRevenue, type Business, type Expense, type InvoiceDocument } from "./types";
import { periodMatches, type Period } from "./report-period";

export type ProfitLossDocument = Pick<InvoiceDocument, "id" | "date" | "type" | "status" | "total" | "vat" | "currency" | "exchangeRate" | "totalIls" | "vatIls" | "convertedToId">;
export type ProfitLossExpense = Pick<Expense, "id" | "date" | "category" | "amount" | "vatAmount" | "isEquipment">;
export const RESULT_LABEL = "רווח / הפסד לפני פחת והתאמות מס";
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
/** Round each recorded money component once, symmetrically, before summation. */
export function agorot(n: number): number {
  const scaled = Math.abs(n) * 100;
  return Math.sign(n) * Math.round(scaled + Number.EPSILON * scaled);
}
function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

export function calculateProfitLoss(documents: ProfitLossDocument[], expenses: ProfitLossExpense[], businessType: Business["businessType"], period: Period) {
  const exempt = businessType === "exempt";
  let income = 0, credits = 0, equipment = 0, excluded = 0, records = 0;
  const categories = new Map<string, number>();
  for (const doc of documents) {
    if (!isCountableRevenue(doc) || (doc.type === "credit_note" ? !["sent", "paid"].includes(doc.status) : doc.status !== "paid")) continue;
    if (!validDate(doc.date)) { excluded++; continue; }
    if (!periodMatches(period, doc.date)) continue;
    const foreign = Boolean(doc.currency && doc.currency !== "ILS");
    const rate = valid(doc.exchangeRate) && doc.exchangeRate > 0 ? doc.exchangeRate : undefined;
    const convert = (snapshot: number | undefined, original: number) =>
      valid(snapshot) ? snapshot : original === 0 ? 0 : valid(original) && (!foreign || rate !== undefined) ? original * (foreign ? rate! : 1) : NaN;
    const gross = convert(doc.totalIls, doc.total);
    const vat = exempt ? 0 : convert(doc.vatIls, doc.vat);
    if (!valid(gross) || !valid(vat) || !Number.isSafeInteger(agorot(gross)) || !Number.isSafeInteger(agorot(vat)) || Math.abs(vat) > Math.abs(gross) || (doc.type !== "credit_note" && vat !== 0 && Math.sign(vat) !== Math.sign(gross))) { excluded++; continue; }
    const amount = doc.type === "credit_note" ? -(Math.abs(agorot(gross)) - Math.abs(agorot(vat))) : agorot(gross) - agorot(vat);
    if (doc.type === "credit_note") credits += amount;
    else income += amount;
    records++;
  }
  for (const expense of expenses) {
    if (!validDate(expense.date)) { excluded++; continue; }
    if (!periodMatches(period, expense.date)) continue;
    const vat = exempt ? 0 : expense.vatAmount ?? 0;
    if (!valid(expense.amount) || !valid(vat) || !Number.isSafeInteger(agorot(expense.amount)) || !Number.isSafeInteger(agorot(vat)) || Math.abs(vat) > Math.abs(expense.amount) || (vat !== 0 && Math.sign(vat) !== Math.sign(expense.amount))) { excluded++; continue; }
    const amount = agorot(expense.amount) - agorot(vat);
    if (expense.isEquipment) equipment += amount;
    else {
      const category = expense.category?.trim() || "ללא קטגוריה";
      categories.set(category, (categories.get(category) ?? 0) + amount);
    }
    records++;
  }
  const operatingExpenses = [...categories.values()].reduce((a, b) => a + b, 0);
  const netIncome = income + credits;
  const notes = [
    "דוח ניהולי לפי תאריך המסמך: הכנסות שסומנו כשולמו וזיכויים שהופקו. מסמכים שבוטלו, טיוטות ומסמכי מקור שהומרו אינם נכללים.",
    "החישוב אינו בסיס מזומן או בסיס מצטבר לצורכי מס. ניכוי מס במקור אינו מפחית את ההכנסה.",
    exempt ? "הסכומים בשקלים וכוללים מע״מ, בהתאם לסוג העסק: עוסק פטור." : "הסכומים בשקלים, בניכוי המע״מ שנרשם. לא נבדקה הזכאות לקיזוז מע״מ.",
    "רכישות שסומנו כציוד מוצגות בנפרד ואינן נכללות בהוצאות השוטפות. פחת, שינויי מלאי והוצאות שאינן מוכרות לא חושבו.",
    "הדוח מבוסס רק על הנתונים שהוזנו לאפליקציה ואינו תחליף לדוח שנתי או לטופס 1320. לפני דיווח יש להשלים התאמות עם איש מקצוע.",
  ];
  if (excluded) notes.unshift(`דוח חלקי: ${excluded} רשומות לא נכללו בגלל סכום, תאריך או שער המרה חסרים או לא תקינים. יש להשלים את הנתונים ולהפיק שוב.`);
  return { income, credits, netIncome, operatingExpenses, equipment, result: netIncome - operatingExpenses, categories: [...categories].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "he")), excluded, records, notes };
}
