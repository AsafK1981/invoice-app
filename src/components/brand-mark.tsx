/**
 * The brand mark (brand book v1.0, 2026-09-07): a smiling document with a
 * peach folded corner, closed happy eyes, peach cheeks, three mint text
 * lines and a mint check badge on the lower-left corner. This is the ONE
 * source for the mark in React; public/logo.svg and logo-v2.svg carry the
 * same drawing for favicons, the manifest, emails and the social card.
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
  peachInk: "#A64E2A",
  offWhite: "#F7F7F2",
  border: "#E4E7E2",
  text: "#1F252B",
  name: "חשבונית ידידותית",
  latin: "FriendlyInvoice",
  tagline: "התנהלות פשוטה לעסק מצליח",
} as const;

type BrandMarkProps = {
  /** Rendered width in px; height follows the 130:150 aspect. */
  size?: number;
  className?: string;
  /** Present when the mark stands alone (an icon link); omit when text sits beside it. */
  title?: string;
  /** The mint check badge on the lower-left corner (brand book "02. Icon"). */
  badge?: boolean;
};

export function BrandMark({ size = 32, className, title, badge = true }: BrandMarkProps) {
  const height = Math.round((size * 150) / 130);
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 130 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {/* page */}
      <path
        d="M24 6h52l36 36v90a14 14 0 0 1-14 14H24a14 14 0 0 1-14-14V20A14 14 0 0 1 24 6z"
        fill="#FFFFFF"
        stroke={BRAND.graphite}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      {/* folded corner */}
      <path
        d="M76 6v22a14 14 0 0 0 14 14h22z"
        fill={BRAND.peach}
        stroke={BRAND.graphite}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      {/* closed happy eyes + smile */}
      <path d="M32 58q10-12 20 0M70 58q10-12 20 0" stroke={BRAND.graphite} strokeWidth="7" strokeLinecap="round" />
      <path d="M46 74q15 14 30 0" stroke={BRAND.graphite} strokeWidth="7" strokeLinecap="round" />
      {/* cheeks */}
      <circle cx="28" cy="72" r="6.5" fill={BRAND.peach} />
      <circle cx="94" cy="72" r="6.5" fill={BRAND.peach} />
      {/* text lines */}
      <path d="M30 100h60M30 114h46M30 128h32" stroke={BRAND.mint} strokeWidth="8" strokeLinecap="round" />
      {badge ? (
        <>
          <circle cx="100" cy="122" r="17" fill={BRAND.mint} stroke="#FFFFFF" strokeWidth="5" />
          <path d="M91 122l6 6 12-13" stroke={BRAND.graphite} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
    </svg>
  );
}

type BrandLockupProps = {
  /** Mark size in px; the wordmark scales with it. */
  size?: number;
  /** Show the tagline under the name (footer, sign-in), or not (header, sidebar). */
  tagline?: boolean;
  className?: string;
};

/**
 * The primary logo from the brand book: mark on the left, then the Latin
 * wordmark "FriendlyInvoice" (Friendly in graphite, Invoice in mint, Inter
 * 700) with "חשבונית ידידותית" (Heebo 700) under it. The lockup reads
 * LEFT-TO-RIGHT as one unit even on an RTL page, which is why it carries
 * its own `dir`. Sizes derive from `size` so every lockup in the product
 * keeps the same proportions.
 */
export function BrandLockup({ size = 32, tagline = false, className }: BrandLockupProps) {
  const latin = Math.round(size * 0.66);
  const hebrew = Math.max(11, Math.round(size * 0.36));
  return (
    <span
      className={className}
      dir="ltr"
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3) }}
    >
      <BrandMark size={size} />
      <span style={{ display: "inline-flex", flexDirection: "column", gap: Math.round(size * 0.08), lineHeight: 1 }}>
        <span className="brand-latin" style={{ fontSize: latin }}>
          <span style={{ color: BRAND.graphite }}>Friendly</span>
          <span style={{ color: BRAND.mint }}>Invoice</span>
        </span>
        <span className="brand-wordmark" dir="rtl" style={{ fontSize: hebrew, color: BRAND.graphite, textAlign: "left" }}>
          {BRAND.name}
        </span>
        {tagline ? (
          <span className="brand-tagline" dir="rtl" style={{ fontSize: Math.max(11, Math.round(size * 0.3)), textAlign: "left" }}>
            {BRAND.tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
