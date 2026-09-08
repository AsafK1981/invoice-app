import { describe, it, expect } from "vitest";
import {
  buildWelcomeHtml,
  buildWelcomeText,
  WELCOME_STEPS,
  WELCOME_SUBJECT,
} from "../src/app/api/send-welcome/template";
import { CANONICAL_ORIGIN } from "../src/lib/public-url";

/**
 * Structural gate for the welcome email, mirroring tests/email-html.test.ts.
 * The welcome email was a bare <div> fragment until 2026-09-08; the same
 * class of bug that blanked a document email in a Microsoft 365 inbox on
 * 2026-06-01 applied to it. Every assertion here is one property a mail
 * filter or a mail client checks before rendering.
 */

const html = buildWelcomeHtml();
const text = buildWelcomeText();

// U+2013 (en dash) and U+2014 (em dash) are banned everywhere in this
// codebase, so the pattern is built from code points rather than typed.
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("welcome email html", () => {
  it("is a full HTML5 document, not a fragment", () => {
    expect(html.trimStart().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toMatch(/<html[^>]*lang="he"[^>]*dir="rtl"/);
    expect(html).toContain('<meta charset="UTF-8"');
    expect(html).toMatch(/<body[^>]*>[\s\S]*<\/body>/);
  });

  it("uses only inline styles and table layout", () => {
    expect(html).not.toContain("<style");
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
  });

  it("links the CTA and the assets on the canonical origin", () => {
    expect(html).toContain(`href="${CANONICAL_ORIGIN}/dashboard"`);
    expect(html).toContain(`src="${CANONICAL_ORIGIN}/email/asaf.png"`);
    expect(html).toContain(`src="${CANONICAL_ORIGIN}/logo-192.png"`);
  });

  it("carries the founder note with an accessible photo", () => {
    expect(html).toMatch(/<img[^>]*src="[^"]*\/email\/asaf\.png"[^>]*alt="אסף"/);
    expect(html).toContain("היי, אני אסף.");
    expect(html).toContain("אסף קוטלר, מייסד חשבונית ידידותית");
  });

  it("renders all five steps in order", () => {
    let cursor = 0;
    for (const [title] of WELCOME_STEPS) {
      const at = html.indexOf(title, cursor);
      expect(at, `step "${title}" missing or out of order`).toBeGreaterThan(-1);
      cursor = at;
    }
  });

  it("dropped the slashed gendered greeting and the emoji", () => {
    expect(html).not.toContain("ברוך/ה");
    expect(html).not.toContain("\u{1F389}");
    expect(WELCOME_SUBJECT).not.toContain("\u{1F389}");
    expect(html).toContain("כיף שהצטרפת.");
  });

  it("never contains a long dash", () => {
    expect(html).not.toMatch(LONG_DASH);
    expect(text).not.toMatch(LONG_DASH);
  });
});

describe("welcome email text alternative", () => {
  it("has the dashboard link, every step and the signature", () => {
    expect(text).toContain(`${CANONICAL_ORIGIN}/dashboard`);
    for (const [title] of WELCOME_STEPS) expect(text).toContain(title);
    expect(text).toContain("אסף קוטלר, מייסד חשבונית ידידותית");
    expect(text).not.toContain("<");
  });
});
