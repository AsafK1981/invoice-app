"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Business } from "./types";

const BUSINESS_ID_KEY = "invoice-app-business-id";
const BUSINESS_READY_EVENT = "invoice-app:business-ready";

const defaultBusiness: Omit<Business, "id"> = {
  name: "העסק שלי",
  businessType: "exempt",
  taxId: "000000000",
  address: "",
  phone: undefined,
  email: undefined,
};

export function useBusinessInit() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initBusiness().then((id) => {
      setBusinessId(id);
      setLoading(false);
      window.dispatchEvent(new Event(BUSINESS_READY_EVENT));
    });
  }, []);

  return { businessId, loading };
}

async function initBusiness(): Promise<string> {
  if (typeof window === "undefined") return "";

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";

  const cached = localStorage.getItem(BUSINESS_ID_KEY);

  if (cached) {
    const { data } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", cached)
      .eq("user_id", user.id)
      .single();
    if (data) return cached;
  }

  const { data: existing } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (existing) {
    localStorage.setItem(BUSINESS_ID_KEY, existing.id);
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("businesses")
    .insert({
      name: defaultBusiness.name,
      business_type: defaultBusiness.businessType,
      tax_id: defaultBusiness.taxId,
      address: defaultBusiness.address,
      user_id: user.id,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error("Failed to create business: " + error?.message);

  localStorage.setItem(BUSINESS_ID_KEY, created.id);
  return created.id;
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
