/**
 * Profession-tailored document design - CLOSED SETS ONLY.
 *
 * This file is the single source of truth for the "document design" feature
 * AND the security boundary for it. Users never supply raw CSS, a color
 * picker value, or a font string. They pick from fixed, developer-curated
 * enums (a template id, an accent key, a font key, a logo position); this
 * module maps those enum picks to concrete, hand-authored CSS values.
 *
 * The only function allowed to turn untrusted JSON (the `document_design`
 * JSONB column, round-tripped through Supabase/the public API) into
 * something that drives rendering is {@link normalizeDocumentDesign}. Its
 * output is a `DocumentDesign` where every field is guaranteed to be one of
 * the enum values declared below - never a pass-through of the input. The
 * only function allowed to turn a `DocumentDesign` into CSS is
 * {@link designToCssVars}; it only ever emits values it looked up from the
 * closed maps in this file, never a string that flowed in from outside.
 *
 * `null` (the column's default, and what every existing business has today)
 * means "no theme chosen" and must render byte-for-byte identically to the
 * design before this feature existed - the existing gold look. An explicit
 * `{ template: "general" }` selection looks the same but is a real user
 * choice; `normalizeDocumentDesign` only returns `null` when the raw input
 * itself is null/undefined/not an object.
 */

// ── Template ids ────────────────────────────────────────────────────────

export type TemplateId =
  | "general"
  | "therapist"
  | "fitness"
  | "beauty"
  | "altmed"
  | "designer"
  | "photographer"
  | "marketing"
  | "coach"
  | "tutor"
  | "dietitian"
  | "tradesperson"
  | "lawyer"
  | "accountant"
  | "architect"
  | "developer"
  | "entertainer";

// ── Accent keys ──────────────────────────────────────────────────────────
// One accent key per template (16, all unique) plus room for future reuse.
// Each maps to a small hand-authored color FAMILY (the "gold" family of
// vars: badge/glabel/hairline/totals color, its lighter line tint, its
// faintest tint, and the top-bar gradient), not a single raw hex a user
// could inject - the family members for the 9 templates with no exact
// mockup reference are derived from one base hex via pure, deterministic
// color math (mix-with-white / mix-with-black), never from user input.

export type AccentKey =
  // brand + classic / neutral
  | "gold"
  | "amberDeep"
  | "terracotta"
  | "navy"
  | "slate"
  | "sage"
  | "graphite"
  | "charcoal"
  | "stone"
  // clean colour set (same hues as the approved app feature tiles)
  | "amber"
  | "orange"
  | "rose"
  | "pink"
  | "fuchsia"
  | "violet"
  | "indigo"
  | "blue"
  | "sky"
  | "cyan"
  | "teal"
  | "emerald"
  | "lime";

interface AccentFamily {
  /** hex, e.g. "#2f3a45" - text/badge/glabel/totals color */
  accent: string;
  /** hex - thin rule/border color (table header underline, card border on the "paid" block) */
  line: string;
  /** hex - very light tint (glabel underline fade, table header background on bold templates) */
  faint: string;
  /** CSS `background` value for the sheet's top bar: a gradient string or a solid hex */
  grad: string;
  /** hex - a darker sibling that carries WHITE text legibly (the "banner"
   *  header band and the paid block on banner/stage layouts). Mid-tone
   *  accents like amber/coral fail contrast with white; their deep sibling
   *  passes while still reading as the same family. */
  deep: string;
}

/** Mix `hex` toward white by `amount` (0..1). Pure, deterministic. */
function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return rgbToHex(mix(r), mix(g), mix(b));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return rgbToHex(mix(r), mix(g), mix(b));
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Expands ONE brand colour into a full accent family. Only used for a
 * brand-book import, where the exact brand hex matters more than a
 * hand-tuned palette. Brand colours arrive at any lightness, but the
 * `accent` step is used for TEXT on white (totals, headings), so light ones
 * are pulled down until they read; the tint/line/deep steps then follow the
 * same 100/300/800 relationship the hand-picked {@link tw} families use.
 * Every output is computed from the input; nothing is passed through.
 */
export function deriveAccentFamily(hex: string): AccentFamily {
  let accent = hex.toLowerCase();
  for (let i = 0; i < 12 && luminance(accent) > 0.3; i++) accent = darken(accent, 0.12);
  const deep = darken(accent, 0.3);
  return {
    accent,
    line: lighten(accent, 0.5),
    faint: lighten(accent, 0.86),
    deep,
    grad: `linear-gradient(177deg, ${lighten(accent, 0.3)} 0%, ${accent} 42%, ${deep} 78%, ${lighten(accent, 0.18)} 100%)`,
  };
}

/** The palette accent closest (RGB distance) to a brand colour - the picker's
 *  home for an imported colour, and what older readers fall back to. */
