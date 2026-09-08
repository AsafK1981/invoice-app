import { describe, it, expect } from "vitest";
import { buildWelcomeHtml, buildWelcomeText, WELCOME_SUBJECT } from "../src/app/api/send-welcome/template";
import { CANONICAL_ORIGIN } from "../src/lib/public-url";

/**
 * Structural gate for the welcome email, mirroring tests/email-html.test.ts.
 * The welcome email was a bare <div> fragment until 2026-09-08; the same
 * class of bug that blanked a document email in a Microsoft 365 inbox on
 * 2026-06-01 applied to it. Every assertion here is one property a mail
 * filter or a mail client checks before rendering, plus the copy rules
 * Asaf set the same day (one action, no slashed greeting, no emoji).
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

  it("asks for exactly one action: the first document, on the canonical origin", () => {
    expect(html).toContain(`href="${CANONICAL_ORIGIN}/documents/new"`);
    // The footer site link is the only other anchor; no dashboard link, no list of tasks.
    const anchors = html.match(/<a\s/g) ?? [];
    expect(anchors).toHaveLength(2);
    expect(html).not.toContain("/dashboard");
    expect(html).not.toContain("<ul");
  });

  it("serves the assets from the canonical origin", () => {
    expect(html).toContain(`src="${CANONICAL_ORIGIN}/email/asaf.png"`);
    expect(html).toContain(`src="${CANONICAL_ORIGIN}/logo-192.png"`);
  });

  it("carries the founder note with an accessible photo", () => {
    expect(html).toMatch(/<img[^>]*src="[^"]*\/email\/asaf\.png"[^>]*alt="אסף"/);
    expect(html).toContain("היי, אני אסף.");
    expect(html).toContain("אסף קוטלר, מייסד חשבונית ידידותית");
  });

  it("dropped the slashed gendered greeting and the emoji", () => {
    expect(html).not.toContain("ברוך/ה");
    expect(html).not.toContain("\u{1F389}");
    expect(WELCOME_SUBJECT).not.toContain("\u{1F389}");
    expect(html).toContain("המסמך הראשון שלך יוצא תוך דקה.");
  });

  it("makes no claim the product does not back", () => {
    // Free launch period without a card, and automatic allocation numbers,
    // are the two facts the email leans on. Nothing numeric beyond "a minute".
    expect(html).toContain("בלי כרטיס אשראי");
    expect(html).toContain("מספרי ההקצאה");
    // The text twin is the copy without markup (no hex colours, no pixel widths).
    expect(text.replace(/https?:\S+/g, "")).not.toMatch(/\d/);
  });

  it("never contains a long dash", () => {
    expect(html).not.toMatch(LONG_DASH);
    expect(text).not.toMatch(LONG_DASH);
  });
});

describe("welcome email text alternative", () => {
  it("has the first-document link and the signature, and no markup", () => {
    expect(text).toContain(`${CANONICAL_ORIGIN}/documents/new`);
    expect(text).toContain("אסף קוטלר, מייסד חשבונית ידידותית");
    expect(text).not.toContain("<");
  });
});
