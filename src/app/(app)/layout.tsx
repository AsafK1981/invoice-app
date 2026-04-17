import { Sidebar } from "@/components/layout/sidebar";
import { AppProviders } from "@/components/providers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <div className="flex min-h-screen w-full">
        <div className="no-print">
          <Sidebar />
        </div>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-8 print:p-0 print:max-w-none">{children}</div>
        </main>
      </div>
    </AppProviders>
  );
}
