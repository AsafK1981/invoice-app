"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "invoice-app:theme";

export type Theme = "light" | "dark";

/**
 * Reads the persisted user choice (or "light" as default — the app was
 * designed light-first, so that's the safer fallback than respecting OS
 * preference for now).
 */
function readStored(): Theme {
  if (typeof window === "undefined") return "light";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "dark" ? "dark" : "light";
}

/** Apply the dark class on <html> imperatively so the swap is instant. */
function applyDom(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
}

/** React hook: returns current theme + setter. Persists + applies. */
export function useTheme() {
  // SSR-safe init: starts as "light" on server, syncs from localStorage
  // on first effect tick. Briefly flashes light if user has dark — fix
  // would be a blocking inline script in <head>, but acceptable for now.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const initial = readStored();
    setThemeState(initial);
    applyDom(initial);
  }, []);

  function setTheme(next: Theme) {
    setThemeState(next);
    applyDom(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }

  function toggle() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return { theme, setTheme, toggle };
}
