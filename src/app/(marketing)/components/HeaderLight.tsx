"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOptionalUser } from "@/lib/auth";

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
 * HeaderV2. Content nav links (מגזין / השוואות / מחירים) are hidden below
 * 760px, matching the approved mockup, and remain reachable from
 * FooterLight; התחברות is the one link that stays visible at every width
 * (as a compact text link beside the CTA) since a returning user needs a
 * way back in without scrolling all the way to the footer.
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
export default function HeaderLight() {
  const pathname = usePathname();
  const { user } = useOptionalUser();
  const homeHref = pathname === "/product" ? "/product" : "/";

  return (
    <header className="ml-header">
      <div className="ml-wrap ml-header-in">
        <Link href={homeHref} className="ml-logo">
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
            <>
              <Link href="/login" className="ml-navlink ml-header-login-mobile">
                התחברות
              </Link>
              <Link href="/login?mode=signup" className="ml-btn ml-btn-primary ml-btn-sm">
                התחילו בחינם
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
