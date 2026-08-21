"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Check, Pencil, X, Loader2 } from "lucide-react";
import {
  usePendingProposals,
  claimProposal,
  reclaimProposal,
  documentExists,
  attachProposalDocument,
  releaseProposal,
  dismissProposal,
  type InvoiceProposal,
} from "@/lib/proposal-store";
import { useBusiness } from "@/lib/business-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { createDocument } from "@/lib/document-store";
import { saveDraft, type EditorDraft } from "@/lib/draft-storage";
import { getVatRate, computeAmounts, round2 } from "@/lib/vat";
import { ilsEquivalents } from "@/lib/exchange-rate";
import { todayInIsrael } from "@/lib/date";
import { formatCurrency } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, type InvoiceDocument } from "@/lib/types";

/**
 * Dashboard widget: invoices an automation prepared, waiting for one click.
 *
 * The approve path builds the document through exactly the same helpers the
 * interactive editor uses on save (computeAmounts + per-line net prices +
 * the ILS snapshot), so an approved proposal is byte-identical to the same
 * invoice typed by hand. Rounding the summed total instead of per-line is
 * what lets a header subtotal drift from the sum of its lines, the mismatch
 * that gets a tax export rejected - the recurring page learned this the hard
 * way and this path deliberately mirrors it.
 *
 * Renders nothing when nothing is pending.
 */
export function InvoiceProposalCard() {
  const { proposals, ready } = usePendingProposals();
  if (!ready || proposals.length === 0) return null;
  return (
    <div className="space-y-3">
      {proposals.map((p) => (
        <ProposalRow key={p.id} proposal={p} />
      ))}
    </div>
  );
}

