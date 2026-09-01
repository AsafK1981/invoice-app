import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createNotificationForBusiness } from "@/lib/notifications-server";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";
import { canIssueTaxInvoicesByType } from "@/lib/vat";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Shared secret for machine callers (a scheduled script on the owner's PC,
 * not a browser). Unset = the endpoint is closed, not open: an automation
 * that can't authenticate must fail loudly rather than write proposals
 * anonymously.
 */
const AUTOMATION_SECRET = process.env.AUTOMATION_SECRET || "";

/**
 * Businesses this endpoint may write proposals for, comma-separated.
 *
 * The secret alone is not enough authorization in a multi-tenant app: a
 * leaked (or reused) AUTOMATION_SECRET would otherwise let its holder plant a
 * convincing "invoice ready" card, with attacker-chosen client and amounts,
 * on ANY user's dashboard - and one careless approval turns that into a real,
 * numbered, immutable document under their business. The allowlist bounds the
 * blast radius to the businesses that actually opted into an automation.
 * Empty = no business is eligible, which fails closed.
 */
const AUTOMATION_BUSINESS_IDS = (process.env.AUTOMATION_BUSINESS_IDS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const MAX_ITEMS = 60;
const MAX_DETAILS = 200;
const MAX_TEXT = 300;
// A line's description may carry its breakdown (one gig per line) since
// 2026-09-01, so it gets the same room as the notes.
const MAX_DESCRIPTION = 4000;
// The הערות block is a per-line breakdown, one line per billed item, so it
// needs far more room than a subject - and it is rendered pre-wrap, never
// interpreted, so newlines and tabs are content here rather than formatting.
const MAX_NOTES = 4000;

interface ProposalItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clean(v: unknown, max = MAX_TEXT): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Validate the caller-supplied lines. Money is recomputed here rather than
 * trusted: `total` on the wire is treated as a claim, and a claim that
 * disagrees with quantity x unitPrice is a bug in the caller worth
 * rejecting - a proposal whose displayed total doesn't match its lines is
 * exactly the thing the owner would approve without noticing.
 */
function parseItems(raw: unknown): { items: ProposalItem[]; total: number } | string {
  if (!Array.isArray(raw) || raw.length === 0) return "items must be a non-empty array";
  if (raw.length > MAX_ITEMS) return `items must hold at most ${MAX_ITEMS} lines`;

  const items: ProposalItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return "each item must be an object";
    const row = r as Record<string, unknown>;
    const description = clean(row.description, MAX_DESCRIPTION);
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    if (!description) return "each item needs a description";
    if (!Number.isFinite(quantity) || quantity <= 0) return "quantity must be a positive number";
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return "unitPrice must be zero or more";
    // The issue path rounds each unit price to agorot before multiplying, so
    // a price with more than 2 decimals would be stored here as one number
    // and issued as another (qty 3 x 0.335 => 1.01 stored, 1.02 issued).
    // Refuse it rather than let the card display a total it will not issue.
    if (round2(unitPrice) !== unitPrice) return "unitPrice must have at most 2 decimals";
    if (!Number.isInteger(quantity) && round2(quantity) !== quantity) {
      return "quantity must have at most 2 decimals";
    }
    const lineTotal = round2(quantity * unitPrice);
    if (row.total != null && Math.abs(Number(row.total) - lineTotal) > 0.01) {
      return `item total ${String(row.total)} does not equal quantity x unitPrice (${lineTotal})`;
    }
    items.push({ description, quantity, unitPrice, total: lineTotal });
  }
  return { items, total: round2(items.reduce((s, i) => s + i.total, 0)) };
}

/**
 * POST /api/proposals
 *
 * Body: { businessId, source, sourceLabel?, period, documentType, clientId?,
 *         clientName, subject, notes?, items[], details? }
 *
 * Creates (or refreshes) the single pending proposal for
 * (businessId, source, period). Never touches a proposal the owner already
 * approved or dismissed - that returns 409 so the caller can stop retrying
 * instead of silently re-queueing work the owner already answered.
 */
