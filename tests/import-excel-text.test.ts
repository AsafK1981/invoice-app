import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  gridToCappedCsv,
  parseAttachmentToCsvText,
  MAX_ATTACHMENT_ROWS,
  MAX_ATTACHMENT_CHARS,
} from "@/lib/import-excel-text";

function xlsxFile(sheets: Record<string, unknown[][]>, name = "book.xlsx"): File {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name);
}

/**
 * These rows become the model's only view of the user's spreadsheet, and the
 * drafts it suggests are built from them. Two failure modes matter:
 *
 *   1. Silent truncation. If a 400-row sheet arrives as 200 rows with no
 *      notice, the assistant confidently prepares drafts for half a month and
 *      nobody can tell from the reply that anything is missing.
 *   2. Structural damage. A newline or a quote inside a cell shifts every
 *      column after it, and the model reads an amount out of the wrong column.
 */

describe("gridToCappedCsv", () => {
  it("keeps a simple grid intact", () => {
    const out = gridToCappedCsv([
      ["תאריך", "מקום", "סכום"],
      ["2026-07-03", "מועדון הזהב", 3500],
    ]);
    expect(out.rowsAsCsv).toBe("תאריך|מקום|סכום\n2026-07-03|מועדון הזהב|3500");
    expect(out.rowCount).toBe(2);
    expect(out.truncated).toBe(false);
  });

  it("drops fully empty rows and trailing empty columns", () => {
    const out = gridToCappedCsv([
      ["a", "b", "", ""],
      ["", "", "", ""],
      ["c", "d", "", ""],
    ]);
    expect(out.rowsAsCsv).toBe("a|b\nc|d");
    expect(out.rowCount).toBe(2);
  });

  it("pads ragged rows to the widest row so columns stay aligned", () => {
    const out = gridToCappedCsv([
      ["date", "venue", "amount"],
      ["2026-07-03", "club"],
    ]);
    expect(out.rowsAsCsv.split("\n")[1]).toBe("2026-07-03|club|");
  });

  it("renders dates as ISO, not as spreadsheet serials", () => {
    const out = gridToCappedCsv([[new Date(Date.UTC(2026, 6, 3)), 1200]]);
    expect(out.rowsAsCsv).toBe("2026-07-03|1200");
  });

  it("neutralises newlines and pipes inside a cell", () => {
    const out = gridToCappedCsv([["line1\nline2", "a|b"]]);
    expect(out.rowsAsCsv).toBe("line1 line2|a/b");
    expect(out.rowsAsCsv.split("\n")).toHaveLength(1);
  });

  // The reason the separator is a pipe at all: commas are ordinary content in
  // a real Israeli sheet, and as a separator each one would shift every column
  // after it - which is how an amount gets read out of the wrong column.
  it("keeps columns aligned when cells contain commas", () => {
    const out = gridToCappedCsv([
      ["מקום", "סכום"],
      ["מועדון, תל אביב", "1,550"],
    ]);
    expect(out.rowsAsCsv.split("\n").map((l) => l.split("|").length)).toEqual([2, 2]);
  });

  it("caps the row count and says how many rows were dropped", () => {
    const grid = Array.from({ length: MAX_ATTACHMENT_ROWS + 15 }, (_, i) => [`row${i}`]);
    const out = gridToCappedCsv(grid);
    expect(out.truncated).toBe(true);
    expect(out.rowCount).toBe(MAX_ATTACHMENT_ROWS);
    expect(out.rowsAsCsv).toContain("15 שורות נוספות לא נכללו");
  });

  it("caps total characters even when the row count is legal", () => {
    const grid = Array.from({ length: 50 }, () => ["x".repeat(2000)]);
    const out = gridToCappedCsv(grid);
    expect(out.truncated).toBe(true);
    expect(out.rowsAsCsv.length).toBeLessThan(MAX_ATTACHMENT_CHARS + 200);
    expect(out.rowCount).toBeLessThan(50);
  });

  it("returns nothing for an empty grid", () => {
    expect(gridToCappedCsv([]).rowCount).toBe(0);
    expect(gridToCappedCsv([[""], [null]] as unknown[][]).rowCount).toBe(0);
  });
});

describe("parseAttachmentToCsvText", () => {
  it("reads the first sheet that has content, not the first sheet", async () => {
    const out = await parseAttachmentToCsvText(xlsxFile({ ריק: [[]], יש: [["a", "b"], [1, 2]] }));
    expect(out.rowsAsCsv).toBe("a|b\n1|2");
  });

  it("evaluates formulas instead of leaking their text", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["סכום"], [0]]);
    ws.A2 = { t: "n", f: "20*3", v: 60 };
    XLSX.utils.book_append_sheet(wb, ws, "s");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const out = await parseAttachmentToCsvText(new File([buf], "f.xlsx"));
    expect(out.rowsAsCsv).toBe("סכום\n60");
  });

  // SheetJS "successfully" parses arbitrary bytes into one cell of control
  // characters. Without the control-character strip that reads as a valid
  // one-row sheet, and we only discover otherwise after paying for a model call.
  it("rejects a file that is not a spreadsheet at all", async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5])], "junk.xlsx");
    await expect(parseAttachmentToCsvText(junk)).rejects.toThrow();
  });

  it("rejects a file over the size cap before parsing it", async () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.xlsx");
    await expect(parseAttachmentToCsvText(big)).rejects.toThrow();
  });

  // Israeli Excel writes CSV as Windows-1255, so UTF-8 decoding would mojibake
  // every Hebrew client name in the file.
  it("decodes a Windows-1255 CSV without mojibake", async () => {
    const bytes = new Uint8Array([0xf9, 0xec, 0xe5, 0xed, 0x2c, 0x31, 0x30, 0x30]);
    const out = await parseAttachmentToCsvText(new File([bytes], "he.csv"));
    expect(out.rowsAsCsv).toBe("שלום|100");
  });
});
