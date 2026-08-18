import { describe, it, expect } from "vitest";
import {
  normalizeDocumentDesign,
  designToCssVars,
  suggestTemplateForBusinessType,
  DOCUMENT_TEMPLATES,
  ACCENT_HEX,
  ACCENT_GROUPS,
  FONT_OPTIONS,
  LAYOUT_OPTIONS,
  getTemplate,
  type DocumentDesign,
  type TemplateId,
} from "@/lib/document-themes";

const HEX_RE = /^#[0-9a-f]{6}$/i;
const PX_RE = /^\d+(\.\d+)?px$/;
const GRAD_OR_HEX_RE = /^(linear-gradient\(.*\)|#[0-9a-f]{6})$/i;
const KNOWN_FONT_FAMILIES = new Set(Object.values(FONT_OPTIONS).map((f) => f.family));

describe("normalizeDocumentDesign: security boundary", () => {
  it("null/undefined input -> null (existing users, gold fallback)", () => {
    expect(normalizeDocumentDesign(null)).toBeNull();
    expect(normalizeDocumentDesign(undefined)).toBeNull();
  });

  it("non-object input -> null", () => {
    expect(normalizeDocumentDesign("general")).toBeNull();
    expect(normalizeDocumentDesign(42)).toBeNull();
    expect(normalizeDocumentDesign(true)).toBeNull();
    expect(normalizeDocumentDesign(["general"])).toBeNull();
  });

  it("empty object -> a full, valid design defaulting to general/gold/heebo/right", () => {
    const d = normalizeDocumentDesign({});
    expect(d).toEqual({
      template: "general",
      accent: "gold",
      font: "heebo",
      layout: "cards",
      pattern: "none",
      logoPosition: "right",
    });
  });

  it("accepts every real template id with its own default accent/font", () => {
    for (const tpl of DOCUMENT_TEMPLATES) {
      const d = normalizeDocumentDesign({ template: tpl.id });
      expect(d?.template).toBe(tpl.id);
      expect(d?.accent).toBe(tpl.accent);
      expect(d?.font).toBe(tpl.font);
    }
  });

  it("unknown template id coerces to general", () => {
    const d = normalizeDocumentDesign({ template: "<script>alert(1)</script>" });
    expect(d?.template).toBe("general");
  });

  it("SQL/JS injection-shaped strings never survive as any field value", () => {
    const raw = {
      template: "'; DROP TABLE businesses; --",
      accent: "javascript:alert(1)",
      font: "</style><script>evil()</script>",
      logoPosition: "url(javascript:alert(1))",
    };
    const d = normalizeDocumentDesign(raw);
    expect(d).not.toBeNull();
    // every field must be one of the closed enum values, never the raw string
    expect(d!.template).toBe("general");
    expect(d!.accent).not.toContain("javascript");
    expect(d!.font).not.toContain("script");
    expect(d!.logoPosition).not.toContain("url(");
    expect(["right", "center", "left"]).toContain(d!.logoPosition);
  });

  it("unknown accent falls back to the resolved template's own default accent", () => {
    const d = normalizeDocumentDesign({ template: "lawyer", accent: "hotpink" });
    expect(d?.accent).toBe(getTemplate("lawyer").accent);
  });

  it("unknown font falls back to the resolved template's own default font", () => {
    const d = normalizeDocumentDesign({ template: "photographer", font: "ComicSans" });
    expect(d?.font).toBe(getTemplate("photographer").font);
  });

  it("unknown logoPosition falls back to right", () => {
    const d = normalizeDocumentDesign({ logoPosition: "top" });
    expect(d?.logoPosition).toBe("right");
  });

  it("valid overrides pass through unchanged", () => {
    const d = normalizeDocumentDesign({
      template: "lawyer",
      accent: "sage",
      font: "assistant",
      layout: "editorial",
      pattern: "bubbles",
      logoPosition: "center",
    });
    expect(d).toEqual({
      template: "lawyer",
      accent: "sage",
      font: "assistant",
      layout: "editorial",
      pattern: "bubbles",
      logoPosition: "center",
    });
  });

  it("extra unknown keys on the raw object are ignored, not passed through", () => {
    const d = normalizeDocumentDesign({
      template: "general",
      customCss: "body { background: url(evil) }",
      __proto__: { polluted: true },
    } as unknown);
    expect(d).toEqual({
      template: "general",
      accent: "gold",
      font: "heebo",
      layout: "cards",
      pattern: "none",
      logoPosition: "right",
    });
    expect((d as unknown as Record<string, unknown>).customCss).toBeUndefined();
  });
});

describe("designToCssVars: only ever emits known-safe values", () => {
  it("null design -> {} (defaults in document-paper.css apply unchanged)", () => {
    expect(designToCssVars(null)).toEqual({});
  });

  it("every color var is a real hex or gradient/hex string, for every template", () => {
    for (const tpl of DOCUMENT_TEMPLATES) {
      const design: DocumentDesign = {
        template: tpl.id,
        accent: tpl.accent,
        font: tpl.font,
        layout: tpl.layout,
        pattern: "none",
        logoPosition: "right",
      };
      const vars = designToCssVars(design);
      for (const key of ["--d-ink", "--d-ink2", "--d-soft", "--d-card", "--d-cardline", "--d-canvas", "--d-gold", "--d-gold-line", "--d-gold-faint", "--d-gold-deep"]) {
        expect(vars[key], `${tpl.id} ${key}`).toMatch(HEX_RE);
      }
      expect(vars["--d-grad"], `${tpl.id} --d-grad`).toMatch(GRAD_OR_HEX_RE);
      expect(vars["--d-topbar-bg"], `${tpl.id} --d-topbar-bg`).toMatch(GRAD_OR_HEX_RE);
      for (const key of ["--d-radius", "--d-badge-r", "--d-borderw", "--d-borderw-hdr", "--d-borderw-grand", "--d-topbar-h"]) {
        expect(vars[key], `${tpl.id} ${key}`).toMatch(PX_RE);
      }
      expect(KNOWN_FONT_FAMILIES.has(vars["--d-font"]), `${tpl.id} --d-font`).toBe(true);
      expect(KNOWN_FONT_FAMILIES.has(vars["--d-font-serif"]), `${tpl.id} --d-font-serif`).toBe(true);
    }
  });

  it("adversarial-shaped (but pre-validated) design still only emits closed-set values", () => {
    // Simulates the output of normalizeDocumentDesign on hostile input: by
    // construction it can only ever contain enum members, but assert the
    // CSS layer doesn't independently trust anything beyond that either.
    const design = normalizeDocumentDesign({
      template: "'; DROP TABLE businesses;--",
      accent: "<img src=x onerror=alert(1)>",
      font: "url(javascript:alert(1))",
      logoPosition: "expression(alert(1))",
    })!;
    const vars = designToCssVars(design);
    const serialized = JSON.stringify(vars);
    expect(serialized).not.toMatch(/script|onerror|javascript:|expression\(/i);
  });

  it("photographer keeps the grand total / paid amount in the body font family even though the name uses Miriam Libre", () => {
    const design: DocumentDesign = {
      template: "photographer",
      accent: "charcoal",
      font: "heebo",
      layout: "editorial",
      pattern: "none",
      logoPosition: "right",
    };
    const vars = designToCssVars(design);
    expect(vars["--d-font"]).toBe(FONT_OPTIONS.heebo.family);
    expect(vars["--d-font-serif"]).toBe(FONT_OPTIONS.miriam.family);
  });

  it("overriding the font away from a template's default applies uniformly (no name-only split)", () => {
    const design: DocumentDesign = {
      template: "photographer",
      accent: "charcoal",
      font: "assistant", // user picked a different font than the template default (heebo)
      layout: "editorial",
      pattern: "none",
      logoPosition: "right",
    };
    const vars = designToCssVars(design);
    expect(vars["--d-font"]).toBe(FONT_OPTIONS.assistant.family);
    expect(vars["--d-font-serif"]).toBe(FONT_OPTIONS.assistant.family);
  });

  it("an explicit {template:general} design resolves to the exact document-paper.css defaults (null-fallback parity)", () => {
    const explicit = designToCssVars(normalizeDocumentDesign({ template: "general" }));
    // These are exactly the hardcoded defaults in document-paper.css's
    // `.doc-paper` base rule — the whole point of the null fallback. Every var
    // an explicit "general" emits must match, or the "reset to original design"
    // button (which persists {template:general}, not null) would silently
    // change the look. --d-font-serif in particular regressed to Heebo once.
    expect(explicit["--d-ink"]).toBe("#211c15");
    expect(explicit["--d-gold"]).toBe("#8a6d26");
    expect(explicit["--d-gold-line"]).toBe("#c9ab63");
    expect(explicit["--d-gold-faint"]).toBe("#e7dcbf");
    expect(explicit["--d-radius"]).toBe("16px");
    expect(explicit["--d-borderw-grand"]).toBe("2px");
    expect(explicit["--d-font"]).toBe(FONT_OPTIONS.heebo.family);
    expect(explicit["--d-font-serif"]).toBe(FONT_OPTIONS.frank.family);
  });
});

describe("suggestTemplateForBusinessType: onboarding auto-suggest", () => {
  const CASES: [string, TemplateId][] = [
    ["פסיכולוג קליני", "therapist"],
    ["מטפלת זוגית ומשפחתית", "therapist"],
    ["טיפול רגשי לילדים", "therapist"],
    ["מאמן כושר אישי", "fitness"],
    ["מדריכת פילאטיס", "fitness"],
    ["מורה ליוגה", "fitness"],
    ["קוסמטיקאית", "beauty"],
    ["מעצבת שיער", "beauty"],
    ["בעלת מספרה", "beauty"],
    ["רפואה משלימה - שיאצו", "altmed"],
    ["רפלקסולוגית", "altmed"],
    ["נטורופת", "altmed"],
    ["מעצב גרפי פרילנסר", "designer"],
    ["מעצבת לוגואים ומיתוג", "designer"],
    ["צלם חתונות", "photographer"],
    ["צלמת אירועים", "photographer"],
    ["ייעוץ שיווק דיגיטלי", "marketing"],
    ["מנהלת סושיאל מדיה", "marketing"],
    ["מאמן עסקי", "coach"],
    ["ייעוץ עסקי לחברות סטארטאפ", "coach"],
    ["מורה פרטית למתמטיקה", "tutor"],
    ["חונך לבגרויות", "tutor"],
    ["דיאטנית קלינית", "dietitian"],
    ["ייעוץ תזונה", "dietitian"],
    ["חשמלאי מוסמך", "tradesperson"],
    ["איש אינסטלציה", "tradesperson"],
    ["קבלן שיפוצים", "tradesperson"],
    ["בעל מקצוע - נגרות", "tradesperson"],
    ["עורך דין נדל\"ן", "lawyer"],
    ["עו\"ד גירושין", "lawyer"],
    ["ייעוץ משפטי לעסקים", "lawyer"],
    ["רואה חשבון", "accountant"],
    ["הנהלת חשבונות לעסקים קטנים", "accountant"],
    ["יועץ מס", "accountant"],
    ["אדריכלית", "architect"],
    ["עיצוב פנים למשרדים", "architect"],
    ["מעצבת פנים", "architect"],
    ["מתכנת Full Stack", "developer"],
    ["פיתוח תוכנה", "developer"],
    ["איש הייטק", "developer"],
  ];

  it.each(CASES)("%s -> %s", (input, expected) => {
    expect(suggestTemplateForBusinessType(input)).toBe(expected);
  });

  it("empty/whitespace input -> general (never guess-forces a colored template)", () => {
    expect(suggestTemplateForBusinessType("")).toBe("general");
    expect(suggestTemplateForBusinessType("   ")).toBe("general");
  });

  it("no keyword match -> general", () => {
    expect(suggestTemplateForBusinessType("חנות ממתקים")).toBe("general");
    expect(suggestTemplateForBusinessType("אני לא יודע מה לכתוב כאן")).toBe("general");
  });

  it("architect wins over designer for interior-design phrasing", () => {
    // "מעצב/ת פנים" contains "מעצב", which is also a designer keyword — the
    // more specific architect rule must be checked first.
    expect(suggestTemplateForBusinessType("מעצב פנים")).toBe("architect");
  });

  it("every returned template id is a real, currently-defined template", () => {
    const ids = new Set(DOCUMENT_TEMPLATES.map((t) => t.id));
    for (const [input] of CASES) {
      expect(ids.has(suggestTemplateForBusinessType(input))).toBe(true);
    }
  });
});

describe("ACCENT_HEX / DOCUMENT_TEMPLATES data integrity", () => {
  it("every template's default accent exists in ACCENT_HEX", () => {
    for (const tpl of DOCUMENT_TEMPLATES) {
      expect(ACCENT_HEX[tpl.accent], tpl.id).toBeDefined();
    }
  });

  it("every template's default font exists in FONT_OPTIONS", () => {
    for (const tpl of DOCUMENT_TEMPLATES) {
      expect(FONT_OPTIONS[tpl.font], tpl.id).toBeDefined();
      if (tpl.nameFont) expect(FONT_OPTIONS[tpl.nameFont], `${tpl.id} nameFont`).toBeDefined();
    }
  });

  it("has exactly 17 templates (16 professions + general)", () => {
    expect(DOCUMENT_TEMPLATES.length).toBe(17);
  });

  it("every template's default layout is a known LayoutKey, and every layout family is used", () => {
    const used = new Set<string>();
    for (const tpl of DOCUMENT_TEMPLATES) {
      expect(LAYOUT_OPTIONS[tpl.layout], tpl.id).toBeDefined();
      used.add(tpl.layout);
    }
    for (const key of Object.keys(LAYOUT_OPTIONS)) expect(used.has(key), key).toBe(true);
  });

  it("general (and therefore null) stays on the legacy 'cards' structure", () => {
    expect(getTemplate("general").layout).toBe("cards");
    expect(normalizeDocumentDesign({ template: "general" })?.layout).toBe("cards");
  });

  it("layout: unknown/malformed -> the template's own default; a valid override sticks", () => {
    expect(normalizeDocumentDesign({ template: "lawyer", layout: "evil" })?.layout).toBe("ledger");
    expect(normalizeDocumentDesign({ template: "lawyer", layout: 7 })?.layout).toBe("ledger");
    expect(normalizeDocumentDesign({ template: "lawyer", layout: "stage" })?.layout).toBe("stage");
    expect(normalizeDocumentDesign({ template: "entertainer" })?.layout).toBe("stage");
  });

  it("display-only (handwriting) fonts switch only the name/number; the body stays on the template font", () => {
    const d = normalizeDocumentDesign({ template: "general", font: "amatic" })!;
    const vars = designToCssVars(d);
    expect(vars["--d-font"]).toBe(FONT_OPTIONS.heebo.family);
    expect(vars["--d-font-serif"]).toBe(FONT_OPTIONS.amatic.family);
    expect(vars["--d-name-scale"]).toBe("1.35");
    // a normal font override still applies uniformly
    const plain = designToCssVars(normalizeDocumentDesign({ template: "general", font: "plex" })!);
    expect(plain["--d-font"]).toBe(FONT_OPTIONS.plex.family);
    expect(plain["--d-font-serif"]).toBe(FONT_OPTIONS.plex.family);
    expect(plain["--d-name-scale"]).toBe("1");
  });

  it("every accent appears in exactly one swatch group, and every template accent is offered", () => {
    const seen = new Map<string, number>();
    for (const g of ACCENT_GROUPS) for (const k of g.keys) seen.set(k, (seen.get(k) ?? 0) + 1);
    for (const k of Object.keys(ACCENT_HEX)) expect(seen.get(k), k).toBe(1);
    for (const tpl of DOCUMENT_TEMPLATES) expect(seen.has(tpl.accent), tpl.id).toBe(true);
  });

  it("pattern: unknown/malformed -> none; valid sticks", () => {
    expect(normalizeDocumentDesign({ pattern: "evil" })?.pattern).toBe("none");
    expect(normalizeDocumentDesign({ pattern: 3 })?.pattern).toBe("none");
    expect(normalizeDocumentDesign({ pattern: "rings" })?.pattern).toBe("rings");
  });

  it("entertainer keywords route musicians / singers / actors to the stage template", () => {
    for (const s of ["מוזיקאי", "זמרת אורחת", "שחקן תיאטרון", "DJ לאירועים", "אמן במה", "רקדנית"]) {
      expect(suggestTemplateForBusinessType(s), s).toBe("entertainer");
    }
  });

  it("template ids are unique", () => {
    const ids = DOCUMENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
