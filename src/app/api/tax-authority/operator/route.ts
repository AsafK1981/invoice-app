import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidIsraeliIdNumber } from "@/lib/israeli-id";
import { canIssueTaxInvoicesByType } from "@/lib/vat";

/**
 * Sets the ת.ז of the human who performs allocations for this business's
 * Tax Authority connection (the ITA v2 `user_id`).
 *
 * Only meaningful for a חברה בע"מ: a sole trader's עוסק number already IS
 * their ת.ז, so their allocations carry a valid person ID by default and
 * this route refuses to touch them rather than inviting a value that could
 * only make the working path worse.
 *
 * The value lives on tax_authority_credentials, which is service-role only
 * (RLS enabled, no policies), so it never reaches the browser. That is why
 * it needs a route at all instead of a plain client write like every other
 * business setting.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function resolveUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(authHeader.slice(7));
  return error || !user ? null : user;
}

export async function POST(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { operatorTaxId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "בקשה לא תקינה" }, { status: 400 });
  }

  // Empty clears the override and restores the default fallback.
  const raw = String(body.operatorTaxId ?? "").replace(/\D/g, "");
  if (raw && !isValidIsraeliIdNumber(raw)) {
    return NextResponse.json(
      { ok: false, error: "מספר ת.ז אינו תקין (ספרת ביקורת שגויה)." },
      { status: 400 },
    );
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: businesses } = await sb
    .from("businesses")
    .select("id, business_type, tax_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  const biz = businesses?.[0];
  if (!biz) {
    return NextResponse.json({ ok: false, error: "אין עסק לחשבון" }, { status: 400 });
  }

  if (!canIssueTaxInvoicesByType(biz.business_type as string)) {
    return NextResponse.json(
      { ok: false, error: "סוג העסק אינו מפיק חשבוניות מס" },
      { status: 400 },
    );
  }

  if (biz.business_type !== "company") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "שדה זה נדרש רק לחברה בע\"מ. אצל עוסק מורשה מספר העוסק הוא ת.ז ממילא, ולכן ההקצאה כבר נושאת מזהה תקין.",
      },
      { status: 400 },
    );
  }

  // A company sending its own ח.פ. as the operator ID is exactly the defect
  // this field exists to correct, so reject it instead of storing a value
  // that changes nothing.
  if (raw && raw === String(biz.tax_id || "").replace(/\D/g, "")) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "יש להזין ת.ז של האדם שמבצע את ההקצאה, לא את מספר החברה. רשות המסים מצפה למזהה של אדם.",
      },
      { status: 400 },
    );
  }

  const { error: updateError } = await sb
    .from("tax_authority_credentials")
    .update({ operator_tax_id: raw || null })
    .eq("business_id", biz.id);

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: "השמירה נכשלה. נסו שוב." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, hasOperatorTaxId: !!raw });
}
