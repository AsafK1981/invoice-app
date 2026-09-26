import type { Competitor } from "@/lib/comparison-data";

/**
 * The internal link graph.
 *
 * Audited 2026-07-27: the site had ZERO internal links between content pages.
 * No post linked to another post, none linked to a /vs comparison, and
 * `maavar-me-invoice4u` did not link to `/vs/invoice4u` - the single most
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
    posts: ["mispar-haktzaa-madrich-2026", "maavar-osek-patur-le-osek-morshe-2026"],
    vs: ["greeninvoice"],
  },
  "mispar-haktzaa-madrich-2026": {
    posts: ["mispar-haktzaa-eich-mekablim", "osek-patur-madrich-2026"],
  },

  "maavar-osek-patur-le-osek-morshe-2026": {
    posts: ["tikrat-osek-patur-2026", "osek-patur-madrich-2026", "mispar-haktzaa-eich-mekablim"],
    vs: ["sumit"],
  },
  "osek-patur-madrich-2026": {
    posts: ["tikrat-osek-patur-2026", "maavar-osek-patur-le-osek-morshe-2026", "kabala-osek-patur"],
  },

  // The ceiling page and the transition page are the same anxious reader at
  // two moments (approaching the ceiling / crossing it) - tightly linked
  // both ways now that the ceiling page is published.
  "tikrat-osek-patur-2026": {
    posts: ["maavar-osek-patur-le-osek-morshe-2026", "osek-patur-madrich-2026"],
    vs: ["greeninvoice"],
  },
  "hashbonit-digitalit-chinam-2026": {
    posts: ["osek-patur-madrich-2026", "kabala-osek-patur"],
    vs: ["ezcount", "icount"],
  },

  // The receipt page answers "what goes in the document"; the 2026 guide
  // answers "which document do I issue at all". Same reader, consecutive
  // questions - so they point at each other, and the receipt page hands the
  // reader onward to the עוסק מורשה transition, which is the next thing that
  // happens to anyone who outgrows a receipt pad.
  "kabala-osek-patur": {
    posts: ["kabala-hashbonit-mas-hevdel", "osek-patur-madrich-2026", "hashbonit-zikuy"],
    vs: ["greeninvoice"],
  },

  // "Which of the three documents do I issue" - the same reader as the
  // receipt page and the allocation-number pages, wired into that cluster.
  "kabala-hashbonit-mas-hevdel": {
    posts: ["hashbonit-iska-osek-patur", "kabala-osek-patur", "mispar-haktzaa-eich-mekablim"],
    vs: ["greeninvoice"],
  },

  // Template-intent page (filled חשבונית עסקה specimen). Sits next to the
  // receipt page and the document-comparison page in the same cluster.
  "hashbonit-iska-osek-patur": {
    posts: ["kabala-hashbonit-mas-hevdel", "kabala-osek-patur", "osek-patur-madrich-2026"],
    vs: ["greeninvoice"],
  },

  // A credit invoice is what you reach for AFTER a tax invoice went wrong, so
  // the allocation-number guide (which explains the tax invoice itself) and
  // the transition guide (which is when you start issuing them at all) are
  // the two things this reader needs next.
  "hashbonit-zikuy": {
    posts: ["mispar-haktzaa-eich-mekablim", "maavar-osek-patur-le-osek-morshe-2026"],
    vs: ["icount"],
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
