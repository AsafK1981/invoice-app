import { describe, expect, it } from "vitest";
import {
  findIssuedMatch,
  periodStart,
  toIssuedCandidate,
  type IssuedCandidate,
} from "../src/lib/proposal-match";

const CLIENT = "d1d3f1db-82af-444f-bf86-10f1050f56ce";

const proposal = {
  documentType: "proforma",
  clientId: CLIENT,
  clientName: 'טים טדי בע"מ',
  subject: "הופעות עם פיניש - אוגוסט 2026",
  total: 7750,
  period: "2026-08",
};

function doc(over: Partial<IssuedCandidate> = {}): IssuedCandidate {
  return {
    id: "doc-1",
    type: "proforma",
    status: "sent",
    date: "2026-09-01",
    clientId: CLIENT,
    clientName: 'טים טדי בע"מ',
    subject: "הופעות עם פיניש - אוגוסט 2026",
    subtotal: 7750,
    createdAt: "2026-09-01T13:30:05Z",
    ...over,
  };
}

describe("periodStart", () => {
  it("returns the first of the month", () => {
    expect(periodStart("2026-08")).toBe("2026-08-01");
  });
  it("never matches anything for a malformed period", () => {
    expect(findIssuedMatch({ ...proposal, period: "garbage" }, [doc()])).toBeNull();
  });
});

describe("findIssuedMatch", () => {
  it("matches the 2026-09-01 incident: same client + subject, issued via the editor", () => {
    expect(findIssuedMatch(proposal, [doc()])?.id).toBe("doc-1");
  });

  it("ignores subject whitespace differences", () => {
    expect(
      findIssuedMatch(proposal, [doc({ subject: "  הופעות עם פיניש  -  אוגוסט 2026 " })]),
    ).not.toBeNull();
  });

  it("matches a rewritten subject when type and pre-VAT amount agree", () => {
    expect(findIssuedMatch(proposal, [doc({ subject: "אוגוסט - הופעות" })])?.id).toBe("doc-1");
  });

  it("does not match a rewritten subject with a different amount", () => {
    expect(findIssuedMatch(proposal, [doc({ subject: "אוגוסט - הופעות", subtotal: 6200 })])).toBeNull();
  });

  it("does not match a rewritten subject issued as a different document type", () => {
    expect(findIssuedMatch(proposal, [doc({ subject: "משהו אחר", type: "receipt" })])).toBeNull();
  });

  it("does not match an identical subject issued as a different document type", () => {
    // The quote that preceded this proforma carries the same subject and the
    // same amount. Matching it would resolve the proposal against a document
    // that bills nobody, and the proforma would never be issued.
    expect(findIssuedMatch(proposal, [doc({ type: "quote" })])).toBeNull();
    expect(findIssuedMatch(proposal, [doc({ type: "receipt" })])).toBeNull();
  });

  it("never matches a draft", () => {
    expect(findIssuedMatch(proposal, [doc({ status: "draft" })])).toBeNull();
  });

  it("never matches a document dated before the billed month", () => {
    expect(findIssuedMatch(proposal, [doc({ date: "2026-07-31" })])).toBeNull();
    expect(findIssuedMatch(proposal, [doc({ date: "2026-08-01" })])).not.toBeNull();
  });

  it("never matches another client, even with an identical subject", () => {
    expect(findIssuedMatch(proposal, [doc({ clientId: "someone-else" })])).toBeNull();
  });

  it("falls back to the client name when the proposal has no client id", () => {
    const adhoc = { ...proposal, clientId: null, clientName: "חברה אחרת" };
    expect(findIssuedMatch(adhoc, [doc({ clientId: null, clientName: " חברה  אחרת" })])).not.toBeNull();
    expect(findIssuedMatch(adhoc, [doc({ clientId: null, clientName: "חברה שלישית" })])).toBeNull();
  });

  it("prefers the reserved document id over any heuristic", () => {
    const reserved = doc({ id: "reserved", subject: "x", subtotal: 1, date: "2020-01-01" });
    const lookalike = doc({ id: "lookalike" });
    expect(
      findIssuedMatch({ ...proposal, intendedDocumentId: "reserved" }, [lookalike, reserved])?.id,
    ).toBe("reserved");
  });

  it("picks the earliest match when there are several", () => {
    const later = doc({ id: "later", date: "2026-09-03" });
    const earlier = doc({ id: "earlier", date: "2026-09-02" });
    expect(findIssuedMatch(proposal, [later, earlier])?.id).toBe("earlier");
  });
});

describe("toIssuedCandidate", () => {
  it("maps a snake_case documents row", () => {
    const c = toIssuedCandidate({
      id: "a",
      type: "proforma",
      status: "sent",
      date: "2026-09-01",
      client_id: null,
      client_name: "x",
      subject: "s",
      subtotal: "12.5",
      created_at: "t",
    });
    expect(c).toEqual({
      id: "a",
      type: "proforma",
      status: "sent",
      date: "2026-09-01",
      clientId: null,
      clientName: "x",
      subject: "s",
      subtotal: 12.5,
      createdAt: "t",
    });
  });
});
