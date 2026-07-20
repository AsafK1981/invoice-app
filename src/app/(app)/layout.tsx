import { Sidebar } from "@/components/layout/sidebar";
import { AppProviders } from "@/components/providers";
import { GlobalSearch } from "@/components/global-search";
import { InstallPrompt } from "@/components/install-prompt";
import { NotificationsBell } from "@/components/notifications-bell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <div className="flex min-h-screen w-full">
        <Sidebar />
        {/* NOTE: `overflow-y-auto` was removed here (2026-07-19). It never did
            anything — <main> has no height cap, so it never scrolled — but it
            DID create a scroll container, which silently disabled every
            `position: sticky` descendant (the document editor's live-preview
            pane among them). */}
        <main className="flex-1 min-w-0">
          <div className="max-w-7xl mx-auto p-4 pt-16 lg:p-8 print:p-0 print:max-w-none">
            <div className="no-print flex items-center justify-end gap-2 mb-4 print:hidden">
              <NotificationsBell />
              <GlobalSearch />
            </div>
            {children}
          </div>
        </main>
        <InstallPrompt />
      </div>
    </AppProviders>
  );
}
