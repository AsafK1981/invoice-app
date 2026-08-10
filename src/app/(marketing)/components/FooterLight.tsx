import Link from "next/link";

/**
 * FooterLight, the warm/cream footer for the homepage only.
 * See HeaderLight for why this is a homepage-local twin of FooterV2
 * rather than a variant prop on it.
 *
 * Content per the approved scope: מגזין / השוואות / תנאי שימוש / פרטיות,
 * plus the site's existing credit line (the same one the dark homepage
 * shows above FooterV2 today) in place of a plain copyright string.
 * נגישות and התחברות (present in FooterV2) are intentionally not repeated
 * here - both are already reachable from the header/hero on this page.
 */
export default function FooterLight() {
  return (
    <footer className="ml-footer">
      <div className="ml-wrap ml-footer-in">
        <Link href="/" className="ml-footer-logo">
          חשבונית ידידותית
        </Link>
        <nav className="ml-footer-links">
          <Link href="/blog">מגזין</Link>
          <Link href="/vs">השוואות</Link>
          <Link href="/terms">תנאי שימוש</Link>
          <Link href="/privacy">פרטיות</Link>
        </nav>
        <span className="ml-footer-copy">נבנה באהבה לעסקים עצמאיים בישראל</span>
      </div>
    </footer>
  );
}
