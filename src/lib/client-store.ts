"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import { createSharedStore } from "./shared-store";
import { logAudit } from "./audit-log";
import { todayInIsrael } from "./date";
import { searchTerms, ilikeOrClause } from "./ilike-search";
import type { Client } from "./types";

const CHANGE_EVENT = "invoice-app:clients-changed";

/** Row count per page for `useClientsPage`. Named so it isn't a magic number
 * at either of its two call sites (the fetch's `.range()` and the caller's
 * page-count math). */
export const CLIENTS_PAGE_SIZE = 50;

/** Columns `useClientsPage`'s search box matches against, mirroring
 * `matchesClient` in the clients page (name, tax id, address, phone, email,
 * notes). */
const CLIENT_SEARCH_COLUMNS = ["name", "tax_id", "address", "phone", "email", "notes"];

function mapRow(row: Record<string, unknown>): Client {
  return {
    id: row.id as string,
    name: row.name as string,
    taxId: (row.tax_id as string) || undefined,
    address: (row.address as string) || undefined,
    phone: (row.phone as string) || undefined,
    email: (row.email as string) || undefined,
    notes: (row.notes as string) || undefined,
    createdAt: (row.created_at as string)?.slice(0, 10) || todayInIsrael(),
  };
}

async function fetchClients(): Promise<Client[] | undefined> {
  const bid = getBusinessId();
  if (!bid) return undefined;
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("business_id", bid)
    .order("created_at", { ascending: false });
  return (data || []).map(mapRow);
}

// One shared fetch + snapshot for every useClients() consumer on the page.
// See document-store.ts's documentsStore for the full rationale.
const clientsStore = createSharedStore<Client[]>(fetchClients, [], (refetch) => {
  // First subscriber only (browser only): load once the business id is known,
  // and reload on every change event - one listener for all consumers.
  onBusinessReady(() => refetch());
  window.addEventListener(CHANGE_EVENT, () => refetch());
});

export function useClients() {
  const snapshot = useSyncExternalStore(
    clientsStore.subscribe,
    clientsStore.getSnapshot,
    clientsStore.getServerSnapshot,
  );
  return { items: snapshot.data, ready: snapshot.ready };
}

/**
 * Paginated, server-side variant for the /clients list view.
 *
 * `useClients()` above stays untouched and keeps fetching every row: it
 * feeds ~16 other consumers (dashboard KPIs, the client picker in every
 * document editor, global search, statement pages, reports, danger-zone
 * counts...) that either look up one client by id or need the whole set to
 * be correct. None of those need to change, and none of them can
 * accidentally end up with a truncated list, because this is a SEPARATE
 * hook - not a flag on the existing one.
 *
 * Only the /clients page itself (the actual list view, which just renders
 * cards and a plain count) uses this. Its header count comes from `total`
 * (the server's `count: "exact"`), so it stays correct even though `items`
 * only holds the current page.
 */
export function useClientsPage(opts: { page: number; search: string }) {
  const { page, search } = opts;
  const [items, setItems] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    setReady(false);

    let query = supabase
      .from("clients")
      .select("*", { count: "exact" })
      .eq("business_id", bid);

    for (const term of searchTerms(search)) {
      query = query.or(ilikeOrClause(CLIENT_SEARCH_COLUMNS, term));
    }

    const from = page * CLIENTS_PAGE_SIZE;
    const to = from + CLIENTS_PAGE_SIZE - 1;
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

  return { items, total, ready, pageSize: CLIENTS_PAGE_SIZE };
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
    const { data: snap } = await supabase
      .from("clients")
      .select("name")
      .eq("id", id)
      .maybeSingle();
    await supabase.from("clients").delete().eq("id", id);
    if (snap?.name) {
      logAudit({
        action: "client.deleted",
        targetType: "client",
        targetId: id,
        targetLabel: snap.name as string,
      });
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },

};
