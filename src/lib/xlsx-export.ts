/**
 * Styled Excel (.xlsx) export shared by every "ייצוא ל-Excel" button.
 *
 * Until 2026-09-03 the exports were bare CSV files: Excel opened them as a
 * grid of unformatted cells with no title, no total row, dates as text and
 * amounts without a currency format. Asaf: "the file is not designed, does
 * not look good, and the total row is missing - it should look like the
 * report we printed". So the sheet mirrors `PrintSheet` (print-sheet.tsx):
 *
 *   business name          <- bold, small
 *   report title           <- bold, large
 *   subtitle (filters)     <- grey
 *   "N rows · הופק date"   <- grey
 *   header row             <- peach wash, bold, medium rule under it
 *   body rows              <- hairline under each row
 *   total row              <- peach wash, bold, medium rule above it
 *
 * Colours are the app-skin tokens: --goldtint #fff4ea, --goldtintline
 * #fddcc0, --ink #241e16, --ink2 #5a5245, --line #e9e1d0, and the table
 * hairline #f2ede1. Sheets are right-to-left so Hebrew headers sit where a
 * Hebrew reader expects them and numbers fall on the left edge, exactly like
 * the printed sheet.
 *
 * Amounts are real numbers with a ₪ number format (never pre-formatted
 * strings) so the accountant can still sum, sort and filter. The total row
 * is a live SUM formula with the computed result cached in the file, so it
 * is right in Excel, Numbers, Google Sheets and any viewer that does not
 * recalculate.
 *
 * exceljs is loaded lazily: it is a ~1 MB library used a few times a month.
 */
import { formatDate } from "./format";

export type CellKind = "text" | "money" | "int" | "percent" | "date";

export type CellValue = string | number | null | undefined;

export interface XlsxColumn<T> {
  header: string;
  /** For `kind: "date"` return an ISO "YYYY-MM-DD"; it becomes a real Excel date. */
  value: (row: T) => CellValue;
  kind?: CellKind;
  /** Column width in Excel character units. Measured from the content when omitted. */
  width?: number;
  /**
   * Cell for the total row. "sum" sums the column with a live formula; a
   * literal is written as-is; a function sees all rows. The total row is
   * rendered only when some column defines one.
   */
  total?: "sum" | string | number | ((rows: T[]) => CellValue);
}

export interface XlsxSheet<T> {
  /** Tab name (Excel caps it at 31 chars and forbids : \ / ? * [ ]). */
  name: string;
  title: string;
  subtitle?: string;
  businessName?: string;
  /** e.g. "12 מסמכים". Rendered next to the generation date. */
  countLabel?: string;
  columns: XlsxColumn<T>[];
  rows: T[];
  /** Label in the first cell of the total row. Default "סה״כ". */
  totalLabel?: string;
  /** Free-text lines under the table (disclaimers, checklists). */
  notes?: string[];
}

/* ---------- resolved, non-generic form so mixed sheets fit one workbook ---------- */

type TotalCell = { sum: true } | { literal: CellValue };

interface ResolvedSheet {
  name: string;
  title: string;
  subtitle?: string;
  businessName?: string;
  countLabel?: string;
  totalLabel: string;
  notes: string[];
  columns: { header: string; kind: CellKind; width?: number }[];
  rows: CellValue[][];
  totals: TotalCell[] | null;
}

/** Resolve a typed sheet spec into plain cell matrices. */
export function sheet<T>(spec: XlsxSheet<T>): ResolvedSheet {
  const columns = spec.columns.map((c) => ({ header: c.header, kind: c.kind ?? "text", width: c.width }));
  const rows = spec.rows.map((r) => spec.columns.map((c) => c.value(r)));
  const hasTotal = spec.columns.some((c) => c.total !== undefined);
  const totals: TotalCell[] | null = hasTotal
    ? spec.columns.map((c) => {
        if (c.total === "sum") return { sum: true };
        if (typeof c.total === "function") return { literal: c.total(spec.rows) };
        return { literal: c.total };
      })
    : null;
  return {
    name: safeSheetName(spec.name),
    title: spec.title,
    subtitle: spec.subtitle,
    businessName: spec.businessName,
    countLabel: spec.countLabel,
    totalLabel: spec.totalLabel ?? "סה״כ",
    notes: spec.notes ?? [],
    columns,
    rows,
    totals,
  };
}

function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet1";
}

/* ---------- palette (app-skin.css tokens, ARGB) ---------- */
const INK = "FF241E16";
const INK2 = "FF5A5245";
const MUTED = "FF6F6757";
const WASH = "FFFFF4EA"; // --goldtint
const WASH_LINE = "FFFDDCC0"; // --goldtintline
const HAIRLINE = "FFF2EDE1"; // .rpt-table td border

