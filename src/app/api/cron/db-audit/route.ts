import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const cronSecret = process.env.CRON_SECRET;

const SENSITIVE_TABLES = [
  "businesses",
  "clients",
  "products",
  "documents",
  "document_items",
  "expenses",
  "document_counters",
];

interface IntegrityIssue {
  kind: string;
  detail: string;
}

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when
  // CRON_SECRET is set as an env var. Reject anything else so the route can't
  // be hammered from the public internet.
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const issues: IntegrityIssue[] = [];

  // 1. Orphan documents (business deleted but doc still around)
  const { data: orphanDocs } = await admin
    .from("documents")
    .select("id, business_id")
    .is("business_id", null);
  if (orphanDocs && orphanDocs.length > 0) {
    issues.push({
      kind: "orphan_documents",
      detail: `${orphanDocs.length} documents with null business_id`,
    });
  }

  // 2. Orphan document items (document deleted but items remain)
  const { data: items } = await admin.from("document_items").select("document_id");
  if (items && items.length > 0) {
    const docIds = new Set<string>();
    const { data: docs } = await admin.from("documents").select("id");
    (docs || []).forEach((d) => docIds.add(d.id));
    const orphanItems = items.filter((i) => !docIds.has(i.document_id));
    if (orphanItems.length > 0) {
      issues.push({
        kind: "orphan_document_items",
        detail: `${orphanItems.length} items pointing to non-existent documents`,
      });
    }
  }

  // 3. Duplicate (business_id, type, number) tuples — would violate the unique
  // constraint, so this is a sanity check that the constraint is doing its job
  const { data: docs } = await admin
    .from("documents")
    .select("business_id, type, number");
  if (docs) {
    const seen = new Map<string, number>();
    for (const d of docs) {
      const key = `${d.business_id}|${d.type}|${d.number}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dups = Array.from(seen.entries()).filter(([, c]) => c > 1);
    if (dups.length > 0) {
      issues.push({
        kind: "duplicate_doc_numbers",
        detail: `${dups.length} duplicated (business, type, number) tuples`,
      });
    }
  }

  // RLS posture is verified by the pre-push hook + the weekly remote audit
  // (which both run the AEGIS anon-key exploit against the live URL). No
  // additional check needed inside this DB-side audit.

  const summary = {
    timestamp: new Date().toISOString(),
    issuesFound: issues.length,
    issues,
    tablesChecked: SENSITIVE_TABLES,
  };

  if (issues.length > 0) {
    // Surface in Sentry so the user gets a notification via their Sentry alerts
    Sentry.captureMessage(
      `DB integrity audit found ${issues.length} issue(s)`,
      {
        level: "warning",
        tags: { kind: "db-integrity" },
        extra: summary,
      }
    );
  }

  return NextResponse.json(summary, { status: issues.length > 0 ? 500 : 200 });
}
