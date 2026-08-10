import Link from "next/link";

/**
 * HeaderLight, the sticky cream/warm-gradient nav for the homepage only.
 *
 * A homepage-local twin of HeaderV2 rather than a `variant` prop on it:
 * HeaderV2's logo (LogoV2) is a stacked mark + two-line wordmark tuned for
 * the dark theme (gold gradient-clip text, tiny tracked kicker line). The
 * approved warm mockup's logo is a single inline text lockup with no mark
 * at all - a structural difference, not just a color swap - so forcing it
 * through HeaderV2/LogoV2 would mean fighting that component's layout
 * rather than reusing it cleanly. This file reuses the exact same LINKS
 * or as HeaderV2 (מגזין, השוואות, התחברות, CTA), so nothing about the
 * site's navigation model diverges - only the paint job.
 *
 * RTL: logo on the right (start), nav + CTA on the left (end), same as
 * HeaderV2. Nav links are hidden below 760px, matching the approved
 * mockup; the same destinations remain reachable from FooterLight.
 */
export default function HeaderLight() {
  return (
    <header className="ml-header">
      <div className="ml-wrap ml-header-in">
        <Link href="/" className="ml-logo">
          חשבונית{" "}
          <span className="ml-logo-soft">ידידותית</span>
        </Link>
        <nav className="ml-nav">
          <Link href="/blog" className="ml-navlink">
            מגזין
          </Link>
          <Link href="/vs" className="ml-navlink">
            השוואות
          </Link>
          <Link href="/login" className="ml-navlink">
            התחברות
          </Link>
        </nav>
        <Link href="/login?mode=signup" className="ml-btn ml-btn-primary ml-btn-sm">
          התחילו בחינם
        </Link>
      </div>
    </header>
  );
}
