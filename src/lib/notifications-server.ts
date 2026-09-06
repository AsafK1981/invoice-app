// Server-side writer for notifications. Used by cron jobs + API routes
// that act on behalf of a user (with service-role).
//
// Client-side producers (e.g. bank-import-modal) should use the regular
// supabase client + the RLS insert policy instead, see
// src/lib/notifications-client.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NotificationKind } from "./notifications";
import { sendPushForNotification } from "./push-server";

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
 * Looks up the owning user for the business and inserts a notification.
 * Swallows errors internally (producers must not throw/fail their main
 * action just because a notification couldn't be written) but returns
 * `true`/`false` so a caller that needs to know delivery actually
 * succeeded (e.g. inapp being the only channel) can react - existing
 * callers that don't check the return value keep their prior
 * fire-and-forget behavior unchanged.
 */
export async function createNotificationForBusiness(args: CreateArgs): Promise<boolean> {
  try {
    const client = admin();
    const { data: biz } = await client
      .from("businesses")
      .select("user_id")
      .eq("id", args.businessId)
      .maybeSingle();
    if (!biz?.user_id) return false;
    // `.select("id")` only so the push can carry the row id as its tag, which
    // is what stops a retried cron from stacking the same banner twice.
    const { data: inserted, error } = await client
      .from("notifications")
      .insert({
        business_id: args.businessId,
        user_id: biz.user_id,
        kind: args.kind,
        title: args.title,
        body: args.body || null,
        href: args.href || null,
        document_id: args.documentId || null,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("[notifications] server write failed:", error);
      return false;
    }

    // The device copy of the same event, if the owner asked for this kind.
    // Awaited so a serverless function is not killed mid-send, but its own
    // try/catch means a push problem never changes what this function
    // returns - the in-app row is already written and is the durable channel.
    try {
      await sendPushForNotification({
        businessId: args.businessId,
        kind: args.kind,
        title: args.title,
        body: args.body,
        href: args.href,
        notificationId: (inserted?.id as string) || undefined,
      });
    } catch (err) {
      console.warn("[notifications] push failed:", err);
    }

    return true;
  } catch (err) {
    console.warn("[notifications] server write failed:", err);
    return false;
  }
}
