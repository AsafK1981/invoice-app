"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId } from "./business-init";
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
    const bid = getBusinessId();
    let query = supabase.from("businesses").select("*");
    if (bid) query = query.eq("id", bid);
    const { data } = await query.limit(1).maybeSingle();

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

export async function saveBusiness(business: Business): Promise<void> {
  const { data, error } = await supabase
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
    .eq("id", business.id)
    .select();

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(
      "השמירה לא בוצעה - ייתכן שאין לך הרשאה לעדכן את העסק הזה. רענן את הדף ונסה שוב."
    );
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
