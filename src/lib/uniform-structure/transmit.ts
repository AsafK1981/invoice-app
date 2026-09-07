/**
 * Transmitting the מבנה אחיד files to רשות המסים.
 *
 * From 1.1.2027 every registered accounting-software vendor must send the
 * uniform-structure files to the Tax Authority the moment they are produced,
 * by calling a dedicated API. The instruction letter is explicit that this is
 * not optional: "יודגש כי עמידה בתוספת זאת הינה תנאי לרישום התוכנה".
 *
 * Source: "הנחיות בדבר שידור קובץ במבנה אחיד - תיאור ה-API's", מהדורה 1.0,
 * 3/2026, chapters 2-4.
 *
 * The protocol is three legs, and only the first and last touch gov.il:
 *
 *   1. POST GetUrlsForUploadingFiles       (gov.il, OAuth2 user token)
 *      -> a uniqueId plus two signed Google Cloud Storage targets, in a
 *         fixed order: INI first, BKMVDATA second.
 *   2. POST the signed URL with the returned headers and an empty body
 *      -> 201, and the real upload URL arrives in the Location header.
 *      PUT the bytes there, in chunks of a size the spec dictates.
 *   3. POST get-file-status                (gov.il, OAuth2 user token)
 *      -> Uploaded / Approved / Rejected per file, polled later.
 *
 * Legs 1 and 3 are geo-blocked outside Israel and go through the same
 * Israeli-egress proxy as the allocation calls. Leg 2 talks to
 * storage.googleapis.com, which is not blocked, so it is never proxied.
 *
 * Everything here is transport. Deciding when to transmit, and what to do
 * when a business has not connected its gov.il account, belongs to the
 * caller.
 */

import { govFetchTarget } from "@/lib/tax-authority";

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

const ITA_BASE =
  process.env.TAX_AUTHORITY_ENV === "production"
    ? "https://ita-api.taxes.gov.il/shaam/production"
    : "https://ita-api.taxes.gov.il/shaam/tsandbox";

const LINKS_URL = `${ITA_BASE}/UniStructFileUploadLinksApi/v1/UploadingFile/GetUrlsForUploadingFiles`;
const STATUS_URL = `${ITA_BASE}/FilesStatusApi/v1/Files/get-file-status`;

/* ------------------------------------------------------------------ */
/* Pure helpers - the parts worth unit testing                         */
/* ------------------------------------------------------------------ */

const MB = 1024 * 1024;

/**
 * Chunk size for a resumable upload, per the table in chapter 3.2 (and the
 * 2026-08-26 clarification from לקוחות בתי תוכנה, which replaced the original
 * flat 1 MB rule to cut the number of round trips).
 *
 * A file at or under 32 MB goes in a single request; the exact byte counts
 * above that are the spec's own, not a rounding of MB, so they are spelled
 * out rather than computed.
 */
export function chunkSizeFor(totalBytes: number): number {
  if (totalBytes <= 32 * MB) return totalBytes;
  if (totalBytes <= 250 * MB) return 33_554_432; // 32 MB
  if (totalBytes <= 1024 * MB) return 67_108_864; // 64 MB
  return 134_217_728; // 128 MB
}

/**
 * The ceiling רשות המסים computed for this dealer, taken from the
 * `x-goog-content-length-range` header ("0,1048576" means up to 1,048,576
 * bytes). Returns null when the header is absent or unparseable.
 *
 * Worth checking before uploading: chapter 3.1 warns that an oversized file
 * fails only once the upload reaches the limit, not at initiation, so the
 * user would otherwise wait through a whole transfer to be told no.
 */
export function maxUploadBytes(headers: Record<string, string> | undefined): number | null {
  const raw = headers?.["x-goog-content-length-range"];
  if (!raw) return null;
  const parts = String(raw).split(",");
  const max = Number(parts[parts.length - 1]);
  return Number.isFinite(max) ? max : null;
}

/** `bytes 0-1023/4096`, the Content-Range a resumable PUT chunk needs. */
export function contentRange(start: number, endExclusive: number, total: number): string {
  return `bytes ${start}-${endExclusive - 1}/${total}`;
}

