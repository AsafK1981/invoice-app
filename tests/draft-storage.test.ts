import { describe, it, expect, beforeEach } from "vitest";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  isDraftEmpty,
  type EditorDraft,
} from "@/lib/draft-storage";

function makeEmptyDraft(): EditorDraft {
  return {
    clientId: "",
    adhocMode: false,
    adhocName: "",
    adhocTaxId: "",
    adhocEmail: "",
    date: "2026-05-03",
    subject: "",
    validUntil: "",
    paymentMethod: "bank_transfer",
    notes: "",
    vatMode: "exclusive",
    items: [{ id: "i1", description: "", quantity: 1, unitPrice: 0 }],
  };
}

function makeFilledDraft(): EditorDraft {
  return {
    ...makeEmptyDraft(),
    clientId: "c1",
    subject: "ייעוץ",
    items: [{ id: "i1", description: "שעות", quantity: 5, unitPrice: 150 }],
  };
}

beforeEach(() => {
  // setup file already clears localStorage, but be explicit
  clearDraft("receipt");
  clearDraft("quote");
  clearDraft("tax_invoice");
  clearDraft("tax_invoice_receipt");
  clearDraft("credit_note");
});

describe("isDraftEmpty", () => {
  it("returns true for default-state draft", () => {
    expect(isDraftEmpty(makeEmptyDraft())).toBe(true);
  });

  it("returns false when client is set", () => {
    expect(isDraftEmpty({ ...makeEmptyDraft(), clientId: "c1" })).toBe(false);
  });

  it("returns false when an item has a description", () => {
    expect(isDraftEmpty(makeFilledDraft())).toBe(false);
  });

  it("returns false when adhoc name is set", () => {
    expect(
      isDraftEmpty({ ...makeEmptyDraft(), adhocMode: true, adhocName: "Random Co" })
    ).toBe(false);
  });

  it("returns false when notes are non-empty", () => {
    expect(isDraftEmpty({ ...makeEmptyDraft(), notes: "important" })).toBe(false);
  });

  it("treats whitespace-only fields as empty", () => {
    expect(
      isDraftEmpty({
        ...makeEmptyDraft(),
        adhocName: "   ",
        subject: "  ",
        notes: " ",
      })
    ).toBe(true);
  });
});

describe("saveDraft / loadDraft", () => {
  it("round-trips a draft cleanly", () => {
    const draft = makeFilledDraft();
    saveDraft("quote", draft);
    const loaded = loadDraft("quote");
    expect(loaded).not.toBeNull();
    expect(loaded?.draft).toEqual(draft);
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("loadDraft returns null when no draft saved", () => {
    expect(loadDraft("receipt")).toBeNull();
  });

  it("drafts are scoped per document type", () => {
    const quoteDraft = { ...makeFilledDraft(), subject: "quote-subject" };
    const receiptDraft = { ...makeFilledDraft(), subject: "receipt-subject" };
    saveDraft("quote", quoteDraft);
    saveDraft("receipt", receiptDraft);
    expect(loadDraft("quote")?.draft.subject).toBe("quote-subject");
    expect(loadDraft("receipt")?.draft.subject).toBe("receipt-subject");
  });

  it("loadDraft returns null on malformed JSON", () => {
    localStorage.setItem("invoice-app:draft:quote", "{not json");
    expect(loadDraft("quote")).toBeNull();
  });

  it("loadDraft returns null and removes a stale draft (>24h old)", () => {
    const draft = makeFilledDraft();
    const stale = {
      draft,
      savedAt: Date.now() - 25 * 60 * 60 * 1000,
    };
    localStorage.setItem("invoice-app:draft:quote", JSON.stringify(stale));
    expect(loadDraft("quote")).toBeNull();
    // also auto-cleared
    expect(localStorage.getItem("invoice-app:draft:quote")).toBeNull();
  });

  it("loadDraft returns the draft when within 24h", () => {
    const draft = makeFilledDraft();
    const fresh = {
      draft,
      savedAt: Date.now() - 12 * 60 * 60 * 1000,
    };
    localStorage.setItem("invoice-app:draft:quote", JSON.stringify(fresh));
    expect(loadDraft("quote")?.draft).toEqual(draft);
  });
});

describe("clearDraft", () => {
  it("removes a saved draft", () => {
    saveDraft("quote", makeFilledDraft());
    expect(loadDraft("quote")).not.toBeNull();
    clearDraft("quote");
    expect(loadDraft("quote")).toBeNull();
  });

  it("clearing one doc type doesn't affect another", () => {
    saveDraft("quote", makeFilledDraft());
    saveDraft("receipt", makeFilledDraft());
    clearDraft("quote");
    expect(loadDraft("quote")).toBeNull();
    expect(loadDraft("receipt")).not.toBeNull();
  });

  it("clearing a non-existent draft is a no-op", () => {
    expect(() => clearDraft("credit_note")).not.toThrow();
  });
});
