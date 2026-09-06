"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

type Tone = "default" | "danger";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmCtx);
  if (!fn) {
    // Dev-time fallback: warn loudly, fall through to window.confirm so nothing breaks
    if (typeof console !== "undefined") {
      console.warn("useConfirm used outside <ConfirmProvider>; falling back to window.confirm");
    }
    return async (opts) => window.confirm(opts.title);
  }
  return fn;
}

interface State extends ConfirmOptions {
  open: boolean;
  resolve?: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ open: false, title: "" });

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, open: true, resolve });
    });
  }, []);

  function close(answer: boolean) {
    state.resolve?.(answer);
    setState((s) => ({ ...s, open: false, resolve: undefined }));
  }

  useEffect(() => {
    if (!state.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
      // Danger confirms (delete, etc.) require an explicit click - Enter must
      // not silently trigger them, e.g. from a stray keypress right after the
      // dialog opens.
      if (e.key === "Enter" && state.tone !== "danger") close(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open]);

  const isDanger = state.tone === "danger";

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm animate-fade-in"
            onClick={() => close(false)}
          />
          <div
            className="card-soft relative w-full max-w-md bg-white shadow-2xl animate-scale-in"
            role="dialog"
            aria-modal="true"
          >
            <button
              onClick={() => close(false)}
              className="absolute top-3 left-3 w-10 h-10 sm:w-8 sm:h-8 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 flex items-center justify-center"
              aria-label="סגור"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6">
              <div className="flex items-start gap-3">
                <div
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                    isDanger ? "bg-rose-100" : "bg-orange-100"
                  }`}
                >
                  <AlertTriangle
                    className={`w-5 h-5 ${isDanger ? "text-rose-600" : "text-orange-600"}`}
                  />
                </div>
                <div className="flex-1 min-w-0 pr-8">
                  <h3 className="font-bold text-stone-900">{state.title}</h3>
                  {state.message && (
                    <p className="text-sm text-stone-700 mt-1.5">{state.message}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => close(false)}
                  className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-xl text-sm font-semibold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50"
                >
                  {state.cancelLabel || "ביטול"}
                </button>
                <button
                  onClick={() => close(true)}
                  autoFocus
                  className={`inline-flex items-center justify-center min-h-[40px] px-5 rounded-xl text-sm font-semibold text-white ${
                    isDanger
                      ? "bg-gradient-to-l from-rose-500 to-pink-500 hover:shadow-md hover:shadow-rose-200"
                      : "bg-gradient-to-l from-orange-500 to-orange-700 hover:shadow-md hover:shadow-orange-200"
                  }`}
                >
                  {state.confirmLabel || "אישור"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