/**
 * The API asks for "DD-MM-YYYY" in table 2.1, but every worked example in the
 * same document sends "2025-01-01" / "2025-12-31" / "2025-12-22". The
 * examples are self-consistent and unambiguous, the prose is not, so we
 * follow the examples. If שע"ם ever rejects a period, this is the first line
 * to suspect.
 */
export function formatPeriod(date: Date | string): string {
  // A plain "YYYY-MM-DD" is returned untouched rather than parsed. Going
  // through Date would read it as UTC midnight and then format it with local
  // getters, so east of Greenwich every such string loses a day and the
  // period filed at שע"ם would be wrong: "2026-01-01" became "2025-12-31".
  if (typeof date === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new Error(`invalid period date: ${String(date)}`);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface UploadTarget {
  fileName: string;
  signUrl: string;
  /** Track this to ask get-file-status about the file later. */
  fileUniqueId: string;
  headers: Record<string, string>;
}

export interface UploadLinks {
  uniqueId: string;
  /** Chapter 2.3: the array always holds INI first, then BKMVDATA. */
  ini: UploadTarget;
  bkm: UploadTarget;
}

export type FileStatus = "Uploaded" | "Approved" | "Rejected" | "";

export interface FileStatusResult {
  fileUniqueId: string;
  fileName?: string;
  isFound: boolean;
  status: FileStatus;
  /** Why a file was rejected. */
  description?: string;
  errorMessage?: string;
}

/* ------------------------------------------------------------------ */
/* Leg 1: ask for the signed upload targets                            */
/* ------------------------------------------------------------------ */

export interface UploadLinksRequest {
  /** The dealer's case number at שע"ם, digits only. */
  caseNumber: string | number;
  startPeriod: Date | string;
  endPeriod: Date | string;
  /** Only when an employee of a representative (מייצג) is transmitting. */
  representorCompanyId?: string | number;
}

export async function getUploadLinks(
  accessToken: string,
  req: UploadLinksRequest,
): Promise<UploadLinks> {
  const body: Record<string, unknown> = {
    caseNumber: Number(String(req.caseNumber).replace(/\D/g, "")),
    startPeriod: formatPeriod(req.startPeriod),
    endPeriod: formatPeriod(req.endPeriod),
  };
  if (req.representorCompanyId) {
    body.representorCompanyId = Number(String(req.representorCompanyId).replace(/\D/g, ""));
  }

  const target = govFetchTarget(LINKS_URL, {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  const res = await fetch(target.url, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: {
    success?: boolean;
    data?: { uniqueId?: string; files?: UploadTarget[] };
    error?: { errorCode?: number; message?: string };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `GetUrlsForUploadingFiles returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  if (!res.ok || parsed.success === false) {
    // 406 is the one worth naming: it means this identity holds no permission
    // for that case number, which is a user-fixable authorisation problem
    // rather than a bug in the request.
    const code = parsed.error?.errorCode ?? res.status;
    const msg = parsed.error?.message || res.statusText;
    throw new Error(
      code === 406
        ? `אין הרשאה לשדר עבור תיק ${body.caseNumber} (406). יש לוודא שההרשאה ברשות המסים ניתנה לעוסק הזה.`
        : `GetUrlsForUploadingFiles failed: ${code} ${msg}`,
    );
  }

  const files = parsed.data?.files || [];
  if (files.length < 2) {
    throw new Error(`expected 2 upload targets (INI, BKM), got ${files.length}`);
  }

  return { uniqueId: parsed.data?.uniqueId || "", ini: files[0], bkm: files[1] };
}

/* ------------------------------------------------------------------ */
/* Leg 2: initiate, then send the bytes                                */
/* ------------------------------------------------------------------ */

/**
 * Opens the resumable session. Google answers 201 and puts the URL that
 * actually accepts bytes in the Location header; the signed URL itself never
 * receives the file.
 *
 * Not proxied: this is storage.googleapis.com, which serves any egress IP.
 */
export async function initiateResumableUpload(target: UploadTarget): Promise<string> {
  const res = await fetch(target.signUrl, {
    method: "POST",
    headers: target.headers,
    body: "",
  });
  if (res.status !== 201) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `resumable initiation for ${target.fileName} expected 201, got ${res.status} ${detail}`.slice(
        0,
        300,
      ),
    );
  }
  const location = res.headers.get("location");
  if (!location) throw new Error(`no Location header on the 201 for ${target.fileName}`);
  return location;
}

/**
 * Sends the bytes to the resumable URL.
 *
 * Google answers 308 ("resume incomplete") after every chunk but the last,
 * and 200/201 once the object is committed, so a 308 is success here rather
 * than an error. A single-chunk upload therefore never sees a 308 at all.
 */
export async function uploadInChunks(uploadUrl: string, data: Uint8Array): Promise<void> {
  const total = data.byteLength;
  if (total === 0) throw new Error("refusing to transmit an empty file");

  const size = chunkSizeFor(total);
  for (let start = 0; start < total; start += size) {
    const end = Math.min(start + size, total);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start),
        "Content-Range": contentRange(start, end, total),
      },
      body: data.slice(start, end),
    });

    const last = end >= total;
    if (last && !res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`final chunk rejected: ${res.status} ${detail}`.slice(0, 300));
    }
    if (!last && res.status !== 308) {
      throw new Error(`chunk ${start}-${end} expected 308, got ${res.status}`);
    }
  }
}

/** Initiate plus upload, for one of the two files. */
export async function transmitFile(target: UploadTarget, data: Uint8Array): Promise<void> {
  const max = maxUploadBytes(target.headers);
  if (max !== null && data.byteLength > max) {
    // Checked here on purpose: chapter 3.1 says an oversized upload fails
    // only on reaching the limit, so without this the user would sit through
    // the entire transfer before being told.
    throw new Error(
      `הקובץ ${target.fileName} בגודל ${data.byteLength} בתים חורג מהמותר לעסק הזה (${max} בתים). ניתן לפנות ל-APISupport@taxes.gov.il.`,
    );
  }
  const uploadUrl = await initiateResumableUpload(target);
  await uploadInChunks(uploadUrl, data);
}

/* ------------------------------------------------------------------ */
/* Leg 3: what happened to the files                                   */
/* ------------------------------------------------------------------ */

export async function getFileStatus(
  accessToken: string,
  files: { fileUniqueId: string; fileName: string }[],
): Promise<FileStatusResult[]> {
  const target = govFetchTarget(STATUS_URL, {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  const res = await fetch(target.url, {
    method: "POST",
    headers: target.headers,
    // FileName is capped at 100 characters by the spec.
    body: JSON.stringify(
      files.map((f) => ({ fileUniqueId: f.fileUniqueId, FileName: f.fileName.slice(0, 100) })),
    ),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`get-file-status failed: ${res.status} ${text.slice(0, 200)}`);
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed?.data || [];
  } catch {
    throw new Error(`get-file-status returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/* ------------------------------------------------------------------ */
/* The whole thing                                                     */
/* ------------------------------------------------------------------ */

export interface TransmitResult {
  uniqueId: string;
  /** Keep these: they are how the status service identifies the files. */
  files: { fileName: string; fileUniqueId: string }[];
}

/**
 * One export, transmitted. Both files or neither: if the BKMVDATA fails after
 * the INI landed, this throws, and the caller decides whether to retry the
 * pair. Partial success is not reported as success, because a lone INI is not
 * a filing.
 */
export async function transmitUniformStructure(args: {
  accessToken: string;
  caseNumber: string | number;
  startPeriod: Date | string;
  endPeriod: Date | string;
  representorCompanyId?: string | number;
  ini: Uint8Array;
  bkmvdata: Uint8Array;
}): Promise<TransmitResult> {
  const links = await getUploadLinks(args.accessToken, {
    caseNumber: args.caseNumber,
    startPeriod: args.startPeriod,
    endPeriod: args.endPeriod,
    representorCompanyId: args.representorCompanyId,
  });

  await transmitFile(links.ini, args.ini);
  await transmitFile(links.bkm, args.bkmvdata);

  return {
    uniqueId: links.uniqueId,
    files: [
      { fileName: links.ini.fileName, fileUniqueId: links.ini.fileUniqueId },
      { fileName: links.bkm.fileName, fileUniqueId: links.bkm.fileUniqueId },
    ],
  };
}
