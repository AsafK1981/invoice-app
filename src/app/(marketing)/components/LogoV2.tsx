/**
 * LogoV2 — the gold "document" mark (from icon-app.svg) + "חשבונית"
 * wordmark in Frank Ruhl Libre gold, with a small "סופר ידידותית"
 * kicker. Two variants:
 *   - "full" (default): mark + wordmark + kicker
 *   - "mark": just the gold document mark
 *
 * The inline SVG uses a fixed gradient id ("v2-logo-gold"). If the logo
 * is rendered more than once on a page the id repeats, but every
 * definition is identical so `url(#v2-logo-gold)` resolves the same gold
 * fill everywhere — visually correct.
 *
 * ACCESSIBLE NAME: the mark is decorative (`aria-hidden`), so the text
 * carries the name. The "full" variant gets it from the wordmark plus a
 * `.v2-sr` space that keeps "חשבונית סופר ידידותית" from concatenating
 * into one word in `textContent`. The "mark" variant has no visible text,
 * so it renders `srText` — which is also what gives a wrapping <a> a real
 * accessible name instead of just its href.
 */

type LogoV2Props = {
  variant?: "full" | "mark";
  className?: string;
  /** Screen-reader-only text for the "mark" variant (ignored by "full"). */
  srText?: string;
};

function Mark({ small }: { small?: boolean }) {
  return (
    <svg
      className={`v2-logo-mark${small ? " sm" : ""}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="v2-logo-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D8BE77" />
          <stop offset="0.4" stopColor="#BE9E4E" />
          <stop offset="0.74" stopColor="#8F6F2A" />
          <stop offset="1" stopColor="#CBB061" />
        </linearGradient>
      </defs>
      <rect
        x="5"
        y="5"
        width="90"
        height="90"
        rx="24"
        fill="#120D07"
        stroke="url(#v2-logo-gold)"
        strokeWidth="2.2"
      />
      <g
        stroke="url(#v2-logo-gold)"
        strokeWidth="2.6"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M37 28h18l10 10v34H37z" />
        <path d="M55 28v10h10" />
      </g>
      <g stroke="url(#v2-logo-gold)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M43 42h8M43 50h16M43 58h16" />
      </g>
    </svg>
  );
}

export default function LogoV2({
  variant = "full",
  className,
  srText = "חשבונית סופר ידידותית",
}: LogoV2Props) {
  if (variant === "mark") {
    return (
      <span className={`v2-logo${className ? ` ${className}` : ""}`}>
        <Mark />
        <span className="v2-sr">{srText}</span>
      </span>
    );
  }

  return (
    <span className={`v2-logo${className ? ` ${className}` : ""}`}>
      <Mark />
      <span className="v2-logo-text">
        <span className="v2-logo-word v2-gold">חשבונית</span>
        {/* Carries the word break between the two stacked lines: without it
            textContent reads "חשבוניתסופר ידידותית". Absolutely positioned,
            so it leaves the flex column and the two-line visual is unchanged. */}
        <span className="v2-sr"> </span>
        <span className="v2-logo-sub">סופר ידידותית</span>
      </span>
    </span>
  );
}
