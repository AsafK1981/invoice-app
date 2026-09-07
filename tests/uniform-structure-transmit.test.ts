import { describe, it, expect, vi, afterEach } from "vitest";
import {
  chunkSizeFor,
  contentRange,
  maxUploadBytes,
  formatPeriod,
  uploadInChunks,
  transmitFile,
} from "@/lib/uniform-structure/transmit";

/**
 * The transmission protocol is all off-by-one risk: chunk boundaries,
 * inclusive-vs-exclusive byte ranges, and a 308 that means success. None of
 * that can be checked against שע"ם yet - production is not exposed and the
 * sandbox only accepts a PDF under 1 MB - so the arithmetic is pinned here
 * instead.
 */

const MB = 1024 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chunkSizeFor", () => {
  it("sends anything up to 32 MB in a single request", () => {
    expect(chunkSizeFor(1)).toBe(1);
    expect(chunkSizeFor(700_000)).toBe(700_000); // a real BKMVDATA for a small business
    expect(chunkSizeFor(32 * MB)).toBe(32 * MB);
  });

  it("switches to fixed chunks exactly one byte over each boundary", () => {
    expect(chunkSizeFor(32 * MB + 1)).toBe(33_554_432);
    expect(chunkSizeFor(250 * MB)).toBe(33_554_432);
    expect(chunkSizeFor(250 * MB + 1)).toBe(67_108_864);
    expect(chunkSizeFor(1024 * MB)).toBe(67_108_864);
    expect(chunkSizeFor(1024 * MB + 1)).toBe(134_217_728);
  });
});

describe("contentRange", () => {
  it("reports an inclusive end, which is one less than the exclusive bound", () => {
    expect(contentRange(0, 1024, 4096)).toBe("bytes 0-1023/4096");
  });

  it("closes the range at the last byte for a final short chunk", () => {
    expect(contentRange(4000, 4096, 4096)).toBe("bytes 4000-4095/4096");
  });

  it("covers the whole file when everything fits in one chunk", () => {
    expect(contentRange(0, 700, 700)).toBe("bytes 0-699/700");
  });
});

describe("maxUploadBytes", () => {
  it("takes the upper bound out of the range header", () => {
    expect(maxUploadBytes({ "x-goog-content-length-range": "0,1048576" })).toBe(1048576);
    expect(maxUploadBytes({ "x-goog-content-length-range": "0,53687091200" })).toBe(53687091200);
  });

  it("returns null rather than a wrong number when the header is missing or junk", () => {
    expect(maxUploadBytes(undefined)).toBeNull();
    expect(maxUploadBytes({})).toBeNull();
    expect(maxUploadBytes({ "x-goog-content-length-range": "nonsense" })).toBeNull();
  });
});

describe("formatPeriod", () => {
  it("follows the worked examples in the spec, not its prose", () => {
    expect(formatPeriod("2025-01-01")).toBe("2025-01-01");
    expect(formatPeriod(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatPeriod(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("refuses an unparseable date instead of sending NaN to gov.il", () => {
    expect(() => formatPeriod("not a date")).toThrow(/invalid period date/);
  });
});

describe("uploadInChunks", () => {
  it("sends a small file as one request covering the whole range", async () => {
    const calls: { range: string | undefined; length: string | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const h = init.headers as Record<string, string>;
        calls.push({ range: h["Content-Range"], length: h["Content-Length"] });
        return new Response("", { status: 200 });
      }),
    );

    await uploadInChunks("https://upload.example/x", new Uint8Array(700_000));

    expect(calls).toEqual([{ range: "bytes 0-699999/700000", length: "700000" }]);
  });

  it("splits a file over 32 MB into contiguous chunks and accepts 308 between them", async () => {
    const total = 33 * MB; // two chunks: 32 MB then the remainder
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const range = (init.headers as Record<string, string>)["Content-Range"];
        calls.push(range);
        // Google answers 308 for every chunk but the last.
        const isLast = range.startsWith(`bytes ${33_554_432}-`);
        return new Response("", { status: isLast ? 200 : 308 });
      }),
    );

    await uploadInChunks("https://upload.example/x", new Uint8Array(total));

    expect(calls).toEqual([
      `bytes 0-33554431/${total}`,
      `bytes 33554432-${total - 1}/${total}`,
    ]);
  });

  it("treats a non-308 mid-upload answer as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    await expect(uploadInChunks("https://upload.example/x", new Uint8Array(33 * MB))).rejects.toThrow(
      /expected 308/,
    );
  });

  it("refuses to transmit an empty file", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(uploadInChunks("https://upload.example/x", new Uint8Array(0))).rejects.toThrow(
      /empty file/,
    );
  });
});

describe("transmitFile", () => {
  it("rejects an oversized file before uploading, not after", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transmitFile(
        {
          fileName: "BKMVDATA.txt",
          signUrl: "https://storage.googleapis.com/x",
          fileUniqueId: "u1",
          headers: { "x-goog-content-length-range": "0,1000" },
        },
        new Uint8Array(2000),
      ),
    ).rejects.toThrow(/חורג מהמותר/);

    // The point of the pre-check: no bytes were sent at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
