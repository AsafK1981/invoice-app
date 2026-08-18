/**
 * Profession-tailored document design — CLOSED SETS ONLY.
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
 * the enum values declared below — never a pass-through of the input. The
 * only function allowed to turn a `DocumentDesign` into CSS is
 * {@link designToCssVars}; it only ever emits values it looked up from the
 * closed maps in this file, never a string that flowed in from outside.
 *
 * `null` (the column's default, and what every existing business has today)
 * means "no theme chosen" and must render byte-for-byte identically to the
 * design before this feature existed — the existing gold look. An explicit
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
// could inject — the family members for the 9 templates with no exact
// mockup reference are derived from one base hex via pure, deterministic
// color math (mix-with-white / mix-with-black), never from user input.

export type AccentKey =
  | "gold"
  | "navy"
  | "sage"
  | "violet"
  | "slate"
  | "charcoal"
  | "amberDeep"
  | "amber"
  | "rose"
  | "terracotta"
  | "coral"
  | "coachGold"
  | "blue"
  | "mint"
  | "graphite"
  | "teal"
  | "fuchsia";

interface AccentFamily {
  /** hex, e.g. "#8a6d26" — text/badge/glabel/totals color */
  accent: string;
  /** hex — thin rule/border color (table header underline, card border on the "paid" block) */
  line: string;
  /** hex — very light tint (glabel underline fade, table header background on bold templates) */
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

/** Mix `hex` toward black by `amount` (0..1). Pure, deterministic. */
function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => Math.round(c * (1 - amount));
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

/** Derive a full family from one base hex, following the shape of the
 *  hand-authored families below (line ≈ +55% white, faint ≈ +88% white,
 *  a 4-stop diagonal gradient echoing the original gold top bar). */
function deriveAccentFamily(base: string): AccentFamily {
  const line = lighten(base, 0.55);
  const faint = lighten(base, 0.88);
  const gradLight = lighten(base, 0.3);
  const gradDark = darken(base, 0.28);
  const gradLight2 = lighten(base, 0.18);
  return {
    accent: base,
    line,
    faint,
    deep: darken(base, 0.3),
    grad: `linear-gradient(177deg, ${gradLight} 0%, ${base} 42%, ${gradDark} 78%, ${gradLight2} 100%)`,
  };
}

/** The closed set of accent families. Exact hex triples are reused verbatim
 *  from the approved template gallery mockup where one exists; the rest are
 *  derived (see {@link deriveAccentFamily}) from the base hex specified in
 *  the product brief. This map is the ONLY source of accent CSS values —
 *  `normalizeDocumentDesign` checks membership here, `designToCssVars` only
 *  ever reads from here. */
