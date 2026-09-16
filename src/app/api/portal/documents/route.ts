import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPortalToken, PORTAL_COOKIE } from "@/lib/portal-token";
import { loadAllPages, type PagedLoadMessages, type RowPage } from "@/lib/paged-load";

/**
 * The portal shows the client their own balance, so a partial list here is
 * worse than an error: PostgREST caps an unpaginated select at 1,000 rows,
 * and a client with more documents than that would have been shown totals
 * computed on the newest 1,000 only, silently understating what they owe or
 * have paid. Every message below therefore asks for a retry instead.
 */
const PORTAL_MESSAGES: PagedLoadMessages = {
  failed: "טעינת המסמכים נכשלה. נסו שוב.",
  changed: "המסמכים השתנו בזמן הטעינה. נסו שוב.",
  unverified: "לא ניתן לאמת את שלמות רשימת המסמכים. נסו שוב.",
  incomplete: "לא כל המסמכים נטענו. נסו שוב.",
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(PORTAL_COOKIE)?.value || "";
  // Demand aud="session": refuse a raw link token used as a cookie.
  const payload = verifyPortalToken(sessionToken, "session");
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ilike is intentional; client emails were stored as the business
  // typed them, often mixed-case. The token's email is wildcard-safe:
  // request-link's regex rejects `%` and `_`, and signPortalToken
  // lowercases + trims. We still escape defensively in case future
  // edits relax the regex.
  const escapedEmail = payload.email.replace(/[\\%_]/g, "\\$&");

  // Both selects below page through every row. `loadAllPages` needs a total
  // order, so they order by id and the documents are sorted by date for
  // display afterwards.
  let clientRows: Record<string, unknown>[];
  let rows: Record<string, unknown>[];
  try {
    clientRows = await loadAllPages(
      (from, to) =>
        admin
          .from("clients")
          .select("id, business_id, name", { count: "exact" })
          .ilike("email", escapedEmail)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<RowPage>,
      PORTAL_MESSAGES,
    );

    if (clientRows.length === 0) {
      return NextResponse.json({ ok: true, email: payload.email, documents: [], businesses: [] });
    }

    const ids = clientRows.map((c) => c.id as string);
    rows = await loadAllPages(
      (from, to) =>
        admin
          .from("documents")
          .select(
            "id, type, number, date, status, total, total_ils, currency, vat, subtotal, client_id, business_id, paid_at, allocation_number, converted_to_id, original_document_id",
            { count: "exact" },
          )
          .in("client_id", ids)
          .neq("status", "draft")
          .neq("status", "cancelled")
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<RowPage>,
      PORTAL_MESSAGES,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : PORTAL_MESSAGES.failed;
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }

  // Newest first, the order the portal lists them in. Ties break on id so the
  // order stays stable between loads.
  rows.sort((a, b) => {
    const dateA = String(a.date ?? "");
    const dateB = String(b.date ?? "");
    if (dateA !== dateB) return dateA < dateB ? 1 : -1;
    return String(a.id) < String(b.id) ? 1 : -1;
  });

  const businessIds = Array.from(new Set(clientRows.map((c) => c.business_id as string)));
  const { data: businessRows } = await admin
    .from("businesses")
    .select("id, name, business_type, tax_id, phone, email")
    .in("id", businessIds);

  // The portal's totals need to know what was converted and what a credit
  // note credits (lib/portal-totals.ts), but not other document ids: the
  // successor id becomes a boolean, and a credit note's original is kept
  // only when that document is already in this client's own list.
  const listed = new Set(rows.map((d) => d.id as string));
  const documents = rows.map(({ converted_to_id, original_document_id, ...d }) => ({
    ...d,
    converted: Boolean(converted_to_id),
    original_document_id:
      typeof original_document_id === "string" && listed.has(original_document_id) ? original_document_id : null,
  }));

  return NextResponse.json({
    ok: true,
    email: payload.email,
    documents,
    businesses: businessRows || [],
  });
}
