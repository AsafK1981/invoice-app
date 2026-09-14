"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { returnLabel } from "@/lib/return-to";

/**
 * Sticky "back to the report" strip for screens reached from a report's
 * fix-it link. Rendered only when the page resolved a safe `?return=` path.
 */
export function ReturnBar({ to }: { to: string }) {
  return (
    <div className="no-print sticky top-2 z-30 flex justify-start">
      <Link
        href={to}
        className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-2xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 shadow-md hover:shadow-lg"
      >
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
        {returnLabel(to)}
      </Link>
    </div>
  );
}
