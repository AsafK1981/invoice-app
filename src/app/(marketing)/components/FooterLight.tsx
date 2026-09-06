import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

/**
 * FooterLight, the warm/cream footer for the homepage only.
 * See HeaderLight for why this is a homepage-local twin of FooterV2
 * rather than a variant prop on it.
 *
 * Content per the approved scope: מגזין / השוואות / מחירים / תנאי שימוש / פרטיות / נגישות,
 * plus the site's existing credit line (the same one the dark homepage
 * shows above FooterV2 today) in place of a plain copyright string.
 * התחברות (present in FooterV2) is intentionally not repeated here - it is
 * already reachable from the header/hero on this page.
 */
export default function FooterLight() {
  return (
    <footer className="ml-footer">
      <div className="ml-wrap ml-footer-in">
        <Link href="/" className="ml-footer-logo" aria-label="חשבונית ידידותית, לדף הבית">
          <BrandMark size={22} />
          <span className="brand-wordmark" style={{ fontSize: 15 }}>חשבונית ידידותית</span>
          <span className="ml-footer-latin">FRIENDLYINVOICE</span>
        </Link>
        <nav className="ml-footer-links">
          <Link href="/blog">מגזין</Link>
          <Link href="/vs">השוואות</Link>
          <Link href="/pricing">מחירים</Link>
          <Link href="/terms">תנאי שימוש</Link>
          <Link href="/privacy">פרטיות</Link>
          <Link href="/security">אבטחת מידע</Link>
          <Link href="/accessibility">נגישות</Link>
        </nav>
        <span className="ml-footer-copy">נבנה באהבה לעסקים עצמאיים בישראל</span>
      </div>
    </footer>
  );
}
