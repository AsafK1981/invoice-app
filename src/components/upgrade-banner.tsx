"use client";

import Link from "next/link";
import { Sparkles, ArrowLeft } from "lucide-react";

interface Props {
  title?: string;
  message: string;
  variant?: "inline" | "card";
}

export function UpgradeBanner({ title, message, variant = "card" }: Props) {
  if (variant === "inline") {
    return (
      <Link
        href="/billing"
        className="inline-flex items-center gap-2 bg-gradient-to-l from-violet-500/10 to-purple-500/10 border border-violet-200 px-3 py-2 rounded-xl text-sm text-violet-900 hover:from-violet-500/20 hover:to-purple-500/20 transition-all"
      >
        <Sparkles className="w-4 h-4 text-violet-600" />
        <span>{message}</span>
        <ArrowLeft className="w-3 h-3 text-violet-600" />
      </Link>
    );
  }

  return (
    <div className="card-soft p-5 bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-md flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          {title && <h3 className="font-bold text-stone-900">{title}</h3>}
          <p className="text-sm text-stone-700 mt-1">{message}</p>
          <Link
            href="/billing"
            className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-violet-500 to-purple-500 text-white hover:shadow-md hover:shadow-violet-200 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            שדרג ל-Pro
          </Link>
        </div>
      </div>
    </div>
  );
}