const FONT = "Arial";

const NUM_FMT: Record<CellKind, string | undefined> = {
  text: undefined,
  money: '"₪"#,##0.00;-"₪"#,##0.00',
  int: "#,##0",
  percent: '0"%"',
  date: "dd.mm.yyyy",
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today as a local-time YYYY-MM-DD (never UTC: that is yesterday every evening in Israel). */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toCell(value: CellValue, kind: CellKind): string | number | Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "date" && typeof value === "string") {
    const m = DATE_ONLY.exec(value);
    // UTC midnight: exceljs converts Date -> Excel serial in UTC, so a local
    // midnight east of Greenwich would land on the previous day.
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return value;
  }
  if ((kind === "money" || kind === "int" || kind === "percent") && typeof value === "number") {
    return Math.round(value * 100) / 100;
  }
  return value;
}

/** Rough on-screen width of a value, in Excel character units. */
function displayLength(value: CellValue, kind: CellKind): number {
  if (value === null || value === undefined) return 0;
  if (kind === "date") return 10;
  if (typeof value === "number") {
    const s = Math.abs(Math.round(value)).toLocaleString("en-US");
    return s.length + (kind === "money" ? 5 : kind === "percent" ? 2 : 1);
  }
  return String(value).length;
}

function columnLetter(index1: number): string {
  let n = index1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/* ---------- workbook ---------- */

/** Build the workbook without touching the DOM (also used by the Node-side test). */
export async function buildWorkbook(sheets: ResolvedSheet[]): Promise<Workbook> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "My Friendly Invoice App";
  wb.created = new Date();
  for (const s of sheets) renderSheet(wb, s);
  return wb;
}

