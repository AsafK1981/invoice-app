import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/public-url";

// Replaces the former static public/robots.txt so the Sitemap: line follows
// CANONICAL_ORIGIN instead of hardcoding a domain. The two cannot coexist —
// Next errors with "conflicting public file and page file" — so this file and
// the deletion of public/robots.txt must ship together.
//
// The Disallow list is load-bearing for privacy, not just for crawl budget:
// /view/ is the PUBLIC customer-document link space (share links sent to a
// business's clients). If this route ever 404s, crawlers fall back to
// "crawl everything" and those documents become indexable. Treat any change
// to the /view/ line as a security change.
export default function robots(): MetadataRoute.Robots {
  // Preview deploys (Vercel branch/PR builds) live at throwaway URLs that
  // still serve real, crawlable HTML. Without this they're indexable
  // duplicate-content copies of production under a different host. Only
  // production (VERCEL_ENV === "production") gets the real rules below;
  // any other value (including unset, e.g. local dev) blocks everything.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/status"],
      disallow: [
        "/api/",
        "/admin",
        "/dashboard",
        "/documents",
        "/clients",
        "/products",
        "/expenses",
        "/reports",
        "/settings",
        "/billing",
        "/onboarding",
        "/reset-password",
        "/auth/",
        "/view/",
        "/invite/",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
