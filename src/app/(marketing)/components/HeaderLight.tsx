"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
 * as HeaderV2 (מגזין, השוואות, מחירים, התחברות, CTA), so nothing about the
 * site's navigation model diverges - only the paint job.
 *
 * RTL: logo on the right (start), nav + CTA on the left (end), same as
 * HeaderV2. Content nav links (מגזין / השוואות / מחירים) are hidden below
 * 760px, matching the approved mockup.
 *
 * MOBILE DRAWER (2026-08-25, Asaf): below 760px the header grows a
 * hamburger button at the far end that opens a slide-in drawer. Asaf's
 * complaint was that the phone version of the landing page reads as an
 * endless website - you scroll and scroll - where he wants a tight landing
 * page you can move around in. The drawer is the "move around" part: on the
 * homepage it lists every section of the page as an in-page jump (the
 * sections carry matching ids and a scroll-margin for the sticky header),
 * followed by the site links and the same two calls to action. The
 * התחברות text link that used to sit in the header at every width moved
 * into the drawer's first slot: at 390px the row could not hold logo, login,
 * CTA and the burger, and a returning user now has a one-tap menu instead
 * of a footer hunt.
 *
 * The drawer is plain React state, not the Popover API: unsupporting
 * browsers would render a popover element inline as a block, and this menu
 * must never degrade into a visible list under the header. Conditional
 * rendering + a mount animation gets the slide for free, and unmounting
 * on close means a tapped anchor link scrolls the page with nothing on top
 * of it. Escape closes; so does the backdrop; so does a route change. Body
 * scrolling is locked while it is open so a swipe on the backdrop does not
 * move the page underneath.
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
const PAGE_SECTIONS: { id: string; label: string }[] = [
  { id: "why", label: "למה דווקא אנחנו" },
  { id: "advantages", label: "כל היתרונות" },
  { id: "pricing", label: "מחירים" },
  { id: "demo", label: "כך זה נראה" },
  { id: "faq", label: "שאלות נפוצות" },
  { id: "compare", label: "השוואה למתחרים" },
];

const SITE_LINKS: { href: string; label: string }[] = [
  { href: "/blog", label: "מגזין" },
  { href: "/vs", label: "השוואות" },
  { href: "/pricing", label: "מחירים" },
  { href: "/security", label: "אבטחת מידע" },
];

export default function HeaderLight() {
  const pathname = usePathname();
  const { user } = useOptionalUser();
  const homeHref = pathname === "/product" ? "/product" : "/";
  const isHome = pathname === "/";

  const [open, setOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Route change closes the drawer (a site link navigates away).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      burgerRef.current?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);

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
            <Link href="/login?mode=signup" className="ml-btn ml-btn-primary ml-btn-sm">
              התחילו בחינם
            </Link>
          )}
          <button
            ref={burgerRef}
            type="button"
            className="ml-burger"
            aria-label={open ? "סגירת התפריט" : "פתיחת התפריט"}
            aria-expanded={open}
            aria-controls="ml-drawer"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="ml-burger-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>

      {open && (
        <div className="ml-drawer-root" id="ml-drawer">
          <div className="ml-drawer-backdrop" onClick={close} aria-hidden="true" />
          <nav className="ml-drawer" aria-label="תפריט האתר">
            <div className="ml-drawer-head">
              <span className="ml-logo">
                חשבונית <span className="ml-logo-soft">ידידותית</span>
              </span>
              <button
                ref={closeRef}
                type="button"
                className="ml-drawer-close"
                aria-label="סגירת התפריט"
                onClick={close}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {isHome && (
              <div className="ml-drawer-group">
                <span className="ml-drawer-label">בדף הזה</span>
                <ul className="ml-drawer-list">
                  {PAGE_SECTIONS.map((s) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`} className="ml-drawer-link" onClick={close}>
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="ml-drawer-group">
              <span className="ml-drawer-label">עוד באתר</span>
              <ul className="ml-drawer-list">
                {SITE_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="ml-drawer-link" onClick={close}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="ml-drawer-cta">
              {user ? (
                <Link
                  href="/dashboard"
                  className="ml-btn ml-btn-primary ml-btn-lg"
                  onClick={close}
                >
                  לאזור האישי
                </Link>
              ) : (
                <>
                  <Link
                    href="/login?mode=signup"
                    className="ml-btn ml-btn-primary ml-btn-lg"
                    onClick={close}
                  >
                    התחילו בחינם
                  </Link>
                  <Link href="/login" className="ml-drawer-login" onClick={close}>
                    כבר רשומים? התחברות
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
