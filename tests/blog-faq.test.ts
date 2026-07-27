import { describe, it, expect } from "vitest";
import { parseFaq } from "@/lib/blog-faq";
import { BLOG_POSTS, loadPostMarkdown } from "@/lib/blog-posts";

/**
 * REGRESSION GUARD: FAQPage structured data is parsed out of the article body,
 * so the parser is the only thing standing between a reformatted article and
 * malformed schema shipping to Google.
 *
 * Drifted or malformed FAQ markup is not a lost rich result, it is a
 * structured-data manual action. These tests pin both the posts that DO have
 * an FAQ (so a silent format change fails here) and the ones that do not (so
 * we never start inventing questions that aren't on the page).
 */

// The four posts carrying a "## שאלות נפוצות" section as of 2026-07-27.
const POSTS_WITH_FAQ = [
  "mispar-haktzaa-eich-mekablim",
  "hashbonit-digitalit-chinam-2026",
  "maavar-me-invoice4u",
  "maavar-osek-patur-le-osek-morshe-2026",
];

describe("parseFaq on real post content", () => {
  for (const slug of POSTS_WITH_FAQ) {
    it(`extracts a usable FAQ from ${slug}`, () => {
      const items = parseFaq(loadPostMarkdown(slug));
      expect(items.length).toBeGreaterThanOrEqual(2);

      for (const { q, a } of items) {
        expect(q.length).toBeGreaterThan(5);
        expect(a.length).toBeGreaterThan(15);
        // Markdown syntax must never leak into structured data.
        expect(q).not.toContain("**");
        expect(a).not.toContain("**");
        expect(a).not.toContain("](");
      }
    });
  }

  it("returns nothing for posts with no FAQ section", () => {
    const withoutFaq = BLOG_POSTS.map((p) => p.slug).filter(
      (slug) => !POSTS_WITH_FAQ.includes(slug),
    );
    // Guards the guard: if every post gained an FAQ this assertion would be
    // vacuous, so make sure there is still something to test.
    expect(withoutFaq.length).toBeGreaterThan(0);

    for (const slug of withoutFaq) {
      expect(parseFaq(loadPostMarkdown(slug))).toEqual([]);
    }
  });
});

describe("parseFaq parsing rules", () => {
  it("ignores a bolded phrase inside an answer", () => {
    const md = [
      "## שאלות נפוצות",
      "",
      "**שאלה אחת?**",
      "תשובה שמכילה **הדגשה** באמצע המשפט וממשיכה הלאה.",
      "",
    ].join("\n");

    const items = parseFaq(md);
    expect(items).toHaveLength(1);
    expect(items[0].q).toBe("שאלה אחת?");
    expect(items[0].a).toContain("הדגשה");
  });

  it("stops at a horizontal rule and does not swallow later sections", () => {
    const md = [
      "## שאלות נפוצות",
      "",
      "**שאלה?**",
      "תשובה מספקת שאורכה מעל הסף.",
      "",
      "---",
      "",
      "**זו לא שאלה אלא שורה מודגשת בסעיף אחר**",
      "טקסט אחר לגמרי.",
    ].join("\n");

    expect(parseFaq(md)).toHaveLength(1);
  });

  it("drops a question with no answer rather than emitting an empty one", () => {
    const md = ["## שאלות נפוצות", "", "**שאלה בלי תשובה?**", ""].join("\n");
    expect(parseFaq(md)).toEqual([]);
  });

  it("returns [] when there is no FAQ heading at all", () => {
    expect(parseFaq("# כותרת\n\nפסקה רגילה.\n")).toEqual([]);
  });
});