export function nearestAccentKey(hex: string): AccentKey {
  const target = hexToRgb(hex);
  let best: AccentKey = "gold";
  let bestDist = Infinity;
  for (const key of Object.keys(ACCENT_HEX) as AccentKey[]) {
    const c = hexToRgb(ACCENT_HEX[key].accent);
    const d = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return best;
}

/** A hand-picked family from four palette steps (ink/line/tint/deep) with
 *  the same 4-stop diagonal gradient shape the original gold bar uses. */
function tw(accent: string, line: string, faint: string, deep: string): AccentFamily {
  return {
    accent,
    line,
    faint,
    deep,
    grad: `linear-gradient(177deg, ${lighten(accent, 0.3)} 0%, ${accent} 42%, ${deep} 78%, ${lighten(accent, 0.18)} 100%)`,
  };
}

/** The closed set of accent families. Exact hex triples are reused verbatim
 *  from the approved template gallery mockup where one exists; the rest are
 *  hand-picked palette steps (see {@link tw}). This map is the ONLY source
 *  of accent CSS values -
 *  `normalizeDocumentDesign` checks membership here, `designToCssVars` only
 *  ever reads from here. */
export const ACCENT_HEX: Record<AccentKey, AccentFamily> = {
  // 2026-09-06 rebrand: the DEFAULT family (the "general" template, and the
  // fallback a null design renders) is the brand's graphite + mint, not the
  // old antique gold. The key stays `gold` because it is persisted in
  // businesses.document_design for every business that ever picked it -
  // renaming it would orphan those rows. Values here must stay byte-for-byte
  // identical to the --d-* defaults in src/app/document-paper.css.
  gold: {
    accent: "#2f3a45",
    line: "#9ed8c3",
    faint: "#e6f5ee",
    deep: "#263039",
    grad: "linear-gradient(135deg, #2f3a45, #263039)",
  },
  amberDeep: {
    accent: "#8a5f07",
    line: "#b8860b",
    faint: "#f2e0b3",
    deep: "#5f4104",
    grad: "linear-gradient(177deg, #d9a52a 0%, #b8860b 50%, #8a5f07 100%)",
  },
  terracotta: tw("#c2410c", "#fdba74", "#ffedd5", "#7c2d12"),
  navy: {
    accent: "#1b2a4a",
    line: "#8a95b3",
    faint: "#dde1eb",
    deep: "#131d33",
    grad: "linear-gradient(177deg, #1b2a4a 0%, #2a3d63 50%, #16213a 100%)",
  },
  slate: tw("#475569", "#cbd5e1", "#f1f5f9", "#1e293b"),
  sage: {
    accent: "#62795f",
    line: "#b9cab3",
    faint: "#e7efe3",
    deep: "#495b47",
    grad: "linear-gradient(177deg, #a9c0a2 0%, #7c9885 42%, #5e7a5b 78%, #9db597 100%)",
  },
  graphite: tw("#3f3f46", "#a1a1aa", "#f4f4f5", "#18181b"),
  charcoal: {
    accent: "#1a1a1a",
    line: "#c9a15a",
    faint: "#ece3d0",
    deep: "#111111",
    grad: "#c9a15a",
  },
  stone: tw("#57534e", "#d6d3d1", "#f5f5f4", "#292524"),
  // 2026-08-18: the clean set. Same hue system as the app's approved
  // feature tiles (app-skin.css .ftile-*): text/ink at the 600 step,
  // hairline at 300, pastel tint at 100, deep at 800. Replaces the earlier
  // colour-math derived families, which came out muddy ("לא נראים טובים").
  amber: tw("#d97706", "#fcd34d", "#fef3c7", "#92400e"),
  orange: tw("#ea580c", "#fdba74", "#ffedd5", "#9a3412"),
  rose: tw("#e11d48", "#fda4af", "#ffe4e6", "#9f1239"),
  pink: tw("#db2777", "#f9a8d4", "#fce7f3", "#9d174d"),
  fuchsia: tw("#c026d3", "#f0abfc", "#fae8ff", "#86198f"),
  violet: tw("#7c3aed", "#c4b5fd", "#ede9fe", "#5b21b6"),
  indigo: tw("#4f46e5", "#a5b4fc", "#e0e7ff", "#3730a3"),
  blue: tw("#2563eb", "#93c5fd", "#dbeafe", "#1e40af"),
  sky: tw("#0284c7", "#7dd3fc", "#e0f2fe", "#075985"),
  cyan: tw("#0891b2", "#67e8f9", "#cffafe", "#155e75"),
  teal: tw("#0d9488", "#5eead4", "#ccfbf1", "#115e59"),
  emerald: tw("#059669", "#6ee7b7", "#d1fae5", "#065f46"),
  lime: tw("#65a30d", "#bef264", "#ecfccb", "#3f6212"),
};

/** Every accent, grouped for the Settings swatch rows: the gentle set
 *  first (what most people want), the deep/saturated set second. Every
 *  template's own accent appears in one of the two groups, so the swatch
 *  rows can always get back to the template default. */
export const ACCENT_GROUPS: { label: string; keys: AccentKey[] }[] = [
  {
    label: "צבעוני",
    keys: [
      "amber",
      "orange",
      "rose",
      "pink",
      "fuchsia",
      "violet",
      "indigo",
      "blue",
      "sky",
      "cyan",
      "teal",
      "emerald",
      "lime",
    ],
  },
  {
    label: "קלאסי",
    keys: ["gold", "amberDeep", "terracotta", "sage", "navy", "slate", "graphite", "stone", "charcoal"],
  },
];

// ── Font keys ────────────────────────────────────────────────────────────
// Exactly the curated Hebrew-capable shortlist. heebo/frank/assistant are
// already self-hosted (src/app/layout.tsx); rubik/miriam are added by this
// feature under src/app/fonts/{rubik,miriam-libre}/, same self-hosted
// next/font/local pattern - no Google Fonts CDN call at request time.

export type FontKey =
  | "heebo"
  | "rubik"
  | "assistant"
  | "frank"
  | "miriam"
  | "alef"
  | "plex"
  | "varela"
  | "playpen"
  | "amatic";

export interface FontOption {
  family: string;
  label: string;
  /** Short Hebrew hint shown under the label in Settings. */
  hint: string;
  /**
   * Handwriting / hand-lettered faces are DISPLAY-ONLY: choosing one sets
   * the business name + document number in that face while the body of
   * the document (line items, amounts, legal text) stays in the template's
   * own readable font. An invoice fully set in a handwriting face is not a
   * document a bookkeeper wants to read.
   */
  displayOnly?: boolean;
  /**
   * Optical scale for the business name / doc number when THIS face is
   * the name font. Amatic SC has a tiny x-height and looks a size smaller
   * than everything else at the same px value; 1 = no adjustment.
   */
  nameScale?: number;
}

export const FONT_OPTIONS: Record<FontKey, FontOption> = {
  heebo: {
    family: 'var(--font-heebo), "Heebo", system-ui, sans-serif',
    label: "Heebo",
    hint: "ברירת המחדל, נקי וקריא",
  },
  rubik: {
    family: 'var(--font-rubik), "Rubik", system-ui, sans-serif',
    label: "Rubik",
    hint: "מעוגל וידידותי",
  },
  assistant: {
    family: 'var(--font-assistant), "Assistant", system-ui, sans-serif',
    label: "Assistant",
    hint: "צר ומודרני",
  },
  alef: {
    family: 'var(--font-alef), "Alef", system-ui, sans-serif',
    label: "Alef",
    hint: "מינימליסטי",
  },
  varela: {
    family: 'var(--font-varela), "Varela Round", system-ui, sans-serif',
    label: "Varela Round",
    hint: "רך ועגול",
  },
  plex: {
    family: 'var(--font-plex), "IBM Plex Sans Hebrew", system-ui, sans-serif',
    label: "IBM Plex",
    hint: "הייטקי, טכני",
  },
  frank: {
    family: 'var(--font-frank), "Frank Ruhl Libre", Georgia, serif',
    label: "Frank Ruhl Libre",
    hint: "סריף קלאסי",
  },
  miriam: {
    family: 'var(--font-miriam), "Miriam Libre", Georgia, serif',
    label: "Miriam Libre",
    hint: "סריף עדין",
  },
  playpen: {
    family: 'var(--font-playpen), "Playpen Sans Hebrew", cursive',
    label: "Playpen",
    hint: "כתב יד (שם ומספר בלבד)",
    displayOnly: true,
    nameScale: 1.05,
  },
  amatic: {
    family: 'var(--font-amatic), "Amatic SC", cursive',
    label: "Amatic",
    hint: "כתב יד דק (שם ומספר בלבד)",
    displayOnly: true,
    nameScale: 1.35,
  },
};

export const FONT_KEYS = Object.keys(FONT_OPTIONS) as FontKey[];

// ── Logo position ────────────────────────────────────────────────────────

export type LogoPosition = "right" | "center" | "left";
export const LOGO_POSITIONS: LogoPosition[] = ["right", "center", "left"];

// ── Corner / border closed buckets ──────────────────────────────────────
// The product brief describes `corner` abstractly as 'sharp'|'soft'|'round',
// but the concrete 15-template table also uses a 4th value ("normal") for
// marketing/accountant/developer, meaning "no special corner treatment -
// keep the current default". Rather than force those three into 'soft' or
// 'round' (which would misrepresent them), 'normal' is kept as its own
// bucket equal to the pre-feature baseline (16px / 3px badge radius).
// Corner and border are NOT independently user-choosable - they are baked
// into the template definition below, so they never need their own
// validation against raw JSON (only `design.template` does, and that
// validation is what makes these safe to look up).

export type CornerKey = "sharp" | "normal" | "soft" | "round";
export type BorderKey = "hairline" | "normal" | "bold";

const CORNER_VALUES: Record<CornerKey, { radius: string; badge: string }> = {
  sharp: { radius: "0px", badge: "0px" },
  normal: { radius: "16px", badge: "3px" },
  soft: { radius: "10px", badge: "8px" },
  round: { radius: "20px", badge: "20px" },
};

const BORDER_VALUES: Record<
  BorderKey,
  { card: string; hdr: string; grand: string; shadow: string }
> = {
  hairline: { card: "1px", hdr: "1px", grand: "1.5px", shadow: "none" },
  normal: {
    card: "1px",
    hdr: "1.5px",
    grand: "2px",
    shadow: "0 1px 2px rgba(40, 30, 10, 0.03)",
  },
  bold: { card: "2px", hdr: "2px", grand: "3px", shadow: "none" },
};

// ── Layout keys ──────────────────────────────────────────────────────────
// The STRUCTURAL axis (added 2026-08-18). Until then every template shared
// one sheet structure and differed only in CSS variables, which is why the
// gallery read as "the same document, recoloured 16 times". A layout is a
// closed enum the paper CSS keys on via `data-doc-layout` - the same DOM,
// restyled: where the header sits, whether zones are cards or hairlines,
// whether the table is a grid or bare rules. Each template ships a default
// layout, and (like accent/font) the user may override it.

export type LayoutKey = "cards" | "banner" | "editorial" | "ledger" | "stage";

export const LAYOUT_OPTIONS: Record<LayoutKey, { label: string; hint: string }> = {
  cards: { label: "כרטיסים", hint: "אזורים בכרטיסים רכים על רקע בהיר" },
  banner: { label: "כותרת צבעונית", hint: "פס כותרת מלא בצבע הדגש, טבלה נקייה" },
  editorial: { label: "מינימלי", hint: "דף לבן, קווים דקים, הרבה אוויר" },
  ledger: { label: "קלאסי", hint: "טבלה עם רשת, מסגרות ישרות, רשמי" },
  stage: { label: "במה", hint: "כותרת כהה, צבע חזק, מראה של כרטיס" },
};

export const LAYOUT_KEYS = Object.keys(LAYOUT_OPTIONS) as LayoutKey[];

// ── Background pattern keys ──────────────────────────────────────────────
// A subtle accent-tinted texture painted on the sheet behind everything
// (document-paper.css `.doc-paper::after`, keyed on `data-doc-pattern`).
// Asaf asked for it (2026-08-18) after the flowing contour lines on the
// marketing homepage: "קווים אופקיים כמו בדף הנחיתה, או בועות או עיגולים".
// Always low-alpha so line items and amounts stay legible; "none" is the
// default for every template and renders nothing at all.

export type PatternKey = "none" | "topo" | "lines" | "bubbles" | "rings";

export const PATTERN_OPTIONS: Record<PatternKey, { label: string; hint: string }> = {
  none: { label: "ללא", hint: "רקע נקי" },
  topo: { label: "קווים זורמים", hint: "קווי גובה עדינים, כמו בדף הבית" },
  lines: { label: "שורות", hint: "קווים אופקיים דקים, כמו נייר מכתבים" },
  bubbles: { label: "בועות", hint: "עיגולים רכים בפינות" },
  rings: { label: "טבעות", hint: "טבעות קונצנטריות בפינה" },
};

export const PATTERN_KEYS = Object.keys(PATTERN_OPTIONS) as PatternKey[];

// ── Templates ────────────────────────────────────────────────────────────

interface Palette {
  ink: string;
  ink2: string;
  soft: string;
  card: string;
  cardline: string;
  canvas: string;
}

export interface DocumentTemplate {
  id: TemplateId;
  /** Hebrew profession label, shown on the template gallery card. */
  label: string;
  accent: AccentKey;
  font: FontKey;
  /**
   * Font used ONLY for the business name / document number (`.doc-serif`),
   * when the user hasn't overridden the font away from this template's own
   * default. Undefined ⇒ same as `font` (no split). Only the photographer
   * template sets this today (Miriam Libre for the name, Heebo everywhere
   * else) - Miriam Libre's ₪ glyph renders as a visibly split ש/ח, which is
   * unacceptable on the grand total, so money always stays in the body
   * font regardless (`designToCssVars` / document-paper.css enforce this
   * for every template, not just this one).
   */
  nameFont?: FontKey;
  /** Default sheet structure; see {@link LayoutKey}. */
  layout: LayoutKey;
  corner: CornerKey;
  border: BorderKey;
  palette: Palette;
  /** Photographer only: a 1px solid accent-line rule instead of the usual
   *  4px gradient bar along the top of the sheet. */
  hairlineTop?: boolean;
}

const GENERAL_PALETTE: Palette = {
  ink: "#1f252b",
  ink2: "#5f6b76",
  soft: "#8b95a0",
  card: "#ffffff",
  cardline: "#e4e7e2",
  canvas: "#f7f7f2",
};

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "general",
    label: "כללי / ברירת מחדל",
    accent: "gold",
    font: "heebo",
    // Business name / doc number are Rubik (brand book: Rubik headings over a
    // Heebo body), matching the null-design fallback in document-paper.css
    // exactly. Without this, an explicit {template:general} (what the "reset
    // to original" button persists) would silently fall the .doc-serif
    // elements back to Heebo - a visible font change vs. null.
    nameFont: "rubik",
    layout: "cards",
    corner: "normal",
    border: "normal",
    palette: GENERAL_PALETTE,
  },
  {
    id: "therapist",
    label: "מטפל/ת · פסיכולוג/ית",
    accent: "sage",
    font: "rubik",
    layout: "cards",
    corner: "soft",
    border: "hairline",
    palette: {
      ink: "#2b342d",
      ink2: "#5c6b5c",
      soft: "#8a9689",
      card: "#ffffff",
      cardline: "#e4ecdf",
      canvas: "#f2f5ee",
    },
  },
  {
    id: "fitness",
    label: "מאמן/ת כושר · פילאטיס",
    accent: "amber",
    font: "rubik",
    layout: "banner",
    corner: "round",
    border: "normal",
    palette: GENERAL_PALETTE,
  },
  {
    id: "beauty",
    label: "קוסמטיקאי/ת · מעצב/ת שיער",
    accent: "rose",
    font: "miriam",
    layout: "editorial",
    corner: "soft",
    border: "hairline",
    palette: {
      ink: "#2e2620",
      ink2: "#5c5346",
      soft: "#948a79",
      card: "#ffffff",
      cardline: "#f1dfe0",
      canvas: "#f9f1f1",
    },
  },
  {
    id: "altmed",
    label: "רפואה משלימה",
    accent: "terracotta",
    font: "rubik",
    layout: "cards",
    corner: "soft",
    border: "hairline",
    palette: {
      ink: "#211c15",
      ink2: "#52443a",
      soft: "#7a6b5c",
      card: "#ffffff",
      cardline: "#e6d9c9",
      canvas: "#f3ece4",
    },
  },
  {
    id: "designer",
    label: "מעצב/ת גרפי/ת",
    accent: "violet",
    font: "heebo",
    layout: "banner",
    corner: "round",
    border: "normal",
    palette: {
      ink: "#201a33",
      ink2: "#4c4267",
      soft: "#8478a3",
      card: "#ffffff",
      cardline: "#e3ddfa",
      canvas: "#f4f1fd",
    },
  },
  {
    id: "photographer",
    label: "צלם/ת",
    accent: "charcoal",
    font: "heebo",
    nameFont: "miriam",
    layout: "editorial",
    corner: "sharp",
    border: "hairline",
    hairlineTop: true,
    palette: {
      ink: "#1a1a1a",
      ink2: "#4a4a4a",
      soft: "#8a8a8a",
      card: "#ffffff",
      cardline: "#ececec",
      canvas: "#ffffff",
    },
  },
  {
    id: "marketing",
    label: "שיווק ופרסום",
    accent: "orange",
    font: "heebo",
    layout: "banner",
    corner: "normal",
    border: "normal",
    palette: {
      ink: "#2a1f1a",
      ink2: "#5c453a",
      soft: "#927d70",
      card: "#ffffff",
      cardline: "#f3ddd6",
      canvas: "#fdf1ee",
    },
  },
  {
    id: "coach",
    label: "מאמן/ת עסקי · יועץ/ת",
    accent: "amber",
    font: "miriam",
    layout: "editorial",
    corner: "soft",
    border: "normal",
    palette: {
      ink: "#241f10",
      ink2: "#564b28",
      soft: "#8a7d52",
      card: "#ffffff",
      cardline: "#ecdfb0",
      canvas: "#f7f2e1",
    },
  },
  {
    id: "tutor",
    label: "מורה פרטי/ת · חונך/ת",
    accent: "blue",
    font: "heebo",
    layout: "cards",
    corner: "soft",
    border: "normal",
    palette: {
      ink: "#17222e",
      ink2: "#3d4e60",
      soft: "#6f8093",
      card: "#ffffff",
      cardline: "#d8e3ea",
      canvas: "#eef3f7",
    },
  },
  {
    id: "dietitian",
    label: "דיאטן/ית · תזונאי/ת",
    accent: "emerald",
    font: "assistant",
    layout: "cards",
    corner: "soft",
    border: "hairline",
    palette: {
      ink: "#17251f",
      ink2: "#3d5449",
      soft: "#6f8a7c",
      card: "#ffffff",
      cardline: "#d7e9df",
      canvas: "#eef6f1",
    },
  },
  {
    id: "tradesperson",
    label: "בעל/ת מקצוע (חשמל, שיפוצים)",
    accent: "amberDeep",
    font: "heebo",
    layout: "ledger",
    corner: "sharp",
    border: "bold",
    palette: {
      ink: "#1c1a16",
      ink2: "#4b463c",
      soft: "#736c5c",
      card: "#fffdf8",
      cardline: "#d9c68f",
      canvas: "#f2ede0",
    },
  },
  {
    id: "lawyer",
    label: "עורך/ת דין",
    accent: "navy",
    font: "frank",
    layout: "ledger",
    corner: "sharp",
    border: "normal",
    palette: {
      ink: "#16213a",
      ink2: "#3c4a68",
      soft: "#6c7690",
      card: "#ffffff",
      cardline: "#d7dbe6",
      canvas: "#eef0f4",
    },
  },
  {
    id: "accountant",
    label: "רואה/ת חשבון",
    accent: "slate",
    font: "assistant",
    layout: "ledger",
    corner: "normal",
    border: "normal",
    palette: {
      ink: "#1c2733",
      ink2: "#445468",
      soft: "#74849a",
      card: "#ffffff",
      cardline: "#d9e2ea",
      canvas: "#eef1f4",
    },
  },
  {
    id: "architect",
    label: "אדריכל/ית",
    accent: "graphite",
    font: "frank",
    layout: "editorial",
    corner: "sharp",
    border: "hairline",
    palette: {
      ink: "#1c1c1c",
      ink2: "#454545",
      soft: "#7a7a7a",
      card: "#ffffff",
      cardline: "#e2e0da",
      canvas: "#f3f3f1",
    },
  },
  {
    id: "developer",
    label: "מפתח/ת תוכנה",
    accent: "teal",
    font: "heebo",
    layout: "banner",
    corner: "normal",
    border: "normal",
    palette: {
      ink: "#10262a",
      ink2: "#34565b",
      soft: "#5f8388",
      card: "#ffffff",
      cardline: "#cfe6e6",
      canvas: "#eaf5f5",
    },
  },
  {
    id: "entertainer",
    label: "מוזיקאי/ת · זמר/ת · שחקן/ית",
    accent: "fuchsia",
    font: "heebo",
    layout: "stage",
    corner: "sharp",
    border: "normal",
    palette: {
      ink: "#141414",
      ink2: "#454545",
      soft: "#7d7d7d",
      card: "#ffffff",
      cardline: "#e6e6e6",
      canvas: "#ffffff",
    },
  },
];

