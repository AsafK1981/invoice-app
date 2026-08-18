import type { LayoutKey } from "@/lib/document-themes";

interface Props {
  layout: LayoutKey;
  /** hex, the template's / current accent - the one coloured stroke */
  accent: string;
  /** rendered height in px (width follows the A4 ratio) */
  size?: number;
  className?: string;
}

const INK = "#3f3a30";
const RULE = "#cfc8b8";
const PAPER = "#ffffff";

/**
 * A miniature page schematic for one layout family - the thing that lets a
 * user tell "banner" from "ledger" at a glance in the settings gallery,
 * before they open the live preview. Pure inline SVG, no external asset,
 * drawn in a 28x36 box (A4-ish). Only the accent is dynamic; everything
 * else is fixed so all glyphs read as one set.
 */
export function LayoutGlyph({ layout, accent, size = 30, className }: Props) {
  const w = Math.round((size * 28) / 36);
  const common = {
    width: w,
    height: size,
    viewBox: "0 0 28 36",
    "aria-hidden": true as const,
    className,
    style: { display: "block" as const },
  };

  switch (layout) {
    case "banner":
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="27" height="35" rx="1.5" fill={PAPER} stroke={RULE} />
          <rect x="0.5" y="0.5" width="27" height="9" rx="1.5" fill={accent} />
          <rect x="4" y="3" width="10" height="1.6" rx="0.8" fill="#fff" />
          <rect x="4" y="6" width="6" height="1.2" rx="0.6" fill="#fff" opacity="0.8" />
          <rect x="4" y="13" width="20" height="2.4" rx="0.6" fill={accent} opacity="0.22" />
          <rect x="4" y="17.5" width="20" height="1" rx="0.5" fill={RULE} />
          <rect x="4" y="21" width="20" height="1" rx="0.5" fill={RULE} />
          <rect x="4" y="24.5" width="20" height="1" rx="0.5" fill={RULE} />
          <rect x="15" y="28.5" width="9" height="4" rx="0.6" fill={accent} />
        </svg>
      );
    case "editorial":
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="27" height="35" rx="1.5" fill={PAPER} stroke={RULE} />
          <rect x="4" y="5" width="12" height="2.2" rx="0.6" fill={INK} />
          <rect x="4" y="9.5" width="20" height="0.7" fill={INK} />
          <rect x="4" y="15" width="7" height="1" rx="0.5" fill={RULE} />
          <rect x="17" y="15" width="7" height="1" rx="0.5" fill={RULE} />
          <rect x="4" y="20.5" width="20" height="0.7" fill={INK} />
          <rect x="4" y="24" width="20" height="0.7" fill={RULE} />
          <rect x="4" y="27.5" width="20" height="0.7" fill={RULE} />
          <rect x="16" y="31" width="8" height="1.8" rx="0.4" fill={accent} />
        </svg>
      );
    case "ledger":
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="27" height="35" rx="1.5" fill={PAPER} stroke={RULE} />
          <rect x="0.5" y="0.5" width="27" height="1.4" fill={accent} />
          <rect x="4" y="5" width="11" height="1.8" rx="0.4" fill={INK} />
          <rect x="4" y="9" width="20" height="0.6" fill={INK} />
          <rect x="4" y="10.4" width="20" height="0.6" fill={INK} />
          <rect x="4" y="14" width="20" height="16" fill="none" stroke={RULE} strokeWidth="0.8" />
          <rect x="4" y="14" width="20" height="3.5" fill={accent} opacity="0.22" />
          <line x1="4" y1="17.5" x2="24" y2="17.5" stroke={INK} strokeWidth="0.8" />
          <line x1="4" y1="21.5" x2="24" y2="21.5" stroke={RULE} strokeWidth="0.8" />
          <line x1="4" y1="25.5" x2="24" y2="25.5" stroke={RULE} strokeWidth="0.8" />
          <line x1="10" y1="14" x2="10" y2="30" stroke={RULE} strokeWidth="0.8" />
          <line x1="18" y1="14" x2="18" y2="30" stroke={RULE} strokeWidth="0.8" />
        </svg>
      );
    case "stage":
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="27" height="35" rx="1.5" fill={PAPER} stroke={RULE} />
          <rect x="0.5" y="0.5" width="27" height="10" rx="1.5" fill="#161616" />
          <rect x="0.5" y="10" width="27" height="1.6" fill={accent} />
          <rect x="4" y="3.5" width="11" height="2.2" rx="0.6" fill={accent} />
          <rect x="4" y="7" width="7" height="1" rx="0.5" fill="#fff" opacity="0.7" />
          <line x1="19" y1="3" x2="19" y2="8.5" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.6" strokeDasharray="1 1" />
          <rect x="4" y="15" width="6" height="1.4" rx="0.4" fill={INK} />
          <rect x="11" y="15.4" width="4" height="0.8" fill={accent} />
          <line x1="4" y1="20" x2="24" y2="20" stroke={INK} strokeWidth="0.9" />
          <line x1="4" y1="23.5" x2="24" y2="23.5" stroke={RULE} strokeWidth="0.7" strokeDasharray="1.2 1" />
          <line x1="4" y1="27" x2="24" y2="27" stroke={RULE} strokeWidth="0.7" strokeDasharray="1.2 1" />
          <rect x="15" y="30" width="9" height="3.5" rx="0.4" fill="#161616" />
        </svg>
      );
    case "cards":
    default:
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="27" height="35" rx="1.5" fill="#f2efe7" stroke={RULE} />
          <rect x="0.5" y="0.5" width="27" height="1.4" fill={accent} />
          <rect x="3.5" y="4.5" width="21" height="8" rx="2" fill={PAPER} stroke={RULE} strokeWidth="0.7" />
          <rect x="6" y="7" width="8" height="1.6" rx="0.5" fill={INK} />
          <rect x="3.5" y="14.5" width="10" height="6" rx="2" fill={PAPER} stroke={RULE} strokeWidth="0.7" />
          <rect x="14.5" y="14.5" width="10" height="6" rx="2" fill={PAPER} stroke={RULE} strokeWidth="0.7" />
          <rect x="3.5" y="22.5" width="21" height="10" rx="2" fill={PAPER} stroke={RULE} strokeWidth="0.7" />
          <rect x="6" y="25" width="16" height="0.8" rx="0.4" fill={accent} opacity="0.7" />
          <rect x="6" y="27.5" width="16" height="0.7" rx="0.35" fill={RULE} />
          <rect x="6" y="29.8" width="16" height="0.7" rx="0.35" fill={RULE} />
        </svg>
      );
  }
}