function ProposalRow({ proposal }: { proposal: InvoiceProposal }) {
  const router = useRouter();
  const { business } = useBusiness();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"approve" | "edit" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const typeLabel = DOCUMENT_TYPE_LABELS[proposal.documentType] || "מסמך";

  // Compute here what approving will actually issue, and show THAT.
  // proposal.total is the sum of the proposed lines before VAT; for a
  // VAT-liable business computeAmounts adds VAT on top, so displaying the
  // raw proposal total would show the owner one number and issue another.
  const amounts = useMemo(
    () => computeAmounts(proposal.items, getVatRate(business), "exclusive"),
    [proposal.items, business],
  );

  /**
   * Build and insert the document for an already-claimed proposal.
   *
   * `documentId` is the uuid reserved on the claim, NOT a fresh one. That is
   * what makes a retry safe: if a previous attempt actually committed the
   * document before its response was lost, we find it and link it instead of
   * creating a second, separately-numbered one.
   *
   * `source` is the row as the database has it, not the row this card
   * rendered from - the automation may have refreshed the figures since.
   */
  async function issueClaimed(source: InvoiceProposal, documentId: string) {
    if (await documentExists(documentId)) {
      // A previous attempt got further than it reported. Link, don't reissue.
      await attachProposalDocument(source.id, documentId);
      router.push(`/documents/${documentId}`);
      return;
    }

    const { subtotal, vat, total, netUnitPriceFactor } = computeAmounts(
      source.items,
      getVatRate(business),
      "exclusive",
    );
    const isPaidOnIssue =
      source.documentType === "receipt" || source.documentType === "tax_invoice_receipt";

    const draft: Omit<InvoiceDocument, "number"> = {
      id: documentId,
      type: source.documentType,
      date: todayInIsrael(),
      clientId: source.clientId,
      clientName: source.clientName,
      subject: source.subject,
      status: isPaidOnIssue ? "paid" : "sent",
      items: source.items.map((i) => {
        const netUnitPrice = round2(i.unitPrice * netUnitPriceFactor);
        return {
          id: crypto.randomUUID(),
          description: i.description,
          quantity: i.quantity,
          unitPrice: netUnitPrice,
          total: round2(i.quantity * netUnitPrice),
        };
      }),
      subtotal,
      vat,
      total,
      paymentMethod: "bank_transfer",
      currency: "ILS",
      exchangeRate: 1,
      zeroRated: false,
      ...ilsEquivalents({ subtotal, vat, total }, 1),
    };

    const { id: docId } = await createDocument(draft);
    await attachProposalDocument(source.id, docId);
    router.push(`/documents/${docId}`);
  }

  async function handleApprove() {
    setBusy("approve");
    setError(null);

    const isRetry = proposal.status === "approved";
    // Reuse the reserved uuid on a retry; mint one only for a first attempt.
    const documentId =
      (isRetry ? proposal.intendedDocumentId : null) || crypto.randomUUID();

    let claimed: InvoiceProposal | null = null;
    try {
      claimed = isRetry
        ? await reclaimProposal(proposal.id)
        : await claimProposal(proposal.id, documentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
      setBusy(null);
      return;
    }
    if (!claimed) {
      setError("ההצעה כבר טופלה במקום אחר. רענן את הדף.");
      setBusy(null);
      return;
    }

    // The claim returns the authoritative row. If the automation refreshed
    // the figures since this card rendered, the owner is looking at a number
    // they did not actually approve - hand it back and make them re-read it
    // rather than quietly issuing the newer amount.
    if (!isRetry && JSON.stringify(claimed.items) !== JSON.stringify(proposal.items)) {
      await releaseProposal(proposal.id).catch(() => {});
      setError("ההצעה התעדכנה מאז שהמסך נטען. בדוק את הסכום החדש ואשר שוב.");
      setBusy(null);
      return;
    }

    try {
      await issueClaimed(claimed, claimed.intendedDocumentId || documentId);
    } catch (err) {
      // Only release when we are sure nothing was issued; otherwise the
      // proposal stays 'approved' with its reserved id and the card comes
      // back as a retry, which is idempotent.
      if (!(await documentExists(documentId).catch(() => true))) {
        await releaseProposal(proposal.id).catch(() => {});
      }
      setError(err instanceof Error ? err.message : "שגיאה ביצירת המסמך");
      setBusy(null);
    }
  }

  /** Hand the proposal to the normal editor instead of issuing it as-is. */
  function handleEdit() {
    setBusy("edit");
    const editorDraft: EditorDraft = {
      clientId: proposal.clientId,
      adhocMode: !proposal.clientId,
      adhocName: proposal.clientId ? "" : proposal.clientName,
      adhocTaxId: "",
      adhocEmail: "",
      date: todayInIsrael(),
      subject: proposal.subject,
      validUntil: "",
      paymentMethod: "bank_transfer",
      notes: "",
      vatMode: "exclusive",
      items: proposal.items.map((i) => ({
        id: crypto.randomUUID(),
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    };
    saveDraft(proposal.documentType, editorDraft);
    // The proposal stays pending on purpose: the owner may abandon the
    // editor, and a proposal marked resolved without a document would be
    // gone with nothing to show for it.
    router.push(`/documents/new?type=${proposal.documentType}`);
  }

  async function handleDismiss() {
    const ok = await confirm({
      title: "לבטל את ההצעה?",
      message: `ההצעה ל${proposal.clientName} על ${formatCurrency(amounts.total)} תוסר. אפשר תמיד ליצור את המסמך ידנית.`,
      tone: "danger",
      confirmLabel: "בטל הצעה",
    });
    if (!ok) return;
    setBusy("dismiss");
    try {
      await dismissProposal(proposal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
      setBusy(null);
    }
  }

  return (
    <div className="card-soft p-4 bg-gradient-to-br from-violet-50 to-indigo-50 border-violet-200">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-violet-700" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-900">
            {proposal.status === "approved"
              ? `האישור הקודם לא הושלם - ${typeLabel} עדיין לא הופק`
              : `${typeLabel} מוכן${proposal.documentType === "proforma" ? "ה" : ""} לאישור`}
          </p>
          <p className="text-sm text-stone-700 mt-0.5">
            <span className="font-medium text-stone-900">{proposal.clientName}</span>
            {" · "}
            {proposal.subject}
          </p>

          <ul className="mt-2 space-y-0.5 text-xs text-stone-700">
            {proposal.items.map((i, idx) => (
              <li key={idx} className="flex items-center gap-2 flex-wrap">
                <span>{i.description}</span>
                <span className="text-stone-500">·</span>
                <span>
                  {i.quantity} × {formatCurrency(i.unitPrice)}
                </span>
                <span className="text-stone-500">=</span>
                <span className="font-medium text-stone-900">{formatCurrency(i.total)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-lg font-bold text-stone-900">
            {formatCurrency(amounts.total)}
          </p>
          {amounts.vat > 0 && (
            <p className="text-xs text-stone-600">
              כולל מע"מ {formatCurrency(amounts.vat)} (לפני מע"מ {formatCurrency(amounts.subtotal)})
            </p>
          )}

          {proposal.details.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="mt-1 text-xs font-semibold text-violet-700 hover:text-violet-800"
              >
                {showDetails ? "הסתר את הפירוט" : `הצג את ${proposal.details.length} השורות מהמקור`}
              </button>
              {showDetails && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-stone-600 border-r-2 border-violet-200 pr-3">
                  {proposal.details.map((d, idx) => (
                    <li key={idx} className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-stone-800">{d.label}</span>
                      {d.note && (
                        <>
                          <span className="text-stone-400">·</span>
                          <span className="truncate">{d.note}</span>
                        </>
                      )}
                      {d.amount != null && (
                        <>
                          <span className="text-stone-400">·</span>
                          <span>{formatCurrency(d.amount)}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[11px] text-stone-500">
                מקור: {proposal.sourceLabel}
              </p>
            </>
          )}

          {error && <p className="mt-2 text-xs font-medium text-rose-700">{error}</p>}

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy !== null}
              className="pgbtn pgbtn-primary disabled:opacity-60"
            >
              {busy === "approve" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {proposal.status === "approved" ? "נסה שוב" : "אשר והפק"}
            </button>
            <button
              type="button"
              onClick={handleEdit}
              disabled={busy !== null}
              className="pgbtn pgbtn-quiet disabled:opacity-60"
            >
              <Pencil className="w-4 h-4" />
              ערוך לפני הפקה
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-700 px-2 disabled:opacity-60"
            >
              <X className="w-4 h-4" />
              לא עכשיו
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
