"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Upload, Sparkles } from "lucide-react";
import { Ltr } from "@/components/ui/ltr";

interface Props {
  /** Lucide icon component */
  icon: React.ComponentType<{ className?: string }>;
  /** Big heading: what this page is for, in 2-4 words */
  title: string;
  /** One-sentence pitch: why this page matters */
  description: string;
  /** Primary CTA: usually "create your first ..." */
  primaryAction: {
    label: string;
    onClick?: () => void;
    href?: string;
    icon?: React.ComponentType<{ className?: string }>;
  };
  /** Optional secondary CTA: usually CSV import */
  secondaryAction?: {
    label: string;
    onClick?: () => void;
    href?: string;
    icon?: React.ComponentType<{ className?: string }>;
  };
  /** Whether to show the "migrating from another tool?" hint to /migrate */
  showMigrateHint?: boolean;
  /** Optional extra hint below the buttons */
  hint?: ReactNode;
}

/**
 * The friendly empty-state shown on listing pages when the user has zero
 * items. Replaces the previous "אין X עדיין" stub with a proper hero:
 * giant gradient icon, clear what-and-why copy, primary CTA, optional
 * CSV-import secondary, and a soft nudge to /migrate for new users
 * arriving from Invoice4U / Greeninvoice / iCount etc.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  showMigrateHint = true,
  hint,
}: Props) {
  const PrimaryIcon = primaryAction.icon || Sparkles;
  const SecondaryIcon = secondaryAction?.icon || Upload;
  return (
    <div className="card-soft p-8 sm:p-12 text-center max-w-3xl mx-auto bg-gradient-to-br from-orange-50/70 via-amber-50/40 to-rose-50/70 border-orange-100">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-xl shadow-orange-200/60 mx-auto mb-5">
        <Icon className="w-9 h-9 text-white" />
      </div>
      <h2 className="text-2xl font-bold text-stone-900">{title}</h2>
      <p className="text-sm text-stone-700 mt-2 leading-relaxed max-w-md mx-auto">
        {description}
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        {primaryAction.href ? (
          <Link
            href={primaryAction.href}
            className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all"
          >
            <PrimaryIcon className="w-4 h-4" />
            {primaryAction.label}
          </Link>
        ) : (
          <button
            onClick={primaryAction.onClick}
            className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all"
          >
            <PrimaryIcon className="w-4 h-4" />
            {primaryAction.label}
          </button>
        )}
        {secondaryAction &&
          (secondaryAction.href ? (
            <Link
              href={secondaryAction.href}
              className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-5 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50"
            >
              <SecondaryIcon className="w-4 h-4 text-orange-500" />
              {secondaryAction.label}
            </Link>
          ) : (
            <button
              onClick={secondaryAction.onClick}
              className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-5 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50"
            >
              <SecondaryIcon className="w-4 h-4 text-orange-500" />
              {secondaryAction.label}
            </button>
          ))}
      </div>

      {hint && <div className="mt-4 text-xs text-stone-600">{hint}</div>}

      {showMigrateHint && (
        <div className="mt-6 pt-6 border-t border-orange-100 max-w-md mx-auto">
          <p className="text-xs text-stone-600">
            מגיע מ-<Ltr>Invoice4U</Ltr>, חשבונית ירוקה, <Ltr>iCount</Ltr>, ריווחית או{" "}
            <Ltr>Excel</Ltr>?{" "}
            <Link
              href="/migrate"
              className="text-orange-700 font-semibold hover:text-orange-900 underline"
            >
              לחץ כאן למדריך מעבר בלחיצה אחת
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
