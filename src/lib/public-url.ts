// Canonical app URL. Use this for any link a user might share, save, or
// embed in an email — NOT window.location.origin. Per-deploy hash URLs
// (e.g. mysuperfriendlyinvoiceapp-abc123-asafk1981s-projects.vercel.app)
// are immutable snapshots of one specific build, so a share link
// generated from one ages immediately into a stale-code link.
//
// Past incident: 2026-05-03 — multiple share links saved by the user
// when they happened to be browsing on a deploy-hash URL kept loading
// pre-fix code days later. Centralizing the canonical origin here
// eliminates that whole class of "why doesn't my share link have the
// new feature" confusion.

export const CANONICAL_ORIGIN = "https://mysuperfriendlyinvoiceapp.vercel.app";

/**
 * Build a public, share-safe URL for a document view page. Always uses
 * the canonical origin so the link doesn't decay when this code runs on
 * a per-deployment preview URL.
 */
export function publicDocumentUrl(documentId: string): string {
  return `${CANONICAL_ORIGIN}/view/${documentId}`;
}
