/**
 * Transmitting a מבנה אחיד pair on behalf of a business, and recording it.
 *
 * transmit.ts is the bare protocol. This is the layer that knows about our
 * database: it resolves the business's gov.il token, writes a row before the
 * upload starts so a crash mid-flight still leaves a trace, sends the files,
 * and stores the per-file identifiers that get-file-status will later be asked
 * about.
 *
 * Deliberately additive. Nothing here is called from the export route yet: the
 * production endpoint is still unannounced, and the duty starts 1.1.2027, so
 * wiring it into a flow that works today would add risk and buy nothing. When
 * it is wired, the contract to keep is that a transmission failure must never
 * cost the user their download.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken, tokenFailureMessage, type TokenFailure } from "@/lib/tax-authority-token";
import { transmitUniformStructure, getFileStatus, formatPeriod } from "./transmit";

type Sb = SupabaseClient;

export interface TransmitAndRecordArgs {
  sb: Sb;
  businessId: string;
  /** The dealer's case number at שע"ם - the business tax id, digits only. */
  caseNumber: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  ini: Uint8Array;
  bkmvdata: Uint8Array;
  representorCompanyId?: string;
}

export type TransmitOutcome =
  | { ok: true; transmissionId: string; uniqueId: string }
  | { ok: false; transmissionId?: string; reason: TokenFailure | "transmit_failed"; message: string };

/**
 * The whole thing, start to finish.
 *
 * The row is written first and updated after, rather than only on success, so
 * that a transmission which dies halfway is visible instead of vanishing. A
 * business that never connected gov.il is not an error worth a row: there was
 * nothing to transmit with, and the caller simply learns why.
 */
export async function transmitAndRecord(args: TransmitAndRecordArgs): Promise<TransmitOutcome> {
  const { sb, businessId } = args;

  const token = await getValidAccessToken(sb, businessId);
  if (!token.ok) {
    return { ok: false, reason: token.reason, message: tokenFailureMessage(token.reason) };
  }

  const periodStart = formatPeriod(args.periodStart);
  const periodEnd = formatPeriod(args.periodEnd);

  const { data: row } = await sb
    .from("uniform_structure_transmissions")
    .insert({
      business_id: businessId,
      period_start: periodStart,
      period_end: periodEnd,
      status: "pending",
      environment: token.environment,
    })
    .select("id")
    .single();

  const transmissionId = row?.id as string | undefined;

  try {
    const result = await transmitUniformStructure({
      accessToken: token.accessToken,
      caseNumber: args.caseNumber,
      startPeriod: periodStart,
      endPeriod: periodEnd,
      representorCompanyId: args.representorCompanyId,
      ini: args.ini,
      bkmvdata: args.bkmvdata,
    });

    if (transmissionId) {
      await sb
        .from("uniform_structure_transmissions")
        .update({
          status: "sent",
          unique_id: result.uniqueId,
          ini_file_name: result.files[0]?.fileName,
          ini_file_unique_id: result.files[0]?.fileUniqueId,
          bkm_file_name: result.files[1]?.fileName,
          bkm_file_unique_id: result.files[1]?.fileUniqueId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", transmissionId);
    }

    return { ok: true, transmissionId: transmissionId || "", uniqueId: result.uniqueId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "transmission failed";
    if (transmissionId) {
      await sb
        .from("uniform_structure_transmissions")
        .update({
          status: "failed",
          // Our own message, already sanitised by transmit.ts - never a raw
          // upstream body.
          error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", transmissionId);
    }
    return { ok: false, transmissionId, reason: "transmit_failed", message };
  }
}

/**
 * Refreshes the stored verdict for one transmission.
 *
 * שע"ם answers per file, and the pair is only as good as its worse half: a
 * rejected BKMVDATA makes the filing rejected even if the INI was approved.
 */
export async function refreshTransmissionStatus(sb: Sb, transmissionId: string): Promise<void> {
  const { data: row } = await sb
    .from("uniform_structure_transmissions")
    .select("business_id, ini_file_name, ini_file_unique_id, bkm_file_name, bkm_file_unique_id")
    .eq("id", transmissionId)
    .maybeSingle();

  if (!row?.ini_file_unique_id && !row?.bkm_file_unique_id) return;

  const token = await getValidAccessToken(sb, row.business_id as string);
  if (!token.ok) return;

  const files = [
    { fileUniqueId: row.ini_file_unique_id as string, fileName: (row.ini_file_name as string) || "" },
    { fileUniqueId: row.bkm_file_unique_id as string, fileName: (row.bkm_file_name as string) || "" },
  ].filter((f) => f.fileUniqueId);

  const statuses = await getFileStatus(token.accessToken, files);
  const byId = new Map(statuses.map((s) => [s.fileUniqueId, s]));
  const ini = byId.get(row.ini_file_unique_id as string);
  const bkm = byId.get(row.bkm_file_unique_id as string);

  await sb
    .from("uniform_structure_transmissions")
    .update({
      ini_status: ini?.status ?? null,
      bkm_status: bkm?.status ?? null,
      rejection_reason: ini?.description || bkm?.description || null,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", transmissionId);
}
