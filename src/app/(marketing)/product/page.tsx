import type { Metadata } from "next";
import MarketingLanding from "../page";

/**
 * /product - the landing page at an address that never bounces.
 *
 * "/" redirects a signed-in visitor to /dashboard (RedirectIfAuthed), which is
 * the right default: someone who types the bare domain wants their invoices,
 * not the sales pitch. The side effect was that the marketing page became
 * unreadable to anyone with a session - including us, reviewing our own copy.
 * This route serves the SAME component at a second permanent address, and
 * RedirectIfAuthed is path-gated to "/" so it renders through untouched.
 *
 * It re-exports rather than duplicating: the landing is ~1,265 lines of freshly
 * tuned layout, and two copies would drift within a week. If a future Next or
 * ESLint version objects to importing a component out of another page module,
 * lift the JSX into components/LandingContent.tsx and render that from both -
 * do not fork the markup.
 */
export const metadata: Metadata = {
  // Points at "/" on purpose: identical content, one canonical, so Google
  // consolidates instead of seeing a duplicate. Deliberately NOT paired with
  // `robots: noindex` - noindex plus a canonical pointing elsewhere are
  // contradictory signals and Google may honour either one.
  alternates: { canonical: "/" },
};

export default MarketingLanding;
