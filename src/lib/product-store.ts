"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import type { Product } from "./types";

const CHANGE_EVENT = "invoice-app:products-changed";

function mapRow(row: Record<string, unknown>): Product {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || undefined,
    price: Number(row.price) || 0,
    unit: (row.unit as string) || "יחידה",
  };
}

export function useProducts() {
  const [items, setItems] = useState<Product[]>([]);
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("business_id", bid)
      .order("created_at", { ascending: false });
    setItems((data || []).map(mapRow));
    setReady(true);
  }, []);

  useEffect(() => {
    onBusinessReady(() => fetch());
    const handler = () => fetch();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [fetch]);

  return { items, ready };
}

export const productStore = {
  async save(product: Product) {
    const bid = getBusinessId();
    if (!bid) return;

    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("id", product.id)
      .single();

    if (existing) {
      await supabase
        .from("products")
        .update({
          name: product.name,
          description: product.description || null,
          price: product.price,
          unit: product.unit,
        })
        .eq("id", product.id);
    } else {
      await supabase.from("products").insert({
        id: product.id,
        business_id: bid,
        name: product.name,
        description: product.description || null,
        price: product.price,
        unit: product.unit,
      });
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

  async remove(id: string) {
    await supabase.from("products").delete().eq("id", id);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

};
