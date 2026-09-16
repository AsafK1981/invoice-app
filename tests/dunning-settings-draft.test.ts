import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canSaveDunningDraft,
  dunningDraftFromBusiness,
  isDunningDraftDirty,
} from "@/lib/dunning-settings-draft";

const saved = dunningDraftFromBusiness({ dunningEnabled: true, dunningFromName: "סטודיו", dunningPreDueEnabled: false });

describe("dunning settings Save button", () => {
  it("reads absent settings as off and empty", () => {
    expect(dunningDraftFromBusiness({})).toEqual({ enabled: false, fromName: "", preDue: false });
  });

  it("is disabled when the draft equals the saved values", () => {
    expect(isDunningDraftDirty({ ...saved }, saved)).toBe(false);
    expect(canSaveDunningDraft({ draft: { ...saved }, saved, saving: false })).toBe(false);
  });

  it("is enabled by any single change", () => {
    expect(canSaveDunningDraft({ draft: { ...saved, enabled: false }, saved, saving: false })).toBe(true);
    expect(canSaveDunningDraft({ draft: { ...saved, fromName: "סטודיו " }, saved, saving: false })).toBe(true);
    expect(canSaveDunningDraft({ draft: { ...saved, preDue: true }, saved, saving: false })).toBe(true);
  });

  it("is disabled again once a change is undone", () => {
    const changed = { ...saved, preDue: true };
    expect(canSaveDunningDraft({ draft: changed, saved, saving: false })).toBe(true);
    expect(canSaveDunningDraft({ draft: { ...changed, preDue: false }, saved, saving: false })).toBe(false);
  });

  it("is disabled while saving", () => {
    expect(canSaveDunningDraft({ draft: { ...saved, enabled: false }, saved, saving: true })).toBe(false);
  });

  it("the component wires the button to canSave", () => {
    const src = readFileSync(path.join(__dirname, "../src/components/dunning-settings-section.tsx"), "utf8");
    expect(src).toMatch(/disabled=\{!canSave\}/);
  });
});

/**
 * The disabled look lives in app-skin.css and has to OUTRANK the !important
 * fill rules for the same CTA classes; order alone does not decide between
 * two !important declarations of different specificity.
 */
describe("disabled orange CTA outranks its fill rules", () => {
  const css = readFileSync(path.join(__dirname, "../src/app/app-skin.css"), "utf8");

  // Specificity (ids, classes + pseudo-classes + attributes, elements) of a
  // simple selector list entry; enough for the selectors used here.
  function specificity(selector: string): [number, number, number] {
    let s = selector.replace(/:not\(([^)]*)\)/g, " $1 ");
    const ids = (s.match(/#[\w-]+/g) ?? []).length;
    const classes =
      (s.match(/\.[\w\\/-]+/g) ?? []).length +
      (s.match(/\[[^\]]+\]/g) ?? []).length +
      (s.match(/:(?!:)[\w-]+/g) ?? []).length;
    s = s.replace(/\.[\w\\/-]+|\[[^\]]+\]|:[\w-]+/g, " ");
    const elements = (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
    return [ids, classes, elements];
  }
  const beats = (a: string, b: string) => {
    const x = specificity(a);
    const y = specificity(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };

  const pairs: [string, string][] = [
    [
      "html button:disabled.from-orange-500.to-orange-700:not(.bg-clip-text)",
      "html .from-orange-500.to-orange-700:not(.bg-clip-text)",
    ],
    [
      "html button:disabled.from-orange-500.to-orange-700:not(.bg-clip-text):hover",
      "html .from-orange-500.to-orange-700:not(.bg-clip-text):hover",
    ],
    ["html button:disabled.from-orange-500.to-rose-500:hover", "html .from-orange-500.to-rose-500:hover"],
    ["html button:disabled.bg-orange-500", "html .bg-orange-500"],
  ];

  it.each(pairs)("%s is in the sheet and outranks %s", (disabled, fill) => {
    expect(css).toContain(fill);
    expect(css).toContain(disabled);
    expect(beats(disabled, fill)).toBe(true);
  });

  it("the specificity helper agrees with the known broken case", () => {
    // The pre-2026-09-16 rule lost to the fill rule.
    expect(beats("html button:disabled.from-orange-500", "html .from-orange-500.to-orange-700:not(.bg-clip-text)")).toBe(false);
  });
});