export const ACCENT_HEX: Record<AccentKey, AccentFamily> = {
  gold: {
    accent: "#8a6d26",
    line: "#c9ab63",
    faint: "#e7dcbf",
    grad: "linear-gradient(177deg, #d8be77 0%, #be9e4e 42%, #8f6f2a 78%, #cbb061 100%)",
    deep: "#6a5320",
  },
  navy: {
    accent: "#1b2a4a",
    line: "#8a95b3",
    faint: "#dde1eb",
    grad: "linear-gradient(177deg, #1b2a4a 0%, #2a3d63 50%, #16213a 100%)",
    deep: "#131d33",
  },
  sage: {
    accent: "#62795f",
    line: "#b9cab3",
    faint: "#e7efe3",
    grad: "linear-gradient(177deg, #a9c0a2 0%, #7c9885 42%, #5e7a5b 78%, #9db597 100%)",
    deep: "#495b47",
  },
  violet: {
    accent: "#6c4ff6",
    line: "#bcaef9",
    faint: "#ece7fe",
    grad: "linear-gradient(177deg, #9c85fb 0%, #6c4ff6 42%, #4a2fd6 78%, #8b6ff9 100%)",
    deep: "#4a2fd6",
  },
  slate: {
    accent: "#34506b",
    line: "#9db2c4",
    faint: "#e1e9ef",
    grad: "linear-gradient(177deg, #6f92ac 0%, #4a6c86 42%, #2c4056 78%, #6786a0 100%)",
    deep: "#263a4e",
  },
  charcoal: {
    accent: "#1a1a1a",
    line: "#c9a15a",
    faint: "#ece3d0",
    grad: "#c9a15a",
    deep: "#111111",
  },
  amberDeep: {
    accent: "#8a5f07",
    line: "#b8860b",
    faint: "#f2e0b3",
    grad: "linear-gradient(177deg, #d9a52a 0%, #b8860b 50%, #8a5f07 100%)",
    deep: "#5f4104",
  },
  amber: deriveAccentFamily("#d98a3d"),
  rose: deriveAccentFamily("#c77b8b"),
  terracotta: deriveAccentFamily("#b8734f"),
  coral: deriveAccentFamily("#f2643b"),
  coachGold: deriveAccentFamily("#d9a404"),
  blue: deriveAccentFamily("#3e7cb1"),
  mint: deriveAccentFamily("#6fa287"),
  graphite: deriveAccentFamily("#2b2b2b"),
  teal: deriveAccentFamily("#0ea5a5"),
  fuchsia: deriveAccentFamily("#d6336c"),
};

/** ~6-7 curated accent options offered as override dots in Settings, drawn
 *  from the palette above. The UI unions this with the current template's
 *  own accent (so the swatch row can always get back to the template
 *  default even when it isn't one of these seven). */
export const ACCENT_SWATCHES: Partial<Record<AccentKey, string>> = {
  gold: ACCENT_HEX.gold.accent,
  navy: ACCENT_HEX.navy.accent,
  slate: ACCENT_HEX.slate.accent,
  sage: ACCENT_HEX.sage.accent,
  terracotta: ACCENT_HEX.terracotta.accent,
  violet: ACCENT_HEX.violet.accent,
  charcoal: ACCENT_HEX.charcoal.accent,
};

// ── Font keys ────────────────────────────────────────────────────────────
// Exactly the curated Hebrew-capable shortlist. heebo/frank/assistant are
// already self-hosted (src/app/layout.tsx); rubik/miriam are added by this
// feature under src/app/fonts/{rubik,miriam-libre}/, same self-hosted
// next/font/local pattern — no Google Fonts CDN call at request time.

export type FontKey = "heebo" | "rubik" | "assistant" | "frank" | "miriam";

export const FONT_OPTIONS: Record<FontKey, { family: string; label: string }> = {
  heebo: { family: 'var(--font-heebo), "Heebo", system-ui, sans-serif', label: "Heebo" },
  rubik: { family: 'var(--font-rubik), "Rubik", system-ui, sans-serif', label: "Rubik" },
  assistant: {
    family: 'var(--font-assistant), "Assistant", system-ui, sans-serif',
    label: "Assistant",
  },
  frank: {
    family: 'var(--font-frank), "Frank Ruhl Libre", Georgia, serif',
    label: "Frank Ruhl Libre",
  },
  miriam: {
    family: 'var(--font-miriam), "Miriam Libre", Georgia, serif',
    label: "Miriam Libre",
  },
};

// ── Logo position ────────────────────────────────────────────────────────

export type LogoPosition = "right" | "center" | "left";
export const LOGO_POSITIONS: LogoPosition[] = ["right", "center", "left"];