const TEMPLATE_MAP: Record<TemplateId, DocumentTemplate> = DOCUMENT_TEMPLATES.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<TemplateId, DocumentTemplate>,
);

export function getTemplate(id: TemplateId): DocumentTemplate {
  return TEMPLATE_MAP[id] ?? TEMPLATE_MAP.general;
}

// ── Onboarding auto-suggest ──────────────────────────────────────────────
// Maps a free-text description of what the business does (what a new user
// types into an optional "תחום עיסוק" onboarding field - NOT the
// Business["businessType"] tax-status enum, which is unrelated:
// exempt/authorized/company say nothing about profession) to the closest
// matching profession template. Pure keyword/substring matching, no ML, no
// network call - deterministic and instant.
//
// Groups are checked in priority order, most specific/least ambiguous
// first, so a phrase that could plausibly match two groups (e.g. "מעצב/ת
// פנים" containing both "מעצב" and being about interior design) resolves to
// the more specific one (architect) before the broader one (designer) gets
// a chance. This is a best-effort heuristic for a one-tap suggestion, not a
// security boundary - an unmatched or ambiguous input always falls back to
// 'general' (the existing gold default) rather than guessing a colored
// template the user didn't ask for.
const TEMPLATE_SUGGESTION_RULES: { template: TemplateId; keywords: string[] }[] = [
  {
    template: "lawyer",
    keywords: ["עורך דין", "עורכת דין", "עו\"ד", "עו’ד", "עוה\"ד", "משפט"],
  },
  {
    template: "accountant",
    keywords: ["רואה חשבון", "רואת חשבון", "הנהלת חשבונות", "יועץ מס", "יועצת מס"],
  },
  {
    template: "architect",
    keywords: ["אדריכל", "עיצוב פנים", "מעצב פנים", "מעצבת פנים"],
  },
  {
    template: "developer",
    keywords: ["תוכנה", "מתכנת", "מתכנתת", "הייטק", "פיתוח"],
  },
  {
    template: "altmed",
    keywords: ["רפואה משלימה", "רפלקסולוג", "רפלקסולוגית", "נטורופת", "נטורופתית"],
  },
  {
    template: "dietitian",
    keywords: ["תזונה", "תזונאי", "תזונאית", "דיאט"],
  },
  {
    template: "fitness",
    keywords: ["כושר", "פילאטיס", "יוגה"],
  },
  {
    template: "tradesperson",
    keywords: [
      "חשמל",
      "אינסטלציה",
      "שיפוץ",
      "שיפוצים",
      "שיפוצניק",
      "קבלן",
      "קבלנית",
      "בעל מקצוע",
      "בעלת מקצוע",
    ],
  },
  {
    template: "photographer",
    keywords: ["צילום", "צלם", "צלמת"],
  },
  {
    template: "marketing",
    keywords: ["שיווק", "סושיאל"],
  },
  {
    template: "coach",
    keywords: ["אימון עסקי", "ייעוץ עסקי", "מאמן עסקי", "מאמנת עסקית"],
  },
  {
    template: "tutor",
    keywords: ["מורה", "הוראה", "שיעורים", "שיעור פרטי", "חונך", "חונכת"],
  },
  {
    template: "entertainer",
    keywords: [
      "מוזיקאי",
      "מוזיקאית",
      "מוסיקאי",
      "מוסיקאית",
      "מוזיקה",
      "מוסיקה",
      "זמר",
      "זמרת",
      "שחקן",
      "שחקנית",
      "נגן",
      "נגנית",
      "להקה",
      "די ג'יי",
      "די-ג'יי",
      "DJ",
      "תקליטן",
      "תקליטנית",
      "בידור",
      "אמן במה",
      "אמנית במה",
      "סטנדאפ",
      "רקדן",
      "רקדנית",
    ],
  },
  {
    template: "beauty",
    keywords: [
      "קוסמטיקה",
      "קוסמטיקאי",
      "קוסמטיקאית",
      "יופי",
      "מספרה",
      "עיצוב שיער",
      "מעצב שיער",
      "מעצבת שיער",
      "ספר/ית",
    ],
  },
  {
    template: "designer",
    keywords: ["עיצוב גרפי", "מעצב גרפי", "מעצבת גרפית", "מעצב", "מעצבת"],
  },
  {
    template: "therapist",
    keywords: ["פסיכולוג", "פסיכולוגית", "פסיכותרפיה", "מטפל", "מטפלת", "טיפול"],
  },
];

