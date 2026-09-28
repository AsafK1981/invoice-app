"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { LtrText } from "@/components/ui/ltr";

export type IncludedFeature = {
  key: string;
  icon: ReactNode;
  /** The full card title, shown in the open panel. */
  title: string;
  /** Two-to-three-word label shown under the tile icon. */
  short: string;
  body: string;
  tone?: string;
  flagship?: true;
  soon?: true;
};

/**
 * /pricing "מה כלול" as a compact strip of small icon tiles (2026-09-28,
 * Asaf: "תקטין את כל האייקונים... שפשוט אפשר יהיה ללחוץ עליהם כדי לפתוח
 * ולקרוא מה זה אומר... שזה יהיה קטן יותר וייכנס בדף"). The twelve full
 * advantage cards took two screens; now the same twelve items sit in two
 * rows of tiles and one shared panel under the grid opens the clicked item's
 * full title and body. Icons, tones and copy are still the shared ADVANTAGES
 * entries, so nothing here can drift from the homepage.
 */
export default function IncludedFeatures({ items }: { items: IncludedFeature[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const panelId = useId();
  const open = items.find((f) => f.key === openKey) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const iconClass = (f: IncludedFeature) =>
    `v2-adv-icon${f.tone ? ` v2-adv-icon--${f.tone}` : ""}${f.flagship ? " is-flagship" : ""}`;

  return (
    <div className="v2-inc">
      <p className="v2-inc-hint">לחצו על תכונה כדי לקרוא מה היא עושה</p>
      <div className="v2-inc-grid">
        {items.map((f) => {
          const isOpen = f.key === openKey;
          return (
            <button
              type="button"
              key={f.key}
              className={`v2-inc-tile${isOpen ? " is-open" : ""}`}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenKey(isOpen ? null : f.key)}
            >
              <span className={iconClass(f)} aria-hidden="true">
                {f.icon}
              </span>
              <span className="lbl">
                <LtrText text={f.short} />
              </span>
              {f.soon ? <span className="v2-adv-soon">בקרוב</span> : null}
            </button>
          );
        })}
      </div>

      <div id={panelId} className="v2-inc-panel" hidden={!open} aria-live="polite">
        {open ? (
          <>
            <span className={iconClass(open)} aria-hidden="true">
              {open.icon}
            </span>
            <div className="txt">
              <h3>
                <LtrText text={open.title} />
                {open.soon ? <span className="v2-adv-soon">בקרוב</span> : null}
              </h3>
              <p>
                <LtrText text={open.body} />
              </p>
            </div>
            <button
              type="button"
              className="close"
              aria-label="סגירה"
              onClick={() => setOpenKey(null)}
            >
              <X />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
