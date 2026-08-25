"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import "./mobile-menu.css";

/**
 * MobileMenu: the hamburger button + slide-in drawer shared by EVERY
 * marketing header (HeaderLight on "/", HeaderV2 on /blog, /vs, /pricing,
 * the legal pages...). Below 760px it is the site's navigation; above that
 * the button is hidden and the headers' own link rows take over.
 *
 * History (all 2026-08-25, Asaf):
 *  - The phone landing page read as "an endless website"; the drawer was
 *    built so a visitor can MOVE between sections instead of scrolling.
 *  - The first version lived only in HeaderLight, so tapping מגזין or מחירים
 *    landed on a page with no hamburger and a "חזרה לעמוד הבית" text link
 *    instead - "זה לא נראה טוב". Asaf: the hamburger has to be top-right on
 *    every page, all the time, with דף הבית inside it. Hence this component.
 *
 * Mechanics that were each learned the hard way:
 *  - Rendered through createPortal into <body>, never inside <header>. Both
 *    headers carry `backdrop-filter`, which (per spec) makes them the
 *    containing block for position: fixed descendants. Chromium ignores that
 *    for backdrop-filter - headless QA passed - but mobile Safari honours it,
 *    so an in-header drawer was squeezed into the 71px header strip and all
 *    Asaf saw was its title line. `open` is only ever true after hydration,
 *    so `document` exists when the portal renders.
 *  - Section jumps are done in JS AFTER the drawer unmounts and the body
 *    scroll lock is lifted. A plain `<a href="#id">` fired the hash
 *    navigation while `body { overflow: hidden }` was still in place; mobile
 *    browsers dropped the scroll and the menu "led nowhere".
 *  - Plain React state, not the Popover API: a browser without popover
 *    support would render the drawer inline as a block under the header.
 *  - Escape, the backdrop, a route change and every link close it. The
 *    hamburger sits at the reading start (top-right in RTL), beside the
 *    logo - Asaf: that is where a hamburger belongs.
 */

export type MenuSection = { id: string; label: string };

const SITE_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "דף הבית" },
  { href: "/blog", label: "מגזין" },
  { href: "/vs", label: "השוואות" },
  { href: "/pricing", label: "מחירים" },
  { href: "/security", label: "אבטחת מידע" },
];

export default function MobileMenu({
  sections,
  signedIn,
}: {
  /** In-page jump targets, homepage only. Ids must exist on the page. */
  sections?: MenuSection[];
  signedIn: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pendingJump = useRef<string | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (open) {
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
      };
    }

    const id = pendingJump.current;
    pendingJump.current = null;
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Two frames: one for the unmount to paint, one so the overflow restore
    // above has definitely landed before we scroll.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        try {
          history.pushState(null, "", `#${id}`);
        } catch {
          /* history unavailable in an exotic embed; the scroll still happened */
        }
      })
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const close = () => setOpen(false);
  const jumpTo = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    pendingJump.current = id;
    setOpen(false);
  };
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <button
        ref={burgerRef}
        type="button"
        className="mm-burger"
        aria-label={open ? "סגירת התפריט" : "פתיחת התפריט"}
        aria-expanded={open}
        aria-controls="mm-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mm-burger-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>

      {open &&
        createPortal(
          <div className="mm-root" id="mm-drawer">
            <div className="mm-backdrop" onClick={close} aria-hidden="true" />
            <nav className="mm-drawer" aria-label="תפריט האתר">
              <div className="mm-head">
                <span className="mm-logo">
                  חשבונית <span className="mm-logo-soft">ידידותית</span>
                </span>
                <button
                  ref={closeRef}
                  type="button"
                  className="mm-close"
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

              {sections && sections.length > 0 && (
                <div className="mm-group">
                  <span className="mm-label">בדף הזה</span>
                  <ul className="mm-list">
                    {sections.map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          className="mm-link"
                          onClick={(e) => jumpTo(e, s.id)}
                        >
                          {s.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mm-group">
                <span className="mm-label">{sections?.length ? "עוד באתר" : "האתר"}</span>
                <ul className="mm-list">
                  {SITE_LINKS.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="mm-link"
                        aria-current={isCurrent(l.href) ? "page" : undefined}
                        onClick={close}
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mm-cta">
                {signedIn ? (
                  <Link href="/dashboard" className="mm-btn" onClick={close}>
                    לאזור האישי
                  </Link>
                ) : (
                  <>
                    <Link href="/login?mode=signup" className="mm-btn" onClick={close}>
                      התחילו בחינם
                    </Link>
                    <Link href="/login" className="mm-login" onClick={close}>
                      כבר רשומים? התחברות
                    </Link>
                  </>
                )}
              </div>
            </nav>
          </div>,
          document.body
        )}
    </>
  );
}
