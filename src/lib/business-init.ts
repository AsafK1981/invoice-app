"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { SESSION_LOST_MESSAGE, isSessionLost } from "./session-guard";
import type { Business } from "./types";

const BUSINESS_ID_KEY = "invoice-app-business-id";
const BUSINESS_READY_EVENT = "invoice-app:business-ready";

// Empty strings, NOT placeholder Hebrew text. The form's placeholder=
// attribute is the right place for guidance text; storing literal
// "העסק שלי" / "000000000" as real data made them render as bold,
// "already filled in" values in Settings, fooling the user into
// thinking onboarding was done.
const defaultBusiness: Omit<Business, "id"> = {
  name: "",
  businessType: "exempt",
  taxId: "",
  address: "",
  phone: undefined,
  email: undefined,
};

// Legacy placeholder values that were stored as real data on auto-create
// before 2026-05-04. Treat these (and empty string) as "not yet set"
// in any "is configured?" check.
const PLACEHOLDER_NAME = "העסק שלי";
const PLACEHOLDER_TAX_ID = "000000000";

export function isPlaceholderBusinessName(name: string | undefined | null): boolean {
  return !name || name === PLACEHOLDER_NAME;
}
export function isPlaceholderBusinessTaxId(taxId: string | undefined | null): boolean {
  return !taxId || taxId === PLACEHOLDER_TAX_ID;
}

/** One Supabase read, reduced to the only three things that matter here. */
export type LookupOutcome =
  | { status: "hit"; id: string }
  | { status: "miss" }
  | { status: "failed"; message: string }
  /** Not attempted - e.g. there was no cached id to check. */
  | { status: "skipped" };

export type BusinessInitPlan =
  | { action: "use"; id: string }
  | { action: "create" }
  | { action: "fail"; message: string };

/**
 * Decide what to do after looking for this user's business.
 *
 * Pulled out as a pure function because the bug it exists to prevent is a
 * decision bug, not an I/O bug. The old code read `const { data: existing }`,
 * dropped the error, and treated an empty result as proof that the user has
 * no business - so a request that was refused (or, worse, silently sent
 * unauthenticated, which RLS answers with zero rows and no error) made the
 * app try to create a second business for someone who already had one. The
 * INSERT was then rejected by the same RLS that hid the row, which is Sentry
 * issue INVOICE-APP-J.
 *
 * The invariant: "create" is only ever reached from a read that actually
 * succeeded and actually came back empty. A failed read is a failed read.
 */
export function planBusinessInit(input: {
  cached: LookupOutcome;
  existing: LookupOutcome;
}): BusinessInitPlan {
  if (input.cached.status === "hit") return { action: "use", id: input.cached.id };
  // A failed cache check is not fatal on its own: the lookup by user_id
  // below is authoritative and gets its own chance.
  if (input.existing.status === "hit") return { action: "use", id: input.existing.id };
  if (input.existing.status === "failed") return { action: "fail", message: input.existing.message };
  if (input.existing.status === "skipped") {
    return {
      action: "fail",
      message: input.cached.status === "failed" ? input.cached.message : SESSION_LOST_MESSAGE,
    };
  }
  return { action: "create" };
}

/** Raised when the app cannot establish which business the user is in. */
export class BusinessInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessInitError";
  }
}

export function useBusinessInit() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    initBusiness()
      .then((id) => {
        setBusinessId(id);
        setLoading(false);
        window.dispatchEvent(new Event(BUSINESS_READY_EVENT));
      })
      // Without this the rejection escaped unhandled and `loading` stayed
      // true forever, which rendered as the "טוען את המערכת..." spinner with
      // no message and no way out - a brand-new signup could not get into
      // the app at all. A visible error the user can retry is the floor.
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "שגיאה בטעינת העסק.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  return { businessId, loading, error, retry: run };
}

/** Normalise one `.maybeSingle()` result into a LookupOutcome. */
function toOutcome(result: {
  data: { id: string } | null;
  error: { message: string; code?: string | null } | null;
}): LookupOutcome {
  if (result.error) {
    return {
      status: "failed",
      message: isSessionLost(result.error) ? SESSION_LOST_MESSAGE : result.error.message,
    };
  }
  return result.data ? { status: "hit", id: result.data.id } : { status: "miss" };
}

async function initBusiness(): Promise<string> {
  if (typeof window === "undefined") return "";

  // getSession(), not getUser(): the id must come from the same session that
  // will sign the queries below, and a user id obtained any other way can
  // disagree with the auth.uid() the database actually sees - which is
  // precisely the mismatch RLS rejects.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  // No session at all is not an error: useRequireAuth is redirecting this
  // visitor to /login, and the old contract of returning "" is preserved.
  if (!userId) return "";

  const cached = localStorage.getItem(BUSINESS_ID_KEY);

  const cachedOutcome: LookupOutcome = cached
    ? toOutcome(
        await supabase
          .from("businesses")
          .select("id")
          .eq("id", cached)
          .eq("user_id", userId)
          .maybeSingle(),
      )
    : { status: "skipped" };

  const existingOutcome: LookupOutcome =
    cachedOutcome.status === "hit"
      ? { status: "skipped" }
      : toOutcome(
          await supabase
            .from("businesses")
            .select("id")
            .eq("user_id", userId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        );

  const plan = planBusinessInit({ cached: cachedOutcome, existing: existingOutcome });

  if (plan.action === "fail") throw new BusinessInitError(plan.message);
  if (plan.action === "use") {
    localStorage.setItem(BUSINESS_ID_KEY, plan.id);
    return plan.id;
  }

  const { data: created, error } = await supabase
    .from("businesses")
    .insert({
      name: defaultBusiness.name,
      business_type: defaultBusiness.businessType,
      tax_id: defaultBusiness.taxId,
      address: defaultBusiness.address,
      user_id: userId,
    })
    .select("id")
    .single();

  if (created) {
    localStorage.setItem(BUSINESS_ID_KEY, created.id);
    return created.id;
  }

  // 23505: the unique index on businesses(user_id) caught a row this session
  // could not see when it decided to create one - two tabs racing, or a
  // first attempt that committed while its response was lost. The row exists
  // and belongs to this user, so read it back rather than reporting failure.
  // Deliberately NOT an upsert: ON CONFLICT DO UPDATE would write the blank
  // defaults above over a real, configured business profile.
  if (error?.code === "23505") {
    const recovered = toOutcome(
      await supabase
        .from("businesses")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    );
    if (recovered.status === "hit") {
      localStorage.setItem(BUSINESS_ID_KEY, recovered.id);
      return recovered.id;
    }
  }

  throw new BusinessInitError(
    isSessionLost(error)
      ? SESSION_LOST_MESSAGE
      : "לא הצלחנו להקים את העסק שלך. רענן את הדף ונסה שוב.",
  );
}

export function getBusinessId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(BUSINESS_ID_KEY);
}

export function onBusinessReady(callback: () => void) {
  if (getBusinessId()) {
    callback();
  } else {
    window.addEventListener(BUSINESS_READY_EVENT, callback, { once: true });
  }
}
