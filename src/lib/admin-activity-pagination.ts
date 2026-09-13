import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdminActivityEvent, AdminActivityKind } from "./admin-activity";
import type { DocumentType } from "./types";

export interface ActivityCursor { at: string; id: string; cutoff: string }
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
function validTime(value: unknown): value is string { return typeof value === "string" && timestamp.test(value) && Number.isFinite(Date.parse(value)); }
export function encodeActivityCursor(cursor: ActivityCursor, secret: string): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
}
export function decodeActivityCursor(value: string, secret: string): ActivityCursor | null {
  if (value.length > 2048) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    const expected = createHmac("sha256", secret).update(payload).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
    const cursor = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!validTime(cursor.at) || !validTime(cursor.cutoff) || typeof cursor.id !== "string" || !/^[a-zA-Z0-9:._-]{1,160}$/.test(cursor.id)) return null;
    return { at: cursor.at, id: cursor.id, cutoff: cursor.cutoff };
  } catch { return null; }
}

export interface ActivityEventRow {
  event_id: string; at: string; kind: AdminActivityKind; email: string | null; business_name: string | null;
  document_type: string | null; draft: boolean | null;
  document_count: number; client_count: number; expense_count: number; product_count: number;
}
export function activityRowToEvent(row: ActivityEventRow): AdminActivityEvent {
  const event: AdminActivityEvent = { id: row.event_id, at: row.at, kind: row.kind, email: row.email, businessName: row.business_name };
  if (row.document_type) event.documentType = row.document_type as DocumentType;
  if (row.kind === "document.created") event.draft = Boolean(row.draft);
  if (row.kind === "data.imported") event.importCounts = { documents: Number(row.document_count), clients: Number(row.client_count), expenses: Number(row.expense_count), products: Number(row.product_count) };
  return event;
}
