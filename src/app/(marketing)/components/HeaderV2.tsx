import Link from "next/link";
import LogoV2 from "./LogoV2";

/**
 * HeaderV2, sticky gold/obsidian nav for the /v2 marketing site.
 * RTL: logo sits on the right (start), nav + login on the left (end).
 */
export default function HeaderV2() {
  return (
    <header className="v2-header">
      {/* No aria-label: the accessible name comes from the wordmark inside,
          which now includes a screen-reader space between its two lines. */}
      <Link href="/">
        <LogoV2 />
      </Link>
      <nav className="v2-header-nav">
        {/* Two labels, one shown at a time by CSS. The long form is the real
            pitch and earns its width on desktop; at phone widths it would not
            fit beside the logo, "מגזין" and the login button, so the short
            form takes over. display:none keeps the hidden one out of the
            accessibility tree, so only one label is ever announced. */}
        <Link href="/vs" className="v2-navlink">
          <span className="v2-nav-long">איזו תוכנה באמת מתאימה לך</span>
          <span className="v2-nav-short">השוואה</span>
        </Link>
        <Link href="/blog" className="v2-navlink">
          מגזין
        </Link>
        <Link href="/login" className="v2-btn-gold">
          התחברות
        </Link>
      </nav>
    </header>
  );
}
