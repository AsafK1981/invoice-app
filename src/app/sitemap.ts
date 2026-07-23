import type { MetadataRoute } from "next";
import { getPublishedPosts } from "@/lib/blog-posts";

const BASE = "https://mysuperfriendlyinvoiceapp.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Only PUBLISHED blog posts (published: true) go in the sitemap. Drafts
  // are excluded on purpose — see src/lib/blog-posts.ts (REVIEW-FIRST).
  const blogPosts: MetadataRoute.Sitemap = getPublishedPosts().map((post) => ({
    url: `${BASE}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE}/vs`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/vs/invoice4u`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/vs/greeninvoice`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/vs/ifreelance`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...blogPosts,
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/status`, lastModified: now, changeFrequency: "always", priority: 0.3 },
  ];
}
