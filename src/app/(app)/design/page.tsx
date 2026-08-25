"use client";

import { Palette } from "lucide-react";
import { DocumentDesignSection } from "@/components/document-design-section";

/**
 * Document design gets its own tab (Asaf, 2026-08-25): it used to be one
 * card buried two thirds of the way down /settings, between numbering and
 * email. It is a creative, revisited-often surface, not a one-time setting,
 * and on its own page the editor and the live preview get ~480px each
 * instead of ~325px inside the settings column.
 */
export default function DesignPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl fgrad fgrad-pink flex items-center justify-center shadow-sm">
            <Palette className="w-5 h-5 text-white" />
          </span>
          עיצוב מסמך
        </h1>
        <p className="text-sm text-stone-700 mt-2 mr-14">
          תבנית, מבנה, צבע, גופן ומיקום הלוגו של המסמכים שלך
        </p>
      </div>

      <DocumentDesignSection />
    </div>
  );
}
