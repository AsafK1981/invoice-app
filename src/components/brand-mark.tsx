/**
 * The brand mark (2026-09-06 rebrand): a smiling document with a mint
 * folded corner, peach cheeks and two mint text lines. This is the ONE
 * source for the mark in React; public/logo.svg carries the same drawing
 * for favicons, the manifest and emails.
 *
 * Colours are the brand constants, not theme tokens, on purpose: the mark
 * must look identical on the marketing page, in the app shell, on a dark
 * tile and inside a customer's document footer.
 */

export const BRAND = {
  graphite: "#2F3A45",
  mint: "#9ED8C3",
  mintTint: "#E6F5EE",
  mintInk: "#2A7A62",
  peach: "#F6B89E",
  peachTint: "#FDEEE6",
  peachInk: "#B85A32",
  offWhite: "#F7F7F2",
  border: "#E4E7E2",
  text: "#1F252B",
  name: "חשבונית ידידותית",
  tagline: "התנהלות פשוטה לעסק מצליח",
  latin: "FriendlyInvoice",
} as const;

type BrandMarkProps = {
  /** Rendered width in px; height follows the 134:140 aspect. */
  size?: number;
  className?: string;
  /** Present when the mark stands alone (an icon link); omit when text sits beside it. */
  title?: string;
};

export function BrandMark({ size = 32, className, title }: BrandMarkProps) {
  const height = Math.round((size * 140) / 134);
  return (
    <svg
      width={size}
      height={height}
      viewBox="-14 0 134 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M22 8h56l30 30v90a12 12 0 0 1-12 12H22a12 12 0 0 1-12-12V20A12 12 0 0 1 22 8z"
        fill="#FFFFFF"
        stroke={BRAND.graphite}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path
        d="M78 8v20a10 10 0 0 0 10 10h20z"
        fill={BRAND.mint}
        stroke={BRAND.graphite}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <circle cx="40" cy="60" r="5" fill={BRAND.graphite} />
      <circle cx="72" cy="60" r="5" fill={BRAND.graphite} />
      <path d="M43 76q13 12 26 0" stroke={BRAND.graphite} strokeWidth="6" strokeLinecap="round" />
      <circle cx="29" cy="72" r="6" fill={BRAND.peach} />
      <circle cx="83" cy="72" r="6" fill={BRAND.peach} />
      <path d="M30 100h50M30 115h30" stroke={BRAND.mint} strokeWidth="7" strokeLinecap="round" />
      <path d="M3 118l-10 8M2 106l-12 1" stroke={BRAND.graphite} strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

type BrandLockupProps = {
  /** Mark size in px; the wordmark scales with it. */
  size?: number;
  /** Show the tagline under the wordmark (header / footer), or just the name (sidebar). */
  tagline?: boolean;
  className?: string;
};

/**
 * Mark + wordmark, the horizontal lockup used in the marketing header,
 * the app sidebar and the footer. The wordmark is Rubik 900 (brand book),
 * the tagline Heebo. Sizes are derived from `size` so every lockup in the
 * product keeps the same proportions.
 */
export function BrandLockup({ size = 34, tagline = true, className }: BrandLockupProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.28) }}
    >
      <BrandMark size={size} />
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, lineHeight: 1 }}>
        <span
          className="brand-wordmark"
          style={{ fontSize: Math.round(size * 0.62), color: BRAND.graphite }}
        >
          {BRAND.name}
        </span>
        {tagline ? (
          <span
            className="brand-tagline"
            style={{ fontSize: Math.max(11, Math.round(size * 0.32)) }}
          >
            {BRAND.tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