/**
 * Suggests the profession template that best matches a free-text business
 * description, for the onboarding "we picked a design for you" nudge.
 * Never returns anything the user can't already see in the template
 * gallery, and never fabricates a match - an empty string or no keyword hit
 * returns 'general' (the current gold default, always safe to suggest since
 * it changes nothing).
 */
export function suggestTemplateForBusinessType(businessType: string): TemplateId {
  const text = (businessType || "").trim();
  if (!text) return "general";

  for (const rule of TEMPLATE_SUGGESTION_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return rule.template;
    }
  }
  return "general";
}

// ── The validated shape ──────────────────────────────────────────────────

export interface DocumentDesign {
  template: TemplateId;
  accent: AccentKey;
  font: FontKey;
  layout: LayoutKey;
  pattern: PatternKey;
  logoPosition: LogoPosition;
  /**
   * Exact brand colour (`#rrggbb`, lowercase) imported from a brand book
   * (2026-08-25). The one deliberate exception to "closed sets only": it is
   * not looked up from a map, but it is still never copied verbatim from
   * raw JSON into CSS - `normalizeDocumentDesign` admits it only through the
   * strict hex regex, and `designToCssVars` emits only colours it computed
   * from that validated value ({@link deriveAccentFamily}). When present it
   * replaces the `accent` family; `accent` keeps the nearest palette key so
   * the picker has a home for it. Absent (not undefined) when unused.
   */
  brandColor?: string;
}

