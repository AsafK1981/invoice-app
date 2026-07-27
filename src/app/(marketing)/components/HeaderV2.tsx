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
        <Link href="/vs" className="v2-navlink">
          השוואה
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
