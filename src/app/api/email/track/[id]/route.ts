import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Smallest valid GIF — 1×1 transparent. Base64 of 43 bytes.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/**
 * Email open tracking pixel. Embedded as a 1×1 invisible <img> in
 * outgoing emails. The recipient's mail client loads the image when
 * they view the message, which fires this endpoint — we stamp
 * email_opened_at + bump email_open_count on the document.
 *
 * Always returns the GIF (cache-control: no-store), even on errors,
 * so mail clients don't display broken-image icons. The id is
 * validated as a UUID before any DB call — otherwise hits to bogus
 * IDs just return the pixel silently.
 *
 * Privacy note: we capture nothing about the opener (IP, user-agent)
 * beyond the fact that the doc was opened. The data goes to the
 * sender (Asaf or the issuing business owner), not to us.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const headers = {
    "Content-Type": "image/gif",
    "Content-Length": String(PIXEL.length),
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  };

  const { id: rawId } = await params;
  // Strip a trailing ".gif" if the URL was written that way for nicer
  // mail-client behavior (some clients refuse to load extensionless images).
  const id = rawId.replace(/\.gif$/i, "");
  if (!UUID_RE.test(id)) {
    return new Response(PIXEL, { headers });
  }

  try {
    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Atomic counter bump + first-open stamp. The COALESCE keeps the
    // first-open timestamp once set; subsequent opens only bump the
    // counter.
    const { data: existing } = await sb
      .from("documents")
      .select("email_opened_at, email_open_count")
      .eq("id", id)
      .maybeSingle();
    if (existing) {
      await sb
        .from("documents")
        .update({
          email_opened_at: existing.email_opened_at || new Date().toISOString(),
          email_open_count: (existing.email_open_count || 0) + 1,
        })
        .eq("id", id);
    }
  } catch (err) {
    // Tracking is best-effort — never let it break the pixel response.
    console.warn("[email-track] failed to stamp open:", err);
  }

  return new Response(PIXEL, { headers });
}
