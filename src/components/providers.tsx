"use client";

import { createContext, useContext } from "react";
import { useBusinessInit } from "@/lib/business-init";
import { Sparkles } from "lucide-react";

const BusinessContext = createContext<string | null>(null);

export function useBusinessId(): string {
  const id = useContext(BusinessContext);
  if (!id) throw new Error("useBusinessId called outside of AppProviders");
  return id;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const { businessId, loading } = useBusinessInit();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-lg animate-pulse">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <p className="text-stone-700 font-medium">טוען את המערכת...</p>
        </div>
      </div>
    );
  }

  return (
    <BusinessContext.Provider value={businessId}>
      {children}
    </BusinessContext.Provider>
  );
}
