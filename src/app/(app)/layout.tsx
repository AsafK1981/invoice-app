import { Sidebar } from "@/components/layout/sidebar";
import { AppProviders } from "@/components/providers";
import { GlobalSearch } from "@/components/global-search";
import { InstallPrompt } from "@/components/install-prompt";
import { AssistantWidget } from "@/components/assistant-widget";
import { NotificationsBell } from "@/components/notifications-bell";
import { EmailVerificationBanner } from "@/components/email-verification-banner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:right-4 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-white focus:text-stone-900 focus:shadow-lg focus:border focus:border-orange-200"
      >
        דלג לתוכן
      </a>
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
          <div className="max-w-7xl mx-auto p-4 pt-16 lg:p-8 print:p-0 print:max-w-none">
            <EmailVerificationBanner />
            <div className="no-print flex items-center justify-end gap-2 mb-4 print:hidden">
              <NotificationsBell />
              <GlobalSearch />
            </div>
            {children}
          </div>
        </main>
        <InstallPrompt />
        <AssistantWidget />
      </div>
    </AppProviders>
  );
}