// ── Corner / border closed buckets ──────────────────────────────────────
// The product brief describes `corner` abstractly as 'sharp'|'soft'|'round',
// but the concrete 15-template table also uses a 4th value ("normal") for
// marketing/accountant/developer, meaning "no special corner treatment —
// keep the current default". Rather than force those three into 'soft' or
// 'round' (which would misrepresent them), 'normal' is kept as its own
// bucket equal to the pre-feature baseline (16px / 3px badge radius).
// Corner and border are NOT independently user-choosable — they are baked
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
   * else) — Miriam Libre's ₪ glyph renders as a visibly split ש/ח, which is
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
  ink: "#211c15",
  ink2: "#514a3d",
  soft: "#6f6857",
  card: "#ffffff",
  cardline: "#e8e1d0",
  canvas: "#efece4",
};

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "general",
    label: "כללי / ברירת מחדל",
    accent: "gold",
    font: "heebo",
    // Business name / doc number stay Frank Ruhl Libre, matching the legacy
    // (null-design) look exactly. Without this, an explicit {template:general}
    // (what the "reset to original" button persists) would silently fall the
    // .doc-serif elements back to Heebo — a visible font change vs. null.
    nameFont: "frank",
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
    accent: "coral",
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
    accent: "coachGold",
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
    accent: "mint",
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
// types into an optional "תחום עיסוק" onboarding field — NOT the
// Business["businessType"] tax-status enum, which is unrelated:
// exempt/authorized/company say nothing about profession) to the closest
// matching profession template. Pure keyword/substring matching, no ML, no
// network call — deterministic and instant.
//
// Groups are checked in priority order, most specific/least ambiguous
// first, so a phrase that could plausibly match two groups (e.g. "מעצב/ת
// פנים" containing both "מעצב" and being about interior design) resolves to
// the more specific one (architect) before the broader one (designer) gets
// a chance. This is a best-effort heuristic for a one-tap suggestion, not a
// security boundary — an unmatched or ambiguous input always falls back to
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
 * gallery, and never fabricates a match — an empty string or no keyword hit
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
  logoPosition: LogoPosition;
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
function isLogoPosition(v: unknown): v is LogoPosition {
  return v === "right" || v === "center" || v === "left";
}

/**
 * THE security boundary. Takes whatever came out of the `document_design`
 * JSONB column (or the public API's echo of it) — trust nothing about its
 * shape — and returns either `null` ("no theme chosen", render the
 * original gold design) or a `DocumentDesign` where every field is
 * GUARANTEED to be a member of a closed set declared in this file.
 *
 * Unknown/malformed template ids fall back to "general". Unknown/malformed
 * accent/font/layout fall back to the resolved template's own default. Unknown
 * logoPosition falls back to "right" (today's behaviour). Nothing here ever
 * returns a string it read off `raw` verbatim — every returned value is one
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
  const logoPosition: LogoPosition = isLogoPosition(r.logoPosition) ? r.logoPosition : "right";

  return { template, accent, font, layout, logoPosition };
}

// ── The CSS boundary ─────────────────────────────────────────────────────

/**
 * Maps a VALIDATED `DocumentDesign` to concrete CSS custom-property values.
 * Every value here is looked up from a closed map declared in this file
 * (ACCENT_HEX / FONT_OPTIONS / CORNER_VALUES / BORDER_VALUES / a template's
 * own `palette`) — this function never emits a string that isn't one of
 * those pre-authored values. `null` input (no design chosen) returns `{}`,
 * so the pre-existing hard-coded `.doc-paper` defaults in
 * document-paper.css keep applying unchanged.
 */
export function designToCssVars(design: DocumentDesign | null): Record<string, string> {
  if (!design) return {};

  const tpl = getTemplate(design.template);
  const accentFamily = ACCENT_HEX[design.accent] ?? ACCENT_HEX[tpl.accent];
  const corner = CORNER_VALUES[tpl.corner];
  const border = BORDER_VALUES[tpl.border];
  const bodyFont = FONT_OPTIONS[design.font] ?? FONT_OPTIONS[tpl.font];

  // The name/number font only follows the template's special `nameFont`
  // when the user is still on the template's own default font. A deliberate
  // font override (picking something other than the template default)
  // applies uniformly, body and name alike — predictable, no hidden split.
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
    "--d-topbar-h": tpl.hairlineTop ? "1px" : "4px",
    "--d-topbar-bg": tpl.hairlineTop ? accentFamily.line : accentFamily.grad,
  };
}
