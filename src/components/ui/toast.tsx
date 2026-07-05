"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type ToastKind = "success" | "error";

interface ToastState {
  id: number;
  kind: ToastKind;
  text: string;
}

type ShowToast = (text: string, kind?: ToastKind) => void;

const ToastCtx = createContext<ShowToast | null>(null);

/**
 * Styled, app-wide toast. Mirrors the inline toast banners used across
 * the app but as a single floating surface so components that can't
 * easily host their own banner (per-row action buttons, toolbar
 * handlers) still get a styled message instead of a native alert().
 */
export function useToast(): ShowToast {
  const fn = useContext(ToastCtx);
  if (!fn) {
    // Dev-time fallback so nothing hard-crashes outside the provider.
    if (typeof console !== "undefined") {
      console.warn("useToast used outside <ToastProvider>; falling back to alert");
    }
    return (text) => {
      if (typeof window !== "undefined") window.alert(text);
    };
  }
  return fn;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback<ShowToast>((text, kind = "error") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), kind, text });
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const isError = toast?.kind === "error";

  return (
    <ToastCtx.Provider value={showToast}>
      {children}
      {toast && (
        <div className="fixed bottom-5 inset-x-0 z-[110] flex justify-center px-4 pointer-events-none">
          <div
            role="status"
            className={`pointer-events-auto flex items-start gap-2 text-sm p-3.5 pr-4 rounded-2xl shadow-lg max-w-md animate-scale-in ${
              isError
                ? "bg-rose-50 border border-rose-200 text-rose-900"
                : "bg-emerald-50 border border-emerald-200 text-emerald-900"
            }`}
          >
            {isError ? (
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
            )}
            <span className="flex-1">{toast.text}</span>
            <button
              onClick={() => setToast(null)}
              className="text-stone-400 hover:text-stone-700 flex-shrink-0"
              aria-label="סגור"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}
