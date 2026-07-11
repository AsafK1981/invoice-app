import Link from "next/link";
import LogoV2 from "./LogoV2";

/**
 * FooterV2 — gold/obsidian footer with a deco gold hairline divider,
 * the mark, and legal/login links.
 */
export default function FooterV2() {
  return (
    <footer className="v2-footer">
      <div className="v2-footer-hair" />
      <div className="v2-footer-inner">
        <Link href="/" aria-label="חשבונית — לדף הבית">
          <LogoV2 variant="mark" />
        </Link>
        <nav className="v2-footer-links">
          <Link href="/terms">תנאי שימוש</Link>
          <Link href="/privacy">פרטיות</Link>
          <Link href="/login">התחברות</Link>
        </nav>
      </div>
    </footer>
  );
}
