"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useOptionalUser } from "@/lib/auth";

/**
 * The "start free" call to action, aware of whether anyone is signed in.
 *
 * Every marketing CTA used to point unconditionally at /login?mode=signup.
 * That was invisible while "/" bounced a signed-in visitor away, but /pricing,
 * /vs and /blog were always readable with a session - and since /product landed
 * so is the whole landing page. A customer who clicks "התחילו בחינם" and lands
 * on a signup form is being told the site does not know who they are.
 *
 * Signed in, this points at /dashboard and says so. Signed out it is exactly
 * the link it replaced.
 *
 * `useOptionalUser` reports signed-out on the first render, so the server-
 * rendered HTML - the only thing a crawler ever sees - is unchanged: still the
 * signup CTA, still indexable as the acquisition page it is.
 */
export default function SignupLink({
  className,
  children,
  authedLabel = "לאזור האישי",
}: {
  className?: string;
  /** The signed-out label, usually "התחילו בחינם". */
  children: ReactNode;
  /** Override when "לאזור האישי" does not fit the surrounding copy. */
  authedLabel?: ReactNode;
}) {
  const { user } = useOptionalUser();

  if (user) {
    return (
      <Link href="/dashboard" className={className}>
        {authedLabel}
      </Link>
    );
  }

  return (
    <Link href="/login?mode=signup" className={className}>
      {children}
    </Link>
  );
}
