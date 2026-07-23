import fs from "node:fs";
import path from "node:path";

/**
 * Blog / magazine post registry.
 *
 * Each entry is a Hebrew SEO article drafted by the marketing content engine.
 * The markdown body lives in `src/content/blog/<slug>.md`; this file holds the
 * typed metadata plus the crucial `published` flag.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  REVIEW-FIRST — how publishing works
 * ─────────────────────────────────────────────────────────────────────────
 *  Every post is imported with `published: false`. While false, a post is:
 *    • hidden from the /blog index list,
 *    • excluded from sitemap.ts,
 *    • marked `robots: noindex, nofollow` on its own page,
 *    • shown with a visible "טיוטה — עדיין לא פורסם" banner.
 *  It is still reachable by direct URL (/blog/<slug>) so Asaf can review it.
 *
 *  TO PUBLISH A POST: flip that post's `published` field below from
 *  `false` to `true`. That single change adds it to the index + sitemap,
 *  removes the draft banner, and lets search engines index it. Nothing
 *  else needs to change.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface BlogPost {
  /** URL slug: /blog/<slug> and the filename src/content/blog/<slug>.md */
  slug: string;
  /** H1 title of the article */
  title: string;
  /** Short lead / meta description shown on the card and in <meta>/OG */
  description: string;
  /** Publication date (folder date the draft came from), ISO yyyy-mm-dd */
  date: string;
  /** REVIEW-FIRST gate. false = draft (hidden from index + sitemap, noindex). */
  published: boolean;
}

/**
 * All imported drafts. Ordering here does not matter — the index sorts by
 * date. Keep `published: false` until a post has been reviewed and approved.
 */
export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "mispar-haktzaa-eich-mekablim",
    title: "מספר הקצאה איך מקבלים: המדריך הפשוט לעוסק שמוציא חשבונית מס ב-2026",
    description:
      "מספר הקצאה איך מקבלים? מדריך פשוט: מתי חובה, מי מבקש אותו, ואיך תוכנת חשבוניות עושה את זה אוטומטית בלי שתגישו טפסים בעצמכם.",
    date: "2026-07-21",
    published: true,
  },
  {
    slug: "hashbonit-digitalit-chinam-2026",
    title:
      "חשבונית דיגיטלית חינם ל-2026: המדריך לעוסק פטור שרוצה להוציא חשבונית בלי לשלם ובלי כאב ראש",
    description:
      "מחפשים חשבונית דיגיטלית חינם לעוסק פטור ב-2026? מדריך פשוט: מה חובה לפי חוק, מתי צריך מספר הקצאה, ואיך להוציא חשבונית תוך דקה בלי לשלם.",
    date: "2026-07-21",
    published: true,
  },
  {
    slug: "maavar-me-invoice4u",
    title: "מעבר מ-invoice4u: איך עוברים תוכנת חשבוניות בלי לאבד היסטוריה",
    description:
      "שוקלים לעזוב את invoice4u? מדריך מעשי למעבר לתוכנת חשבוניות אחרת ב-2026 - מה לגבות לפני שעוזבים, איך לא לאבד לקוחות והיסטוריית מסמכים, ומה לבדוק לפני שבוחרים תחליף.",
    date: "2026-07-14",
    published: true,
  },
  {
    slug: "maavar-osek-patur-le-osek-morshe-2026",
    title: "מעבר מעוסק פטור לעוסק מורשה - המדריך המלא 2026",
    description:
      "עברתם את תקרת המחזור? המדריך המלא למעבר מעוסק פטור לעוסק מורשה ב-2026 - מה משתנה, איך נרשמים ברשות המסים, ואיך ממשיכים להוציא חשבוניות בלי כאב ראש.",
    date: "2026-07-14",
    published: true,
  },
  {
    slug: "article-2026-07-13-1",
    title: "מספר הקצאה לחשבוניות ב-2026: המדריך המלא לעצמאים",
    description:
      "מהו מספר הקצאה, למי הוא חובה, ומהם הספים המעודכנים ל-2026? מדריך פשוט לעצמאים על רפורמת חשבונית ישראל — איך מוציאים מספר הקצאה ואיך תוכנה עושה זאת אוטומטית.",
    date: "2026-07-13",
    published: true,
  },
  {
    slug: "article-2026-07-13-2",
    title: "עוסק פטור 2026: המדריך המלא להוצאת קבלות וחשבוניות כחוק",
    description:
      "מה עוסק פטור צריך להוציא — קבלה, חשבונית עסקה או חשבונית מס? מדריך 2026 על מספור רציף, מסמך ממוחשב, שמירת מסמכים 7 שנים והטעויות הנפוצות. פשוט וברור.",
    date: "2026-07-13",
    published: true,
  },
];

/** Newest first. */
function byDateDesc(a: BlogPost, b: BlogPost): number {
  return b.date.localeCompare(a.date);
}

/** Posts that have been approved for publishing (published: true), newest first. */
export function getPublishedPosts(): BlogPost[] {
  return BLOG_POSTS.filter((p) => p.published).sort(byDateDesc);
}

/** All posts, published or draft, newest first. */
export function getAllPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort(byDateDesc);
}

/** Look up a single post by slug (draft or published), or undefined. */
export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/**
 * Read the raw markdown body for a post from src/content/blog/<slug>.md.
 * Server-only (uses the filesystem at build time). Throws if the file is
 * missing so a broken registry fails loudly rather than rendering blank.
 */
export function loadPostMarkdown(slug: string): string {
  const file = path.join(process.cwd(), "src", "content", "blog", `${slug}.md`);
  return fs.readFileSync(file, "utf8");
}
