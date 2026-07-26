import type { ReactNode } from "react";

/**
 * Bidi isolation for Latin ("LTR") runs sitting inside Hebrew RTL copy.
 *
 * The problem: in an `dir="rtl"` paragraph the Unicode bidi algorithm resolves
 * neutral characters (punctuation, spaces, currency signs) against their
 * NEIGHBOURS. So "Invoice4U בוגרים יותר." can render with the period on the
 * wrong side, and "ל-API" can flip the hyphen. Wrapping each Latin run in a
 * `dir="ltr"` span turns the run into its own isolate, so the surrounding
 * punctuation resolves against the paragraph direction instead.
 *
 * Two entry points:
 *   • `<Ltr>` — for JSX you are AUTHORING. You know where the Latin is, so
 *     wrap it by hand: `נסה את <Ltr>Apple Pay</Ltr> שלנו`.
 *   • `<LtrText>` — for DATA strings you are RENDERING (e.g. the `verdict` /
 *     `tagline` fields in `src/lib/comparison-data.ts`), where the Latin runs
 *     are not known at author time and must be detected.
 *
 * Deliberately NO `display:inline-block` on the span. `dir` alone (plus the
 * `unicode-bidi: isolate` base rule in globals.css) already gives full bidi
 * isolation, while `inline-block` would make the run an atomic box that can
 * never wrap — a multi-word run like "Apple Pay Business" would then be
 * pushed to the next line whole, or overflow a narrow mobile column.
 */

/** A Latin token: starts with a letter, may carry digits, may contain inner
 *  joiners (`-'&+./`), and ALWAYS ends on an alphanumeric — so trailing
 *  punctuation ("Invoice4U.", "Bit,") stays outside the run. */
const TOKEN = String.raw`[A-Za-z][A-Za-z0-9]*(?:[-'&+./][A-Za-z0-9]+)*`;
/** Consecutive tokens joined by a single space are ONE run ("Apple Pay"). */
const LATIN_RUN_SOURCE = `${TOKEN}(?: ${TOKEN})*`;

export interface LatinSegment {
  /** The raw substring. Concatenating every `t` reproduces the input exactly. */
  t: string;
  /** True when this segment is a Latin run that should be bidi-isolated. */
  ltr: boolean;
}

/**
 * Split a string into alternating non-Latin / Latin-run segments.
 * Pure and allocation-cheap; the regex is rebuilt per call so a shared
 * `lastIndex` can never leak between callers.
 */
export function splitLatinRuns(text: string): LatinSegment[] {
  const out: LatinSegment[] = [];
  if (!text) return out;

  // Fresh regex per call — a module-level /g regex would carry `lastIndex`
  // across calls and silently skip matches. `exec` in a loop rather than
  // `matchAll`, which needs a downlevel iteration helper at target ES2017.
  const re = new RegExp(LATIN_RUN_SOURCE, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) out.push({ t: text.slice(cursor, match.index), ltr: false });
    out.push({ t: match[0], ltr: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) out.push({ t: text.slice(cursor), ltr: false });
  return out;
}

/** Isolate hand-authored Latin content inside RTL copy. */
export function Ltr({ children }: { children: ReactNode }) {
  return <span dir="ltr">{children}</span>;
}

/** Render a data string, isolating every Latin run it contains. */
export function LtrText({ text }: { text: string }) {
  const parts: ReactNode[] = splitLatinRuns(text).map((seg, i) =>
    seg.ltr ? (
      <span key={i} dir="ltr">
        {seg.t}
      </span>
    ) : (
      seg.t
    ),
  );
  return <>{parts}</>;
}
