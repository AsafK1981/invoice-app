import { NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import * as Sentry from "@sentry/nextjs";
import { cronAuthError, cronAdminClient } from "@/lib/cron";

const AXIOM_API_TOKEN = process.env.AXIOM_API_TOKEN || "";
const AXIOM_DATASET = process.env.AXIOM_DATASET || "mysuperfriendlyinvoiceapp";
// EU instance because the org was created on EU Central 1.
const AXIOM_BASE = process.env.AXIOM_API_BASE || "https://api.eu.axiom.co";

/**
 * Weekly archive of Axiom logs into Supabase Storage. Solves the
 * 12-month retention gap from the info-security appendix §19; Axiom's
 * free tier caps at 30 days, so every Sunday we snapshot the last 8
 * days (1-day overlap for safety) into a private storage bucket.
 *
 * The archive is gzipped NDJSON, named:
 *   YYYY/MM/YYYY-MM-DD_to_YYYY-MM-DD.ndjson.gz
 *
 * Only the service-role key can read or write the bucket. If the Tax
 * Authority requests log access (appendix §21), generate a signed URL
 * with a short TTL and share it.
 *
 * Schedule: Sunday 04:00 UTC (configured in vercel.json).
 */
export async function GET(req: Request) {
  const unauth = cronAuthError(req);
  if (unauth) return unauth;

  if (!AXIOM_API_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "AXIOM_API_TOKEN not configured" },
      { status: 503 },
    );
  }

  const now = new Date();
  const endTime = new Date(now);
  endTime.setUTCHours(0, 0, 0, 0); // midnight UTC today
  const startTime = new Date(endTime);
  startTime.setUTCDate(startTime.getUTCDate() - 8); // 8 days of overlap-safe coverage

  const startIso = startTime.toISOString();
  const endIso = endTime.toISOString();

  // Pull the logs via Axiom APL. Use simple "all rows" query and let
  // Axiom paginate via cursor. We keep going until no more rows or
  // a sanity limit kicks in.
  const rows: unknown[] = [];
  let cursor: string | undefined;
  let pages = 0;
  const MAX_PAGES = 100; // 100 × 1000 rows = 100k rows ceiling per run

  try {
    while (pages < MAX_PAGES) {
      const body: Record<string, unknown> = {
        apl: `['${AXIOM_DATASET}'] | sort by _time asc`,
        startTime: startIso,
        endTime: endIso,
      };
      if (cursor) body.cursor = cursor;

      const r = await fetch(`${AXIOM_BASE}/v1/datasets/_apl?format=tabular`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AXIOM_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const errText = await r.text();
        throw new Error(`Axiom API ${r.status}: ${errText}`);
      }

      const data = (await r.json()) as {
        tables?: Array<{ columns: Array<{ name: string }>; rows: unknown[][] }>;
        cursor?: string;
        status?: { rowsExamined: number; rowsMatched: number };
      };
      const table = data.tables?.[0];
      if (table && table.rows.length > 0) {
        const colNames = table.columns.map((c) => c.name);
        for (const row of table.rows) {
          const obj: Record<string, unknown> = {};
          colNames.forEach((name, i) => {
            obj[name] = row[i];
          });
          rows.push(obj);
        }
      }
      if (!data.cursor || !table || table.rows.length === 0) break;
      cursor = data.cursor;
      pages++;
    }
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "axiom fetch failed" },
      { status: 502 },
    );
  }

  // Compose NDJSON (one JSON object per line); easier to stream + grep
  // than a single giant JSON array.
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
  const compressed = gzipSync(Buffer.from(ndjson, "utf8"));

  const yyyy = startTime.getUTCFullYear();
  const mm = String(startTime.getUTCMonth() + 1).padStart(2, "0");
  const dateSlug = `${startTime.toISOString().slice(0, 10)}_to_${endTime.toISOString().slice(0, 10)}`;
  const objectPath = `${yyyy}/${mm}/${dateSlug}.ndjson.gz`;

  const sb = cronAdminClient();

  const { error: upErr } = await sb.storage
    .from("axiom-archive")
    .upload(objectPath, compressed, {
      contentType: "application/gzip",
      upsert: true,
    });

  if (upErr) {
    Sentry.captureException(upErr);
    return NextResponse.json(
      { ok: false, error: `storage upload failed: ${upErr.message}` },
      { status: 500 },
    );
  }

  console.log(
    `[axiom-archive] ${objectPath}: ${rows.length} rows, ${compressed.length} bytes`,
  );

  return NextResponse.json({
    ok: true,
    path: objectPath,
    rows: rows.length,
    pages: pages + 1,
    bytes: compressed.length,
    range: { from: startIso, to: endIso },
  });
}
