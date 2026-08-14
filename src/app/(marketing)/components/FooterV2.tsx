import Link from "next/link";

/**
 * FooterV2, footer with a hairline divider and legal/login links, for /vs,
 * /blog, /terms, /privacy, /status, /accessibility. Chrome-bridging pass,
 * 2026-08-14: the boxed gold mark is gone in favor of the same plain text
 * wordmark FooterLight uses (`.v2-footer-wordmark` in v2.css), and the
 * signup CTA is the homepage's orange-gradient pill (`.v2-btn-gold`,
 * repainted - see v2.css). Link structure and content are unchanged.
 */
export default function FooterV2() {
  return (
    <footer className="v2-footer">
      <div className="v2-footer-hair" />
      <div className="v2-footer-inner">
        <Link href="/" className="v2-footer-wordmark">
          חשבונית ידידותית
        </Link>
        <nav className="v2-footer-links">
          <Link href="/pricing">מחירים</Link>
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