export async function downloadXlsx(filename: string, sheets: ResolvedSheet[]): Promise<void> {
  const wb = await buildWorkbook(sheets);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  // Revoke on the next tick: revoking synchronously races the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Workbook = import("exceljs").Workbook;
type Worksheet = import("exceljs").Worksheet;
type Borders = Partial<import("exceljs").Borders>;

function renderSheet(wb: Workbook, s: ResolvedSheet) {
  const colCount = Math.max(1, s.columns.length);
  const lastCol = columnLetter(colCount);

  const ws: Worksheet = wb.addWorksheet(s.name, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: colCount > 6 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  });

  /* --- header block: mirrors PrintSheet's <header> --- */
  let r = 1;
  const addHeadLine = (text: string, font: Partial<import("exceljs").Font>, height: number) => {
    const row = ws.getRow(r);
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = { name: FONT, ...font };
    cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
    if (colCount > 1) ws.mergeCells(r, 1, r, colCount);
    row.height = height;
    r += 1;
  };
  if (s.businessName) addHeadLine(s.businessName, { bold: true, size: 11, color: { argb: INK } }, 18);
  addHeadLine(s.title, { bold: true, size: 16, color: { argb: INK } }, 26);
  if (s.subtitle) addHeadLine(s.subtitle, { size: 10, color: { argb: INK2 } }, 16);
  addHeadLine(
    `${s.countLabel ? `${s.countLabel} · ` : ""}הופק ${formatDate(todayIso())}`,
    { size: 9, color: { argb: MUTED } },
    15,
  );
  ws.getRow(r).height = 8; // breathing room before the table
  r += 1;

  /* --- table header --- */
  const headerRow = r;
  const head = ws.getRow(headerRow);
  s.columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WASH } };
    cell.alignment = {
      horizontal: c.kind === "text" ? "right" : "left",
      vertical: "middle",
      wrapText: true,
      readingOrder: "rtl",
    };
    cell.border = {
      bottom: { style: "medium", color: { argb: WASH_LINE } },
    };
  });
  // Two lines tall: a long Hebrew label ("סכום כולל מע״מ") wraps instead of
  // being clipped behind the autofilter arrow.
  head.height = 32;
  r += 1;

  /* --- body --- */
  const firstBodyRow = r;
  if (s.rows.length === 0) {
    const row = ws.getRow(r);
    const cell = row.getCell(1);
    cell.value = "אין שורות לייצוא";
    cell.font = { name: FONT, size: 10, color: { argb: MUTED } };
    cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
    cell.border = { bottom: { style: "thin", color: { argb: HAIRLINE } } };
    if (colCount > 1) ws.mergeCells(r, 1, r, colCount);
    row.height = 20;
    r += 1;
  } else {
    for (const values of s.rows) {
      const row = ws.getRow(r);
      s.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = toCell(values[i], c.kind);
        if (v !== null) cell.value = v;
        cell.font = { name: FONT, size: 10, color: { argb: INK } };
        const fmt = NUM_FMT[c.kind];
        if (fmt) cell.numFmt = fmt;
        cell.alignment = {
          horizontal: c.kind === "text" ? "right" : "left",
          vertical: "middle",
          readingOrder: c.kind === "text" ? "rtl" : "ltr",
          wrapText: c.kind === "text",
        };
        cell.border = { bottom: { style: "thin", color: { argb: HAIRLINE } } };
      });
      row.height = 18;
      r += 1;
    }
  }
  const lastBodyRow = r - 1;

  /* --- total row: PrintSheet's <tfoot> / .rpt-total --- */
  if (s.totals) {
    const row = ws.getRow(r);
    const border: Borders = {
      top: { style: "medium", color: { argb: WASH_LINE } },
      bottom: { style: "medium", color: { argb: WASH_LINE } },
    };
    let labelPlaced = false;
    s.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const t = s.totals![i];
      if ("sum" in t) {
        const col = columnLetter(i + 1);
        const result = s.rows.reduce((sum, values) => {
          const v = values[i];
          return typeof v === "number" ? sum + v : sum;
        }, 0);
        cell.value =
          s.rows.length > 0
            ? { formula: `SUM(${col}${firstBodyRow}:${col}${lastBodyRow})`, result: Math.round(result * 100) / 100 }
            : 0;
        const fmt = NUM_FMT[c.kind];
        if (fmt) cell.numFmt = fmt;
      } else if (t.literal !== undefined && t.literal !== null && t.literal !== "") {
        const v = toCell(t.literal, typeof t.literal === "number" ? c.kind : "text");
        if (v !== null) cell.value = v;
        if (typeof t.literal === "number" && NUM_FMT[c.kind]) cell.numFmt = NUM_FMT[c.kind]!;
        if (typeof t.literal === "string") labelPlaced = true;
      } else if (!labelPlaced) {
        // The first column without its own total carries the label, like
        // the print sheet puts "סה״כ" under the date column.
        cell.value = s.totalLabel;
        labelPlaced = true;
      }
      const isLabel = typeof cell.value === "string";
      cell.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WASH } };
      cell.alignment = {
        horizontal: isLabel || c.kind === "text" ? "right" : "left",
        vertical: "middle",
        readingOrder: isLabel || c.kind === "text" ? "rtl" : "ltr",
      };
      cell.border = border;
    });
    if (!labelPlaced) {
      const first = row.getCell(1);
      if (first.value === null || first.value === undefined) first.value = s.totalLabel;
    }
    row.height = 22;
    r += 1;
  }

  /* --- notes under the table --- */
  if (s.notes.length > 0) {
    r += 1;
    for (const note of s.notes) {
      const row = ws.getRow(r);
      const cell = row.getCell(1);
      cell.value = note;
      cell.font = { name: FONT, size: 9, italic: true, color: { argb: INK2 } };
      cell.alignment = { horizontal: "right", vertical: "top", wrapText: true, readingOrder: "rtl" };
      if (colCount > 1) ws.mergeCells(r, 1, r, colCount);
      // ~ one line per 90 characters across the merged width
      row.height = Math.max(16, Math.ceil(note.length / 90) * 15);
      r += 1;
    }
  }

  /* --- column widths --- */
  const hasFilter = s.rows.length > 0;
  s.columns.forEach((c, i) => {
    if (c.width) {
      ws.getColumn(i + 1).width = c.width;
      return;
    }
    // Header words wrap onto the two-line header row, so the header only
    // needs its longest word; body values never wrap and drive the width.
    let max = Math.max(...c.header.split(" ").map((w) => w.length));
    const sample = s.rows.slice(0, 500);
    for (const values of sample) max = Math.max(max, displayLength(values[i], c.kind));
    if (s.totals && i === 0) max = Math.max(max, s.totalLabel.length);
    // Hebrew glyphs run slightly wider than the Excel unit, the autofilter
    // arrow eats ~3 units of the header cell, and a cap keeps one long
    // description from stretching the sheet off the page.
    const filterPad = hasFilter ? 3 : 0;
    ws.getColumn(i + 1).width = Math.min(48, Math.max(10, Math.ceil(max * 1.15) + 2 + filterPad));
  });

  /* --- sheet-level: RTL, frozen header, filter, print titles --- */
  ws.views = [{ rightToLeft: true, state: "frozen", xSplit: 0, ySplit: headerRow, showGridLines: false }];
  if (s.rows.length > 0) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastBodyRow, column: colCount } };
  }
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  ws.pageSetup.printArea = `A1:${lastCol}${r - 1}`;
}
