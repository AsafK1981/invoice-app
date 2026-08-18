import { describe, it, expect } from "vitest";
import { validateIntent } from "@/lib/whatsapp/intent";

/**
 * REGRESSION GUARD: the model is a parser, not an authority.
 *
 * Everything validateIntent() lets through becomes a draft the user approves at
 * a glance, and approval writes an immutable tax document. The prompt asks the
 * model to be conservative, but a prompt is not an enforcement mechanism — one
 * bad generation, one model swap, or one prompt-injection-shaped customer name
 * and the guarantees have to come from here instead.
 *
 * The rule these tests pin: anything doubtful degrades to "unknown", which just
 * asks the user to rephrase. That is always cheap. A wrong document is not.
 */

const TODAY = "2026-08-08";

function ok(over: Record<string, unknown> = {}) {
  return {
    intent: "create_document",
    docType: "receipt",
    clientName: "דני כהן",
    amount: 1200,
    amountIncludesVat: false,
    paymentMethod: "העברה בנקאית",
    description: "שירותי צילום",
    date: TODAY,
    ...over,
  };
}

describe("validateIntent", () => {
  it("accepts a well-formed document intent", () => {
    const r = validateIntent(ok(), TODAY);
    expect(r.intent).toBe("create_document");
    if (r.intent !== "create_document") throw new Error("unreachable");
    expect(r.clientName).toBe("דני כהן");
    expect(r.amount).toBe(1200);
    expect(r.paymentMethod).toBe("העברה בנקאית");
  });

  it("rejects a document type outside the allowlist", () => {
    // credit_note reverses a real document. It must never be reachable from a
    // parsed sentence, even if the model names it.
    expect(validateIntent(ok({ docType: "credit_note" }), TODAY).intent).toBe("unknown");
    expect(validateIntent(ok({ docType: "proforma" }), TODAY).intent).toBe("unknown");
    expect(validateIntent(ok({ docType: "" }), TODAY).intent).toBe("unknown");
  });

  it("refuses tax invoices, which can require an allocation number", () => {
    // The channel issues receipts and quotes only. A חשבונית מס can require a
    // מספר הקצאה from רשות המסים and there is no gate for that in a chat, so
    // even a well-formed request for one must not produce a draft.
    // Mirrors the p_type allowlist in 20260808-whatsapp-channel.sql.
    expect(validateIntent(ok({ docType: "tax_invoice" }), TODAY).intent).toBe("unknown");
    expect(validateIntent(ok({ docType: "tax_invoice_receipt" }), TODAY).intent).toBe("unknown");
  });

  it("surfaces an explicit tax-invoice request instead of downgrading it", () => {
    // Silently substituting a receipt would hand the customer a document they
    // cannot deduct VAT against, so the model has a dedicated intent for this
    // and the handler answers it with a real explanation.
    expect(validateIntent({ intent: "unavailable_doc_type" }, TODAY).intent).toBe(
      "unavailable_doc_type",
    );
  });

  it("rejects non-positive, non-finite and absurd amounts", () => {
    // 1_000_001 is the sanity rail: it catches a decimal-point misread
    // (500 -> 500000) before it becomes an immutable document.
    for (const amount of [0, -50, NaN, Infinity, null, undefined, "", "1,200", "אלף", 1_000_001]) {
      expect(
        validateIntent(ok({ amount }), TODAY).intent,
        `amount ${String(amount)} should not pass`,
      ).toBe("unknown");
    }
  });

  it("coerces a clean numeric string, on purpose", () => {
    // Number("1200") is exact, so rejecting it would only turn a harmless model
    // formatting choice into a "didn't understand you" reply. Anything that is
    // NOT cleanly numeric ("1,200", "אלף", "") becomes NaN and is rejected by
    // the test above, so the permissiveness has a hard edge.
    const r = validateIntent(ok({ amount: "1200" }), TODAY);
    if (r.intent !== "create_document") throw new Error("expected create_document");
    expect(r.amount).toBe(1200);
  });

  it("rejects a missing or implausibly short client name", () => {
    for (const clientName of ["", " ", "א", null, undefined]) {
      expect(
        validateIntent(ok({ clientName }), TODAY).intent,
        `clientName ${String(clientName)} should not pass`,
      ).toBe("unknown");
    }
  });

  it("drops a payment method it does not recognise instead of passing it through", () => {
    // payment_method reaches the document and its PDF. An invented value would
    // print verbatim on a legal document, so an unknown one becomes null.
    const r = validateIntent(ok({ paymentMethod: "מטבע קריפטו" }), TODAY);
    if (r.intent !== "create_document") throw new Error("expected create_document");
    expect(r.paymentMethod).toBeNull();
  });

  it("falls back to today on a malformed date", () => {
    for (const date of ["08/08/2026", "yesterday", "", 20260808, null]) {
      const r = validateIntent(ok({ date }), TODAY);
      if (r.intent !== "create_document") throw new Error("expected create_document");
      expect(r.date).toBe(TODAY);
    }
  });

  it("falls back to today on a shape-valid but impossible or absurd date", () => {
    // "2026-02-31" passes the regex and would only be rejected by Postgres —
    // i.e. after the user already tapped confirm. "1900-01-01" is a real date
    // that has no business on a document issued today.
    for (const date of ["2026-02-31", "2026-13-01", "1900-01-01", "2999-01-01"]) {
      const r = validateIntent(ok({ date }), TODAY);
      if (r.intent !== "create_document") throw new Error("expected create_document");
      expect(r.date, `${date} should have fallen back`).toBe(TODAY);
    }
  });

  it("keeps a real date inside the plausible window", () => {
    // Backdating a receipt by a few weeks is legitimate and must survive.
    const r = validateIntent(ok({ date: "2026-07-15" }), TODAY);
    if (r.intent !== "create_document") throw new Error("expected create_document");
    expect(r.date).toBe("2026-07-15");
  });

  it("amountIncludesVat is true/false ONLY for literal booleans; anything else is 'not stated' (null)", () => {
    // Getting this wrong changes the customer's total by 18%. A truthy-ish
    // value ("true", 1) must not count - and since 2026-08-18 "not stated"
    // is a real third state that makes the bot ASK a VAT business.
    for (const v of ["true", 1, "yes", {}, undefined]) {
      const r = validateIntent(ok({ amountIncludesVat: v }), TODAY);
      if (r.intent !== "create_document") throw new Error("expected create_document");
      expect(r.amountIncludesVat, `value ${String(v)} should be null`).toBe(null);
    }
    const t = validateIntent(ok({ amountIncludesVat: true }), TODAY);
    const f = validateIntent(ok({ amountIncludesVat: false }), TODAY);
    if (t.intent !== "create_document" || f.intent !== "create_document") throw new Error("expected create_document");
    expect(t.amountIncludesVat).toBe(true);
    expect(f.amountIncludesVat).toBe(false);
  });

  it("clamps an over-long description rather than rejecting the whole request", () => {
    const r = validateIntent(ok({ description: "א".repeat(5000) }), TODAY);
    if (r.intent !== "create_document") throw new Error("expected create_document");
    expect(r.description!.length).toBeLessThanOrEqual(200);
  });

  it("a missing or generic description becomes null so the bot asks 'עבור מה?'", () => {
    for (const v of [undefined, "", "   ", "תשלום", "שירות"]) {
      const r = validateIntent(ok({ description: v }), TODAY);
      if (r.intent !== "create_document") throw new Error("expected create_document");
      expect(r.description, `description ${String(v)} should be null`).toBe(null);
    }
    const r = validateIntent(ok({ description: "ייעוץ עסקי" }), TODAY);
    if (r.intent !== "create_document") throw new Error("expected create_document");
    expect(r.description).toBe("ייעוץ עסקי");
  });

  it("rounds the amount to two decimals", () => {
    const r = validateIntent(ok({ amount: 1200.005 }), TODAY);
    if (r.intent !== "create_document") throw new Error("expected create_document");
    expect(Math.round(r.amount * 100)).toBe(r.amount * 100);
  });

  it("passes help and status through, and treats anything else as unknown", () => {
    expect(validateIntent({ intent: "help" }, TODAY).intent).toBe("help");
    expect(validateIntent({ intent: "status" }, TODAY).intent).toBe("status");
    expect(validateIntent({ intent: "delete_everything" }, TODAY).intent).toBe("unknown");
    expect(validateIntent({}, TODAY).intent).toBe("unknown");
  });

  it("keeps the model's Hebrew reason so the user is told what was missing", () => {
    const r = validateIntent({ intent: "unknown", reason: "חסר סכום." }, TODAY);
    if (r.intent !== "unknown") throw new Error("expected unknown");
    expect(r.reason).toBe("חסר סכום.");
  });
});
