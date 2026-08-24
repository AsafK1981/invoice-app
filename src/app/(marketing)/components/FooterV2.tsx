"use client";

import Link from "next/link";
import { useOptionalUser } from "@/lib/auth";

/**
 * FooterV2, the footer for /pricing, /vs, /blog, /terms, /privacy, /status,
 * /accessibility. Chrome-bridging pass, 2026-08-14: the boxed gold mark went
 * away in favor of the same plain text wordmark FooterLight uses
 * (`.v2-footer-wordmark` in v2.css).
 *
 * BROUGHT TO PARITY WITH FooterLight 2026-08-24 (Asaf: "תעבור על כל העמודים
 * ותוודא שהכל נראה טוב כמו בדף הראשי"). Three things had drifted, and the
 * footer is the one component a visitor sees on literally every page, so the
 * mismatch was visible on every navigation:
 *   - מגזין and השוואות were missing here, so the footer's link set shrank
 *     the moment you left the homepage. Restored, in FooterLight's order.
 *   - The orange "התחילו בחינם" pill and the התחברות link lived in the
 *     footer bar. The homepage has neither - both are already in the sticky
 *     header on every one of these pages, and on /pricing and /vs there is a
 *     full CTA section directly above this - so the pill was a third ask in
 *     one screen. Dropped.
 *   - The credit line ("נבנה באהבה לעסקים עצמאיים בישראל") only existed on
 *     the homepage. Added, so the footer ends the same way everywhere.
 *
 * Still session-aware, and still a client component for that one reason: the
 * wordmark points at /product rather than "/" for a signed-in reader, since
 * "/" would bounce them into the app - not what clicking a site's logo should
 * do. `useOptionalUser` reports signed-out on the first render, so the SSR
 * HTML a crawler sees is unchanged.
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
          <Link href="/blog">מגזין</Link>
          <Link href="/vs">השוואות</Link>
          <Link href="/pricing">מחירים</Link>
          <Link href="/terms">תנאי שימוש</Link>
          <Link href="/privacy">פרטיות</Link>
          <Link href="/security">אבטחת מידע</Link>
          <Link href="/accessibility">נגישות</Link>
        </nav>
        <span className="v2-footer-copy">נבנה באהבה לעסקים עצמאיים בישראל</span>
      </div>
    </footer>
  );
}
