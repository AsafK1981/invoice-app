"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "invoice-app:skin";

export type Skin = "coral" | "gold";

/**
 * Visual skin. "gold" (the obsidian + antique-gold art-deco look) is now the
 * DEFAULT for everyone — applied by setting <html data-skin="gold">. "coral"
 * is the demoted internal fallback: only reachable via ?skin=coral, which the
 * pre-hydration script in layout.tsx persists as localStorage "coral". Any
 * other stored value (or none) resolves to gold. That script applies the
 * chosen skin before first paint; this hook just keeps React state in sync.
 */
function readStored(): Skin {
  if (typeof window === "undefined") return "gold";
  return window.localStorage.getItem(STORAGE_KEY) === "coral" ? "coral" : "gold";
}

function applyDom(skin: Skin) {
  if (typeof document === "undefined") return;
  if (skin === "coral") document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", "gold");
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
