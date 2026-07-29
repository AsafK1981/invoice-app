import type { Metadata } from "next";

/**
 * Metadata builder shared by every /vs/* comparison page.
 *
 * `openGraph` is set EXPLICITLY here and on every page that uses this helper:
 * Next inherits the PARENT's whole openGraph block when a child omits it, so
 * without this each /vs page advertised the homepage's og:url and og:title;
 * every comparison link previewed as the homepage.
 *
 * `url` and `canonical` stay RELATIVE on purpose; `metadataBase` in
 * src/app/layout.tsx resolves them against the production origin.
 *
 * No `openGraph.images`, file-based `opengraph-image.tsx` generates the card.
 */
export function vsMetadata(opts: {
  /** Relative path, e.g. "/vs/invoice4u", resolved against metadataBase. */
  path: string;
  title: string;
  description: string;
  keywords?: string[];
}): Metadata {
  const { path, title, description, keywords } = opts;
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
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
