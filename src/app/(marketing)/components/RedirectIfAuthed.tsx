"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Tiny client-side auth gate for the (server-rendered) marketing landing.
 * Anonymous visitors see the landing instantly; this renders nothing and
 * never blocks SEO or the anon experience. Only a detected Supabase session
 * triggers a client-side redirect to /dashboard, restoring the pre-promotion
 * behavior of the old coral landing (git: src/app/page.tsx before 35ad6e7).
 */
export default function RedirectIfAuthed() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (active && user) {
          router.replace("/dashboard");
        }
      })
      // A failed auth read here just means we do not redirect, which is the
      // correct fallback (the anonymous landing page is already rendered).
      // Without the catch it became an unhandled rejection on any flaky
      // connection - the class of error that filled Sentry from /onboarding.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
