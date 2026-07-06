import type { DocumentType, PaymentMethod } from "./types";
import type { VatMode } from "./vat";

export interface DraftItem {
  id: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface EditorDraft {
  clientId: string;
  adhocMode: boolean;
  adhocName: string;
  adhocTaxId: string;
  adhocEmail: string;
  date: string;
  subject: string;
  validUntil: string;
  paymentMethod: PaymentMethod;
  notes: string;
  vatMode: VatMode;
  /** Round the final total to a whole shekel (הפרש עיגול). Optional for
   *  backward compatibility with drafts saved before the feature existed. */
  roundTotal?: boolean;
  items: DraftItem[];
}

interface StoredDraft {
  draft: EditorDraft;
  savedAt: number;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const PREFIX = "invoice-app:draft:";

function key(documentType: DocumentType): string {
  return `${PREFIX}${documentType}`;
}

export function saveDraft(documentType: DocumentType, draft: EditorDraft): void {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredDraft = { draft, savedAt: Date.now() };
    localStorage.setItem(key(documentType), JSON.stringify(stored));
  } catch {
    // storage full / private mode — ignore silently
  }
}

export function loadDraft(documentType: DocumentType): { draft: EditorDraft; savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(documentType));
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredDraft;
    if (!stored?.draft || typeof stored.savedAt !== "number") return null;
    if (Date.now() - stored.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key(documentType));
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function clearDraft(documentType: DocumentType): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key(documentType));
  } catch {
    // ignore
  }
}

/**
 * A draft is "empty" if it looks like the editor's default unfilled state:
 * no client, no description on any item, default quantities, etc. We don't
 * want to nag the user with a recovery banner for a draft that has nothing
 * worth recovering.
 */
export function isDraftEmpty(draft: EditorDraft): boolean {
  if (draft.clientId || draft.adhocName.trim()) return false;
  if (draft.subject.trim() || draft.notes.trim()) return false;
  if (draft.adhocTaxId.trim() || draft.adhocEmail.trim()) return false;
  return draft.items.every(
    (i) => !i.description.trim() && i.quantity === 1 && i.unitPrice === 0
  );
}