function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TEMPLATE_MAP, v);
}
function isAccentKey(v: unknown): v is AccentKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ACCENT_HEX, v);
}
function isFontKey(v: unknown): v is FontKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(FONT_OPTIONS, v);
}
function isLayoutKey(v: unknown): v is LayoutKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LAYOUT_OPTIONS, v);
}
function isPatternKey(v: unknown): v is PatternKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PATTERN_OPTIONS, v);
}
function isLogoPosition(v: unknown): v is LogoPosition {
  return v === "right" || v === "center" || v === "left";
}

const BRAND_HEX_RE = /^#[0-9a-f]{6}$/;

/** Strict lowercase `#rrggbb` - the only shape a brand colour may take. */
export function isBrandHex(v: unknown): v is string {
  return typeof v === "string" && BRAND_HEX_RE.test(v);
}

/**
 * Coerces user/model-supplied colour text into the strict shape, or null.
 * Accepts `#RRGGBB` in any case and `#rgb` shorthand; rejects everything
 * else (names, rgb(), anything with a `)` - this value ends up in CSS).
 */
export function normalizeBrandHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (BRAND_HEX_RE.test(s)) return s;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return null;
}

/**
 * THE security boundary. Takes whatever came out of the `document_design`
 * JSONB column (or the public API's echo of it) - trust nothing about its
 * shape - and returns either `null` ("no theme chosen", render the
 * original gold design) or a `DocumentDesign` where every field is
 * GUARANTEED to be a member of a closed set declared in this file.
 *
 * Unknown/malformed template ids fall back to "general". Unknown/malformed
 * accent/font/layout fall back to the resolved template's own default. Unknown
 * logoPosition falls back to "right" (today's behaviour). Nothing here ever
 * returns a string it read off `raw` verbatim - every returned value is one
 * of the literal enum members checked against above.
 */
