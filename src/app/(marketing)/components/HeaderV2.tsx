import Link from "next/link";

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
 * `.v2-nav-secondary` (מגזין, השוואה): hidden below 375px only (see v2.css),
 * so the wordmark + מחירים + CTA never overflow a 320px viewport. מחירים
 * stays visible at every width on purpose.
 */
export default function HeaderV2() {
  return (
    <header className="v2-header">
      <Link href="/" className="v2-wordmark">
        חשבונית{" "}
        <span className="v2-wordmark-soft">ידידותית</span>
      </Link>
      <nav className="v2-header-nav">
        {/* Two labels, one shown at a time by CSS. The long form is the real
            pitch and earns its width on desktop; at phone widths it would not
            fit beside the logo, "מגזין" and the login button, so the short
            form takes over. display:none keeps the hidden one out of the
            accessibility tree, so only one label is ever announced. */}
        <Link href="/vs" className="v2-navlink v2-nav-secondary">
          <span className="v2-nav-long">איזו תוכנה באמת מתאימה לך</span>
          <span className="v2-nav-short">השוואה</span>
        </Link>
        <Link href="/blog" className="v2-navlink v2-nav-secondary">
          מגזין
        </Link>
        <Link href="/#pricing" className="v2-navlink">
          מחירים
        </Link>
        <Link href="/login" className="v2-navlink v2-header-login">
          התחברות
        </Link>
        <Link href="/login?mode=signup" className="v2-btn-gold">
          התחילו בחינם
        </Link>
      </nav>
    </header>
  );
}
