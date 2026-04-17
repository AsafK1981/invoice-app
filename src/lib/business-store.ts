"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Business } from "./types";

export function useBusiness() {
  const [business, setBusiness] = useState<Business>({
    id: "",
    name: "העסק שלי",
    businessType: "exempt",
    taxId: "",
    address: "",
  });
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from("businesses")
      .select("*")
      .limit(1)
      .single();
    if (data) {
      setBusiness({
        id: data.id,
        name: data.name,
        businessType: data.business_type,
        taxId: data.tax_id,
        address: data.address,
        phone: data.phone ?? undefined,
        email: data.email ?? undefined,
        logoUrl: data.logo_url ?? undefined,
      });
      setReady(true);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { business, ready, refetch: fetch };
}

export async function saveBusiness(business: Business) {
  await supabase
    .from("businesses")
    .update({
      name: business.name,
      business_type: business.businessType,
      tax_id: business.taxId,
      address: business.address,
      phone: business.phone || null,
      email: business.email || null,
      logo_url: business.logoUrl || null,
    })
    .eq("id", business.id);
  window.dispatchEvent(new Event("invoice-app:business-changed"));
}

export function loadBusiness(): Business {
  return { id: "", name: "העסק שלי", businessType: "exempt", taxId: "", address: "" };
}

export function resetBusiness() {}
