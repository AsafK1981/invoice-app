"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "invoice-app:install-dismissed-at";
const DISMISS_DAYS = 14;

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || "0");
    const ageDays = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
    if (dismissedAt && ageDays < DISMISS_DAYS) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    } else {
      dismiss();
    }
    setDeferredPrompt(null);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 z-50 lg:bottom-6 lg:right-6 lg:inset-x-auto lg:max-w-sm no-print">
      <div className="card-soft p-4 bg-white shadow-xl shadow-orange-200/40 border-orange-200 flex items-start gap-3 animate-fade-in-up">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-900 text-sm">להתקין את האפליקציה?</p>
          <p className="text-xs text-stone-600 mt-1">
            הוסף את MySuperFriendlyInvoiceApp למסך הבית לגישה מהירה כמו אפליקציה רגילה.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={install}
              className="inline-flex items-center justify-center min-h-[36px] px-4 rounded-xl bg-gradient-to-l from-orange-500 to-rose-500 text-white text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
            >
              התקן
            </button>
            <button
              onClick={dismiss}
              className="inline-flex items-center justify-center min-h-[36px] px-4 rounded-xl text-stone-700 text-sm font-medium hover:bg-stone-100 transition-colors"
            >
              לא עכשיו
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="text-stone-400 hover:text-stone-700 p-1 -m-1"
          aria-label="סגור"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
