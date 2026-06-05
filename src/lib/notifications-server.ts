// Server-side writer for notifications. Used by cron jobs + API routes
// that act on behalf of a user (with service-role).
//
// Client-side producers (e.g. bank-import-modal) should use the regular
// supabase client + the RLS insert policy instead — see
// src/lib/notifications-client.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NotificationKind } from "./notifications";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let cached: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

interface CreateArgs {
  businessId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  documentId?: string;
}

/**
 * Fire-and-forget. Looks up the owning user for the business and inserts
 * a notification. Silently swallows errors — producers must not fail
 * their main action just because a notification couldn't be written.
 */
export async function createNotificationForBusiness(args: CreateArgs): Promise<void> {
  try {
    const client = admin();
    const { data: biz } = await client
      .from("businesses")
      .select("user_id")
      .eq("id", args.businessId)
      .maybeSingle();
    if (!biz?.user_id) return;
    await client.from("notifications").insert({
      business_id: args.businessId,
      user_id: biz.user_id,
      kind: args.kind,
      title: args.title,
      body: args.body || null,
      href: args.href || null,
      document_id: args.documentId || null,
    });
  } catch (err) {
    console.warn("[notifications] server write failed:", err);
  }
}
