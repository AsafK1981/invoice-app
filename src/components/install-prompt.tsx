"use client";

import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "invoice-app:install-dismissed-at";
const PERMANENT_KEY = "invoice-app:install-dismissed-permanently";
const SESSION_KEY = "invoice-app:install-dismissed-this-session";
const DISMISS_DAYS = 60; // bumped from 14; popping up every 2 weeks is still annoying

export function InstallPrompt() {
  // Bottom-right on every route. It used to flip left over the single-document
  // paper, and the assistant launcher mirrored it - which made the assistant
  // change corners between pages. Asaf (2026-08-14): the assistant owns
  // bottom-left everywhere, so this card owns bottom-right everywhere; briefly
  // covering the paper's corner is acceptable for a dismissible one-off card.
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  // Set to true once the user has chosen ANY option in this session; prevents
  // the prompt from re-appearing if the browser fires beforeinstallprompt a
  // second time (which it does whenever you navigate routes in some Chromes).
  const dismissedThisSessionRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Permanent dismiss: never show again
    if (localStorage.getItem(PERMANENT_KEY) === "1") return;

    // Already dismissed this browser session (in-memory + sessionStorage as backup)
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      dismissedThisSessionRef.current = true;
      return;
    }

    // Cooldown after "Not now"
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || "0");
    if (dismissedAt) {
      const ageDays = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
      if (ageDays < DISMISS_DAYS) return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      // If user already dealt with the prompt this session, swallow the
      // event silently; don't pop up again.
      if (dismissedThisSessionRef.current) return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function markDismissedThisSession() {
    dismissedThisSessionRef.current = true;
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {}
    setVisible(false);
  }

  function dismissTemporarily() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    markDismissedThisSession();
  }

  function dismissPermanently() {
    localStorage.setItem(PERMANENT_KEY, "1");
    markDismissedThisSession();
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      // Installed: never show again
      localStorage.setItem(PERMANENT_KEY, "1");
    }
    markDismissedThisSession();
    setDeferredPrompt(null);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 inset-x-4 z-50 lg:bottom-6 lg:inset-x-auto lg:right-6 lg:max-w-sm no-print"
    >
      <div className="card-soft p-4 bg-white shadow-xl shadow-orange-200/40 border-orange-200 flex items-start gap-3 animate-fade-in-up">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-900 text-sm">להתקין את האפליקציה?</p>
          <p className="text-xs text-stone-600 mt-1">
            הוסף את חשבונית ידידותית למסך הבית לגישה מהירה כמו אפליקציה רגילה.
          </p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <button
              onClick={install}
              className="inline-flex items-center justify-center min-h-[36px] px-4 rounded-xl bg-gradient-to-l from-orange-500 to-orange-700 text-white text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
            >
              התקן
            </button>
            <button
              onClick={dismissTemporarily}
              className="inline-flex items-center justify-center min-h-[36px] px-4 rounded-xl text-stone-700 text-sm font-medium hover:bg-stone-100 transition-colors"
            >
              לא עכשיו
            </button>
          </div>
          <button
            onClick={dismissPermanently}
            className="mt-2 text-xs text-stone-500 hover:text-stone-700 underline"
          >
            אל תציג שוב
          </button>
        </div>
        <button
          onClick={dismissTemporarily}
          className="text-stone-400 hover:text-stone-700 p-1 -m-1"
          aria-label="סגור"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
