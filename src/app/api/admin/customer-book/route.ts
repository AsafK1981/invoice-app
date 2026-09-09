import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";
import { UNIFORM_SOFTWARE } from "@/lib/uniform-structure/software";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * ספר הלקוחות של בית התוכנה. הוראות ניהול ספרים, נספח ה' (ה): a registered
 * software house keeps a bound book of its customers: name, address, tax id,
 * phone. Our customers are the businesses using the app, and those four
 * fields are what onboarding collects. This route prints the book as one CSV
 * (UTF-8 BOM, opens in Excel), sequentially numbered, with the software
 * name/version and the print time in the header rows, so a printout is the
 * "bound book" an auditor asks for on the day they ask.
 *
 * Admin only (allow-list in src/lib/admin.ts); every call is logged to
 * admin_access_log. Exactly the four statutory fields plus the signup date and
 * the account email; nothing about what the customers invoiced.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await logAdminAccess(sb, {
    actor: user.email || user.id,
    channel: "admin_api",
    action: "admin/customer-book GET",
  });

  const { data: businesses, error } = await sb
    .from("businesses")
    .select("id, name, tax_id, address, phone, email, created_at, user_id")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const printedAt = new Date();
  const rows = (businesses ?? []).map((b, i) => ({
    "מס' סידורי": i + 1,
    "שם הלקוח": b.name,
    "כתובת": b.address || "",
    "מספר עוסק / ח.פ": b.tax_id || "",
    "טלפון": b.phone || "",
    "אימייל": b.email || "",
    "תאריך הצטרפות": String(b.created_at).slice(0, 10),
  }));
  const header = [
    `ספר לקוחות - ${UNIFORM_SOFTWARE.name} גרסה ${UNIFORM_SOFTWARE.version} - בית התוכנה: ${UNIFORM_SOFTWARE.vendorName} (ע.מ ${UNIFORM_SOFTWARE.vendorTaxId})`,
    `הוראות ניהול ספרים, נספח ה' (ה). הופק: ${printedAt.toISOString()}. סה"כ לקוחות: ${rows.length}.`,
    "",
  ].join("\n");
  const csv = "﻿" + header + Papa.unparse(rows) + "\n\nסוף ספר הלקוחות\n";
  const filename = `customer-book-${printedAt.toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
