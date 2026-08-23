"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOptionalUser } from "@/lib/auth";

/**
 * Tiny client-side auth gate for the (server-rendered) marketing landing.
 * Anonymous visitors see the landing instantly; this renders nothing and
 * never blocks SEO or the anon experience. Only a detected Supabase session
 * triggers a client-side redirect to /dashboard, restoring the pre-promotion
 * behavior of the old coral landing (git: src/app/page.tsx before 35ad6e7).
 *
 * BOUNCES FROM "/" ONLY. The exact same landing component is also served at
 * /product (see that route's file) precisely so that a signed-in user CAN read
 * the marketing page - previously impossible, since the only address it lived
 * at threw them straight into the app. Keep this path check: without it the
 * /product escape hatch silently stops working.
 */
export default function RedirectIfAuthed() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useOptionalUser();

  useEffect(() => {
    if (pathname !== "/") return;
    if (user) router.replace("/dashboard");
  }, [pathname, user, router]);

  return null;
}