export async function POST(req: NextRequest) {
  if (!AUTOMATION_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Automation endpoint is not configured" },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${AUTOMATION_SECRET}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (AUTOMATION_BUSINESS_IDS.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No business is enrolled for automated proposals" },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const businessId = clean(body.businessId, 40);
  const source = clean(body.source, 60);
  const period = clean(body.period, 7);
  const documentType = clean(body.documentType, 40) as DocumentType;
  const clientId = clean(body.clientId, 40);
  const clientName = clean(body.clientName);
  const subject = clean(body.subject);
  // Not run through clean(): that trims and would be wrong to apply per-line,
  // and the cap differs. Only the outer whitespace is stripped.
  const notes =
    typeof body.notes === "string" ? body.notes.trim().slice(0, MAX_NOTES) : "";

  if (!UUID_RE.test(businessId)) {
    return NextResponse.json({ ok: false, error: "businessId must be a UUID" }, { status: 400 });
  }
  if (!AUTOMATION_BUSINESS_IDS.includes(businessId.toLowerCase())) {
    return NextResponse.json(
      { ok: false, error: "This business is not enrolled for automated proposals" },
      { status: 403 },
    );
  }
  if (!source) {
    return NextResponse.json({ ok: false, error: "source is required" }, { status: 400 });
  }
  if (!PERIOD_RE.test(period)) {
    return NextResponse.json({ ok: false, error: "period must be YYYY-MM" }, { status: 400 });
  }
  if (!(documentType in DOCUMENT_TYPE_LABELS)) {
    return NextResponse.json({ ok: false, error: "unknown documentType" }, { status: 400 });
  }
  // Credit notes are stored NEGATIVE app-wide (revenue and VAT summing both
  // depend on it) while parseItems below forces every proposal total
  // positive. Rather than special-case the sign for a document type no
  // automation should be minting anyway, refuse it outright.
  if (documentType === "credit_note") {
    return NextResponse.json(
      { ok: false, error: "credit notes cannot be proposed by an automation" },
      { status: 400 },
    );
  }
  if (!clientName) {
    return NextResponse.json({ ok: false, error: "clientName is required" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ ok: false, error: "subject is required" }, { status: 400 });
  }
  if (clientId && !UUID_RE.test(clientId)) {
    return NextResponse.json({ ok: false, error: "clientId must be a UUID" }, { status: 400 });
  }

  const parsed = parseItems(body.items);
  if (typeof parsed === "string") {
    return NextResponse.json({ ok: false, error: parsed }, { status: 400 });
  }

  const details = Array.isArray(body.details) ? body.details.slice(0, MAX_DETAILS) : null;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The business must exist. Without this a typo'd (but well-formed) UUID
  // would surface as a foreign-key error 500 instead of a clear 404.
  const { data: business, error: bizErr } = await supabase
    .from("businesses")
    .select("id, business_type")
    .eq("id", businessId)
    .maybeSingle();
  if (bizErr) {
    return NextResponse.json({ ok: false, error: bizErr.message }, { status: 500 });
  }
  if (!business) {
    return NextResponse.json({ ok: false, error: "Unknown business" }, { status: 404 });
  }
  // An עוסק פטור may not issue a tax invoice at all. create_document_atomic
  // only rejects a tax invoice carrying nonzero VAT, so a zero-VAT one would
  // slip through and the owner would issue a document their status forbids.
  // The interactive UI hides the option; this endpoint has to enforce it.
  const taxInvoiceTypes: DocumentType[] = ["tax_invoice", "tax_invoice_receipt"];
  if (
    taxInvoiceTypes.includes(documentType) &&
    !canIssueTaxInvoicesByType(business.business_type as string)
  ) {
    return NextResponse.json(
      { ok: false, error: "This business cannot issue tax invoices" },
      { status: 400 },
    );
  }

  // A client id from another business would attach this proposal to a
  // stranger's client row; drop it rather than fail, the name still carries.
  let safeClientId: string | null = clientId || null;
  if (safeClientId) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", safeClientId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!client) safeClientId = null;
  }

  const { data: existing, error: exErr } = await supabase
    .from("invoice_proposals")
    .select("id, status, document_id")
    .eq("business_id", businessId)
    .eq("source", source)
    .eq("period", period)
    .maybeSingle();
  if (exErr) {
    return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });
  }

  if (existing && existing.status !== "pending") {
    return NextResponse.json(
      {
        ok: false,
        error: "already resolved",
        status: existing.status,
        documentId: existing.document_id,
      },
      { status: 409 },
    );
  }

  const payload = {
    business_id: businessId,
    source,
    source_label: clean(body.sourceLabel, 80) || source,
    period,
    document_type: documentType,
    client_id: safeClientId,
    client_name: clientName,
    subject,
    notes: notes || null,
    items: parsed.items,
    total: parsed.total,
    details,
    status: "pending" as const,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // `.eq("status", "pending")` makes this a conditional update, not a
    // read-then-write. Without it an owner who approves in the window between
    // the SELECT above and this UPDATE would have their resolved proposal
    // reset to pending while document_id still points at the document they
    // already issued - the card would reappear and invite a second issue.
    const { data: updated, error } = await supabase
      .from("invoice_proposals")
      .update(payload)
      .eq("id", existing.id)
      .eq("status", "pending")
      .select("id");
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { ok: false, error: "already resolved", status: "resolved" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, id: existing.id, refreshed: true, total: parsed.total });
  }

  const { data: inserted, error } = await supabase
    .from("invoice_proposals")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // In-app bell, so the proposal is visible even if the owner never sees the
  // WhatsApp push. Non-fatal: the proposal itself is already saved.
  try {
    await createNotificationForBusiness({
      businessId,
      kind: "proposal_ready",
      title: "חשבונית מוכנה לאישור",
      body: `${subject} · ${parsed.total.toLocaleString("he-IL")} ₪`,
      href: "/dashboard",
    });
  } catch {
    /* notification is best-effort */
  }

  return NextResponse.json({ ok: true, id: inserted.id, refreshed: false, total: parsed.total });
}
