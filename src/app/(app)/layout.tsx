"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { AppProviders } from "@/components/providers";
import { GlobalSearch } from "@/components/global-search";
import { InstallPrompt } from "@/components/install-prompt";
import { NotificationsBell } from "@/components/notifications-bell";
import { EmailVerificationBanner } from "@/components/email-verification-banner";
import { TwoFactorNudge } from "@/components/two-factor-nudge";

// Client-side <Link href="/page#anchor"> navigation swaps `children` under
// this persistent layout without a full page load, and the target section
// (e.g. tax-officer-notice-section.tsx) often isn't in the DOM yet on the
// first paint - it's waiting on business/document data from context. The
// browser only auto-scrolls to a hash on a real navigation, so a client
// transition silently lands at the top of the page. Retry across a few
// frames until the element shows up, then scroll to it.
function useScrollToHashOnNavigate(pathname: string) {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 60) requestAnimationFrame(tryScroll);
    };
    const raf = requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [pathname]);
}

// Floating chat button - never needs to be part of the initial server-rendered
// HTML, so keep it out of the main bundle/SSR pass entirely (same pattern as
// the recharts usage in dashboard/page.tsx).
const AssistantWidget = dynamic(
  () => import("@/components/assistant-widget").then((mod) => mod.AssistantWidget),
  { ssr: false },
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  useScrollToHashOnNavigate(usePathname());

  return (
    <AppProviders>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:right-4 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-white focus:text-stone-900 focus:shadow-lg focus:border focus:border-orange-200"
      >
        דלג לתוכן
      </a>
      <div data-mobile-app-toolbar aria-hidden="true" className="lg:hidden print:hidden fixed inset-x-0 top-0 z-30 h-[calc(5rem+env(safe-area-inset-top))] bg-white border-b border-stone-200" />
      <div className="flex min-h-screen w-full">
        <Sidebar />
        {/* NOTE: `overflow-y-auto` was removed here (2026-07-19). It never did
            anything (<main> has no height cap, so it never scrolled), but it
            DID create a scroll container, which silently disabled every
            `position: sticky` descendant (the document editor's live-preview
            pane among them). */}
        <main id="main-content" className="flex-1 min-w-0">
          {/* Below `pt-16` so it clears the mobile hamburger button (fixed
              top-4 right-4), instead of a full-bleed row above the flex
              layout that it would otherwise overlap. */}
          <div className="max-w-7xl mx-auto p-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] lg:p-8 lg:pb-28 print:p-0 print:max-w-none">
            <EmailVerificationBanner />
            <TwoFactorNudge />
            <div className="no-print flex items-center justify-end gap-2 mb-4 print:hidden">
              <NotificationsBell />
              <GlobalSearch />
            </div>
            {children}
          </div>
        </main>
        <AssistantWidget />
        <InstallPrompt />
      </div>
    </AppProviders>
  );
}
