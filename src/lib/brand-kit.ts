/**
 * Brand-book import (2026-08-25, Asaf: "import the person's brand book so
 * the document is designed automatically with their fonts, colours and
 * logo, in one go").
 *
 * Isomorphic half: the validated BrandKit shape the server returns, and the
 * pure mapping from that kit onto the closed-set DocumentDesign. The model
 * call itself lives in brand-extract.ts (server only).
 *
 * The app cannot load arbitrary webfonts, so a brand font is mapped to the
 * closest of the ten faces it ships. Colours are different: the exact brand
 * hex is kept (DocumentDesign.brandColor) because "close" is not what a
 * brand colour means to its owner.
 */
import {
  FONT_OPTIONS,
  nearestAccentKey,
  normalizeBrandHex,
  type DocumentDesign,
  type FontKey,
} from "./document-themes";

export type BrandFontStyle = "sans" | "serif" | "rounded" | "handwritten" | "mono" | "display" | "unknown";
export type BrandFontRole = "heading" | "body" | "other";
export type BrandColorRole = "primary" | "secondary" | "accent" | "neutral" | "other";
export type BrandStyle = "minimal" | "classic" | "playful" | "technical" | "elegant" | "bold" | "unknown";

export interface BrandFont {
  name: string;
  role: BrandFontRole;
  style: BrandFontStyle;
}

export interface BrandColor {
  /** Strict lowercase #rrggbb (normalizeBrandHex). */
  hex: string;
  role: BrandColorRole;
  /** true when the model read the swatch visually rather than a printed value. */
  estimated: boolean;
}

export interface BrandKit {
  colors: BrandColor[];
  fonts: BrandFont[];
  style: BrandStyle;
  hasLogo: boolean;
  logoDescription: string | null;
  businessName: string | null;
  /** One short Hebrew sentence for the user about anything ambiguous. */
  notes: string | null;
}

export const BRAND_FONT_STYLES: BrandFontStyle[] = ["sans", "serif", "rounded", "handwritten", "mono", "display", "unknown"];
export const BRAND_FONT_ROLES: BrandFontRole[] = ["heading", "body", "other"];
export const BRAND_COLOR_ROLES: BrandColorRole[] = ["primary", "secondary", "accent", "neutral", "other"];
export const BRAND_STYLES: BrandStyle[] = ["minimal", "classic", "playful", "technical", "elegant", "bold", "unknown"];

const MAX_COLORS = 8;
const MAX_FONTS = 6;
const MAX_TEXT = 200;

function clampText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_TEXT) : null;
}

function oneOf<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Turns the model's raw JSON into a BrandKit, trusting nothing: hexes go
 * through normalizeBrandHex, enums through allow-lists, free text is
 * whitespace-collapsed and capped. Exported for unit tests.
 */
export function interpretRawBrandKit(raw: unknown): BrandKit {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  const colors: BrandColor[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(r.colors) ? r.colors : []) {
    if (colors.length >= MAX_COLORS) break;
    const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const hex = normalizeBrandHex(o.hex);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    colors.push({ hex, role: oneOf(o.role, BRAND_COLOR_ROLES, "other"), estimated: o.estimated === true });
  }

  const fonts: BrandFont[] = [];
  for (const f of Array.isArray(r.fonts) ? r.fonts : []) {
    if (fonts.length >= MAX_FONTS) break;
    const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const name = clampText(o.name);
    if (!name) continue;
    fonts.push({ name, role: oneOf(o.role, BRAND_FONT_ROLES, "other"), style: oneOf(o.style, BRAND_FONT_STYLES, "unknown") });
  }

  return {
    colors,
    fonts,
    style: oneOf(r.style, BRAND_STYLES, "unknown"),
    hasLogo: r.hasLogo === true,
    logoDescription: clampText(r.logoDescription),
    businessName: clampText(r.businessName),
    notes: clampText(r.notes),
  };
}

/** The colour the documents should be accented with, or null. */
export function primaryBrandColor(kit: BrandKit): string | null {
  const byRole = (role: BrandColorRole) => kit.colors.find((c) => c.role === role)?.hex ?? null;
  return byRole("primary") ?? byRole("accent") ?? byRole("secondary") ?? kit.colors.find((c) => c.role !== "neutral")?.hex ?? null;
}

