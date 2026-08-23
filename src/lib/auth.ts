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
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace("/login");
      } else {
        setUser(user);
        setLoading(false);
      }
    });

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

/**
 * Session check that does NOT redirect anywhere.
 *
 * `useRequireAuth` above both reads the session AND bounces to /login; public
 * pages need only the first half - they want to KNOW whether someone is signed
 * in so they can render a different call to action, not to gate anything. Used
 * by the marketing landing's RedirectIfAuthed and HeaderLight.
 *
 * `checked` starts false so the first render (and the server render) is always
 * the signed-out variant: that keeps the SSR HTML crawlers receive identical to
 * what it was before this hook existed, and avoids a hydration mismatch.
 */
export function useOptionalUser(): { user: User | null; checked: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!active) return;
        setUser(user ?? null);
        setChecked(true);
      })
      // A failed auth read just means we treat the visitor as signed out, which
      // is the correct fallback for a public page. Without the catch this became
      // an unhandled rejection on any flaky connection.
      .catch(() => {
        if (active) setChecked(true);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        setUser(session?.user ?? null);
        setChecked(true);
      }
    );

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user, checked };
}
