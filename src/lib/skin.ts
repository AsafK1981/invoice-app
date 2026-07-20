"use client";

import { useEffect, useState } from "react";

/** Shared with the pre-hydration script in layout.tsx, which cannot import. */
export const SKIN_STORAGE_KEY = "invoice-app:skin";
const STORAGE_KEY = SKIN_STORAGE_KEY;

export type Skin = "coral" | "gold";

/**
 * Visual skin. "gold" is the DEFAULT for everyone — applied by setting
 * <html data-skin="gold">. The name is historical: it started as an obsidian +
 * antique-gold art-deco look and is now the warm light shell (see the header of
 * skin-gold.css). The attribute value was deliberately left as "gold" so stored
 * preferences and the ?skin= escape hatch keep working.
 *
 * "coral" is the demoted internal fallback: only reachable via ?skin=coral,
 * which the pre-hydration script in layout.tsx persists as localStorage
 * "coral". Any other stored value (or none) resolves to gold. That script
 * applies the chosen skin before first paint; this hook just keeps React state
 * in sync.
 */
function readStored(): Skin {
  if (typeof window === "undefined") return "gold";
  return window.localStorage.getItem(STORAGE_KEY) === "coral" ? "coral" : "gold";
}

/**
 * The single owner of the skin's DOM contract — keep in step with the inline
 * pre-hydration script in layout.tsx, which has to duplicate this logic because
 * it runs before any module loads.
 */
function applyDom(skin: Skin) {
  if (typeof document === "undefined") return;
  if (skin === "coral") document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", "gold");
  // A beta-era `invoice-app:theme=dark` value could still add .dark, whose
  // utility block in globals.css inverts the palette against the light shell.
  document.documentElement.classList.remove("dark");
}

/** React hook: current skin + setter. Persists to localStorage + applies. */
export function useSkin() {
  const [skin, setSkinState] = useState<Skin>("gold");

  useEffect(() => {
    const initial = readStored();
    setSkinState(initial);
    applyDom(initial);
  }, []);

  function setSkin(next: Skin) {
    setSkinState(next);
    applyDom(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }

  function toggle() {
    setSkin(skin === "gold" ? "coral" : "gold");
  }

  return { skin, setSkin, toggle };
}
