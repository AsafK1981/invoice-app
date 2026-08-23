"use client";

import { useEffect } from "react";

/**
 * Plays the landing page's entrance motion: each card/panel/heading animates
 * in once, the first time it scrolls into view.
 *
 * WHY THIS EXISTS AND NOT `animation-timeline: view()`
 * ---------------------------------------------------
 * The first two attempts at this were pure CSS scroll-driven animations. They
 * were correct - measured in Chrome, every element moved exactly as specced -
 * and Asaf could not see them at all (2026-08-23, twice: "לא רואים שום הבדל").
 * That is not a tuning problem, it is what scroll-linked motion IS: progress is
 * bound to scroll offset, so the entire animation plays out inside however much
 * scrolling the user happens to do. One flick of a mouse wheel is ~100px x 3
 * lines, which on these cards is the whole entry range - the animation is over
 * in the same instant the card appears, no matter how long a duration you write.
 * The faster you scroll, the less of it exists.
 *
 * A time-based animation triggered on entry plays at ITS OWN speed. 700ms is
 * 700ms whether the page was nudged or flung. That is the property we actually
 * needed, and no amount of range/easing tuning on view() would have produced it.
 *
 * PROGRESSIVE ENHANCEMENT
 * -----------------------
 * The start state (opacity 0) is gated behind `.ml-anim`, which page.tsx
 * renders on the `.ml-theme` wrapper SERVER-side - so it is present in the
 * first paint (no flash of visible-then-hidden) without a script mutating the
 * DOM during parse, which is what made an earlier version mismatch hydration.
 * Consequences by environment:
 *   - No JS at all      -> a <noscript> style in page.tsx neutralises the
 *                          start state and everything renders visible.
 *   - JS on, this island fails to hydrate -> <noscript> does NOT apply, so
 *                          page.tsx's 6s failsafe timer strips `.ml-anim` and
 *                          the page appears. `cancelAnimationFailsafe` below
 *                          calls that off as soon as we are running, so a
 *                          slow-but-working page is never yanked mid-animation.
 *   - prefers-reduced-motion: reduce -> the CSS block is skipped entirely; the
 *                          class is inert and content is visible immediately.
 *
 * The observer is one-shot per element (unobserve on first intersection): these
 * are entrances, not scroll-linked effects, and re-playing them on the way back
 * up reads as a page that cannot sit still.
 */

/** Everything that animates in, in one selector - kept in sync with the
 *  `.ml-anim` rules in marketing-light.css. */
const TARGETS = [
  ".ml-trust-card",
  ".ml-spot-card",
  ".ml-adv-card",
  ".ml-faq-item",
  ".ml-price-frees li",
  ".ml-price-plan",
  ".ml-wa-phone-wrap",
  ".ml-sheet-wrap",
  ".ml-browser-wrap",
  ".ml-midcta-in",
  ".ml-compare-in",
  ".ml-spot-head",
  ".ml-adv-head",
  ".ml-show-head",
  ".ml-faq-title",
  ".ml-pricing h2",
].join(",");

declare global {
  interface Window {
    /** Set by the inline script in page.tsx; see the failsafe note above. */
    cancelAnimationFailsafe?: () => void;
  }
}

export default function EntranceMotion() {
  useEffect(() => {
    const root = document.querySelector(".ml-anim");
    if (!root) return;

    // We are alive - the inline script's "reveal everything" timer is no
    // longer needed and must not fire mid-animation.
    window.cancelAnimationFailsafe?.();

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      root.classList.remove("ml-anim");
      return;
    }

    const els = Array.from(document.querySelectorAll<HTMLElement>(TARGETS));
    if (!els.length) {
      root.classList.remove("ml-anim");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      {
        /* threshold stays 0 and the trigger line is moved with rootMargin
           instead. A fractional threshold is a fraction of the TARGET, so an
           element taller than the viewport - the browser mock is, on a phone -
           can never reach 0.15 and would simply never fire. Pulling the bottom
           of the root box up by 12% fires each element a beat after it starts
           entering, at any element size. */
        threshold: 0,
        rootMargin: "0px 0px -12% 0px",
      }
    );
    for (const el of els) observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return null;
}
