import type { Metadata } from "next";

/**
 * Shared Metadata builder for marketing pages that need their own
 * `openGraph` block.
 *
 * `openGraph` must be set EXPLICITLY on every page that uses this helper:
 * Next inherits the PARENT's whole openGraph block when a child omits it, so
 * without this each page would advertise the homepage's og:url and og:title;
 * every shared link would preview as the homepage.
 *
 * `url` and `canonical` stay RELATIVE on purpose; `metadataBase` in
 * src/app/layout.tsx resolves them against the production origin.
 *
 * No `openGraph.images`, file-based `opengraph-image.tsx` generates the card.
 */
export function pageMetadata(opts: {
  /** Relative path, e.g. "/vs/invoice4u", resolved against metadataBase. */
  path: string;
  title: string;
  description: string;
  keywords?: string[];
  /**
   * openGraph.title override. `<title>` runs through the root layout's
   * `template: "%s | MyFriendlyInvoiceApp"`, but og:title is NOT templated,
   * so pages that want a short `<title>` (e.g. "מדיניות פרטיות") and a
   * fuller Hebrew-branded og:title (e.g. "מדיניות פרטיות | חשבונית
   * ידידותית") pass both. Defaults to `title`.
   */
  ogTitle?: string;
}): Metadata {
  const { path, title, description, keywords, ogTitle } = opts;
  return {
    title,
    description,
    keywords,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "he_IL",
      siteName: "MyFriendlyInvoiceApp",
      url: path,
      title: ogTitle ?? title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
