/**
 * LogoV2 - the brand lockup for the V2 marketing chrome (HeaderV2 /
 * FooterV2 and the inner marketing pages). Since the 2026-09-06 rebrand it
 * is a thin wrapper over the shared brand mark (src/components/brand-mark.tsx):
 * the smiling document + "חשבונית ידידותית" wordmark + tagline. Two variants:
 *   - "full" (default): mark + wordmark + tagline
 *   - "mark": just the document mark
 *
 * ACCESSIBLE NAME: the mark is decorative (`aria-hidden`), so the text
 * carries the name. The "full" variant gets it from the wordmark. The
 * "mark" variant has no visible text, so it renders `srText`, which is
 * also what gives a wrapping <a> a real accessible name instead of just
 * its href.
 */

import { BrandLockup, BrandMark } from "@/components/brand-mark";

type LogoV2Props = {
  variant?: "full" | "mark";
  className?: string;
  /** Screen-reader-only text for the "mark" variant (ignored by "full"). */
  srText?: string;
};

export default function LogoV2({
  variant = "full",
  className,
  srText = "חשבונית ידידותית",
}: LogoV2Props) {
  if (variant === "mark") {
    return (
      <span className={`v2-logo${className ? ` ${className}` : ""}`}>
        <BrandMark size={30} />
        <span className="v2-sr">{srText}</span>
      </span>
    );
  }

  return (
    <span className={`v2-logo${className ? ` ${className}` : ""}`}>
      <BrandLockup size={34} />
    </span>
  );
}