// Brand faces the app cannot load, mapped to the nearest of its own ten.
// Order matters: first match wins, so the app's own faces come first.
const NAME_TO_KEY: [RegExp, FontKey][] = [
  [/heebo/, "heebo"],
  [/rubik/, "rubik"],
  [/assistant/, "assistant"],
  [/(^|[^a-z])alef([^a-z]|$)/, "alef"],
  [/varela/, "varela"],
  [/plex/, "plex"],
  [/frank/, "frank"],
  [/miriam/, "miriam"],
  [/playpen/, "playpen"],
  [/amatic/, "amatic"],
  [/mono|courier|consolas|jetbrains|fira code|menlo|space grotesk/, "plex"],
  [/dancing|pacifico|caveat|kalam|satisfy|great vibes|handlee|indie flower|shadows into|brush|script|hand/, "playpen"],
  [/times|georgia|garamond|playfair|merriweather|david|narkis|hadassah|lora|cormorant|baskerville|bodoni|didot|cardo|suez|shlomo|taamey|crimson|spectral|serif/, "frank"],
  [/poppins|nunito|quicksand|comfortaa|fredoka|baloo|secular|varela/, "varela"],
  [/montserrat|futura|gotham|proxima|avenir|raleway|josefin|circular|gilroy|sora|century gothic/, "alef"],
  [/oswald|bebas|barlow|anton|archivo|league|fira sans|work sans|manrope|dm sans|condensed/, "assistant"],
  [/open sans|arial|helvetica|inter|roboto|noto|segoe|lato|source sans|almoni|simpler|pf din|(^|[^a-z])din([^a-z]|$)|arimo|ubuntu|calibri|verdana|tahoma|sans/, "heebo"],
];

const STYLE_TO_KEY: Record<BrandFontStyle, FontKey> = {
  sans: "heebo",
  serif: "frank",
  rounded: "varela",
  handwritten: "playpen",
  mono: "plex",
  display: "rubik",
  unknown: "heebo",
};

function matchOne(font: BrandFont): { key: FontKey; exact: boolean } | null {
  const n = font.name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  for (const [re, key] of NAME_TO_KEY) {
    if (re.test(n)) return { key, exact: FONT_OPTIONS[key].label.toLowerCase() === n || re.source.includes(key) };
  }
  if (font.style !== "unknown") return { key: STYLE_TO_KEY[font.style], exact: false };
  return null;
}

/**
 * Picks the app font for a brand kit. The body face wins over the heading
 * face because the document body is what has to stay readable; a heading
 * face that maps to a handwriting font is fine (those apply to the business
 * name and number only).
 */
export function matchBrandFont(fonts: BrandFont[]): { key: FontKey; reason: string } {
  const ordered = [...fonts].sort((a, b) => rank(a.role) - rank(b.role));
  for (const f of ordered) {
    const m = matchOne(f);
    if (!m) continue;
    const label = FONT_OPTIONS[m.key].label;
    return {
      key: m.key,
      reason: m.exact ? `גופן: ${label} (כמו בקובץ המיתוג)` : `גופן: ${f.name} -> ${label} (הקרוב ביותר מבין גופני האפליקציה)`,
    };
  }
  return { key: "heebo", reason: fonts.length ? `גופן: לא זוהה גופן מוכר (${fonts[0].name}), נשאר Heebo` : "גופן: לא צוין בקובץ המיתוג, נשאר Heebo" };
}

function rank(role: BrandFontRole): number {
  return role === "body" ? 0 : role === "heading" ? 1 : 2;
}

export interface BrandApplication {
  design: DocumentDesign;
  /** Hebrew lines describing what changed, for the import panel. */
  summary: string[];
}

/**
 * Applies a kit to the in-progress design: exact brand colour (+ nearest
 * palette key), mapped font, and no decorative background (a pattern fights
 * a brand). Template, layout and logo position are the user's own choices
 * and stay untouched.
 */
export function applyBrandKit(draft: DocumentDesign, kit: BrandKit): BrandApplication {
  const summary: string[] = [];
  const next: DocumentDesign = { ...draft };

  const primary = primaryBrandColor(kit);
  if (primary) {
    next.brandColor = primary;
    next.accent = nearestAccentKey(primary);
    const estimated = kit.colors.find((c) => c.hex === primary)?.estimated;
    summary.push(`צבע דגש: ${primary}${estimated ? " (הוערך מהמראה, לא מערך מודפס)" : ""}`);
  } else {
    summary.push("צבע: לא נמצא צבע מותג בקובץ, צבע הדגש לא שונה");
  }

  const font = matchBrandFont(kit.fonts);
  next.font = font.key;
  summary.push(font.reason);

  if (draft.pattern !== "none") {
    next.pattern = "none";
    summary.push("רקע: בוטל הרקע הדקורטיבי כדי לא להתחרות במיתוג");
  }

  return { design: next, summary };
}
