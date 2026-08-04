"use client";

import { ChevronRight, ChevronLeft } from "lucide-react";

interface PaginationProps {
  /** 0-based current page index. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * Shared prev/next pagination control. Renders nothing when there is only
 * one page (or none), so a caller never has to guard for that itself. RTL:
 * with the page's `dir="rtl"` ancestor, the first JSX child (הקודם) lands
 * on the visual right and the second (הבא) on the visual left, matching the
 * natural right-to-left reading order.
 */
export function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <div className={`flex items-center justify-center gap-3 py-4 ${className || ""}`}>
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 0}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium text-stone-700 border border-orange-200 bg-white hover:bg-orange-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
        aria-label="עמוד קודם"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
        הקודם
      </button>
      <span className="text-sm text-stone-600 font-medium px-1 tabular-nums">
        עמוד {page + 1} מתוך {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount - 1}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium text-stone-700 border border-orange-200 bg-white hover:bg-orange-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
        aria-label="עמוד הבא"
      >
        הבא
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
