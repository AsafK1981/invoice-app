"use client";
import { useEffect, useRef, type RefObject } from "react";
const SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Contain drawer focus and restore background interaction when it closes. */
export function useDrawerFocus(open: boolean, panelRef: RefObject<HTMLElement | null>, onClose: () => void, triggerRef: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const previousFocus = triggerRef.current ?? document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const isolated: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = panel;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.hasAttribute("data-drawer-backdrop")) {
          isolated.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(SELECTOR))
      .filter(el => el.getClientRects().length > 0 && !el.closest("[inert]"));
    const focusFirst = () => (focusable()[0] ?? panel).focus();
    focusFirst();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0] ?? panel;
      const last = items[items.length - 1] ?? panel;
      if (!items.length || !panel.contains(document.activeElement) ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocus = (event: FocusEvent) => { if (!panel.contains(event.target as Node)) focusFirst(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      isolated.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, panelRef, triggerRef]);
}
