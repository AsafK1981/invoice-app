/**
 * The styled Excel export (src/lib/xlsx-export.ts) must produce the same
 * anatomy as the printed sheet: title block, peach header, real dates,
 * ₪-formatted numbers, a bold SUM total row, RTL view with a frozen header.
 * Builds the expenses sheet exactly the way exportExpenses does, writes it,
 * reads it back with exceljs and asserts every one of those.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sheet, buildWorkbook } from "@/lib/xlsx-export";

type Expense = {
  id: string;
  date: string;
  category: string;
  supplier: string;
  amount: number;
  description?: string;
  vatAmount?: number;
};

const expenses: Expense[] = [
  { id: "1", date: "2026-08-03", category: "תוכנה", supplier: "Adobe", amount: 117, vatAmount: 18, description: "מנוי חודשי" },
  { id: "2", date: "2026-08-10", category: "משרד", supplier: "אופיס דיפו", amount: 234.5, vatAmount: 36.1, description: "נייר וטונר" },
  { id: "3", date: "2026-08-21", category: "רכב", supplier: "פז", amount: 400, vatAmount: 61.54 },
];

function expensesSheet(rows: Expense[]) {
  return sheet<Expense>({
    name: "הוצאות",
    title: "רשימת הוצאות",
    subtitle: "אוגוסט 2026",
    businessName: "סטודיו לדוגמה",
    countLabel: `${rows.length} הוצאות`,
    rows,
    columns: [
      { header: "תאריך", value: (e) => e.date, kind: "date" },
      { header: "קטגוריה", value: (e) => e.category },
      { header: "ספק", value: (e) => e.supplier },
      { header: "תיאור", value: (e) => e.description || "", width: 34 },
      { header: "סכום ללא מע״מ", value: (e) => e.amount - (e.vatAmount ?? 0), kind: "money", total: "sum" },
      { header: "מע״מ", value: (e) => e.vatAmount ?? 0, kind: "money", total: "sum" },
      { header: "סכום כולל מע״מ", value: (e) => e.amount, kind: "money", total: "sum" },
    ],
  });
}

async function roundTrip(sheets: ReturnType<typeof sheet>[], name: string) {
  const dir = path.join(os.tmpdir(), "mfia-xlsx-test");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const wb = await buildWorkbook(sheets);
  await wb.xlsx.writeFile(file);
  const back = new ExcelJS.Workbook();
  await back.xlsx.readFile(file);
  return { file, wb: back };
}

describe("styled xlsx export", () => {
  it("renders the expenses sheet with the print sheet's anatomy", async () => {
    const { wb, file } = await roundTrip([expensesSheet(expenses)], "sample-expenses.xlsx");
    const ws = wb.getWorksheet(1)!;

    // sheet-level
    expect(ws.name).toBe("הוצאות");
    expect(ws.views[0]?.rightToLeft).toBe(true);
    expect(ws.views[0]?.state).toBe("frozen");
    expect((ws.views[0] as ExcelJS.WorksheetViewFrozen).ySplit).toBe(6);
    expect(ws.pageSetup.printTitlesRow).toBe("6:6");
    expect(JSON.stringify(ws.autoFilter)).toContain("6");

    // title block, rows 1-4
    expect(ws.getCell("A1").value).toBe("סטודיו לדוגמה");
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("A2").value).toBe("רשימת הוצאות");
    expect(ws.getCell("A2").font?.size).toBe(16);
    expect(ws.getCell("A3").value).toBe("אוגוסט 2026");
    expect(String(ws.getCell("A4").value)).toMatch(/^3 הוצאות · הופק \d{2}\.\d{2}\.\d{4}$/);

    // header row 6
    const head = ws.getRow(6);
    expect(head.getCell(1).value).toBe("תאריך");
    expect(head.getCell(7).value).toBe("סכום כולל מע״מ");
    expect(head.getCell(1).font?.bold).toBe(true);
    expect((head.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFF4EA");
    expect(head.getCell(1).border?.bottom?.style).toBe("medium");

    // body row 7: real date, real numbers, ₪ format
    const first = ws.getRow(7);
    expect(first.getCell(1).value).toBeInstanceOf(Date);
    expect((first.getCell(1).value as Date).toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(first.getCell(1).numFmt).toBe("dd.mm.yyyy");
    expect(first.getCell(5).value).toBe(99);
    expect(first.getCell(7).value).toBe(117);
    expect(first.getCell(7).numFmt.startsWith('"₪"')).toBe(true);
    expect(first.getCell(7).border?.bottom?.style).toBe("thin");

    // total row 10: label, live SUM with cached result, bold on a peach wash
    const total = ws.getRow(10);
    expect(total.getCell(1).value).toBe("סה״כ");
    const f = total.getCell(7).value as ExcelJS.CellFormulaValue;
    expect(f.formula).toBe("SUM(G7:G9)");
    expect(f.result).toBe(751.5);
    expect((total.getCell(6).value as ExcelJS.CellFormulaValue).result).toBe(115.64);
    expect(total.getCell(7).font?.bold).toBe(true);
    expect((total.getCell(7).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFF4EA");
    expect(total.getCell(7).border?.top?.style).toBe("medium");

    // widths: explicit honoured, measured ones sane
    expect(ws.getColumn(4).width).toBe(34);
    expect(ws.getColumn(7).width ?? 0).toBeGreaterThanOrEqual(14);
    expect(ws.getColumn(7).width ?? 0).toBeLessThanOrEqual(48);

    expect(fs.statSync(file).size).toBeGreaterThan(5000);
  });

  it("writes an honest empty state and a zero total when there are no rows", async () => {
    const { wb } = await roundTrip([expensesSheet([])], "empty.xlsx");
    const ws = wb.getWorksheet(1)!;
    expect(ws.getCell("A7").value).toBe("אין שורות לייצוא");
    expect(ws.getRow(8).getCell(7).value).toBe(0);
    expect(ws.autoFilter).toBeFalsy();
  });

  it("supports literal and computed totals and several sheets in one file", async () => {
    type Row = { label: string; income: number; margin: number | null };
    const rows: Row[] = [
      { label: "ינואר", income: 1000, margin: 40 },
      { label: "פברואר", income: 0, margin: null },
    ];
    const s = sheet<Row>({
      name: "פירוט/חודשי?",
      title: "פירוט חודשי",
      rows,
      columns: [
        { header: "חודש", value: (r) => r.label },
        { header: "הכנסות", value: (r) => r.income, kind: "money", total: "sum" },
        { header: "שולי רווח", value: (r) => r.margin, kind: "percent", total: () => 20 },
      ],
    });
    const { wb } = await roundTrip([s, expensesSheet(expenses)], "multi.xlsx");
    expect(wb.worksheets.map((w) => w.name)).toEqual(["פירוט חודשי", "הוצאות"]);
    const ws = wb.getWorksheet(1)!;
    // no business name / subtitle: title at A1, count line at A2, header at 4
    expect(ws.getCell("A1").value).toBe("פירוט חודשי");
    expect((ws.views[0] as ExcelJS.WorksheetViewFrozen).ySplit).toBe(4);
    expect(ws.getRow(5).getCell(3).value).toBe(40);
    expect(ws.getRow(5).getCell(3).numFmt).toBe('0"%"');
    // null margin stays blank, never 0
    expect(ws.getRow(6).getCell(3).value).toBeNull();
    const total = ws.getRow(7);
    expect(total.getCell(1).value).toBe("סה״כ");
    expect((total.getCell(2).value as ExcelJS.CellFormulaValue).result).toBe(1000);
    expect(total.getCell(3).value).toBe(20);
  });
});
