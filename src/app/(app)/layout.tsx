import { Sidebar } from "@/components/layout/sidebar";
import { AppProviders } from "@/components/providers";
import { GlobalSearch } from "@/components/global-search";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <div className="flex min-h-screen w-full">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-4 pt-16 lg:p-8 print:p-0 print:max-w-none">
            <div className="no-print flex justify-end mb-4 print:hidden">
              <GlobalSearch />
            </div>
            {children}
          </div>
        </main>
      </div>
    </AppProviders>
  );
}
