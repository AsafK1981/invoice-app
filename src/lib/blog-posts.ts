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
 *  REVIEW-FIRST: how publishing works
 * ─────────────────────────────────────────────────────────────────────────
 *  Every post is imported with `published: false`. While false, a post is:
 *    • hidden from the /blog index list,
 *    • excluded from sitemap.ts,
 *    • marked `robots: noindex, nofollow` on its own page,
 *    • shown with a visible "טיוטה: עדיין לא פורסם" banner.
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
 * All imported drafts. Ordering here does not matter; the index sorts by
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
    // Slug intentionally keeps the lowercase spelling; it is a live URL in
    // the sitemap. Only the human-facing title/description use the brand's
    // real casing, "Invoice4U".
    slug: "maavar-me-invoice4u",
    title: "מעבר מ-Invoice4U: איך עוברים תוכנת חשבוניות בלי לאבד היסטוריה",
    description:
      "שוקלים לעזוב את Invoice4U? מדריך מעשי למעבר לתוכנת חשבוניות אחרת ב-2026: מה לגבות לפני שעוזבים, איך לא לאבד לקוחות והיסטוריית מסמכים, ומה לבדוק לפני שבוחרים תחליף.",
    date: "2026-07-14",
    published: true,
  },
  {
    slug: "maavar-osek-patur-le-osek-morshe-2026",
    title: "מעבר מעוסק פטור לעוסק מורשה: המדריך המלא 2026",
    description:
      "עברתם את תקרת המחזור? המדריך המלא למעבר מעוסק פטור לעוסק מורשה ב-2026: מה משתנה, איך נרשמים ברשות המסים, ואיך ממשיכים להוציא חשבוניות בלי כאב ראש.",
    date: "2026-07-14",
    published: true,
  },
  {
    slug: "mispar-haktzaa-madrich-2026",
    title: "מספר הקצאה לחשבוניות ב-2026: המדריך המלא לעצמאים",
    description:
      "מהו מספר הקצאה, למי הוא חובה, ומהם הספים המעודכנים ל-2026? מדריך פשוט לעצמאים על רפורמת חשבונית ישראל: איך מוציאים מספר הקצאה ואיך תוכנה עושה זאת אוטומטית.",
    date: "2026-07-13",
    published: true,
  },
  {
    slug: "osek-patur-madrich-2026",
    title: "עוסק פטור 2026: המדריך המלא להוצאת קבלות וחשבוניות כחוק",
    description:
      "מה עוסק פטור צריך להוציא: קבלה, חשבונית עסקה או חשבונית מס? מדריך 2026 על מספור רציף, מסמך ממוחשב, שמירת מסמכים 7 שנים והטעויות הנפוצות. פשוט וברור.",
    date: "2026-07-13",
    published: true,
  },
  {
    // Written 2026-08-24 straight off Search Console data, not from a topic
    // guess. The Performance report showed 432 impressions at average
    // position 37.2 and exactly one click, and the top queries were
    // "קבלות עוסק פטור" (24), "קבלה עוסק פטור להורדה" (17) and
    // "חשבונית זיכוי ממולאת" (37). "להורדה" and "ממולאת" are template
    // intent - people wanting a filled example they can copy - and no page
    // on the site answered that. osek-patur-madrich-2026 covers WHICH
    // document to issue; this one covers what goes IN it, with a filled
    // specimen, so the two inform rather than cannibalise each other.
    slug: "kabala-osek-patur",
    title: "קבלה לעוסק פטור: מה חייב להופיע בה, דוגמה ממולאת ותבנית להורדה",
    description:
      "קבלה לעוסק פטור: מה חייב להופיע בה לפי החוק, דוגמה ממולאת שאפשר להעתיק, ושלושת הכללים שבהם באמת נכשלים - מספור רציף, הוצאה מיידית וסדר כרונולוגי.",
    date: "2026-08-24",
    published: true,
  },
  {
    // Highest-demand query in Search Console on 2026-08-24 that the site had
    // no page for: "חשבונית זיכוי ממולאת", 37 impressions and 0 clicks. The
    // word ממולאת is template intent, so the page leads with a filled
    // specimen rather than a definition. Its differentiator is the fact most
    // guides bury: a credit invoice does NOT need a מספר הקצאה - that duty
    // covers חשבונית מס and חשבונית מס־קבלה only.
    slug: "hashbonit-zikuy",
    title: "חשבונית זיכוי: מתי מוציאים אותה, מה חייב להופיע ודוגמה ממולאת",
    description:
      "חשבונית זיכוי: מתי מוציאים, מה חייב להופיע בה ודוגמה ממולאת. למה אסור למחוק חשבונית מס, ולמה חשבונית זיכוי לא צריכה מספר הקצאה.",
    date: "2026-08-24",
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
