import { describe, it, expect } from "vitest";
import { POST_RELATED, VS_RELATED } from "@/lib/related-links";
import { BLOG_POSTS, getPublishedPosts, getPostBySlug } from "@/lib/blog-posts";
import { COMPETITORS } from "@/lib/comparison-data";

/**
 * REGRESSION GUARD: the internal link graph must not point at nothing.
 *
 * related-links.ts stores slugs, not URLs, precisely so a rename cannot leave
 * a stale label behind — but nothing stops a slug from being deleted or a post
 * from being flipped back to published:false. Either would emit a crawlable
 * link to a 404 or to a page we deliberately hid from the index and sitemap.
 *
 * Unpublished targets are the subtle one: RelatedLinks filters them at render
 * time, so the site stays correct, but a link silently vanishing is a content
 * bug worth failing on rather than discovering months later in Search Console.
 */

const publishedSlugs = new Set(getPublishedPosts().map((p) => p.slug));
const allSlugs = new Set(BLOG_POSTS.map((p) => p.slug));
const competitorSlugs = new Set(Object.keys(COMPETITORS));

describe("POST_RELATED", () => {
  it("is keyed only by real post slugs", () => {
    for (const slug of Object.keys(POST_RELATED)) {
      expect(allSlugs.has(slug), `unknown source post: ${slug}`).toBe(true);
    }
  });

  it("points only at published posts", () => {
    for (const [source, targets] of Object.entries(POST_RELATED)) {
      for (const target of targets.posts ?? []) {
        expect(allSlugs.has(target), `${source} -> unknown post ${target}`).toBe(true);
        expect(
          publishedSlugs.has(target),
          `${source} -> unpublished post ${target}`,
        ).toBe(true);
      }
    }
  });

  it("points only at real competitors", () => {
    for (const [source, targets] of Object.entries(POST_RELATED)) {
      for (const target of targets.vs ?? []) {
        expect(
          competitorSlugs.has(target),
          `${source} -> unknown competitor ${target}`,
        ).toBe(true);
      }
    }
  });

  it("never links a post to itself", () => {
    for (const [source, targets] of Object.entries(POST_RELATED)) {
      expect(targets.posts ?? []).not.toContain(source);
    }
  });

  it("covers every published post, so no article is a dead end", () => {
    for (const post of getPublishedPosts()) {
      const targets = POST_RELATED[post.slug];
      expect(targets, `no related links configured for ${post.slug}`).toBeDefined();
      const total = (targets.posts?.length ?? 0) + (targets.vs?.length ?? 0);
      expect(total, `${post.slug} has an empty related block`).toBeGreaterThan(0);
    }
  });
});

describe("VS_RELATED", () => {
  it("covers every competitor exactly", () => {
    expect(Object.keys(VS_RELATED).sort()).toEqual([...competitorSlugs].sort());
  });

  it("points only at published posts", () => {
    for (const [competitor, slugs] of Object.entries(VS_RELATED)) {
      expect(slugs.length, `${competitor} has no guides`).toBeGreaterThan(0);
      for (const slug of slugs) {
        expect(getPostBySlug(slug), `${competitor} -> unknown post ${slug}`).toBeDefined();
        expect(
          publishedSlugs.has(slug),
          `${competitor} -> unpublished post ${slug}`,
        ).toBe(true);
      }
    }
  });
});