export function normalizeDocumentDesign(raw: unknown): DocumentDesign | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const r = raw as Record<string, unknown>;

  const template: TemplateId = isTemplateId(r.template) ? r.template : "general";
  const tpl = getTemplate(template);

  const accent: AccentKey = isAccentKey(r.accent) ? r.accent : tpl.accent;
  const font: FontKey = isFontKey(r.font) ? r.font : tpl.font;
  // Pre-2026-08-18 rows have no `layout` at all -> the template's own
  // default. null and "general" stay byte-identical to the legacy sheet
  // ("cards"); the other professions deliberately moved to their new
  // structures - that was the whole point of adding the axis.
  const layout: LayoutKey = isLayoutKey(r.layout) ? r.layout : tpl.layout;
  const pattern: PatternKey = isPatternKey(r.pattern) ? r.pattern : "none";
  const logoPosition: LogoPosition = isLogoPosition(r.logoPosition) ? r.logoPosition : "right";

  const design: DocumentDesign = { template, accent, font, layout, pattern, logoPosition };
  // Regex-gated, never verbatim: see the field's doc comment.
  const brandColor = normalizeBrandHex(r.brandColor);
  if (brandColor) design.brandColor = brandColor;
  return design;
}

// ── The CSS boundary ─────────────────────────────────────────────────────

