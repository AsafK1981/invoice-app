import { describe, it, expect } from "vitest";
import { decodeFileBytes } from "@/lib/import-decode";

// Helper: build an ArrayBuffer from raw byte values.
function buf(...bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

describe("decodeFileBytes", () => {
  it("decodes Windows-1255 Hebrew (Israeli Excel Save-as-CSV)", () => {
    // "תאריך" in cp1255: ת=0xFA א=0xE0 ר=0xF8 י=0xE9 ך=0xEA
    const s = decodeFileBytes(buf(0xfa, 0xe0, 0xf8, 0xe9, 0xea));
    expect(s).toBe("תאריך");
  });

  it("decodes a full cp1255 CSV line correctly", () => {
    // "לקוח,סכום" — ל=0xEC ק=0xF7 ו=0xE5 ח=0xE7 , =0x2C ס=0xF1 כ=0xEB ו=0xE5 ם=0xED
    const s = decodeFileBytes(
      buf(0xec, 0xf7, 0xe5, 0xe7, 0x2c, 0xf1, 0xeb, 0xe5, 0xed),
    );
    expect(s).toBe("לקוח,סכום");
  });

  it("strips a UTF-8 BOM", () => {
    // EF BB BF + "ab"
    const s = decodeFileBytes(buf(0xef, 0xbb, 0xbf, 0x61, 0x62));
    expect(s).toBe("ab");
  });

  it("decodes plain UTF-8 Hebrew", () => {
    const bytes = new TextEncoder().encode("שלום");
    const s = decodeFileBytes(bytes.buffer as ArrayBuffer);
    expect(s).toBe("שלום");
  });

  it("decodes UTF-16 LE BOM", () => {
    // FF FE + "Hi" little-endian
    const s = decodeFileBytes(buf(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00));
    expect(s).toBe("Hi");
  });

  it("plain ASCII passes through", () => {
    const bytes = new TextEncoder().encode("number,total\n1,100");
    const s = decodeFileBytes(bytes.buffer as ArrayBuffer);
    expect(s).toBe("number,total\n1,100");
  });
});
