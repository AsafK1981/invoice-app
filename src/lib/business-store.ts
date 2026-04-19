"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Business } from "./types";

const CHANGE_EVENT = "invoice-app:business-changed";

const defaultBusiness: Business = {
  id: "",
  name: "העסק שלי",
  businessType: "exempt",
  taxId: "",
  address: "",
};

export function useBusiness() {
  const [business, setBusiness] = useState<Business>(defaultBusiness);
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from("businesses")
      .select("*")
      .limit(1)
      .single();
    setBusiness(
      data
        ? {
            id: data.id,
            name: data.name,
            businessType: data.business_type,
            taxId: data.tax_id,
            address: data.address,
            phone: data.phone ?? undefined,
            email: data.email ?? undefined,
            logoUrl: data.logo_url ?? undefined,
          }
        : defaultBusiness
    );
    setReady(true);
  }, []);

  useEffect(() => {
    fetch();
    const handler = () => fetch();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [fetch]);

  return { business, ready, refetch: fetch };
}

export async function saveBusiness(business: Business) {
  const { error } = await supabase
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
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
