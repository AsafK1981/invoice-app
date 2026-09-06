"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";

export default function AppErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console so dev/Sentry can pick it up
    console.error("[App error boundary]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="card-soft p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-100 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-rose-600" />
        </div>
        <h1 className="text-xl font-bold text-stone-900 mb-2">משהו לא עבד כצפוי</h1>
        <p className="text-sm text-stone-700 mb-6">
          קרתה תקלה בטעינת העמוד. ברוב המקרים רענון פשוט פותר את זה. אם זה ממשיך, ספר לנו ונבדוק.
        </p>

        {error.digest && (
          <p className="text-xs text-stone-500 mb-5 font-mono">
            קוד שגיאה: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-5 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-orange-700 text-white hover:shadow-md hover:shadow-orange-200"
          >
            <RotateCcw className="w-4 h-4" />
            נסה שוב
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-5 rounded-xl text-sm font-semibold bg-white border border-stone-200 text-stone-800 hover:bg-stone-50"
          >
            <Home className="w-4 h-4" />
            למסך הראשי
          </Link>
        </div>
      </div>
    </div>
  );
}
