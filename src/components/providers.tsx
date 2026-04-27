"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useBusinessInit } from "@/lib/business-init";
import { useRequireAuth } from "@/lib/auth";

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
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-xl shadow-orange-200/50 btn-glow">
            <Sparkles className="w-9 h-9 text-white animate-pulse" />
          </div>
          <div>
            <p className="text-stone-800 font-bold text-lg">MySuperFriendlyInvoiceApp</p>
            <p className="text-stone-500 text-sm mt-1">טוען את המערכת...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <BusinessContext.Provider value={businessId}>
      {children}
    </BusinessContext.Provider>
  );
}
