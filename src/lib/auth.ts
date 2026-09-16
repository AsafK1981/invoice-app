"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";
import type { User } from "@supabase/supabase-js";

export function useRequireAuth() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const toLogin = () => {
      // Keep the deep link (e.g. the welcome email's /documents/new) so the
      // login page can send the user back there instead of the dashboard.
      const here = window.location.pathname + window.location.search;
      router.replace(
        here && here !== "/" && here !== "/dashboard"
          ? `/login?next=${encodeURIComponent(here)}`
          : "/login",
      );
    };

    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!user) {
          toLogin();
        } else {
          setUser(user);
          setLoading(false);
        }
      })
      // getUser() rejects rather than resolving on a non-auth failure (a
      // dropped mobile connection, a lock it could not acquire). Unguarded,
      // `loading` stayed true forever and AppProviders showed its
      // "טוען את המערכת..." spinner with no way out - the same dead end
      // business-init used to have. Sending the user to /login is a real
      // screen with a real action on it.
      .catch(() => toLogin());

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session?.user) {
          router.replace("/login");
        } else {
          setUser(session.user);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [router]);

  return { user, loading };
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "/login";
}
