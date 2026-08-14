import Link from "next/link";
import LogoV2 from "./LogoV2";

/**
 * FooterV2, gold/obsidian footer with a deco gold hairline divider,
 * the mark, and legal/login links.
 */
export default function FooterV2() {
  return (
    <footer className="v2-footer">
      <div className="v2-footer-hair" />
      <div className="v2-footer-inner">
        {/* The mark alone has no text, so the link's accessible name comes
            from LogoV2's `.v2-sr` string rather than an aria-label, an
            anchor whose only content is an image used to expose just "/". */}
        <Link href="/">
          <LogoV2 variant="mark" srText="חשבונית ידידותית, לדף הבית" />
        </Link>
        <nav className="v2-footer-links">
          <Link href="/#pricing">מחירים</Link>
          <Link href="/terms">תנאי שימוש</Link>
          <Link href="/privacy">פרטיות</Link>
          <Link href="/accessibility">נגישות</Link>
          <Link href="/login">התחברות</Link>
          <Link href="/login?mode=signup" className="v2-btn-gold v2-footer-cta">
            התחילו בחינם
          </Link>
        </nav>
      </div>
    </footer>
  );
}
