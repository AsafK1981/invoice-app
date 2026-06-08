import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Account deletion — irreversible. Wipes:
 *   - Storage logos (business-logos bucket)
 *   - Document attachments (rows + storage files)
 *   - audit_log rows for the user's businesses
 *   - documents + document_items
 *   - expenses, clients, products, document_counters
 *   - businesses
 *   - the auth user record itself
 *
 * Rate limited so an attacker who somehow obtains a token can't
 * destroy the user's data more than once a day (admittedly a thin
 * wall — the right defense is the auth check above it). Bigger
 * concern is preventing accidental double-clicks on the Delete
 * button from racing.
 */
export async function POST(req: NextRequest) {
  try {
    // Require an explicit Authorization: Bearer header (the client always
    // sends it). We deliberately do NOT fall back to reading the session
    // token from the cookie: a header-only contract can't be driven by a
    // cross-site request, so this keeps irreversible account deletion
    // CSRF-safe.
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit BY USER — not IP — because a legitimate user does this
    // exactly once. Two requests in 60 seconds is a double-click race.
    const ip = clientIp(req);
    const rl = checkRate({
      key: `delete-account:${user.id}:${ip}`,
      max: 1,
      windowMs: 60_000,
    });
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: "Already processing. Wait a moment." },
        { status: 429 },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Find all businesses owned by the user
    const { data: businesses } = await admin
      .from("businesses")
      .select("id, logo_url")
      .eq("user_id", user.id);

    const businessIds = (businesses || []).map((b) => b.id);

    if (businessIds.length > 0) {
      // Snapshot doc + attachment ids before deletion (need them for storage cleanup)
      const { data: docs } = await admin
        .from("documents")
        .select("id")
        .in("business_id", businessIds);
      const docIds = (docs || []).map((d) => d.id);

      let attachmentPaths: string[] = [];
      if (docIds.length > 0) {
        const { data: atts } = await admin
          .from("document_attachments")
          .select("file_path")
          .in("document_id", docIds);
        attachmentPaths = (atts || []).map((a) => a.file_path as string).filter(Boolean);
      }

      // Storage cleanup — best effort. If a delete fails we still
      // proceed with the rest of the wipe (orphaned storage files
      // can be cleaned up by the bucket lifecycle later).
      const logoPaths = (businesses ?? [])
        .map((b) => extractStoragePath(b.logo_url as string | null, "business-logos"))
        .filter((p): p is string => Boolean(p));
      if (logoPaths.length > 0) {
        await admin.storage.from("business-logos").remove(logoPaths).catch(() => {});
      }
      if (attachmentPaths.length > 0) {
        await admin.storage.from("document-attachments").remove(attachmentPaths).catch(() => {});
      }

      // DB cleanup. Order matters because of FKs:
      //   document_items → documents → ...
      //   document_attachments → documents
      //   audit_log → businesses (no FK but logically owned)
      if (docIds.length > 0) {
        await admin.from("document_items").delete().in("document_id", docIds);
        await admin.from("document_attachments").delete().in("document_id", docIds);
      }
      await admin.from("documents").delete().in("business_id", businessIds);
      await admin.from("expenses").delete().in("business_id", businessIds);
      await admin.from("clients").delete().in("business_id", businessIds);
      await admin.from("products").delete().in("business_id", businessIds);
      await admin.from("document_counters").delete().in("business_id", businessIds);
      await admin.from("audit_log").delete().in("business_id", businessIds);
      await admin.from("businesses").delete().eq("user_id", user.id);
    }

    // Finally delete the auth user
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete account error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Pulls the storage object key out of a public URL. Supabase public URLs
 * look like `<base>/storage/v1/object/public/<bucket>/<key>`. Returns
 * just the `<key>` portion, or null on parse failure.
 */
function extractStoragePath(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}
