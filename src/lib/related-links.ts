import type { Competitor } from "@/lib/comparison-data";

/**
 * The internal link graph.
 *
 * Audited 2026-07-27: the site had ZERO internal links between content pages.
 * No post linked to another post, none linked to a /vs comparison, and
 * `maavar-me-invoice4u` did not link to `/vs/invoice4u` — the single most
 * obvious pair on the site. Every article was an SEO dead end: crawlers
 * arrived, found one outbound link back to /blog, and left. Nothing passed
 * authority to the comparison pages, which are the highest-intent surfaces.
 *
 * Only SLUGS live here. Titles are resolved at render time from BLOG_POSTS and
 * COMPETITORS so a renamed post cannot leave a stale label behind, and
 * tests/related-links.test.ts fails if any slug stops resolving (e.g. when a
 * post is unpublished), which is the only thing preventing silent 404s.
 */

export interface RelatedTargets {
  /** Blog post slugs. */
  posts?: string[];
  /** Competitor slugs, rendered as /vs/<slug>. */
  vs?: Competitor["slug"][];
}

export const POST_RELATED: Record<string, RelatedTargets> = {
  // The migration guide and the Invoice4U comparison are the same reader at
  // the same moment; they were never linked.
  "maavar-me-invoice4u": {
    posts: ["hashbonit-digitalit-chinam-2026"],
    vs: ["invoice4u", "greeninvoice"],
  },

  // These two both target "מספר הקצאה" and currently cannibalize each other.
  // Linking them tells Google they are a cluster, not duplicates.
  "mispar-haktzaa-eich-mekablim": {
    posts: ["article-2026-07-13-1", "maavar-osek-patur-le-osek-morshe-2026"],
    vs: ["greeninvoice"],
  },
  "article-2026-07-13-1": {
    posts: ["mispar-haktzaa-eich-mekablim", "article-2026-07-13-2"],
  },

  "maavar-osek-patur-le-osek-morshe-2026": {
    posts: ["article-2026-07-13-2", "mispar-haktzaa-eich-mekablim"],
    vs: ["sumit"],
  },
  "article-2026-07-13-2": {
    posts: ["maavar-osek-patur-le-osek-morshe-2026", "hashbonit-digitalit-chinam-2026"],
  },
  "hashbonit-digitalit-chinam-2026": {
    posts: ["article-2026-07-13-2", "mispar-haktzaa-eich-mekablim"],
    vs: ["ezcount", "icount"],
  },
};

/**
 * Comparison page -> the guides worth reading next. Every /vs page gets the
 * two broad explainers; invoice4u additionally gets the migration guide, which
 * is the specific thing someone comparing against Invoice4U is about to need.
 */
const VS_DEFAULT_POSTS = [
  "hashbonit-digitalit-chinam-2026",
  "mispar-haktzaa-eich-mekablim",
];

export const VS_RELATED: Record<Competitor["slug"], string[]> = {
  invoice4u: ["maavar-me-invoice4u", ...VS_DEFAULT_POSTS],
  greeninvoice: VS_DEFAULT_POSTS,
  ifreelance: VS_DEFAULT_POSTS,
  sumit: ["maavar-osek-patur-le-osek-morshe-2026", ...VS_DEFAULT_POSTS],
  icount: VS_DEFAULT_POSTS,
  ezcount: VS_DEFAULT_POSTS,
};
