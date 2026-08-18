"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, Check, RotateCcw } from "lucide-react";
import { useBusiness, saveBusiness } from "@/lib/business-store";
import { getVatRate, calculateVat, round2 } from "@/lib/vat";
import {
  DOCUMENT_TEMPLATES,
  ACCENT_HEX,
  ACCENT_GROUPS,
  FONT_KEYS,
  FONT_OPTIONS,
  LAYOUT_KEYS,
  LAYOUT_OPTIONS,
  LOGO_POSITIONS,
  getTemplate,
  normalizeDocumentDesign,
  type DocumentDesign,
  type AccentKey,
  type FontKey,
  type LayoutKey,
  type LogoPosition,
} from "@/lib/document-themes";
import { LayoutGlyph } from "@/components/layout-glyph";
import { DocumentPreview, type PreviewClient } from "@/components/document-preview";
import type { DocumentItem } from "@/lib/types";

const DEFAULT_DESIGN: DocumentDesign = {
  template: "general",
  accent: "gold",
  font: "heebo",
  layout: "cards",
  logoPosition: "right",
};

// A fabricated document, never persisted, purely so the live preview shows
// the CHOSEN theme applied to something with real line items, a client and
// totals — the same reason document-preview.tsx's "new document" flow
// already uses `placeholders`. Uses the business's OWN name/logo/tax id
// (so the header the user sees is theirs), fake everything else.
const SAMPLE_CLIENT: PreviewClient = {
  name: "דנה כהן בע״מ",
  taxId: "514236987",
  address: "רח' ויצמן 22, רמת גן",
};
const SAMPLE_ITEMS: DocumentItem[] = [
  { id: "sample-1", description: "שירות ייעוץ חודשי", quantity: 1, unitPrice: 1800, total: 1800 },
  { id: "sample-2", description: "בניית תוכנית עבודה רבעונית", quantity: 1, unitPrice: 650, total: 650 },
];
const SAMPLE_SUBTOTAL = 2450;

const LOGO_POSITION_LABELS: Record<LogoPosition, string> = {
  right: "ימין",
  center: "מרכז",
  left: "שמאל",
};

const TAB_LABELS = { edit: "עריכה", preview: "תצוגה מקדימה" } as const;

