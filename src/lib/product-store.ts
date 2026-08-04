"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import { logAudit } from "./audit-log";
import { searchTerms, ilikeOrClause } from "./ilike-search";
import type { Product } from "./types";

const CHANGE_EVENT = "invoice-app:products-changed";

/** Row count per page for `useProductsPage`. */
export const PRODUCTS_PAGE_SIZE = 50;

/** Columns `useProductsPage`'s search box matches against. Mirrors
 * `matchesProduct` in the products page (name, description, unit); price is
 * left out server-side since matching it required formatting a currency
 * string client-side (`formatCurrency(p.price)`), which has no clean SQL
 * equivalent - a rare, low-value search path to drop for real pagination. */
const PRODUCT_SEARCH_COLUMNS = ["name", "description", "unit"];

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

/**
 * Paginated, server-side variant for the /products list view. Same rationale
 * as `useClientsPage` in client-store.ts: `useProducts()` stays untouched
 * (the product picker in every document editor, global search, dashboard and
 * danger-zone all need the full catalog), and only the /products page itself
 * switches to this separate, opt-in hook.
 */
export function useProductsPage(opts: { page: number; search: string }) {
  const { page, search } = opts;
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    setReady(false);

    let query = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("business_id", bid);

    for (const term of searchTerms(search)) {
      query = query.or(ilikeOrClause(PRODUCT_SEARCH_COLUMNS, term));
    }

    const from = page * PRODUCTS_PAGE_SIZE;
    const to = from + PRODUCTS_PAGE_SIZE - 1;
    const { data, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    setItems((data || []).map(mapRow));
    setTotal(count ?? 0);
    setReady(true);
  }, [page, search]);

  useEffect(() => {
    onBusinessReady(() => fetch());
    const handler = () => fetch();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [fetch]);

  return { items, total, ready, pageSize: PRODUCTS_PAGE_SIZE };
}

export const productStore = {
  async save(product: Product) {
    const bid = getBusinessId();
    if (!bid) return;

    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("id", product.id)
      .maybeSingle();

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
    const { data: snap } = await supabase
      .from("products")
      .select("name")
      .eq("id", id)
      .maybeSingle();
    await supabase.from("products").delete().eq("id", id);
    if (snap?.name) {
      logAudit({
        action: "product.deleted",
        targetType: "product",
        targetId: id,
        targetLabel: snap.name as string,
      });
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

};
