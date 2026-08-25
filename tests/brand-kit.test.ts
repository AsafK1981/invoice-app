import { describe, it, expect } from "vitest";
import {
  normalizeDocumentDesign,
  designToCssVars,
  deriveAccentFamily,
  nearestAccentKey,
  normalizeBrandHex,
  ACCENT_HEX,
  type DocumentDesign,
} from "@/lib/document-themes";
import { applyBrandKit, interpretRawBrandKit, matchBrandFont, primaryBrandColor, type BrandKit } from "@/lib/brand-kit";

const HEX = /^#[0-9a-f]{6}$/;

const BASE: DocumentDesign = {
  template: "general",
  accent: "gold",
  font: "heebo",
  layout: "cards",
  pattern: "topo",
  logoPosition: "right",
};

describe("brand colour: the one non-closed-set field stays regex-gated", () => {
  it("normalizeBrandHex accepts #RRGGBB / #rgb only", () => {
    expect(normalizeBrandHex("#1B2A4A")).toBe("#1b2a4a");
    expect(normalizeBrandHex(" #abc ")).toBe("#aabbcc");
    for (const bad of ["red", "#abcd", "1b2a4a", "#1b2a4a)", "url(x)", "#1b2a4a; color: red", 12, null, undefined, "#ggg"]) {
      expect(normalizeBrandHex(bad), String(bad)).toBeNull();
    }
  });

  it("normalizeDocumentDesign keeps a valid brandColor and drops an invalid one (no key at all)", () => {
    const ok = normalizeDocumentDesign({ ...BASE, brandColor: "#DB2777" })!;
    expect(ok.brandColor).toBe("#db2777");
    const bad = normalizeDocumentDesign({ ...BASE, brandColor: "expression(alert(1))" })!;
    expect("brandColor" in bad).toBe(false);
    const legacy = normalizeDocumentDesign(BASE)!;
    expect(legacy).toEqual(BASE);
  });

  it("designToCssVars uses the brand family when present, the palette otherwise", () => {
    const withBrand = designToCssVars({ ...BASE, brandColor: "#1b2a4a" });
    expect(withBrand["--d-gold"]).toBe("#1b2a4a");
    expect(withBrand["--d-gold-faint"]).toMatch(HEX);
    const without = designToCssVars(BASE);
    expect(without["--d-gold"]).toBe(ACCENT_HEX.gold.accent);
  });

  it("deriveAccentFamily emits only computed hex/gradient values and darkens light brand colours for text", () => {
    const fam = deriveAccentFamily("#ffd700"); // bright yellow
    for (const k of ["accent", "line", "faint", "deep"] as const) expect(fam[k]).toMatch(HEX);
    expect(fam.grad).toMatch(/^linear-gradient\(/);
    expect(fam.accent).not.toBe("#ffd700"); // pulled down to read on white
    const navy = deriveAccentFamily("#1b2a4a");
    expect(navy.accent).toBe("#1b2a4a"); // already dark: kept exact
    expect(navy.faint > navy.line).toBe(true); // tint lighter than hairline (hex compares by channel here)
  });

  it("nearestAccentKey lands on the obvious palette neighbour", () => {
    expect(nearestAccentKey("#1b2a4a")).toBe("navy");
    expect(nearestAccentKey("#db2777")).toBe("pink");
    expect(nearestAccentKey("#059669")).toBe("emerald");
  });
});

describe("interpretRawBrandKit: trusts nothing from the model", () => {
  it("normalizes hexes, drops junk, dedupes, caps lists and text", () => {
    const kit = interpretRawBrandKit({
      colors: [
        { hex: "#1B2A4A", role: "primary", estimated: false },
        { hex: "#1b2a4a", role: "primary", estimated: true }, // dupe
        { hex: "red", role: "accent" },
        { hex: "#C9A15A", role: "not-a-role", estimated: "yes" },
      ],
      fonts: [{ name: "  Rubik   Bold ", role: "body", style: "sans" }, { name: 7 }, { name: "x", role: "heading", style: "weird" }],
      style: "elegant",
      hasLogo: "true",
      logoDescription: "a".repeat(500),
      businessName: null,
      notes: "הברנדבוק לא מציין גופן",
    });
    expect(kit.colors).toEqual([
      { hex: "#1b2a4a", role: "primary", estimated: false },
      { hex: "#c9a15a", role: "other", estimated: false },
    ]);
    expect(kit.fonts).toEqual([
      { name: "Rubik Bold", role: "body", style: "sans" },
      { name: "x", role: "heading", style: "unknown" },
    ]);
    expect(kit.hasLogo).toBe(false);
    expect(kit.logoDescription!.length).toBe(200);
    expect(kit.style).toBe("elegant");
    expect(interpretRawBrandKit("garbage").colors).toEqual([]);
  });
});

describe("font mapping onto the app's ten faces", () => {
  const f = (name: string, role: "heading" | "body" | "other" = "body", style: BrandKit["fonts"][number]["style"] = "unknown") => ({ name, role, style });

  it("exact app faces win, body before heading", () => {
    expect(matchBrandFont([f("Playpen Sans", "heading"), f("Rubik", "body")]).key).toBe("rubik");
    expect(matchBrandFont([f("Frank Ruhl Libre", "heading")]).key).toBe("frank");
  });

  it("well-known brand faces map to the nearest look", () => {
    expect(matchBrandFont([f("Montserrat")]).key).toBe("alef");
    expect(matchBrandFont([f("Open Sans")]).key).toBe("heebo");
    expect(matchBrandFont([f("Playfair Display")]).key).toBe("frank");
    expect(matchBrandFont([f("Poppins")]).key).toBe("varela");
    expect(matchBrandFont([f("Dancing Script")]).key).toBe("playpen");
    expect(matchBrandFont([f("JetBrains Mono")]).key).toBe("plex");
  });

  it("falls back to the declared style, then to Heebo", () => {
    expect(matchBrandFont([f("Almoni Neue", "body", "rounded")]).key).toBe("heebo"); // almoni is a known sans
    expect(matchBrandFont([f("Zzz Unknown", "body", "serif")]).key).toBe("frank");
    expect(matchBrandFont([f("Zzz Unknown", "body", "unknown")]).key).toBe("heebo");
    expect(matchBrandFont([]).key).toBe("heebo");
  });
});

describe("applyBrandKit", () => {
  const kit: BrandKit = {
    colors: [
      { hex: "#f5f5f5", role: "neutral", estimated: false },
      { hex: "#1b2a4a", role: "primary", estimated: false },
    ],
    fonts: [{ name: "Assistant", role: "body", style: "sans" }],
    style: "classic",
    hasLogo: true,
    logoDescription: null,
    businessName: null,
    notes: null,
  };

  it("sets the exact brand colour, its nearest palette key, the font, and clears the pattern", () => {
    expect(primaryBrandColor(kit)).toBe("#1b2a4a");
    const { design, summary } = applyBrandKit(BASE, kit);
    expect(design.brandColor).toBe("#1b2a4a");
    expect(design.accent).toBe("navy");
    expect(design.font).toBe("assistant");
    expect(design.pattern).toBe("none");
    expect(design.template).toBe(BASE.template);
    expect(design.layout).toBe(BASE.layout);
    expect(summary.join("\n")).toContain("#1b2a4a");
    // The applied design survives the security boundary unchanged.
    expect(normalizeDocumentDesign(design)).toEqual(design);
  });

  it("leaves the accent alone when the kit has no usable colour", () => {
    const { design } = applyBrandKit(BASE, { ...kit, colors: [{ hex: "#ffffff", role: "neutral", estimated: false }] });
    expect(design.brandColor).toBeUndefined();
    expect(design.accent).toBe("gold");
  });
});
