/**
 * The brand mark (brand book, 2026-09-07 "Deep Orange + Charcoal"): the
 * invoice icon with the V sign - a charcoal-outlined document with an orange
 * folded corner, two content rules and an orange check badge on the lower
 * right. Aligned and stable: no shadow, no glow, no 3D. This is the ONE
 * source for the mark in React; public/logo.svg and logo-v2.svg carry the
 * same drawing for favicons, the manifest, emails and the social card.
 *
 * Colours are the brand constants, not theme tokens, on purpose: the mark
 * must look identical on the marketing page, in the app shell, on a dark
 * tile and inside a customer's document footer.
 */

export const BRAND = {
  orange: "#D96A1D", burnt: "#A94E16", gold: "#F2A33C", charcoal: "#1F232B",
  cream: "#F7F2EB", sand: "#E8DDD0", orangeTint: "#FBEADB", orangeInk: "#A94E16",
  greenTint: "#EEF4E8", greenInk: "#4A7536", offWhite: "#F7F2EB", border: "#E8DDD0", text: "#1F232B",
  name: "חשבונית ידידותית", latin: "Friendly Invoice", tagline: "התנהלות פשוטה לעסק מצליח",
} as const;

type BrandMarkProps = {
  /** Rendered width in px; height follows the 130:150 aspect. */
  size?: number;
  className?: string;
  /** Present when the mark stands alone (an icon link); omit when text sits beside it. */
  title?: string;
  /** The orange check badge on the lower-right corner (brand book "02. Icon"). */
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
        stroke="#1F232B"
        strokeWidth="8"
        strokeLinejoin="round"
      />
      {/* folded corner */}
      <path
        d="M76 6v22a14 14 0 0 0 14 14h22z"
        fill="#D96A1D"
        stroke="#1F232B"
        strokeWidth="8"
        strokeLinejoin="round"
      />
      {/* content rules */}
      <path d="M30 60h44M30 78h30" stroke="#1F232B" strokeWidth="7" strokeLinecap="round" />
      <path d="M30 112h18" stroke="#1F232B" strokeWidth="7" strokeLinecap="round" />
      {badge ? (
        <>
          <circle cx="90" cy="112" r="23" fill="#D96A1D" />
          <path
            d="M78 112l9 9 16-18"
            stroke="#FFFFFF"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
  /** "dark" is the charcoal footer slab: cream Hebrew, orange signature. */
  tone?: "light" | "dark";
};

/**
 * The primary logo from the brand book: the mark at the reading START (the
 * right side on an RTL page), vertically centred against two text lines.
 * "חשבונית ידידותית" is the PRIMARY name (Heebo 700, charcoal) and
 * "Friendly Invoice" is the SECONDARY English signature under it (Playfair
 * Display 500 via `.brand-latin`, in Primary Orange so it lifts off the
 * charcoal Hebrew above it). Sizes derive from `size` so every lockup in the
 * product keeps the same proportions, including the clear space between the
 * mark and the text.
 */
export function BrandLockup({ size = 32, tagline = false, className, tone = "light" }: BrandLockupProps) {
  const hebrew = Math.round(size * 0.5);
  const latin = Math.round(size * 0.38);
  const dark = tone === "dark";
  return (
    <span
      className={className}
      dir="rtl"
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3) }}
    >
      <BrandMark size={size} />
      <span
        style={{
          display: "inline-flex",
          flexDirection: "column",
          gap: Math.round(size * 0.1),
          lineHeight: 1,
          textAlign: "right",
        }}
      >
        <span className="brand-wordmark" style={{ fontSize: hebrew, color: dark ? "#FFFFFF" : BRAND.charcoal }}>
          {BRAND.name}
        </span>
        <span className="brand-latin" dir="ltr" style={{ fontSize: latin, color: BRAND.orange, textAlign: "right" }}>
          {BRAND.latin}
        </span>
        {tagline ? (
          <span
            className="brand-tagline"
            style={{
              fontSize: Math.max(11, Math.round(size * 0.3)),
              ...(dark ? { color: "rgba(247, 242, 235, 0.7)" } : null),
            }}
          >
            {BRAND.tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
