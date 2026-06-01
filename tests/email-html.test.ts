import { describe, it, expect } from "vitest";
import { buildHtml, buildText } from "../src/app/api/send-email/template";

/**
 * Regression suite for the email-rendering bug we hit on 2026-06-01.
 *
 * A real customer (corporate Microsoft 365 inbox) couldn't open the
 * emails because the body was a raw <div> fragment without DOCTYPE,
 * meta charset, html/body wrappers, or a plain-text alternative.
 * Defender stripped the malformed HTML and left the recipient with a
 * blank message. The user saw it render fine in Gmail Sent so it
 * looked like everything was working.
 *
 * Every assertion below maps to one structural property that bug
 * would have failed. Running this gate in pre-push catches the entire
 * class before it reaches production again.
 */

const BASE_ARGS = {
  businessName: "אסף קוטלר",
  clientName: "טים טדי בע\"מ",
  receiptNumber: 90002,
  total: 4650,
  viewUrl: "https://mysuperfriendlyinvoiceapp.vercel.app/view/abc-123",
};

describe("buildHtml structure", () => {
  const html = buildHtml(BASE_ARGS);

  it("starts with an HTML5 DOCTYPE so corporate filters don't reject it", () => {
    expect(html.trim().toLowerCase()).toMatch(/^<!doctype html/);
  });

  it("wraps content in <html lang=he dir=rtl>", () => {
    expect(html).toMatch(/<html\b[^>]*\blang="he"/i);
    expect(html).toMatch(/<html\b[^>]*\bdir="rtl"/i);
  });

  it("declares UTF-8 charset (Hebrew silently mangles without it)", () => {
    expect(html).toMatch(/<meta\b[^>]*charset="UTF-8"/i);
  });

  it("declares Content-Type meta as defensive double-up", () => {
    expect(html).toMatch(/<meta[^>]*http-equiv="Content-Type"[^>]*charset=UTF-8/i);
  });

  it("has a <title> for clients that show it", () => {
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });

  it("wraps the visible content in <body>", () => {
    expect(html).toMatch(/<body[^>]*>[\s\S]*<\/body>/i);
  });

  it("contains the view URL inside an <a href>", () => {
    expect(html).toContain(`href="${BASE_ARGS.viewUrl}"`);
  });

  it("renders the view URL as visible plain-text fallback (in case the styled button doesn't render)", () => {
    // The URL should appear at least twice: once as href, once as visible text.
    const occurrences = html.split(BASE_ARGS.viewUrl).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("escapes the client name so a quote in the name can't break the markup", () => {
    expect(html).toContain("טים טדי בע&quot;מ");
  });

  it("escapes the business name the same way", () => {
    const withQuote = buildHtml({ ...BASE_ARGS, businessName: 'Bad"Name' });
    expect(withQuote).toContain("Bad&quot;Name");
    expect(withQuote).not.toContain('Bad"Name');
  });

  it("includes the receipt number in the visible body", () => {
    expect(html).toContain("#90002");
  });

  it("includes the total amount formatted with commas", () => {
    expect(html).toContain("4,650");
  });

  it("renders the tracking pixel when one is provided", () => {
    const withPixel = buildHtml({
      ...BASE_ARGS,
      trackingPixelUrl: "https://example.com/track/abc.gif",
    });
    expect(withPixel).toMatch(/<img[^>]*src="https:\/\/example\.com\/track\/abc\.gif"[^>]*width="1"/);
  });

  it("does not render any image when no tracking pixel is provided", () => {
    const noPixel = buildHtml({ ...BASE_ARGS, logoUrl: undefined });
    expect(noPixel).not.toMatch(/width="1"[^>]*height="1"/);
  });

  it("uses the reminder wording when kind=reminder", () => {
    const reminder = buildHtml({ ...BASE_ARGS, kind: "reminder", daysSinceSent: 17 });
    expect(reminder).toContain("תזכורת");
    expect(reminder).toContain("17 ימים");
  });

  it("uses the initial wording when kind=initial", () => {
    const initial = buildHtml({ ...BASE_ARGS, kind: "initial" });
    expect(initial).toContain("מצורף מסמך");
    expect(initial).not.toContain("תזכורת");
  });
});

describe("buildText plain-text alternative", () => {
  const text = buildText(BASE_ARGS);

  it("is non-empty (corporate gateways that strip HTML fall back to this)", () => {
    expect(text.length).toBeGreaterThan(50);
  });

  it("includes the client name", () => {
    expect(text).toContain("טים טדי בע\"מ");
  });

  it("includes the receipt number", () => {
    expect(text).toContain("#90002");
  });

  it("includes the total amount", () => {
    expect(text).toContain("4,650");
  });

  it("includes the view URL as a plain link", () => {
    expect(text).toContain(BASE_ARGS.viewUrl);
  });

  it("includes the business name", () => {
    expect(text).toContain("אסף קוטלר");
  });

  it("uses reminder phrasing when kind=reminder", () => {
    const reminder = buildText({ ...BASE_ARGS, kind: "reminder", daysSinceSent: 5 });
    expect(reminder).toContain("תזכורת");
    expect(reminder).toContain("5 ימים");
  });

  it("contains no HTML tags (it must be plain text)", () => {
    expect(text).not.toMatch(/<[a-z][\s\S]*?>/i);
  });
});
