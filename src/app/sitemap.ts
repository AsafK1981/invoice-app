import type { MetadataRoute } from "next";
import { getPublishedPosts } from "@/lib/blog-posts";
import { COMPETITORS } from "@/lib/comparison-data";
import { absoluteUrl } from "@/lib/public-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Only PUBLISHED blog posts (published: true) go in the sitemap. Drafts
  // are excluded on purpose; see src/lib/blog-posts.ts (REVIEW-FIRST).
  const blogPosts: MetadataRoute.Sitemap = getPublishedPosts().map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.date),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  // Derived from COMPETITORS rather than hand-listed: a 7th comparison page
  // used to be able to ship without ever entering the sitemap, i.e. never
  // get crawled. Object key order is insertion order, so this emits the
  // same six URLs in the same order as the list it replaced.
  const vsPages: MetadataRoute.Sitemap = Object.keys(COMPETITORS).map((slug) => ({
    url: absoluteUrl(`/vs/${slug}`),
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.9,
  }));

  return [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: absoluteUrl("/vs"), lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    ...vsPages,
    { url: absoluteUrl("/blog"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...blogPosts,
    { url: absoluteUrl("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: absoluteUrl("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: absoluteUrl("/accessibility"), lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: absoluteUrl("/status"), lastModified: now, changeFrequency: "always", priority: 0.3 },
  ];
}