/**
 * Maps a VALIDATED `DocumentDesign` to concrete CSS custom-property values.
 * Every value here is looked up from a closed map declared in this file
 * (ACCENT_HEX / FONT_OPTIONS / CORNER_VALUES / BORDER_VALUES / a template's
 * own `palette`) - this function never emits a string that isn't one of
 * those pre-authored values. `null` input (no design chosen) returns `{}`,
 * so the pre-existing hard-coded `.doc-paper` defaults in
 * document-paper.css keep applying unchanged.
 */
export function designToCssVars(design: DocumentDesign | null): Record<string, string> {
  if (!design) return {};

  const tpl = getTemplate(design.template);
  // A brand colour (already regex-validated by normalizeDocumentDesign; the
  // isBrandHex re-check keeps this function safe even for a hand-built
  // DocumentDesign) is expanded into a family by colour math from that one
  // value - still nothing copied through from untrusted input.
  const accentFamily =
    design.brandColor && isBrandHex(design.brandColor)
      ? deriveAccentFamily(design.brandColor)
      : (ACCENT_HEX[design.accent] ?? ACCENT_HEX[tpl.accent]);
  const corner = CORNER_VALUES[tpl.corner];
  const border = BORDER_VALUES[tpl.border];
  const chosen = FONT_OPTIONS[design.font] ?? FONT_OPTIONS[tpl.font];
  // Display-only faces (handwriting) never become the body font: the body
  // stays in the template's own default and only the name/number switch.
  const bodyFont = chosen.displayOnly ? FONT_OPTIONS[tpl.font] : chosen;

  // The name/number font only follows the template's special `nameFont`
  // when the user is still on the template's own default font. A deliberate
  // font override (picking something other than the template default)
  // applies uniformly, body and name alike - predictable, no hidden split -
  // except for display-only faces, whose whole point is the split.
  const usingTemplateDefaultFont = design.font === tpl.font;
  const nameFontKey = usingTemplateDefaultFont && tpl.nameFont ? tpl.nameFont : design.font;
  const nameFont = FONT_OPTIONS[nameFontKey] ?? bodyFont;

  return {
    "--d-ink": tpl.palette.ink,
    "--d-ink2": tpl.palette.ink2,
    "--d-soft": tpl.palette.soft,
    "--d-card": tpl.palette.card,
    "--d-cardline": tpl.palette.cardline,
    "--d-canvas": tpl.palette.canvas,
    "--d-gold": accentFamily.accent,
    "--d-gold-line": accentFamily.line,
    "--d-gold-faint": accentFamily.faint,
    "--d-gold-deep": accentFamily.deep,
    "--d-grad": accentFamily.grad,
    "--d-radius": corner.radius,
    "--d-badge-r": corner.badge,
    "--d-borderw": border.card,
    "--d-borderw-hdr": border.hdr,
    "--d-borderw-grand": border.grand,
    "--d-card-shadow": border.shadow,
    "--d-font": bodyFont.family,
    "--d-font-serif": nameFont.family,
    "--d-name-scale": String(nameFont.nameScale ?? 1),
    "--d-topbar-h": tpl.hairlineTop ? "1px" : "4px",
    "--d-topbar-bg": tpl.hairlineTop ? accentFamily.line : accentFamily.grad,
  };
}
