import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Push a business's next document number past `target` for one document type.
 *
 * Called after importing historical documents. It is not a nicety: the live
 * issuing path (create_document_atomic) hands out numbers from
 * document_counters, so if the counter still sits below the highest number an
 * import just wrote, the next real invoice is handed a number that already
 * exists. `next_number` is the number that will be handed out NEXT, so an
 * import whose highest number is N needs target = N + 1.
 *
 * All three import paths used to inline the same read-then-write:
 *
 *     const { data: counterRow } = await sb...maybeSingle()   // error dropped
 *     if (!counterRow) insert(...)                            // error dropped
 *     else if (counterRow.next_number < target) update(...)   // error dropped
 *
 * Three ways to fail silently, and the read failed OPEN: under RLS a request
 * that loses its access token comes back with zero rows and no error (see
 * src/lib/session-guard.ts), so `counterRow` was null, the INSERT hit the
 * unique index on (business_id, doc_type) and was discarded unread, and the
 * counter was never raised at all - under a comment calling it CRITICAL.
 *
 * It is now ONE atomic statement, in the database:
 *
 *     INSERT ... ON CONFLICT (business_id, doc_type)
 *     DO UPDATE SET next_number = GREATEST(next_number, EXCLUDED.next_number)
 *
 * The intermediate rewrite - a conditional UPDATE, then an INSERT, retrying on
 * 23505 - was closer but still two statements, and the coding council kept
 * producing interleavings that beat it. The decisive one is not exotic:
 * document-numbering-settings.tsx lets the owner set the next number BY HAND,
 * including downwards, so "the row exists and my UPDATE declined to raise it,
 * therefore it is already high enough" is not something the client can know.
 * GREATEST does the comparison inside the same statement that does the write,
 * which removes the question rather than answering it.
 *
 * The function is SECURITY INVOKER, so the caller's RLS still decides which
 * business they may touch (migration 20260916-bump-document-counter-rpc.sql).
 */
export async function bumpDocumentCounter(
  sb: SupabaseClient,
  businessId: string,
  docType: string,
  target: number,
): Promise<void> {
  const { error } = await sb.rpc("bump_document_counter", {
    p_business_id: businessId,
    p_doc_type: docType,
    p_target: target,
  });
  if (error) throw new Error(counterFailure(docType, error.message));
}

/**
 * Raise every type an import touched, and report ALL the failures.
 *
 * Each type gets its own attempt on purpose. A single loop that threw on the
 * first failure left the remaining types unraised while their documents were
 * already committed - the same stale-counter hazard this exists to prevent,
 * just moved to whichever type happened to come second.
 */
export async function bumpDocumentCounters(
  sb: SupabaseClient,
  businessId: string,
  highestByType: Iterable<[string, number]>,
): Promise<void> {
  const failures: string[] = [];
  for (const [docType, highest] of highestByType) {
    try {
      // next_number is the number handed out NEXT, so the first free one is
      // the highest imported number plus one.
      await bumpDocumentCounter(sb, businessId, docType, highest + 1);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (failures.length > 0) throw new Error(failures.join(" · "));
}

function counterFailure(docType: string, detail: string): string {
  // Deliberately does not claim the import succeeded: this also runs after a
  // row loop that aborted partway, and the documents already written are what
  // make a stale counter dangerous.
  return `המסמכים יובאו אך לא הצלחנו לעדכן את מונה המספור עבור ${docType}. אל תפיק מסמך חדש מסוג זה עד שתרענן ותנסה שוב (${detail})`;
}
