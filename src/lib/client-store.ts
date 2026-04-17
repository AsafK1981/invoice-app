"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId } from "./business-init";
import type { Client } from "./types";

const CHANGE_EVENT = "invoice-app:clients-changed";

function mapRow(row: Record<string, unknown>): Client {
  return {
    id: row.id as string,
    name: row.name as string,
    taxId: (row.tax_id as string) || undefined,
    address: (row.address as string) || undefined,
    phone: (row.phone as string) || undefined,
    email: (row.email as string) || undefined,
    notes: (row.notes as string) || undefined,
    createdAt: (row.created_at as string)?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  };
}

export function useClients() {
  const [items, setItems] = useState<Client[]>([]);
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    const { data } = await supabase
      .from("clients")
      .select("*")
      .eq("business_id", bid)
      .order("created_at", { ascending: false });
    setItems((data || []).map(mapRow));
    setReady(true);
  }, []);

  useEffect(() => {
    fetch();
    const handler = () => fetch();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [fetch]);

  return { items, ready };
}

export const clientStore = {
  async save(client: Client) {
    const bid = getBusinessId();
    if (!bid) return;

    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("id", client.id)
      .single();

    if (existing) {
      await supabase
        .from("clients")
        .update({
          name: client.name,
          tax_id: client.taxId || null,
          address: client.address || null,
          phone: client.phone || null,
          email: client.email || null,
          notes: client.notes || null,
        })
        .eq("id", client.id);
    } else {
      await supabase.from("clients").insert({
        id: client.id,
        business_id: bid,
        name: client.name,
        tax_id: client.taxId || null,
        address: client.address || null,
        phone: client.phone || null,
        email: client.email || null,
        notes: client.notes || null,
      });
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

  async remove(id: string) {
    await supabase.from("clients").delete().eq("id", id);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

  load() { return []; },
  reset() {},
};
