"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "invoice-app:skin";

export type Skin = "coral" | "gold";

/**
 * Opt-in visual skin. "coral" is the default app (unset attribute); "gold"
 * is the obsidian + antique-gold art-deco re-skin, applied by setting
 * <html data-skin="gold">. The pre-hydration script in layout.tsx already
 * applies the persisted value (and any ?skin= override) before first paint,
 * so this hook just keeps React state in sync and drives the toggle.
 */
function readStored(): Skin {
  if (typeof window === "undefined") return "coral";
  return window.localStorage.getItem(STORAGE_KEY) === "gold" ? "gold" : "coral";
}

function applyDom(skin: Skin) {
  if (typeof document === "undefined") return;
  if (skin === "gold") document.documentElement.setAttribute("data-skin", "gold");
  else document.documentElement.removeAttribute("data-skin");
}

/** React hook: current skin + setter. Persists to localStorage + applies. */
export function useSkin() {
  const [skin, setSkinState] = useState<Skin>("coral");

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
