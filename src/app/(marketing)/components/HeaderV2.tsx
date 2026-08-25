"use client";

import Link from "next/link";
import { useOptionalUser } from "@/lib/auth";
import MobileMenu from "./MobileMenu";

/**
 * HeaderV2, sticky nav for /vs, /blog, /terms, /privacy, /status,
 * /accessibility. Page BODIES on these routes keep their gold-on-cream v2
 * styling; the CHROME (this header, the footer, the CTA) was bridged to the
 * homepage's warm-light language on 2026-08-14 so leaving the homepage
 * doesn't feel like landing on a different, older site. The wordmark is now
 * the same plain inline text lockup as HeaderLight (no boxed icon - see
 * `.v2-wordmark` in v2.css) and the CTA is the same orange-gradient pill.
 * RTL: logo sits on the right (start), nav + login on the left (end).
 *
 * `.v2-nav-secondary` (מגזין, השוואות): hidden below 375px only (see v2.css),
 * so the wordmark + מחירים + CTA never overflow a 320px viewport. מחירים
 * stays visible at every width on purpose.
 *
 * NAV PARITY WITH THE HOMEPAGE (2026-08-24, Asaf: "תעבור על כל העמודים
 * ותוודא שהכל נראה טוב כמו בדף הראשי"). Two things had drifted and made a
 * sub-page read as a different site the moment you left "/":
 *   1. The /vs link showed its long form, "איזו תוכנה באמת מתאימה לך", which
 *      next to מגזין / מחירים / התחברות did not read as a nav item at all -
 *      it read as a stray tagline dropped into the bar. It is now the same
 *      one-word "השוואות" HeaderLight uses, at every width, so the two-label
 *      long/short pair is gone with it.
 *   2. Link ORDER now matches HeaderLight exactly (מגזין, השוואות, מחירים,
 *      התחברות); it used to lead with /vs, so the items visibly reshuffled
 *      between pages.
 * The row is also centred on the same 1160px measure as the homepage's
 * `.ml-wrap` (see `.v2-header-in` in v2.css) - before this the bar was
 * full-bleed, so the wordmark and the CTA jumped to the window edges on
 * every page but "/".
 *
 * SESSION-AWARE, mirroring HeaderLight: these pages were always readable with
 * a session, so "התחברות" and "התחילו בחינם" were being offered to people who
 * are already customers. Signed in, the pair collapses into one לאזור האישי,
 * and the wordmark points at /product rather than "/" - "/" would bounce them
 * into the app, which is not what clicking a site's logo should do.
 * `useOptionalUser` reports signed-out on the first render, so the SSR HTML a
 * crawler sees is byte-identical to before.
 *
 * MOBILE (2026-08-25, Asaf): the same hamburger + drawer as the homepage,
 * top-right beside the wordmark, on every page. His complaint: tapping
 * מגזין or מחירים in the homepage drawer landed on a page with no hamburger
 * and a "חזרה לעמוד הבית" text link instead - "זה לא נראה טוב". Below 760px
 * the nav links here are hidden (they live in the drawer, together with
 * דף הבית) and only the CTA stays beside the burger; `.v2-back` is hidden
 * at that width too, see v2.css. Shared component: MobileMenu.tsx.
 */
export default function HeaderV2() {
  const { user } = useOptionalUser();

  return (
    <header className="v2-header">
      <div className="v2-header-in">
        <div className="v2-header-start">
          <MobileMenu signedIn={!!user} />
          <Link href={user ? "/product" : "/"} className="v2-wordmark">
            חשבונית{" "}
            <span className="v2-wordmark-soft">ידידותית</span>
          </Link>
        </div>
        <nav className="v2-header-nav">
          <Link href="/blog" className="v2-navlink v2-nav-secondary">
            מגזין
          </Link>
          <Link href="/vs" className="v2-navlink v2-nav-secondary">
            השוואות
          </Link>
          <Link href="/pricing" className="v2-navlink">
            מחירים
          </Link>
          {user ? (
            <Link href="/dashboard" className="v2-btn-gold">
              לאזור האישי
            </Link>
          ) : (
            <>
              <Link href="/login" className="v2-navlink v2-header-login">
                התחברות
              </Link>
              <Link href="/login?mode=signup" className="v2-btn-gold">
                התחילו בחינם
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
