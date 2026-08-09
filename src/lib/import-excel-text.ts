import * as XLSX from "xlsx";
import Papa from "papaparse";
import { decodeFileBytes } from "@/lib/import-decode";

/**
 * Turns a spreadsheet the user drops into the assistant chat into a compact
 * block of text the model can read.
 *
 * Deliberately NOT the bulk-import pipeline. That one maps known header names
 * onto known entities and refuses rows it can't map; here the whole point is
 * that the file is arbitrary - a gig list, a shift table, whatever the user
 * keeps - so we hand the grid over as-is and let the model interpret it.
 *
 * Caps exist for the token budget, not for correctness: a 5,000-row sheet would
 * blow past the context window and cost real money per turn. When we cut, we
 * say so in the text itself, so the model can tell the user rather than
 * silently reasoning about a partial file.
 */

/** Rows handed to the model. A month of gigs is tens of rows, not hundreds. */
export const MAX_ATTACHMENT_ROWS = 200;
/** Hard character ceiling, whichever binds first. */
export const MAX_ATTACHMENT_CHARS = 30_000;
/** Rejected before parsing - anything larger is not a gig list. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const ATTACHMENT_ACCEPT = ".xlsx,.xls,.csv";

export interface ParsedAttachment {
  fileName: string;
  rowsAsCsv: string;
  rowCount: number;
  truncated: boolean;
}

type Cell = unknown;

/**
 * Turns every control character into a space.
 *
 * Two jobs at once. Newlines and tabs inside a cell would break the row/column
 * structure the model lines its columns up by. And SheetJS will happily
 * "parse" a file that is not a spreadsheet at all - five junk bytes named
 * .xlsx come back as a single cell of raw control bytes - so without this,
 * garbage reads as a legitimate one-row sheet and we only find out after
 * paying for a model call.
 *
 * Written as a code-point filter rather than a regex so no control character
 * has to appear literally in this file.
 */
function stripControl(s: string): string {
  return Array.from(s)
    .map((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c < 32 || (c >= 127 && c <= 159) ? " " : ch;
    })
    .join("");
}

function formatCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  // cellDates:true gives us real Dates for date columns; ISO keeps them
  // unambiguous for the model (an Israeli sheet's 03/04 is not obvious).
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  // The pipe is the column separator, so a cell may not contain one.
  return stripControl(String(value)).replace(/ +/g, " ").replace(/\|/g, "/").trim();
}

/**
 * Grid -> capped CSV text. Pure, so the caps and the truncation notice are
 * testable without a browser File or SheetJS.
 */
export function gridToCappedCsv(grid: Cell[][]): {
  rowsAsCsv: string;
  rowCount: number;
  truncated: boolean;
} {
  const rows = (Array.isArray(grid) ? grid : [])
    .map((row) => (Array.isArray(row) ? row.map(formatCell) : []))
    .filter((row) => row.some((cell) => cell !== ""));

  // Trailing empty columns are common in hand-kept sheets (a stray formatted
  // cell far to the right) and would pad every single row with commas.
  const width = rows.reduce((max, row) => {
    let last = 0;
    for (let i = 0; i < row.length; i++) if (row[i] !== "") last = i + 1;
    return Math.max(max, last);
  }, 0);

  const lines: string[] = [];
  let truncated = rows.length > MAX_ATTACHMENT_ROWS;
  let used = 0;

  for (const row of rows.slice(0, MAX_ATTACHMENT_ROWS)) {
    const cells = row.slice(0, width);
    while (cells.length < width) cells.push("");
    // Pipe-separated, not comma-separated: a comma is ordinary content in a
    // real sheet ("מועדון, תל אביב", an amount typed as 1,550) and every one of
    // them would shift the columns after it, which is how the model ends up
    // reading an amount out of the wrong column. A pipe never appears in this
    // kind of file, and formatCell strips the ones that somehow do.
    const line = cells.join("|");
    if (used + line.length + 1 > MAX_ATTACHMENT_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  const dropped = rows.length - lines.length;
  const text = lines.join("\n");
  return {
    rowsAsCsv: truncated
      ? `${text}\n[הקובץ נחתך - ${dropped} שורות נוספות לא נכללו]`
      : text,
    rowCount: lines.length,
    truncated,
  };
}

/**
 * Columns read from a sheet. A gig list is a handful of columns; a stray
 * formatted cell out at column XFD would otherwise make SheetJS materialise
 * 16,384-wide rows - enough to hang the user's own tab, and enough for one
 * outlier row to widen every other row and eat the character budget.
 */
const MAX_ATTACHMENT_COLS = 40;

/** The raw grid of the first sheet that actually has content. */
function workbookToGrid(buf: ArrayBuffer): Cell[][] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const grid = XLSX.utils
      .sheet_to_json<Cell[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
      })
      .map((row) => (Array.isArray(row) ? row.slice(0, MAX_ATTACHMENT_COLS) : row));
    if (grid.some((row) => Array.isArray(row) && row.some((c) => formatCell(c) !== ""))) {
      return grid;
    }
  }
  return [];
}

function csvTextToGrid(text: string): Cell[][] {
  // header:false on purpose - the model reads the header row itself, and many
  // real sheets have a title line or a blank row above the actual headers.
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return parsed.data.filter(Array.isArray);
}

export async function parseAttachmentToCsvText(file: File): Promise<ParsedAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("הקובץ גדול מדי (עד 5MB).");
  }
  const isCsv = /\.csv$/i.test(file.name);
  const buf = await file.arrayBuffer();

  let grid: Cell[][];
  try {
    grid = isCsv ? csvTextToGrid(decodeFileBytes(buf)) : workbookToGrid(buf);
  } catch {
    throw new Error("לא הצלחתי לקרוא את הקובץ. נסה לשמור אותו מחדש כ-Excel או CSV.");
  }

  const { rowsAsCsv, rowCount, truncated } = gridToCappedCsv(grid);
  if (!rowCount) throw new Error("הקובץ ריק או שאין בו נתונים קריאים.");

  return { fileName: file.name.slice(0, 200), rowsAsCsv, rowCount, truncated };
}
