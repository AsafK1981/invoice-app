"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandLockup } from "@/components/brand-mark";
import { useBusinessInit } from "@/lib/business-init";
import { useRequireAuth } from "@/lib/auth";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";

const BusinessContext = createContext<string | null>(null);

export function useBusinessId(): string {
  const id = useContext(BusinessContext);
  if (!id) throw new Error("useBusinessId called outside of AppProviders");
  return id;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useRequireAuth();
  const { businessId, loading: bizLoading } = useBusinessInit();

  useEffect(() => {
    if (!user) return;
    const onboarded = user.user_metadata?.onboarded === true;
    const onOnboarding = pathname === "/onboarding";
    if (!onboarded && !onOnboarding) {
      router.replace("/onboarding");
    }
  }, [user, pathname, router]);

  if (authLoading || bizLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50">
        <div className="text-center space-y-5 animate-fade-in">
          <BrandLockup size={44} tagline />
          <div role="status">
            <p className="text-stone-500 text-sm mt-1">טוען את המערכת...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <BusinessContext.Provider value={businessId}>
      <ConfirmProvider>
        <ToastProvider>{children}</ToastProvider>
      </ConfirmProvider>
    </BusinessContext.Provider>
  );
}
