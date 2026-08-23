"use client";

import Link from "next/link";
import { useOptionalUser } from "@/lib/auth";

/**
 * FooterV2, footer with a hairline divider and legal/login links, for /vs,
 * /blog, /terms, /privacy, /status, /accessibility. Chrome-bridging pass,
 * 2026-08-14: the boxed gold mark is gone in favor of the same plain text
 * wordmark FooterLight uses (`.v2-footer-wordmark` in v2.css), and the
 * signup CTA is the homepage's orange-gradient pill (`.v2-btn-gold`,
 * repainted - see v2.css). Link structure and content are unchanged.
 *
 * SESSION-AWARE since /product landed - same reasoning as HeaderV2: the legal
 * pages this footer sits on were always reachable with a session, so the
 * התחברות + התחילו בחינם pair was being shown to existing customers. Signed
 * in they collapse into one לאזור האישי and the wordmark points at /product,
 * the landing address that does not bounce.
 */
export default function FooterV2() {
  const { user } = useOptionalUser();

  return (
    <footer className="v2-footer">
      <div className="v2-footer-hair" />
      <div className="v2-footer-inner">
        <Link href={user ? "/product" : "/"} className="v2-footer-wordmark">
          חשבונית ידידותית
        </Link>
        <nav className="v2-footer-links">
          <Link href="/pricing">מחירים</Link>
          <Link href="/terms">תנאי שימוש</Link>
          <Link href="/privacy">פרטיות</Link>
          <Link href="/security">אבטחת מידע</Link>
          <Link href="/accessibility">נגישות</Link>
          {user ? (
            <Link href="/dashboard" className="v2-btn-gold v2-footer-cta">
              לאזור האישי
            </Link>
          ) : (
            <>
              <Link href="/login">התחברות</Link>
              <Link href="/login?mode=signup" className="v2-btn-gold v2-footer-cta">
                התחילו בחינם
              </Link>
            </>
          )}
        </nav>
      </div>
    </footer>
  );
}
