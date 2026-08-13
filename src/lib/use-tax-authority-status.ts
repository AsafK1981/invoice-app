"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface TaxAuthorityStatus {
  /** "exempt" (עוסק פטור, never gated), "authorized" (עוסק מורשה) / "company",
   *  or null while unknown/unauthenticated. */
  businessType: string | null;
  /** Has this business completed the one-time חשבונית ישראל OAuth connect? */
  connected: boolean;
  /** True once the fetch has settled (success OR failure). Gate rendering on
   *  this, not on `businessType`/`connected` alone, so a component doesn't
   *  render its "not connected" state for a beat before the real answer
   *  arrives. */
  loaded: boolean;
}

/**
 * Single shared fetch of /api/tax-authority/status. Previously each consumer
 * (the in-editor connect banner, and now also the end-of-form "next step"
 * card) fired its own request; calling this ONCE in the editor and passing
 * the result down means both read the exact same connect state and can
 * never disagree for a beat, and the network only pays for one round trip.
 */
export function useTaxAuthorityStatus(): TaxAuthorityStatus {
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/tax-authority/status", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const d = await res.json();
        if (!cancelled && d.ok) {
          setBusinessType(d.businessType);
          setConnected(Boolean(d.connected));
        }
      } catch {
        /* status is best-effort; consumers simply stay hidden on failure */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { businessType, connected, loaded };
}
