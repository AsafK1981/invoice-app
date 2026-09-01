"use client";

/**
 * "טקסט גדול" - the opt-in large-text mode (Asaf, 2026-08-31).
 *
 * The switch lives in the sidebar footer. When it is on, <html> carries
 * `data-text-size="large"` and app-skin.css lifts the app root ~15% (see the
 * READABILITY block there). The choice is stored in two places:
 *
 *   - localStorage, so it applies on the very next paint of the next visit on
 *     this device, before any network round-trip;
 *   - `businesses.text_size`, so the same person gets it on their phone and
 *     their computer. The DB value wins whenever it is known (see
 *     syncTextSizeFromBusiness), the local copy is only a cache of it.
 *
 * Everything here is idempotent and safe to call during render on the client.
 */

import { supabase } from "./supabase";

export type TextSize = "normal" | "large";

export const TEXT_SIZE_KEY = "invoice-app:text-size";
export const TEXT_SIZE_EVENT = "invoice-app:text-size-changed";
const ATTR = "data-text-size";

export function normalizeTextSize(value: unknown): TextSize {
  return value === "large" ? "large" : "normal";
}

/**
 * The value currently APPLIED to <html> - the attribute only, never the
 * stored copy. (An earlier version fell back to localStorage here, which
 * made applyStoredTextSize's "already applied?" check compare storage to
 * itself and never re-apply after a reload - caught by the preview E2E.)
 */
export function readTextSize(): TextSize {
  if (typeof document === "undefined") return "normal";
  return normalizeTextSize(document.documentElement.getAttribute(ATTR));
}

/** Puts the attribute on <html> and caches the choice locally. No network. */
export function applyTextSize(size: TextSize): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (size === "large") html.setAttribute(ATTR, "large");
  else html.removeAttribute(ATTR);
  try {
    if (size === "large") window.localStorage.setItem(TEXT_SIZE_KEY, "large");
    else window.localStorage.removeItem(TEXT_SIZE_KEY);
  } catch {
    // private mode / blocked storage: the attribute still applies for this page
  }
  window.dispatchEvent(new CustomEvent(TEXT_SIZE_EVENT, { detail: size }));
}

/**
 * Applies the cached choice. Called once when the app shell mounts so a
 * returning user does not see a normal-size flash while the business row
 * is still loading.
 */
export function applyStoredTextSize(): void {
  let stored: TextSize = "normal";
  try {
    stored = normalizeTextSize(window.localStorage.getItem(TEXT_SIZE_KEY));
  } catch {
    stored = "normal";
  }
  // Unconditional on purpose: applyTextSize is idempotent, and any
  // "only if different" guard here must NOT consult the stored value
  // (see readTextSize) or it defeats itself.
  applyTextSize(stored);
}

/**
 * The DB is the source of truth once it is known: if the business row says
 * "large" and this device says "normal" (or the reverse), the device follows.
 * `undefined` means "row not loaded yet" and changes nothing.
 */
export function syncTextSizeFromBusiness(dbValue: TextSize | undefined): void {
  if (dbValue === undefined) return;
  if (dbValue !== readTextSize()) applyTextSize(dbValue);
}

/**
 * The switch handler: applies immediately, then persists to the business row.
 * The write is its own small UPDATE (not saveBusiness) so that a stale
 * in-memory Business object elsewhere can never reset the choice by
 * accident, and so the toggle works even before the settings form loads.
 */
export async function setTextSize(size: TextSize, businessId: string | undefined): Promise<void> {
  applyTextSize(size);
  if (!businessId) return;
  const { error } = await supabase
    .from("businesses")
    .update({ text_size: size })
    .eq("id", businessId);
  if (error) {
    // Not fatal: the local copy already applies. Surface for debugging only.
    console.warn("text_size save failed:", error.message);
  }
}
