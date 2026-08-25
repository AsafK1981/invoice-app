// Canonical app URL. Use this for any link a user might share, save, or
// embed in an email, NOT window.location.origin. Per-deploy hash URLs
// (e.g. mysuperfriendlyinvoiceapp-abc123-asafk1981s-projects.vercel.app)
// are immutable snapshots of one specific build, so a share link
// generated from one ages immediately into a stale-code link.
//
// Past incident: 2026-05-03, multiple share links saved by the user
// when they happened to be browsing on a deploy-hash URL kept loading
// pre-fix code days later. Centralizing the canonical origin here
// eliminates that whole class of "why doesn't my share link have the
// new feature" confusion.
//
// ---------------------------------------------------------------------
// Moving to a real domain: set NEXT_PUBLIC_SITE_ORIGIN in Vercel's
// Production env and REDEPLOY. NEXT_PUBLIC_* is inlined at build time,
// so setting the variable without a rebuild is a silent no-op. Set it in
// Production only (or identically everywhere) - setting it on Preview
// alone emits preview-origin canonicals, i.e. duplicate content.
//
// Deliberately NOT reusing NEXT_PUBLIC_APP_URL: that variable is already
// read by src/lib/tax-authority.ts and the billing checkout route, where
// it must keep byte-matching the redirect_uri registered with רשות המסים.
// Those two concerns have to be able to move independently, so this is a
// separate variable. While it is unset, every emitted byte is identical
// to the hardcoded vercel.app deployment.
//
// Referenced as a full static member expression on purpose - Next only
// inlines NEXT_PUBLIC_* when it can see `process.env.NEXT_PUBLIC_FOO`
// literally in the source, so destructuring it would break the client
// bundle (this module is imported by "use client" components).
const RAW_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.trim() ||
  "https://mysuperfriendlyinvoiceapp.vercel.app"; // domain-literal-ok: the fallback this constant exists to centralize

/** Throws at module scope (i.e. fails the build) rather than letting a
 *  malformed origin quietly corrupt every canonical, og:url and sitemap
 *  entry at once. */
function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SITE_ORIGIN is not a valid absolute URL: ${JSON.stringify(value)}. ` +
        `Expected something like https://example.com (no trailing slash, no path).`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `NEXT_PUBLIC_SITE_ORIGIN must be http(s), got ${parsed.protocol}`,
    );
  }
  // Drop any path/query/hash and the trailing slash so callers can always
  // safely concatenate `${CANONICAL_ORIGIN}/foo`.
  return parsed.origin;
}

export const CANONICAL_ORIGIN = normalizeOrigin(RAW_ORIGIN);

/** Bare host, no protocol. For places that print the domain as text
 *  rather than linking it (e.g. the PDF/document footer). */
export const CANONICAL_HOST = new URL(CANONICAL_ORIGIN).host;

/**
 * Absolute URL for an app-relative path. Use for sitemap entries, robots,
 * JSON-LD @id values and og:url - anywhere a relative path is not allowed.
 */
export function absoluteUrl(path: string): string {
  return `${CANONICAL_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Build a public, share-safe URL for a document view page. Always uses
 * the canonical origin so the link doesn't decay when this code runs on
 * a per-deployment preview URL.
 */
export function publicDocumentUrl(documentId: string): string {
  return absoluteUrl(`/view/${documentId}`);
}
