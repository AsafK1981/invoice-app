"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandLockup } from "@/components/brand-mark";
import { useBusinessInit } from "@/lib/business-init";
import { useRequireAuth, signOut } from "@/lib/auth";
import { installPrintWidthFit } from "@/lib/print-width-fit";
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
  const { businessId, loading: bizLoading, error: bizError, retry: retryBiz } = useBusinessInit();

  // Every print in the app shrinks wide tables to fit the paper instead of
  // cutting them off (src/lib/print-width-fit.ts).
  useEffect(() => installPrintWidthFit(), []);

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

  // Loading finished but the business could not be established. Previously
  // this state simply never ended - the rejection was unhandled, the spinner
  // above ran forever, and the user had no message, no retry and no way to
  // sign out. Anything with a button on it beats that.
  if (bizError || !businessId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50 p-4">
        <div className="w-full max-w-md text-center space-y-5">
          <BrandLockup size={44} />
          <div className="card-soft p-8 space-y-4">
            <h1 className="text-lg font-bold text-stone-900">לא הצלחנו לטעון את העסק שלך</h1>
            <p className="text-sm text-stone-600">
              {bizError || "החיבור נקטע באמצע. הנתונים שלך במקום, רק הטעינה נכשלה."}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={retryBiz}
                className="btn-glow w-full bg-gradient-to-l from-orange-500 to-orange-700 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 transition-all cursor-pointer"
              >
                נסה שוב
              </button>
              <button
                onClick={() => signOut()}
                className="w-full text-sm font-medium text-stone-600 hover:text-orange-700 py-2 cursor-pointer"
              >
                התנתק והתחבר מחדש
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BusinessContext.Provider value={businessId}>
      <ConfirmProvider>
        <ToastProvider>{children}</ToastProvider>
      </ConfirmProvider>
    </BusinessContext.Provider>
  );
}
