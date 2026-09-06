"use client";

import Link from "next/link";
import { BrandLockup } from "@/components/brand-mark";
import { usePathname } from "next/navigation";
import { useOptionalUser } from "@/lib/auth";
import MobileMenu, { type MenuSection } from "./MobileMenu";

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
 * as HeaderV2 (מגזין, השוואות, מחירים, התחברות, CTA), so nothing about the
 * site's navigation model diverges - only the paint job.
 *
 * RTL: logo on the right (start), nav + CTA on the left (end), same as
 * HeaderV2. Content nav links (מגזין / השוואות / מחירים) are hidden below
 * 760px, matching the approved mockup.
 *
 * MOBILE (2026-08-25, Asaf): below 760px the header shows a hamburger at the
 * reading start (top-right in RTL), beside the logo. It is the shared
 * MobileMenu component - the same button and drawer HeaderV2 renders on
 * every other marketing page - fed here with the homepage's section jumps.
 * The compact התחברות text link that used to sit beside the CTA is gone: at
 * 390px the row could not hold logo, login, CTA and the burger, and the
 * drawer carries התחברות instead. See MobileMenu.tsx for the drawer's
 * own history (portal, jump timing).
 *
 * SESSION-AWARE since the /product route landed. It is a client component
 * now, but still server-rendered like every other "use client" component, and
 * `useOptionalUser` reports signed-out on the first render - so the HTML a
 * crawler or an anonymous visitor receives is byte-identical to before. Only
 * after hydration, and only for a visitor who actually has a session, do the
 * two signed-out calls to action (התחברות / התחילו בחינם) collapse into one
 * לאזור האישי link. Offering "start free" to a paying user reads as a site
 * that does not know who you are.
 *
 * The logo likewise follows the page it is on: on /product it points back at
 * /product, because "/" would bounce a signed-in reader into the app - the
 * exact trap /product exists to avoid.
 */

/* In-page jumps, homepage only. Each id lives on the matching <section> in
   page.tsx; keep the two lists in sync. */
const PAGE_SECTIONS: MenuSection[] = [
  { id: "why", label: "למה דווקא אנחנו" },
  { id: "advantages", label: "כל היתרונות" },
  { id: "pricing", label: "מחירים" },
  { id: "demo", label: "כך זה נראה" },
  { id: "faq", label: "שאלות נפוצות" },
  { id: "compare", label: "השוואה למתחרים" },
];

export default function HeaderLight() {
  const pathname = usePathname();
  const { user } = useOptionalUser();
  const homeHref = pathname === "/product" ? "/product" : "/";
  const isHome = pathname === "/";

  return (
    <header className="ml-header">
      <div className="ml-wrap ml-header-in">
        <div className="ml-header-start">
          <MobileMenu sections={isHome ? PAGE_SECTIONS : undefined} signedIn={!!user} />
          <Link href={homeHref} className="ml-logo" aria-label="חשבונית ידידותית, לדף הבית">
            <BrandLockup size={36} />
          </Link>
        </div>
        <nav className="ml-nav">
          <Link href="/blog" className="ml-navlink">
            מגזין
          </Link>
          <Link href="/vs" className="ml-navlink">
            השוואות
          </Link>
          <Link href="/pricing" className="ml-navlink">
            מחירים
          </Link>
          {!user && (
            <Link href="/login" className="ml-navlink">
              התחברות
            </Link>
          )}
        </nav>
        <div className="ml-header-actions">
          {user ? (
            <Link href="/dashboard" className="ml-btn ml-btn-primary ml-btn-sm">
              לאזור האישי
            </Link>
          ) : (
            <Link href="/login?mode=signup" className="ml-btn ml-btn-primary ml-btn-sm">
              התחילו בחינם
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