export function DocumentDesignSection() {
  const { business, ready } = useBusiness();
  const [draft, setDraft] = useState<DocumentDesign>(DEFAULT_DESIGN);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const initialized = useRef(false);

  // Initialize the draft from the business's SAVED design exactly once,
  // when the business first loads — not on every refetch (a save
  // dispatches invoice-app:business-changed, which would otherwise
  // clobber further in-progress edits with the just-saved value; harmless
  // since they're equal right after a save, but wrong in general).
  useEffect(() => {
    if (ready && !initialized.current) {
      initialized.current = true;
      setDraft(normalizeDocumentDesign(business.documentDesign) ?? DEFAULT_DESIGN);
    }
  }, [ready, business.documentDesign]);

  const currentTemplate = getTemplate(draft.template);

  function chooseTemplate(id: DocumentDesign["template"]) {
    const tpl = getTemplate(id);
    // Picking a new template resets accent/font/layout to ITS defaults — a
    // fresh start for the new "character" — but keeps the user's own logo
    // position, which is a personal preference, not part of the template.
    setDraft((d) => ({
      ...d,
      template: id,
      accent: tpl.accent,
      font: tpl.font,
      layout: tpl.layout,
    }));
  }

  function chooseLayout(layout: LayoutKey) {
    setDraft((d) => ({ ...d, layout }));
  }

  function chooseAccent(accent: AccentKey) {
    setDraft((d) => ({ ...d, accent }));
  }

  function chooseFont(font: FontKey) {
    setDraft((d) => ({ ...d, font }));
  }

  function chooseLogoPosition(logoPosition: LogoPosition) {
    setDraft((d) => ({ ...d, logoPosition }));
  }

  function resetToDefault() {
    setDraft(DEFAULT_DESIGN);
  }

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await saveBusiness({ ...business, documentDesign: draft });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  const vatRate = getVatRate(business);
  const vat = vatRate > 0 ? calculateVat(SAMPLE_SUBTOTAL, vatRate) : 0;
  const previewBusiness = { ...business, documentDesign: draft };

  const editPanel = (
    <div className="space-y-6">
      {/* ── Template gallery ── */}
      <div>
        <h3 className="text-sm font-semibold text-stone-900 mb-3">תבנית לפי מקצוע</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {DOCUMENT_TEMPLATES.map((tpl) => {
            const selected = draft.template === tpl.id;
            const swatchHex = ACCENT_HEX[tpl.accent].accent;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => chooseTemplate(tpl.id)}
                aria-pressed={selected}
                className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-start transition-colors ${
                  selected
                    ? "border-orange-400 bg-orange-50/70"
                    : "border-stone-200 bg-white hover:border-orange-200 hover:bg-orange-50/30"
                }`}
              >
                <LayoutGlyph layout={tpl.layout} accent={swatchHex} className="flex-shrink-0" />
                <span className="text-xs font-semibold text-stone-800 leading-tight">
                  {tpl.label}
                </span>
                {selected && (
                  <Check className="w-3.5 h-3.5 text-orange-600 flex-shrink-0 mr-auto" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Layout (structure) override ── */}
      <div>
        <h3 className="text-sm font-semibold text-stone-900 mb-3">מבנה הדף</h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {LAYOUT_KEYS.map((key) => {
            const opt = LAYOUT_OPTIONS[key];
            const selected = draft.layout === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => chooseLayout(key)}
                aria-pressed={selected}
                title={opt.hint}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-2.5 transition-colors ${
                  selected
                    ? "border-orange-400 bg-orange-50/70"
                    : "border-stone-200 bg-white hover:border-orange-200 hover:bg-orange-50/30"
                }`}
              >
                <LayoutGlyph
                  layout={key}
                  accent={ACCENT_HEX[draft.accent].accent}
                  size={38}
                />
                <span className="text-[11px] font-semibold text-stone-800 leading-tight">
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Accent override ── */}
      <div>
        <h3 className="text-sm font-semibold text-stone-900 mb-3">צבע דגש</h3>
        <div className="space-y-3">
          {ACCENT_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="text-[11px] font-semibold text-stone-500 mb-1.5">{group.label}</div>
              <div className="flex flex-wrap gap-2">
                {group.keys.map((key) => {
                  const hex = ACCENT_HEX[key].accent;
                  const selected = draft.accent === key;
                  const isTemplateDefault = key === currentTemplate.accent;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => chooseAccent(key)}
                      aria-pressed={selected}
                      aria-label={key}
                      title={isTemplateDefault ? `${key} (ברירת המחדל של התבנית)` : key}
                      className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center transition-all ${
                        selected
                          ? "ring-2 ring-offset-2 ring-orange-400"
                          : isTemplateDefault
                            ? "ring-1 ring-offset-1 ring-stone-300 hover:scale-105"
                            : "hover:scale-105"
                      }`}
                      style={{ background: hex }}
                    >
                      {selected && <Check className="w-4 h-4 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Font ── */}
      <div>
        <h3 className="text-sm font-semibold text-stone-900 mb-3">גופן</h3>
        <div className="grid grid-cols-2 gap-2">
          {FONT_KEYS.map((key) => {
            const opt = FONT_OPTIONS[key];
            const selected = draft.font === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => chooseFont(key)}
                aria-pressed={selected}
                className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border-2 text-start transition-colors ${
                  selected
                    ? "border-orange-400 bg-orange-50/70"
                    : "border-stone-200 bg-white hover:border-orange-200"
                }`}
              >
                <span
                  className="text-base leading-tight text-stone-900 whitespace-nowrap"
                  style={{ fontFamily: opt.family, fontSize: opt.nameScale ? `${opt.nameScale}em` : undefined }}
                >
                  אסף קוטלר · 0118
                </span>
                <span className="text-[11px] text-stone-500 leading-tight">
                  {opt.label} · {opt.hint}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-stone-500 mt-2">
          גופני כתב היד חלים על שם העסק ומספר המסמך בלבד; גוף המסמך נשאר בגופן קריא.
        </p>
      </div>

      {/* ── Logo position ── */}
      <div>
        <h3 className="text-sm font-semibold text-stone-900 mb-3">מיקום לוגו</h3>
        <div className="inline-flex rounded-xl border-2 border-stone-200 bg-white p-1">
          {LOGO_POSITIONS.map((pos) => {
            const selected = draft.logoPosition === pos;
            return (
              <button
                key={pos}
                type="button"
                onClick={() => chooseLogoPosition(pos)}
                aria-pressed={selected}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selected ? "bg-orange-100 text-orange-800" : "text-stone-600 hover:bg-stone-50"
                }`}
              >
                {LOGO_POSITION_LABELS[pos]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const previewPanel = (
    <div className="lg:sticky lg:top-4">
      <DocumentPreview
        business={previewBusiness}
        client={SAMPLE_CLIENT}
        documentType="tax_invoice_receipt"
        date={new Date().toISOString().slice(0, 10)}
        subject="ליווי עסקי - רבעון נוכחי"
        items={SAMPLE_ITEMS}
        subtotal={SAMPLE_SUBTOTAL}
        vat={vat}
        vatRate={vatRate}
        total={round2(SAMPLE_SUBTOTAL + vat)}
      />
      <p className="text-xs text-stone-500 mt-2 text-center">
        תצוגה מקדימה עם נתוני דוגמה, לא מסמך אמיתי
      </p>
    </div>
  );

  return (
    <div className="card-soft p-6">
      <div className="flex items-center justify-between pb-4 border-b border-orange-100 mb-4 flex-wrap gap-2">
        <h2 className="font-semibold text-stone-900 flex items-center gap-2">
          <Palette className="w-4 h-4 text-orange-500" />
          עיצוב מסמכים
        </h2>
        <button
          type="button"
          onClick={resetToDefault}
          className="inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-100"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          איפוס לעיצוב המקורי
        </button>
      </div>

      <p className="text-sm text-stone-700 mb-4">
        בחר תבנית עיצוב המותאמת לתחום העיסוק שלך. משפיע על כל המסמכים החדשים בלבד, לא על
        מסמכים שכבר הופקו. אם לא בוחרים כלום, המסמכים ממשיכים להיראות בדיוק כמו היום.
      </p>

      {/* Mobile: Preview/Edit segmented toggle, full-width single panel.
          Desktop (lg+): both panels side by side, toggle bar hidden. */}
      <div className="lg:hidden inline-flex rounded-xl border-2 border-stone-200 bg-white p-1 mb-4">
        {(Object.keys(TAB_LABELS) as Array<keyof typeof TAB_LABELS>).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mobileTab === tab ? "bg-orange-100 text-orange-800" : "text-stone-600"
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className={mobileTab === "edit" ? "block" : "hidden lg:block"}>{editPanel}</div>
        <div className={mobileTab === "preview" ? "block" : "hidden lg:block"}>{previewPanel}</div>
      </div>

      {saveError && (
        <div className="mt-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
          {saveError}
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-orange-100 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:shadow-none ${
            justSaved
              ? "bg-emerald-600"
              : "bg-gradient-to-l from-orange-500 to-rose-500 hover:shadow-md hover:shadow-orange-200 disabled:opacity-60"
          }`}
        >
          {justSaved ? "נשמר ✓" : saving ? "שומר..." : "שמור עיצוב"}
        </button>
      </div>
    </div>
  );
}
